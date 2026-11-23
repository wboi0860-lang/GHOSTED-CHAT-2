import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_BASE_URL = Deno.env.get('APP_URL') || '';

const FUN_NOTIFICATION_POOL: Array<{
  category: 'location' | 'games' | 'status' | 'chats';
  title: string;
  body: string;
  pushType: 'location' | 'games' | 'status' | 'chat_list';
}> = [
  // LOCATION
  {
    category: 'location',
    title: 'Ghosted Map',
    body: 'Come check out where your friends are 👀',
    pushType: 'location',
  },
  {
    category: 'location',
    title: 'Ghosted Map',
    body: 'Someone is near you on the map... open Location to see who',
    pushType: 'location',
  },
  {
    category: 'location',
    title: 'Ghosted Map',
    body: 'Your friends are moving - check the map before they ghost you',
    pushType: 'location',
  },
  // GAMES
  {
    category: 'games',
    title: 'Ghosted Games',
    body: 'Play 2 Truths 1 Lie - Can your friends catch your lie? 🤥',
    pushType: 'games',
  },
  {
    category: 'games',
    title: 'Ghosted Games',
    body: 'Would You Rather...? Your friends are waiting in Games',
    pushType: 'games',
  },
  {
    category: 'games',
    title: 'Ghosted Games',
    body: 'New game round started - Are you brave enough to play?',
    pushType: 'games',
  },
  // CHAT / STATUS
  {
    category: 'status',
    title: 'Ghosted Idea',
    body: 'Someone just posted a Ghosted Idea - go react before it disappears',
    pushType: 'status',
  },
  {
    category: 'status',
    title: 'Ghosted Idea',
    body: 'Your Ghosted Idea is getting likes - come check it',
    pushType: 'status',
  },
  {
    category: 'chats',
    title: 'Ghosted Chat',
    body: '3 friends are online now - say hi before they go ghost',
    pushType: 'chat_list',
  },
];

function stripGhostPrefix(value?: string | null): string {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  return raw.replace(/^GH-?/i, '').replace(/[\s-]+/g, '');
}

function getLocalClockInTimezone(tz?: string | null, date = new Date()): { dateStr: string; hour: number } {
  const safeTz = tz && tz.trim() ? tz.trim() : 'UTC';
  try {
    const dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const hourFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: safeTz,
      hour: '2-digit',
      hour12: false,
    });
    const dateStr = dateFormatter.format(date);
    const rawHour = Number(hourFormatter.format(date));
    const hour = Number.isFinite(rawHour) ? rawHour % 24 : date.getUTCHours();
    return { dateStr, hour };
  } catch {
    return {
      dateStr: date.toISOString().slice(0, 10),
      hour: date.getUTCHours(),
    };
  }
}

function isQuietHours(hour: number): boolean {
  // NEVER 11pm - 8am (23:00 through 07:59)
  return hour >= 23 || hour < 8;
}

function isRecentlyInApp(profile: any): boolean {
  if (profile?.is_in_app !== true) return false;
  if (!profile?.last_seen_at) return true;
  const ageMs = Date.now() - new Date(profile.last_seen_at).getTime();
  return ageMs < 90 * 1000;
}

function buildDeepLinkPath(data: Record<string, string>): string {
  const params = new URLSearchParams();
  if (data.type) params.set('push_type', data.type);
  if (data.call_id) params.set('call_id', data.call_id);
  if (data.caller_ghost) params.set('caller', data.caller_ghost);
  if (data.peer_ghost) params.set('peer', data.peer_ghost);
  if (data.request_id) params.set('request_id', data.request_id);
  if (data.status_id) params.set('status_id', data.status_id);
  if (data.action) params.set('push_action', data.action);
  const path = `/?${params.toString()}`;
  return APP_BASE_URL ? `${APP_BASE_URL.replace(/\/$/, '')}${path}` : path;
}

async function lookupProfile(
  supabase: ReturnType<typeof createClient>,
  params: { userId?: string | null; ghostNumber?: string | null }
): Promise<any | null> {
  const cols =
    'id, ghost_number, ghosted_number, name, onesignal_id, notifications_enabled, fun_notifications_enabled, dnd_enabled, is_in_app, active_chat_id, active_screen, last_seen_at, last_active_at, timezone, fun_notif_count_today, fun_notif_last_date, fun_notif_last_sent_at, scheduled_fun_notif_ids';

  if (params.userId) {
    const { data } = await supabase.from('profiles').select(cols).eq('id', params.userId).maybeSingle();
    if (data) return data;
  }

  const rawGhost = String(params.ghostNumber || '').trim().toUpperCase();
  const core = stripGhostPrefix(rawGhost);
  if (!rawGhost && !core) return null;

  const candidates = Array.from(
    new Set([
      rawGhost,
      core,
      core.length === 8 ? `GH-${core.slice(0, 4)}-${core.slice(4, 8)}` : '',
    ].filter(Boolean))
  );

  for (const candidate of candidates) {
    const { data } = await supabase
      .from('profiles')
      .select(cols)
      .or(`ghosted_number.eq.${candidate},ghost_number.eq.${candidate}`)
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }

  if (core.length === 8) {
    const p1 = core.slice(0, 4);
    const p2 = core.slice(4, 8);
    const { data } = await supabase
      .from('profiles')
      .select(cols)
      .or(`ghosted_number.ilike.%${p1}%${p2}%,ghost_number.ilike.%${p1}%${p2}%`)
      .limit(5);
    const match = (data || []).find(
      (r: any) => stripGhostPrefix(r.ghosted_number || r.ghost_number) === core
    );
    if (match) return match;
  }

  return null;
}

async function isBlockedByRecipient(
  supabase: ReturnType<typeof createClient>,
  recipientId: string,
  senderGhost: string
): Promise<boolean> {
  if (!recipientId || !senderGhost) return false;
  try {
    const core = stripGhostPrefix(senderGhost);
    const { data } = await supabase
      .from('blocked_users')
      .select('id, blocked_ghost_number')
      .eq('blocker_id', recipientId)
      .limit(50);

    if (!Array.isArray(data)) return false;
    return data.some(
      (row: any) =>
        stripGhostPrefix(row.blocked_ghost_number) === core ||
        String(row.blocked_ghost_number || '').toUpperCase() === senderGhost.toUpperCase()
    );
  } catch {
    return false;
  }
}

async function claimDispatchKey(
  supabase: ReturnType<typeof createClient>,
  eventKey: string
): Promise<boolean> {
  if (!eventKey) return true;
  try {
    const { error } = await supabase
      .from('push_dispatch_log')
      .insert([{ event_key: eventKey, created_at: new Date().toISOString() }]);
    if (error && (error.code === '23505' || /duplicate/i.test(error.message))) {
      return false;
    }
  } catch {}
  return true;
}

async function sendOneSignalNotification(params: {
  onesignalId: string;
  externalUserId?: string;
  title: string;
  body: string;
  data: Record<string, string>;
  highPriority?: boolean;
  sendAfterIso?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const appId = Deno.env.get('ONESIGNAL_APP_ID') || '';
  const apiKey = Deno.env.get('ONESIGNAL_REST_API_KEY') || '';

  if (!appId || !apiKey) {
    return { ok: false, error: 'ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY not configured' };
  }

  const deepUrl = buildDeepLinkPath(params.data);
  const channelUuid = Deno.env.get('ONESIGNAL_ANDROID_CHANNEL_UUID') || '';

  const bodyPayload: Record<string, any> = {
    app_id: appId,
    include_subscription_ids: [params.onesignalId],
    headings: { en: params.title },
    contents: { en: params.body },
    data: {
      ...params.data,
      url: deepUrl,
      color: '#A855F7',
      colorized: 'true',
      title_color: '#000000',
      body_color: '#000000',
      sub_text_color: '#000000',
      android_channel_id: 'ghosted_special',
    },
    url: deepUrl,
    target_channel: 'push',
    // Android: Full Purple (#A855F7) + Black Text (#000000)
    existing_android_channel_id: 'ghosted_special',
    ...(channelUuid ? { android_channel_id: channelUuid } : {}),
    small_icon: 'ic_ghost_black',
    large_icon: 'ic_ghost_large',
    android_accent_color: 'FFA855F7',
    android_led_color: 'FFA855F7',
    android_background_layout: {
      headings_color: 'FF000000',
      contents_color: 'FF000000',
    },
    // iOS: Normal white system card + black text + custom sound & badge
    ios_sound: 'ghost.wav',
    ios_badgeType: 'Increase',
    ios_badgeCount: 1,
  };

  if (params.highPriority) {
    bodyPayload.priority = 10;
    bodyPayload.ttl = 35;
    bodyPayload.android_visibility = 1;
    bodyPayload.android_accent_color = 'FFA855F7';
    bodyPayload.android_led_color = 'FFA855F7';
    bodyPayload.android_group = 'ghosted_calls';
    bodyPayload.ios_interruption_level = 'time-sensitive';
    bodyPayload.web_push_topic = params.data.call_id || 'ghosted_call';
  }

  if (params.sendAfterIso) {
    bodyPayload.send_after = params.sendAfterIso;
  }

  const res = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(bodyPayload),
  });

  const text = await res.text();
  let parsed: any = {};
  try {
    parsed = JSON.parse(text);
  } catch {}

  if (!res.ok) {
    return { ok: false, error: parsed?.errors?.[0] || text || `HTTP ${res.status}` };
  }
  return { ok: true, id: parsed?.id };
}

async function cancelOneSignalNotification(notifId: string): Promise<void> {
  const appId = Deno.env.get('ONESIGNAL_APP_ID') || '';
  const apiKey = Deno.env.get('ONESIGNAL_REST_API_KEY') || '';
  if (!appId || !apiKey || !notifId) return;
  try {
    await fetch(
      `https://api.onesignal.com/notifications/${encodeURIComponent(notifId)}?app_id=${encodeURIComponent(appId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Key ${apiKey}` },
      }
    );
  } catch {}
}

async function storeEphemeralNotification(
  supabase: ReturnType<typeof createClient>,
  params: {
    userId: string;
    ghostNumber: string;
    senderGhost: string;
    title: string;
    body: string;
    type: string;
    data: Record<string, string>;
  }
) {
  try {
    await supabase.from('notifications').insert([
      {
        user_id: params.userId,
        ghost_number: params.ghostNumber,
        sender_ghost_number: params.senderGhost,
        title: params.title,
        message: params.body,
        type: params.type,
        silent: false,
        data: params.data,
        read: false,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    ]);
  } catch {}
}

function pickRandomFunMessage() {
  const idx = Math.floor(Math.random() * FUN_NOTIFICATION_POOL.length);
  return FUN_NOTIFICATION_POOL[idx];
}

async function handleFunReengagementCron(supabase: ReturnType<typeof createClient>) {
  const threeHoursAgoIso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { data: candidates, error } = await supabase
    .from('profiles')
    .select(
      'id, ghost_number, onesignal_id, notifications_enabled, fun_notifications_enabled, dnd_enabled, is_in_app, last_active_at, last_seen_at, timezone, fun_notif_count_today, fun_notif_last_date, fun_notif_last_sent_at'
    )
    .not('onesignal_id', 'is', null)
    .lte('last_active_at', threeHoursAgoIso)
    .limit(250);

  if (error || !Array.isArray(candidates)) {
    return { processed: 0, sentCount: 0, error: error?.message };
  }

  let sentCount = 0;
  for (const user of candidates) {
    if (!user.onesignal_id) continue;
    if (isRecentlyInApp(user)) continue;

    const { dateStr, hour } = getLocalClockInTimezone(user.timezone);
    if (isQuietHours(hour)) continue; // NEVER 11pm - 8am

    const countToday = user.fun_notif_last_date === dateStr ? Number(user.fun_notif_count_today || 0) : 0;
    if (countToday >= 2) continue; // MAX 2 per day

    if (user.fun_notif_last_sent_at) {
      const sinceLastMs = Date.now() - new Date(user.fun_notif_last_sent_at).getTime();
      if (sinceLastMs < 2 * 60 * 60 * 1000) continue;
    }

    const picked = pickRandomFunMessage();
    const dataPayload: Record<string, string> = {
      type: picked.pushType,
      category: picked.category,
      is_fun: 'true',
    };

    const res = await sendOneSignalNotification({
      onesignalId: user.onesignal_id,
      externalUserId: user.id,
      title: picked.title,
      body: picked.body,
      data: dataPayload,
      highPriority: false,
    });

    if (res.ok) {
      sentCount++;
      await supabase
        .from('profiles')
        .update({
          fun_notif_count_today: countToday + 1,
          fun_notif_last_date: dateStr,
          fun_notif_last_sent_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      await storeEphemeralNotification(supabase, {
        userId: user.id,
        ghostNumber: user.ghost_number || '',
        senderGhost: 'GHOSTED',
        title: picked.title,
        body: picked.body,
        type: 'fun_reengagement',
        data: dataPayload,
      });
    }
  }

  return { processed: candidates.length, sentCount };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const payload = await req.json().catch(() => ({}));

    // =========================================================================
    // PART 2: FUN RE-ENGAGEMENT CRON / SCHEDULE / CANCEL MODES
    // =========================================================================
    if (payload.mode === 'fun_reengagement') {
      const result = await handleFunReengagementCron(supabase);
      return new Response(JSON.stringify({ ok: true, mode: 'fun_reengagement', ...result }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (payload.mode === 'cancel_scheduled_fun' && payload.user_id) {
      const prof = await lookupProfile(supabase, { userId: payload.user_id });
      const existingIds: string[] = Array.isArray(prof?.scheduled_fun_notif_ids)
        ? prof.scheduled_fun_notif_ids
        : [];
      for (const nid of existingIds) {
        await cancelOneSignalNotification(nid);
      }
      await supabase
        .from('profiles')
        .update({ scheduled_fun_notif_ids: [], last_active_at: new Date().toISOString(), is_in_app: true })
        .eq('id', payload.user_id);
      return new Response(JSON.stringify({ ok: true, cancelled: existingIds.length }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (payload.mode === 'schedule_fun_for_user' && payload.user_id) {
      const prof = await lookupProfile(supabase, { userId: payload.user_id });
      if (!prof || !prof.onesignal_id) {
        return new Response(JSON.stringify({ ok: false, reason: 'not_eligible' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Cancel old queued ones first so we never stack >2 per day
      const existingIds: string[] = Array.isArray(prof.scheduled_fun_notif_ids)
        ? prof.scheduled_fun_notif_ids
        : [];
      for (const nid of existingIds) {
        await cancelOneSignalNotification(nid);
      }

      const { dateStr } = getLocalClockInTimezone(prof.timezone);
      const alreadyToday = prof.fun_notif_last_date === dateStr ? Number(prof.fun_notif_count_today || 0) : 0;
      const slotsLeft = Math.max(0, 2 - alreadyToday);
      const scheduledIds: string[] = [];

      const offsetsHours = [3.2, 6.5].slice(0, slotsLeft);
      for (const offsetH of offsetsHours) {
        const candidateDate = new Date(Date.now() + offsetH * 60 * 60 * 1000);
        const targetClock = getLocalClockInTimezone(prof.timezone, candidateDate);
        if (isQuietHours(targetClock.hour)) continue;
        if (targetClock.dateStr !== dateStr && scheduledIds.length >= 2) continue;

        const picked = pickRandomFunMessage();
        const res = await sendOneSignalNotification({
          onesignalId: prof.onesignal_id,
          externalUserId: prof.id,
          title: picked.title,
          body: picked.body,
          data: {
            type: picked.pushType,
            category: picked.category,
            is_fun: 'true',
          },
          sendAfterIso: candidateDate.toISOString(),
        });
        if (res.ok && res.id) {
          scheduledIds.push(res.id);
        }
      }

      await supabase
        .from('profiles')
        .update({ scheduled_fun_notif_ids: scheduledIds })
        .eq('id', prof.id);

      return new Response(JSON.stringify({ ok: true, scheduledIds }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // PART 1: REAL-TIME EVENT TRIGGERS (DB Webhooks OR Direct Invoke)
    // =========================================================================
    const table = String(payload.table || '').toLowerCase();
    const op = String(payload.type || '').toUpperCase();
    const eventType = String(payload.event_type || '').toLowerCase();
    const record = payload.record || payload;
    const oldRecord = payload.old_record || null;

    let normalizedEvent:
      | 'call'
      | 'chat'
      | 'map_request'
      | 'map_accepted'
      | 'status_like'
      | null = null;

    if (eventType === 'call' || (table === 'call_requests' && op === 'INSERT')) {
      if (record.status === 'ringing') normalizedEvent = 'call';
    } else if (eventType === 'chat' || (table === 'chats' && op === 'INSERT')) {
      normalizedEvent = 'chat';
    } else if (eventType === 'map_request' || (table === 'map_requests' && op === 'INSERT')) {
      if (!record.status || record.status === 'pending') normalizedEvent = 'map_request';
    } else if (eventType === 'map_accepted' || (table === 'map_requests' && op === 'UPDATE')) {
      if (record.status === 'accepted' && (!oldRecord || oldRecord.status !== 'accepted')) {
        normalizedEvent = 'map_accepted';
      }
    } else if (eventType === 'status_like' || (table === 'status_likes' && op === 'INSERT')) {
      normalizedEvent = 'status_like';
    }

    if (!normalizedEvent) {
      return new Response(JSON.stringify({ sent: false, reason: 'ignored_event' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let recipient: any = null;
    let senderGhost = '';
    let title = '';
    let body = '';
    let pushData: Record<string, string> = {};
    let highPriority = false;
    let eventKey = '';
    let targetScreenCheck: 'call' | 'chat' | 'map' | 'status' = 'chat';

    if (normalizedEvent === 'call') {
      senderGhost = String(record.caller_ghosted_number || record.caller_ghost || record.caller_ghost_number || '').trim().toUpperCase();
      const callId = String(record.id || record.call_id || '');
      recipient = await lookupProfile(supabase, {
        userId: record.receiver_id,
        ghostNumber: record.receiver_ghosted_number || record.receiver_ghost || record.receiver_ghost_number,
      });
      if (!recipient) {
        return new Response(JSON.stringify({ sent: false, reason: 'recipient_not_found' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const recipientGhost = recipient.ghosted_number || recipient.ghost_number;
      if (recipient.id === record.caller_id || stripGhostPrefix(recipientGhost) === stripGhostPrefix(senderGhost)) {
        return new Response(JSON.stringify({ sent: false, reason: 'self_ignored' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      eventKey = `call:${callId}`;
      title = 'Incoming Ghost Call';
      body = `${senderGhost} is calling you`;
      highPriority = true;
      targetScreenCheck = 'call';
      pushData = {
        type: 'call',
        call_id: callId,
        caller_ghost: senderGhost,
        caller_name: String(record.caller_name || ''),
      };
    } else if (normalizedEvent === 'chat') {
      senderGhost = String(record.sender_ghosted_number || record.sender_ghost || record.sender_ghost_number || '').trim().toUpperCase();
      const msgText = String(record.message || record.text || '').trim();
      const msgId = String(record.id || `${senderGhost}_${Date.now()}`);
      recipient = await lookupProfile(supabase, {
        userId: record.receiver_id,
        ghostNumber: record.receiver_ghosted_number || record.receiver_ghost || record.receiver_ghost_number,
      });
      if (!recipient) {
        return new Response(JSON.stringify({ sent: false, reason: 'recipient_not_found' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const recipientGhost = recipient.ghosted_number || recipient.ghost_number;
      if (recipient.id === record.sender_id || stripGhostPrefix(recipientGhost) === stripGhostPrefix(senderGhost)) {
        return new Response(JSON.stringify({ sent: false, reason: 'self_ignored' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Do NOT send if receiver is inside that same chat
      if (
        isRecentlyInApp(recipient) &&
        recipient.active_screen === 'chat_detail' &&
        stripGhostPrefix(recipient.active_chat_id) === stripGhostPrefix(senderGhost)
      ) {
        return new Response(JSON.stringify({ sent: false, reason: 'receiver_in_same_chat' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      eventKey = `chat:${msgId}`;
      title = 'New Ghost Chat';
      body = `${senderGhost}: ${msgText.slice(0, 50)}`;
      targetScreenCheck = 'chat';
      pushData = {
        type: 'chat',
        peer_ghost: senderGhost,
        chat_id: String(record.chat_id || ''),
      };
    } else if (normalizedEvent === 'map_request') {
      senderGhost = String(record.from_ghost_number || record.from_name || 'Someone').trim().toUpperCase();
      const reqId = String(record.id || `${record.from_id}_${record.to_id}`);
      recipient = await lookupProfile(supabase, {
        userId: record.to_id,
        ghostNumber: record.to_ghost_number,
      });
      if (!recipient) {
        return new Response(JSON.stringify({ sent: false, reason: 'recipient_not_found' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      eventKey = `map_req:${reqId}:${record.updated_at || record.created_at || ''}`;
      title = 'Map Request';
      body = `${senderGhost} wants to see where you are`;
      targetScreenCheck = 'map';
      pushData = {
        type: 'map',
        action: 'map_request',
        request_id: reqId,
        from_ghost: senderGhost,
      };
    } else if (normalizedEvent === 'map_accepted') {
      senderGhost = String(record.to_ghost_number || record.to_name || 'Your friend').trim().toUpperCase();
      const reqId = String(record.id || `${record.from_id}_${record.to_id}`);
      recipient = await lookupProfile(supabase, {
        userId: record.from_id,
        ghostNumber: record.from_ghost_number,
      });
      if (!recipient) {
        return new Response(JSON.stringify({ sent: false, reason: 'recipient_not_found' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      eventKey = `map_acc:${reqId}:${record.updated_at || ''}`;
      title = 'Map Request Accepted';
      body = `${senderGhost} accepted your map request`;
      targetScreenCheck = 'map';
      pushData = {
        type: 'map',
        action: 'map_accepted',
        request_id: reqId,
        peer_ghost: senderGhost,
      };
    } else if (normalizedEvent === 'status_like') {
      const statusId = String(record.status_id || '');
      const likerUserId = String(record.user_id || '');
      const { data: idea } = await supabase
        .from('ideas')
        .select('id, user_id, ghost_number')
        .eq('id', statusId)
        .maybeSingle();

      if (!idea || !idea.user_id || idea.user_id === likerUserId) {
        return new Response(JSON.stringify({ sent: false, reason: 'idea_missing_or_self_like' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const likerProfile = await lookupProfile(supabase, { userId: likerUserId });
      senderGhost = String(likerProfile?.ghost_number || 'Someone').trim().toUpperCase();
      recipient = await lookupProfile(supabase, {
        userId: idea.user_id,
        ghostNumber: idea.ghost_number,
      });
      if (!recipient) {
        return new Response(JSON.stringify({ sent: false, reason: 'creator_not_found' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      eventKey = `status_like:${statusId}:${likerUserId}`;
      title = 'Ghosted Idea';
      body = `${senderGhost} liked your Ghosted Idea`;
      targetScreenCheck = 'status';
      pushData = {
        type: 'status',
        status_id: statusId,
        liker_ghost: senderGhost,
      };
    }

    if (!recipient) {
      return new Response(JSON.stringify({ sent: false, reason: 'recipient_not_found' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (await isBlockedByRecipient(supabase, recipient.id, senderGhost)) {
      return new Response(JSON.stringify({ sent: false, reason: 'blocked' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // App special notifications ONLY show OUTSIDE the app as system push notifications
    if (isRecentlyInApp(recipient)) {
      return new Response(JSON.stringify({ sent: false, reason: 'recipient_in_app_outside_only' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Deduplicate between DB Webhook trigger and Client invoke
    const claimed = await claimDispatchKey(supabase, eventKey);
    if (!claimed) {
      return new Response(JSON.stringify({ sent: false, reason: 'already_dispatched' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Store ephemeral in-app notification row in Supabase
    await storeEphemeralNotification(supabase, {
      userId: recipient.id,
      ghostNumber: recipient.ghosted_number || recipient.ghost_number || '',
      senderGhost,
      title,
      body,
      type: pushData.type || normalizedEvent,
      data: pushData,
    });

    if (!recipient.onesignal_id) {
      return new Response(
        JSON.stringify({ sent: false, reason: 'no_onesignal_id', storedInSupabase: true, title, body }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const osRes = await sendOneSignalNotification({
      onesignalId: recipient.onesignal_id,
      externalUserId: recipient.id,
      title,
      body,
      data: pushData,
      highPriority,
    });

    return new Response(
      JSON.stringify({
        sent: osRes.ok,
        onesignal_notification_id: osRes.id || null,
        error: osRes.error || null,
        event: normalizedEvent,
        title,
        body,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ sent: false, error: (err as Error).message || 'send-push error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
