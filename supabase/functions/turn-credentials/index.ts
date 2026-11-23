import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Generates short-lived TURN relay credentials so peers NEVER connect directly (zero IP leak).
 * Supports Cloudflare Calls TURN or Twilio Network Traversal Service.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const cfTurnKeyId = Deno.env.get('CLOUDFLARE_TURN_KEY_ID');
    const cfTurnApiToken = Deno.env.get('CLOUDFLARE_TURN_API_TOKEN');

    if (cfTurnKeyId && cfTurnApiToken) {
      const cfRes = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${cfTurnKeyId}/credentials/generate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cfTurnApiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: 300 }),
        }
      );

      if (cfRes.ok) {
        const data = await cfRes.json();
        return new Response(
          JSON.stringify({
            iceServers: data.iceServers ? [data.iceServers] : [],
            iceTransportPolicy: 'relay',
            provider: 'cloudflare_turn',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const twilioSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioAuth = Deno.env.get('TWILIO_AUTH_TOKEN');

    if (twilioSid && twilioAuth) {
      const basicAuth = btoa(`${twilioSid}:${twilioAuth}`);
      const twRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Tokens.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basicAuth}`,
          },
        }
      );

      if (twRes.ok) {
        const data = await twRes.json();
        // Filter ONLY TURN relay URLs (strip direct STUN to guarantee zero IP leak)
        const relayServers = (data.ice_servers || []).filter((s: { urls?: string; url?: string }) => {
          const u = s.urls || s.url || '';
          return u.startsWith('turn:') || u.startsWith('turns:');
        });
        return new Response(
          JSON.stringify({
            iceServers: relayServers,
            iceTransportPolicy: 'relay',
            provider: 'twilio_turn',
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Metered / custom TURN relay fallback via env
    const customTurnUrl = Deno.env.get('TURN_SERVER_URL');
    const customTurnUser = Deno.env.get('TURN_SERVER_USERNAME');
    const customTurnPass = Deno.env.get('TURN_SERVER_CREDENTIAL');

    const iceServers = customTurnUrl
      ? [
          {
            urls: customTurnUrl,
            username: customTurnUser || '',
            credential: customTurnPass || '',
          },
        ]
      : [];

    return new Response(
      JSON.stringify({
        iceServers,
        iceTransportPolicy: 'relay',
        provider: customTurnUrl ? 'custom_turn' : 'relay_policy_enforced',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
