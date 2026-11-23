import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find connected calls exceeding max_duration_seconds OR stale heartbeat (>30s)
    const { data: activeCalls } = await supabase
      .from('calls')
      .select('*')
      .eq('status', 'connected');

    const nowMs = Date.now();
    const forceEndedIds: string[] = [];

    for (const call of activeCalls || []) {
      const startedMs = call.started_at ? new Date(call.started_at).getTime() : new Date(call.created_at).getTime();
      const lastHbMs = call.last_heartbeat ? new Date(call.last_heartbeat).getTime() : startedMs;
      const maxSecs = call.max_duration_seconds || 120;

      const elapsedSecs = Math.floor((nowMs - startedMs) / 1000);
      const hbAgeSecs = Math.floor((nowMs - lastHbMs) / 1000);

      if (elapsedSecs >= maxSecs || hbAgeSecs >= 30) {
        const reason = elapsedSecs >= maxSecs ? 'max_duration_reached' : 'heartbeat_timeout';
        await supabase
          .from('calls')
          .update({
            status: 'ended',
            ended_at: new Date().toISOString(),
            duration_seconds: Math.min(maxSecs, elapsedSecs),
          })
          .eq('id', call.id);

        // Broadcast call_ended to both participants
        for (const num of [call.caller_ghost_number, call.receiver_ghost_number]) {
          const ch = supabase.channel(`call:${num}`);
          await ch.send({
            type: 'broadcast',
            event: 'call_ended',
            payload: { call_id: call.id, reason },
          });
          await supabase.removeChannel(ch);
        }

        forceEndedIds.push(call.id);
      }
    }

    // Trigger SQL cleanup for calls older than 5 seconds post-end
    await supabase.rpc('cleanup_expired_calls');

    return new Response(
      JSON.stringify({ checked: (activeCalls || []).length, force_ended: forceEndedIds }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
