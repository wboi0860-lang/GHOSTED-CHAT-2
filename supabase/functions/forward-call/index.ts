import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizeGhostCompact(num: string): string {
  return (num || '').replace(/[\s-]+/g, '').toLowerCase().trim();
}

async function lookupGhostParticipant(
  supabase: ReturnType<typeof createClient>,
  rawNumber: string
) {
  if (!rawNumber) return null;

  const norm = normalizeGhostCompact(rawNumber);
  const digits = norm.replace(/\D/g, '').slice(0, 8);
  if (digits.length !== 8) return null;

  const p1 = digits.slice(0, 4);
  const p2 = digits.slice(4, 8);
  const canonicalGh = `GH-${p1}-${p2}`;

  try {
    const filters = [
      `ghosted_number.eq.${canonicalGh}`,
      `ghosted_number.ilike.${canonicalGh}`,
      `ghost_number.eq.${canonicalGh}`,
      `ghost_number.ilike.${canonicalGh}`,
      `ghost_number.ilike.gh${digits}`,
      `ghosted_number.ilike.%${p1}%${p2}%`,
      `ghost_number.ilike.%${p1}%${p2}%`,
    ];

    const { data } = await supabase
      .from('profiles')
      .select('id, ghost_number, ghosted_number, is_vip, is_online, is_in_app, dnd_enabled, can_call, fcm_token')
      .or(filters.join(','))
      .limit(10);

    if (Array.isArray(data) && data.length > 0) {
      const match = data.find((r: any) => {
        const g = (r.ghosted_number || r.ghost_number || '').trim().toUpperCase();
        if (!g) return false;
        const gDigits = g.replace(/\D/g, '');
        return gDigits === digits;
      });
      if (match) {
        return {
          ...match,
          id: match.id,
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { caller_ghost_number, receiver_ghost_number, offer_sdp } = await req.json();

    if (!caller_ghost_number || !receiver_ghost_number || !offer_sdp) {
      return new Response(
        JSON.stringify({ error: 'caller_ghost_number, receiver_ghost_number, and offer_sdp are required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (normalizeGhostCompact(caller_ghost_number) === normalizeGhostCompact(receiver_ghost_number)) {
      return new Response(
        JSON.stringify({ error: 'Cannot call your own GHOSTED Number.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Lookup caller & receiver in `profiles`
    const [callerProfile, receiverProfile] = await Promise.all([
      lookupGhostParticipant(supabase, caller_ghost_number),
      lookupGhostParticipant(supabase, receiver_ghost_number),
    ]);

    if (!receiverProfile) {
      return new Response(
        JSON.stringify({ error: 'Number not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (callerProfile && callerProfile.can_call === false) {
      return new Response(
        JSON.stringify({ error: 'Calling is currently restricted on this account.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Check if receiver blocked caller (Rule: If blocked = no push)
    const { data: blockedRow } = await supabase
      .from('blocked_users')
      .select('id')
      .eq('blocker_id', receiverProfile.id)
      .eq('blocked_ghost_number', caller_ghost_number)
      .maybeSingle();

    if (blockedRow) {
      return new Response(
        JSON.stringify({ forwarded: false, reason: 'unavailable', status: 'missed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Check if receiver is busy, on DND, or unreachable (app closed without FCM token)
    const { data: activeCalls } = await supabase
      .from('calls')
      .select('id')
      .in('status', ['ringing', 'connected'])
      .or(
        `caller_ghost_number.eq.${receiver_ghost_number},receiver_ghost_number.eq.${receiver_ghost_number}`
      )
      .limit(1);

    const isBusy = Boolean(activeCalls && activeCalls.length > 0);
    const isDnd = receiverProfile.dnd_enabled === true;
    const isUnreachableOffline = receiverProfile.is_online === false && !receiverProfile.fcm_token;

    if (isBusy || isDnd || isUnreachableOffline) {
      // Store temporary 24h missed notification (auto-deletes after 24h, NOT call history)
      await supabase.from('missed_call_notifications').insert([
        {
          receiver_ghost_number,
          caller_ghost_number,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      ]);

      // Dispatch push via send_notification (DND enforces silent missed only)
      await supabase.functions.invoke('send_notification', {
        body: {
          recipient_ghost_number: receiver_ghost_number,
          recipient_user_id: receiverProfile.id,
          sender_ghost_number: caller_ghost_number,
          type: 'missed_call',
        },
      }).catch(() => {});

      return new Response(
        JSON.stringify({
          forwarded: false,
          status: 'missed',
          reason: isBusy
            ? 'Receiver is on another call'
            : isDnd
            ? 'Receiver is on Do Not Disturb'
            : 'Receiver is offline',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Compute max_duration_seconds: VIP (caller OR receiver) = 150s (2m30s), Free = 120s (2m00s)
    const eitherVip = Boolean(callerProfile?.is_vip || receiverProfile.is_vip);
    const maxDurationSeconds = eitherVip ? 150 : 120;

    // 5. Create call record + invite + participants
    const { data: callRow, error: callErr } = await supabase
      .from('calls')
      .insert([
        {
          caller_ghost_number,
          receiver_ghost_number,
          caller_ghosted_number: caller_ghost_number,
          receiver_ghosted_number: receiver_ghost_number,
          max_duration_seconds: maxDurationSeconds,
          status: 'ringing',
          last_heartbeat: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (callErr || !callRow) {
      throw new Error(callErr?.message || 'Failed to create call session');
    }

    await supabase.from('call_invites').insert([
      {
        call_id: callRow.id,
        caller_ghost_number,
        receiver_ghost_number,
        offer_sdp,
      },
    ]);

    await supabase.from('call_participants').insert([
      { call_id: callRow.id, ghost_number: caller_ghost_number, role: 'caller' },
      { call_id: callRow.id, ghost_number: receiver_ghost_number, role: 'receiver' },
    ]);

    // 6. Broadcast incoming invite to receiver's Realtime channel: call:<RECEIVER_GHOST_NUMBER>
    const channel = supabase.channel(`call:${receiver_ghost_number}`);
    await channel.send({
      type: 'broadcast',
      event: 'incoming_call',
      payload: {
        call_id: callRow.id,
        caller_ghost_number,
        receiver_ghost_number,
        caller_ghosted_number: caller_ghost_number,
        receiver_ghosted_number: receiver_ghost_number,
        offer_sdp,
        max_duration_seconds: maxDurationSeconds,
        created_at: callRow.created_at,
      },
    });
    await supabase.removeChannel(channel);

    // 7. If receiver is NOT in app, dispatch FCM Incoming Call push via send_notification
    if (!receiverProfile.is_in_app && receiverProfile.fcm_token) {
      await supabase.functions.invoke('send_notification', {
        body: {
          recipient_ghost_number: receiver_ghost_number,
          recipient_user_id: receiverProfile.id,
          sender_ghost_number: caller_ghost_number,
          type: 'call',
          call_id: callRow.id,
          max_duration_seconds: maxDurationSeconds,
        },
      }).catch(() => {});
    }

    return new Response(
      JSON.stringify({
        forwarded: true,
        call_id: callRow.id,
        max_duration_seconds: maxDurationSeconds,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || 'Call forward error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
