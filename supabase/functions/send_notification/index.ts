import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type NotificationType = 'message' | 'call' | 'missed_call';

interface SendNotificationPayload {
  recipient_ghost_number?: string;
  recipient_user_id?: string;
  sender_ghost_number: string;
  type: NotificationType;
  call_id?: string;
  max_duration_seconds?: number;
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getGoogleAccessTokenFromServiceAccount(serviceAccountJson: string): Promise<{ accessToken: string; projectId: string } | null> {
  try {
    const sa = JSON.parse(serviceAccountJson);
    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claimSet = base64UrlEncode(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
      })
    );

    const unsignedToken = `${header}.${claimSet}`;
    const pemBody = (sa.private_key || '')
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    const keyDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      keyDer.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      new TextEncoder().encode(unsignedToken)
    );

    const jwt = `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
    });

    if (!tokenRes.ok) return null;
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return null;

    return {
      accessToken: tokenData.access_token,
      projectId: sa.project_id || Deno.env.get('FIREBASE_PROJECT_ID') || 'concise-veld-8rrhs',
    };
  } catch {
    return null;
  }
}

async function dispatchFcmPush(params: {
  token: string;
  title: string;
  body: string;
  silent: boolean;
  data: Record<string, string>;
}): Promise<{ dispatched: boolean; provider: string; error?: string }> {
  const serviceAccountJson = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (serviceAccountJson) {
    const auth = await getGoogleAccessTokenFromServiceAccount(serviceAccountJson);
    if (auth) {
      const url = `https://fcm.googleapis.com/v1/projects/${auth.projectId}/messages:send`;
      const fcmRes = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: params.token,
            data: params.data,
            android: {
              priority: params.silent ? 'normal' : 'high',
              notification: {
                title: params.title,
                body: params.body,
                ...(params.silent ? { notification_priority: 'PRIORITY_MIN', default_sound: false } : { sound: 'default' }),
              },
            },
            apns: {
              headers: {
                'apns-priority': params.silent ? '5' : '10',
              },
              payload: {
                aps: {
                  alert: { title: params.title, body: params.body },
                  ...(params.silent ? { 'content-available': 1 } : { sound: 'default' }),
                },
              },
            },
            webpush: {
              headers: { Urgency: params.silent ? 'low' : 'high' },
              notification: {
                title: params.title,
                body: params.body,
                silent: params.silent,
                requireInteraction: params.data.type === 'call',
              },
              fcm_options: {
                link: params.data.url || '/',
              },
            },
          },
        }),
      });
      if (fcmRes.ok) {
        return { dispatched: true, provider: 'fcm_v1' };
      }
      const errText = await fcmRes.text();
      return { dispatched: false, provider: 'fcm_v1', error: errText };
    }
  }

  const fcmServerKey = Deno.env.get('FCM_SERVER_KEY');
  if (fcmServerKey) {
    const legacyRes = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${fcmServerKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: params.token,
        priority: params.silent ? 'normal' : 'high',
        notification: {
          title: params.title,
          body: params.body,
          ...(params.silent ? {} : { sound: 'default' }),
        },
        data: params.data,
      }),
    });
    if (legacyRes.ok) {
      return { dispatched: true, provider: 'fcm_legacy' };
    }
    const errText = await legacyRes.text();
    return { dispatched: false, provider: 'fcm_legacy', error: errText };
  }

  return { dispatched: false, provider: 'none', error: 'FCM credentials not configured in Edge Function secrets' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const payload = (await req.json()) as SendNotificationPayload;
    const senderGhostNumber = (payload.sender_ghost_number || '').trim().toUpperCase();
    const recipientGhostNumber = (payload.recipient_ghost_number || '').trim().toUpperCase();
    const recipientUserId = (payload.recipient_user_id || '').trim();
    const requestedType = payload.type;

    if (!senderGhostNumber || (!recipientGhostNumber && !recipientUserId) || !requestedType) {
      return new Response(
        JSON.stringify({ sent: false, error: 'sender_ghost_number, recipient identifier, and type are required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (recipientGhostNumber && senderGhostNumber === recipientGhostNumber) {
      return new Response(
        JSON.stringify({ sent: false, reason: 'self_notification_ignored' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Rule: Delete notifications older than 24 hours automatically
    const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('notifications').delete().lte('expires_at', new Date().toISOString());
    await supabase.from('notifications').delete().lte('created_at', cutoffIso);

    // 1. Lookup recipient profile in Supabase (`profiles`)
    const normGhost = recipientGhostNumber.replace(/[\s-]+/g, '').toLowerCase();
    const digits = normGhost.replace(/\D/g, '').slice(0, 8);
    const p1 = digits.slice(0, 4);
    const p2 = digits.slice(4, 8);
    const canonicalFormatted = p1.length === 4 && p2.length === 4 ? `GH-${p1}-${p2}` : recipientGhostNumber;

    let recipient: any = null;
    try {
      const selectCols = 'id, ghost_number, ghosted_number, fcm_token, dnd_enabled, is_in_app, is_online, last_seen_at';
      if (recipientGhostNumber) {
        const filters = [
          `ghosted_number.eq.${recipientGhostNumber}`,
          `ghosted_number.eq.${canonicalFormatted}`,
          `ghost_number.eq.${recipientGhostNumber}`,
          `ghost_number.eq.${canonicalFormatted}`,
          `ghosted_number.ilike.${normGhost}`,
          `ghost_number.ilike.${normGhost}`,
        ];
        if (p1.length === 4 && p2.length === 4) {
          filters.push(`ghosted_number.ilike.%${p1}%${p2}%`, `ghost_number.ilike.%${p1}%${p2}%`);
        }
        const { data } = await supabase.from('profiles').select(selectCols).or(filters.join(',')).limit(10);
        const match = (data || []).find((r: any) => {
          const val = (r.ghosted_number || r.ghost_number || '').replace(/[\s-]+/g, '').toLowerCase();
          return val === normGhost || (digits.length === 8 && val === `gh${digits}`);
        });
        if (match) {
          recipient = match;
        }
      } else if (recipientUserId) {
        const { data } = await supabase.from('profiles').select(selectCols).eq('id', recipientUserId).maybeSingle();
        if (data) {
          recipient = data;
        }
      }
    } catch {}

    if (!recipient) {
      return new Response(
        JSON.stringify({ sent: false, reason: 'recipient_not_found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Rule: If blocked = no push
    const { data: blockedRow } = await supabase
      .from('blocked_users')
      .select('id')
      .eq('blocker_id', recipient.id)
      .eq('blocked_ghost_number', senderGhostNumber)
      .maybeSingle();

    if (blockedRow) {
      return new Response(
        JSON.stringify({ sent: false, reason: 'blocked' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Rule: If in app = no push
    const lastSeenMs = recipient.last_seen_at ? new Date(recipient.last_seen_at).getTime() : 0;
    const isRecentlyActiveInApp =
      recipient.is_in_app === true && (lastSeenMs === 0 || Date.now() - lastSeenMs < 5 * 60 * 1000);

    if (isRecentlyActiveInApp) {
      return new Response(
        JSON.stringify({ sent: false, reason: 'recipient_in_app' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Rule: If DND = silent missed only
    const isDnd = recipient.dnd_enabled === true;
    let effectiveType: NotificationType = requestedType;
    let isSilent = false;

    if (isDnd) {
      if (requestedType === 'message') {
        return new Response(
          JSON.stringify({ sent: false, reason: 'dnd_suppresses_message_push' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      // Incoming call or missed call under DND => silent missed only
      effectiveType = 'missed_call';
      isSilent = true;
    }

    // 5. Build exact privacy-safe notification payload (NEVER includes message text)
    const targetGhost = recipient.ghosted_number || recipient.ghost_number || recipientGhostNumber;
    let body = '';
    let dataPayload: Record<string, string> = {};

    if (effectiveType === 'message') {
      body = `New GHOSTED Message from ${senderGhostNumber}`;
      dataPayload = {
        type: 'message',
        action: 'open_chat',
        sender_ghost_number: senderGhostNumber,
        silent: 'false',
        url: `/?action=open_chat&peer=${encodeURIComponent(senderGhostNumber)}`,
      };
    } else if (effectiveType === 'call') {
      const callId = payload.call_id || '';
      const maxDuration = String(payload.max_duration_seconds || 120);
      body = `Incoming call from ${senderGhostNumber}`;
      dataPayload = {
        type: 'call',
        action: 'incoming_call',
        sender_ghost_number: senderGhostNumber,
        call_id: callId,
        max_duration_seconds: maxDuration,
        silent: 'false',
        url: `/?action=incoming_call&callId=${encodeURIComponent(callId)}&caller=${encodeURIComponent(senderGhostNumber)}&maxDuration=${encodeURIComponent(maxDuration)}`,
      };
    } else {
      body = `Missed call from ${senderGhostNumber}`;
      dataPayload = {
        type: 'missed_call',
        action: 'open_calls',
        sender_ghost_number: senderGhostNumber,
        silent: isSilent ? 'true' : 'false',
        url: '/?action=open_calls',
      };
    }

    // 6. Store ephemeral notification in Supabase (auto-deletes after 24h)
    const expiresAtIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('notifications').insert([
      {
        user_id: recipient.id,
        ghost_number: targetGhost,
        sender_ghost_number: senderGhostNumber,
        title: 'GHOSTED',
        message: body,
        type: effectiveType,
        silent: isSilent,
        data: dataPayload,
        read: false,
        expires_at: expiresAtIso,
      },
    ]);

    // 7. Send FCM push if fcm_token is registered in profiles
    let fcmResult: { dispatched: boolean; provider: string; error?: string } = {
      dispatched: false,
      provider: 'none',
      error: 'no_fcm_token',
    };

    if (recipient.fcm_token) {
      fcmResult = await dispatchFcmPush({
        token: recipient.fcm_token,
        title: 'GHOSTED',
        body,
        silent: isSilent,
        data: dataPayload,
      });
    }

    return new Response(
      JSON.stringify({
        sent: true,
        type: effectiveType,
        silent: isSilent,
        body,
        fcm: fcmResult,
        expires_at: expiresAtIso,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ sent: false, error: (err as Error).message || 'send_notification error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
