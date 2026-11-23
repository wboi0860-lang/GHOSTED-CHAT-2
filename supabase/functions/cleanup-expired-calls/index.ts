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

    const { data: deletedCount, error } = await supabase.rpc('cleanup_expired_calls');
    if (error) throw error;

    const { data: deletedNotifs } = await supabase.rpc('cleanup_expired_notifications');
    const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('notifications').delete().lte('created_at', cutoffIso);

    return new Response(
      JSON.stringify({
        success: true,
        deleted_calls: deletedCount ?? 0,
        deleted_notifications: deletedNotifs ?? 0,
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
