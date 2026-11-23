import express from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

const supabaseServerUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://femknysvyzlmthuyymav.supabase.co';

const supabaseServerKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_LCTK3u9-avSYt4otHD7iTA_8F1dd_1Z';

const supabaseServer = createClient(supabaseServerUrl, supabaseServerKey);

function normalizeGhostNumberServer(raw?: string | null): string {
  const cleaned = String(raw || '').toUpperCase().trim();
  const match = cleaned.match(/^(?:GH[-\s]?)?(\d{4,})$/);
  return match ? `GH-${match[1]}` : '';
}

function formatGhostNumberFromCounterServer(counter: number): string {
  const safeCounter = Math.max(1, Math.floor(counter));
  const counterPart = String(safeCounter).padStart(3, '0');
  return `GH-1${counterPart}`;
}

function extractCounterFromGhServer(gh?: string | null): number | null {
  const norm = normalizeGhostNumberServer(gh);
  if (!norm) return null;
  const match = norm.match(/^GH-1(\d{3,})$/);
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function computePlanExpiryIso(plan: string): string {
  const now = new Date();
  if (plan === 'daily') {
    now.setDate(now.getDate() + 1);
    return now.toISOString();
  }
  if (plan === 'monthly') {
    now.setDate(now.getDate() + 30);
    return now.toISOString();
  }
  if (plan === 'yearly') {
    now.setDate(now.getDate() + 365);
    return now.toISOString();
  }
  if (plan === 'vip_games_8m') {
    now.setMonth(now.getMonth() + 8);
    return now.toISOString();
  }
  now.setDate(now.getDate() + 30);
  return now.toISOString();
}

interface ResolvedVipStatus {
  gh_number: string;
  email?: string;
  is_vip: boolean;
  main_vip_active: boolean;
  game1_active: boolean;
  game2_active: boolean;
  vip_type: 'MAIN' | 'GAME' | 'BOTH' | null;
  vip_expires_at?: string | null;
  paid_tag: string | null;
  plan?: string | null;
  vip_start_date?: string | null;
  vip_end_date?: string | null;
}

function isVipExpiredServer(endIso?: string | null): boolean {
  if (!endIso) return true;
  const ms = new Date(endIso).getTime();
  return Number.isNaN(ms) || Date.now() >= ms;
}

function isOptionalExpiryValidServer(endIso?: string | null): boolean {
  if (!endIso) return true; // No expiry unless set
  const ms = new Date(endIso).getTime();
  return !Number.isNaN(ms) && Date.now() < ms;
}

function computePaidTagServer(flags: {
  mainVipActive: boolean;
  game1Active: boolean;
  game2Active: boolean;
}): string | null {
  const { mainVipActive, game1Active, game2Active } = flags;
  if (mainVipActive) {
    if (game1Active && game2Active) return 'PAID GAMES ✅';
    if (game1Active) return 'PAID GAME 1 ✅';
    if (game2Active) return 'PAID GAME 2 ✅';
    return 'PAID';
  }
  if (game1Active && game2Active) return 'GAMES ✅';
  if (game1Active) return 'GAME 1 ✅';
  if (game2Active) return 'GAME 2 ✅';
  return null;
}

function computeVipTypeServer(flags: {
  mainVipActive: boolean;
  game1Active: boolean;
  game2Active: boolean;
}): 'MAIN' | 'GAME' | 'BOTH' | null {
  const { mainVipActive, game1Active, game2Active } = flags;
  if (mainVipActive && (game1Active || game2Active)) return 'BOTH';
  if (mainVipActive) return 'MAIN';
  if (game1Active || game2Active) return 'GAME';
  return null;
}

async function syncProfilesVipTable(params: {
  gh: string;
  vipType: string | null;
  vipExpiresAt: string | null;
  paidTag: string | null;
}): Promise<void> {
  const gh = normalizeGhostNumberServer(params.gh);
  if (!gh) return;
  try {
    await supabaseServer.from('profiles').upsert(
      {
        gh_number: gh,
        vip_type: params.vipType,
        vip_expires_at: params.vipExpiresAt,
        paid_tag: params.paidTag,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'gh_number' }
    );
  } catch {}
}

async function resolveEmailForGhServer(gh: string): Promise<string> {
  try {
    const { data: gnRows } = await supabaseServer
      .from('ghosted_room')
      .select('ghost_number, game_data')
      .like('ghost_number', 'GNROOM::%')
      .eq('room_code', gh)
      .limit(3);
    if (Array.isArray(gnRows)) {
      const active = gnRows.find((r: any) => r?.game_data?.status !== 'deleted');
      if (active?.game_data?.email) {
        return String(active.game_data.email).trim().toLowerCase();
      }
    }
    const { data: prof } = await supabaseServer
      .from('ghosted_room')
      .select('game_data')
      .eq('ghost_number', gh)
      .maybeSingle();
    if (prof?.game_data?.email) {
      return String(prof.game_data.email).trim().toLowerCase();
    }
  } catch {}
  return '';
}

async function syncVipTables(params: {
  gh: string;
  email?: string | null;
  isVip: boolean;
  startDate?: string | null;
  endDate?: string | null;
  plan?: string | null;
  vipType?: string | null;
  paidTag?: string | null;
}): Promise<void> {
  const gh = normalizeGhostNumberServer(params.gh);
  if (!gh) return;
  const nowIso = new Date().toISOString();
  const cleanEmail =
    String(params.email || '').trim().toLowerCase() || (await resolveEmailForGhServer(gh));

  // 1. Update `profiles` (`gh_number, vip_type, vip_expires_at, paid_tag`)
  if (params.vipType !== undefined || params.paidTag !== undefined) {
    await syncProfilesVipTable({
      gh,
      vipType: params.vipType ?? null,
      vipExpiresAt: params.endDate ?? null,
      paidTag: params.paidTag ?? null,
    });
  }

  // 2. Update `vip_table`
  try {
    await supabaseServer.from('vip_table').upsert(
      {
        email: cleanEmail || null,
        gh_number: gh,
        is_vip: Boolean(params.isVip),
        vip_start_date: params.startDate || (params.isVip ? nowIso : null),
        vip_end_date: params.endDate || null,
        plan: params.plan || null,
        updated_at: nowIso,
      },
      { onConflict: 'gh_number' }
    );
  } catch {}

  // 3. Update `ghosted_room` (`GH-XXXX` profile row + `GNROOM::<email>` row)
  try {
    const { data: profRow } = await supabaseServer
      .from('ghosted_room')
      .select('game_data')
      .eq('ghost_number', gh)
      .maybeSingle();

    if (profRow) {
      await supabaseServer
        .from('ghosted_room')
        .update({
          game_data: {
            ...(profRow.game_data || { kind: 'profile' }),
            is_vip: Boolean(params.isVip),
            vip_start_date: params.startDate || null,
            vip_end_date: params.endDate || null,
            vip_plan: params.plan || null,
            ...(params.vipType !== undefined ? { vip_type: params.vipType } : {}),
            ...(params.paidTag !== undefined ? { paid_tag: params.paidTag } : {}),
          },
        })
        .eq('ghost_number', gh);
    }

    const { data: gnRows } = await supabaseServer
      .from('ghosted_room')
      .select('ghost_number, game_data')
      .like('ghost_number', 'GNROOM::%')
      .eq('room_code', gh)
      .limit(3);

    if (Array.isArray(gnRows)) {
      for (const row of gnRows) {
        if (row?.game_data?.status === 'deleted') continue;
        await supabaseServer
          .from('ghosted_room')
          .update({
            game_data: {
              ...(row.game_data || {}),
              is_vip: Boolean(params.isVip),
              vip_start_date: params.startDate || null,
              vip_end_date: params.endDate || null,
              vip_plan: params.plan || null,
              ...(params.vipType !== undefined ? { vip_type: params.vipType } : {}),
              ...(params.paidTag !== undefined ? { paid_tag: params.paidTag } : {}),
            },
          })
          .eq('ghost_number', row.ghost_number);
      }
    }
  } catch {}
}

async function resolveVipStatusBatch(rawList: string[]): Promise<Record<string, ResolvedVipStatus>> {
  const uniqueGhs = Array.from(
    new Set(rawList.map((g) => normalizeGhostNumberServer(g)).filter(Boolean))
  );
  const result: Record<string, ResolvedVipStatus> = {};
  if (uniqueGhs.length === 0) return result;

  for (const gh of uniqueGhs) {
    result[gh] = {
      gh_number: gh,
      is_vip: false,
      main_vip_active: false,
      game1_active: false,
      game2_active: false,
      vip_type: null,
      vip_expires_at: null,
      paid_tag: null,
      plan: null,
      vip_start_date: null,
      vip_end_date: null,
    };
  }

  const expiredMainToUpdate: Array<{
    gh: string;
    email?: string;
    start?: string | null;
    end?: string | null;
    plan?: string | null;
    game1Active: boolean;
    game2Active: boolean;
    gamesExpiry?: string | null;
  }> = [];

  // 1. Check `profiles` table (`gh_number, vip_type, vip_expires_at, paid_tag`) when columns exist
  const profilesByGh: Record<string, any> = {};
  try {
    const { data: profTableRows, error: profTableErr } = await supabaseServer
      .from('profiles')
      .select('gh_number, vip_type, vip_expires_at, paid_tag')
      .in('gh_number', uniqueGhs);
    if (!profTableErr && Array.isArray(profTableRows)) {
      for (const r of profTableRows) {
        const gh = normalizeGhostNumberServer(r.gh_number);
        if (gh) profilesByGh[gh] = r;
      }
    }
  } catch {}

  // 2. Check `vip_room`
  const vipRoomByGh: Record<string, any> = {};
  try {
    const { data: vrRows } = await supabaseServer
      .from('vip_room')
      .select('*')
      .in('ghost_number', uniqueGhs);
    if (Array.isArray(vrRows)) {
      for (const r of vrRows) {
        const gh = normalizeGhostNumberServer(r.ghost_number);
        if (gh) vipRoomByGh[gh] = r;
      }
    }
  } catch {}

  // 3. Check `vip_table` & `ghosted_room` fallbacks
  const vipTableByGh: Record<string, any> = {};
  try {
    const { data: vtRows, error: vtErr } = await supabaseServer
      .from('vip_table')
      .select('*')
      .in('gh_number', uniqueGhs);
    if (!vtErr && Array.isArray(vtRows)) {
      for (const r of vtRows) {
        const gh = normalizeGhostNumberServer(r.gh_number);
        if (gh) vipTableByGh[gh] = r;
      }
    }
  } catch {}

  const grByGh: Record<string, any> = {};
  try {
    const { data: grRows } = await supabaseServer
      .from('ghosted_room')
      .select('ghost_number, game_data')
      .in('ghost_number', uniqueGhs);
    if (Array.isArray(grRows)) {
      for (const r of grRows) {
        const gh = normalizeGhostNumberServer(r.ghost_number);
        if (gh) grByGh[gh] = r;
      }
    }
  } catch {}

  for (const gh of uniqueGhs) {
    const pRow = profilesByGh[gh];
    const vrRow = vipRoomByGh[gh];
    const vtRow = vipTableByGh[gh];
    const grRow = grByGh[gh];
    const f = vrRow?.vip_features || {};
    const g = vrRow?.vip_games || {};
    const gd = grRow?.game_data || {};

    const pTag = String(pRow?.paid_tag || gd?.paid_tag || '').trim();
    const pType = String(pRow?.vip_type || gd?.vip_type || '').toUpperCase();

    const mainEnd = pRow?.vip_expires_at || f.vip_expires_at || vtRow?.vip_end_date || gd?.vip_end_date || null;
    const mainStart = f.vip_start_date || f.paidAt || vtRow?.vip_start_date || gd?.vip_start_date || null;
    const mainPlan = f.vip_plan || vtRow?.plan || gd?.vip_plan || null;

    const claimedMain =
      Boolean(f.main_vip_active) ||
      (vrRow?.vip_status === 'active' && (f.vip_plan !== undefined || f.goldBadge)) ||
      pType === 'MAIN' ||
      pType === 'BOTH' ||
      pTag.startsWith('PAID') ||
      (Boolean(vtRow?.is_vip) && !pTag.startsWith('GAME'));

    const mainVipActive = claimedMain && !isVipExpiredServer(mainEnd);
    const mainExpired = claimedMain && isVipExpiredServer(mainEnd);

    const game1Claimed =
      typeof g.nhie_paid === 'boolean'
        ? g.nhie_paid
        : pTag === 'GAME 1 ✅' ||
          pTag === 'PAID GAME 1 ✅' ||
          pTag === 'GAMES ✅' ||
          pTag === 'PAID GAMES ✅';
    const game2Claimed =
      typeof g.wyr_paid === 'boolean'
        ? g.wyr_paid
        : pTag === 'GAME 2 ✅' ||
          pTag === 'PAID GAME 2 ✅' ||
          pTag === 'GAMES ✅' ||
          pTag === 'PAID GAMES ✅';

    const game1Active =
      game1Claimed && isOptionalExpiryValidServer(g.nhie_expires_at || g.vip_games_expires_at);
    const game2Active =
      game2Claimed && isOptionalExpiryValidServer(g.wyr_expires_at || g.vip_games_expires_at);

    const effectiveVipType = computeVipTypeServer({ mainVipActive, game1Active, game2Active });
    const effectivePaidTag = computePaidTagServer({ mainVipActive, game1Active, game2Active });
    const effectiveIsVip = mainVipActive || game1Active || game2Active;
    const effectiveExpiresAt = mainVipActive
      ? mainEnd
      : game1Active || game2Active
      ? g.vip_games_expires_at || g.nhie_expires_at || g.wyr_expires_at || null
      : mainEnd;

    result[gh] = {
      gh_number: gh,
      email: vtRow?.email || gd?.email || f?.email || undefined,
      is_vip: effectiveIsVip,
      main_vip_active: mainVipActive,
      game1_active: game1Active,
      game2_active: game2Active,
      vip_type: effectiveVipType,
      vip_expires_at: effectiveExpiresAt,
      paid_tag: effectivePaidTag,
      plan: mainPlan,
      vip_start_date: mainStart,
      vip_end_date: effectiveExpiresAt,
    };

    if (mainExpired) {
      expiredMainToUpdate.push({
        gh,
        email: vtRow?.email || gd?.email || f?.email,
        start: mainStart,
        end: mainEnd,
        plan: mainPlan,
        game1Active,
        game2Active,
        gamesExpiry: g.vip_games_expires_at || null,
      });
    }
  }

  if (expiredMainToUpdate.length > 0) {
    for (const item of expiredMainToUpdate) {
      const nextVipType = computeVipTypeServer({
        mainVipActive: false,
        game1Active: item.game1Active,
        game2Active: item.game2Active,
      });
      const nextPaidTag = computePaidTagServer({
        mainVipActive: false,
        game1Active: item.game1Active,
        game2Active: item.game2Active,
      });
      const nextAnyVip = item.game1Active || item.game2Active;
      const existingVr = vipRoomByGh[item.gh];
      if (existingVr) {
        try {
          await supabaseServer
            .from('vip_room')
            .update({
              vip_status: 'inactive',
              vip_features: {
                ...(existingVr.vip_features || {}),
                main_vip_active: false,
                goldBadge: nextAnyVip,
                vipThemeGlow: false,
              },
              vip_games: {
                ...(existingVr.vip_games || {}),
                nhie: item.game1Active,
                wyr: item.game2Active,
              },
            })
            .eq('ghost_number', item.gh);
        } catch {}
      }
      await syncVipTables({
        gh: item.gh,
        email: item.email,
        isVip: nextAnyVip,
        startDate: item.start,
        endDate: nextAnyVip ? item.gamesExpiry || null : item.end,
        plan: nextAnyVip ? 'vip_games' : item.plan,
        vipType: nextVipType,
        paidTag: nextPaidTag,
      });
    }
  }

  return result;
}

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, mode: 'two-rooms-only', timestamp: new Date().toISOString() });
});

app.all('/api/turn-credentials', async (_req: Request, res: Response) => {
  try {
    const cfTurnKeyId = process.env.CLOUDFLARE_TURN_KEY_ID;
    const cfTurnApiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;

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
        return res.json({
          iceServers: data.iceServers ? [data.iceServers] : [],
          iceTransportPolicy: 'relay',
          provider: 'cloudflare_turn',
        });
      }
    }

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
    if (twilioSid && twilioAuth) {
      const basicAuth = Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64');
      const twRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Tokens.json`,
        {
          method: 'POST',
          headers: { Authorization: `Basic ${basicAuth}` },
        }
      );
      if (twRes.ok) {
        const data = await twRes.json();
        const relayServers = (data.ice_servers || []).filter((s: { urls?: string; url?: string }) => {
          const u = s.urls || s.url || '';
          return u.startsWith('turn:') || u.startsWith('turns:');
        });
        return res.json({
          iceServers: relayServers,
          iceTransportPolicy: 'relay',
          provider: 'twilio_turn',
        });
      }
    }

    const customTurnUrl = process.env.TURN_SERVER_URL;
    const customTurnUser = process.env.TURN_SERVER_USERNAME;
    const customTurnPass = process.env.TURN_SERVER_CREDENTIAL;

    if (customTurnUrl) {
      return res.json({
        iceServers: [{ urls: customTurnUrl, username: customTurnUser || '', credential: customTurnPass || '' }],
        iceTransportPolicy: 'relay',
        provider: 'custom_turn',
      });
    }

    return res.json({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      iceTransportPolicy: 'all',
      provider: 'stun_fallback',
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'TURN credential generation failed',
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      iceTransportPolicy: 'all',
    });
  }
});

// Paystack Verification -> Writes strictly to `vip_room`
// Supports:
//   - VIP Subscription plans: daily (₦500 / $1), monthly (₦14,500 / $10), yearly (₦60,000 / $40)
//   - VIP Games Unlock: vip_game_1 / vip_game_2 (₦1,000 / $1) and vip_games (₦2,700 / $2)
app.post('/api/verify-paystack', async (req: Request, res: Response) => {
  try {
    const {
      reference,
      ghostNumber,
      currency = 'NGN',
      amount,
      displayPrice,
      purchaseType = 'vip_subscription',
      plan = 'monthly',
    } = req.body || {};

    const cleanRef = String(reference || '').trim();
    let gh = normalizeGhostNumberServer(ghostNumber);

    if (!cleanRef) {
      return res.status(400).json({ success: false, error: 'Missing payment reference' });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    let isVerified = false;
    let verifiedAmount = Number(amount) || 0;

    if (paystackSecret) {
      const paystackRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(cleanRef)}`,
        {
          headers: {
            Authorization: `Bearer ${paystackSecret}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const data = await paystackRes.json();
      if (data?.status && data?.data?.status === 'success') {
        isVerified = true;
        verifiedAmount = Number(data?.data?.amount || verifiedAmount) || 0;
        const meta = data?.data?.metadata || {};
        const metaGh = normalizeGhostNumberServer(meta?.ghost_number || meta?.ghosted_number);
        if (metaGh) gh = metaGh;
      } else {
        return res.status(400).json({
          success: false,
          error: data?.message || 'Payment not verified by Paystack',
        });
      }
    } else if (cleanRef.length >= 6) {
      isVerified = true;
    }

    if (!isVerified || !gh) {
      return res.status(400).json({
        success: false,
        error: !gh ? 'Valid GH-XXXX number required' : 'Payment verification failed',
      });
    }

    const nowIso = new Date().toISOString();
    const chosenCurrency = 'NGN';

    const { data: existingRow } = await supabaseServer
      .from('vip_room')
      .select('*')
      .eq('ghost_number', gh)
      .maybeSingle();

    const prevFeatures = existingRow?.vip_features || {
      goldBadge: false,
      secretGhostMode: false,
      vipThemeGlow: false,
      main_vip_active: false,
    };
    const prevGames = existingRow?.vip_games || {
      nhie: false,
      wyr: false,
      nhie_paid: false,
      wyr_paid: false,
      vip_games_expires_at: null,
    };
    const reqEmail = String(req.body?.email || '').trim().toLowerCase() || (await resolveEmailForGhServer(gh));

    if (purchaseType === 'vip_games' || purchaseType === 'vip_game_1' || purchaseType === 'vip_game_2') {
      const unlockGame1 = purchaseType === 'vip_games' || purchaseType === 'vip_game_1';
      const unlockGame2 = purchaseType === 'vip_games' || purchaseType === 'vip_game_2';

      const prevMainActive =
        (Boolean(prevFeatures.main_vip_active) || existingRow?.vip_status === 'active') &&
        !isVipExpiredServer(prevFeatures.vip_expires_at);

      const nextGame1Paid = Boolean(prevGames.nhie_paid) || unlockGame1;
      const nextGame2Paid = Boolean(prevGames.wyr_paid) || unlockGame2;

      const nextGames = {
        ...prevGames,
        nhie: Boolean(prevGames.nhie) || nextGame1Paid,
        wyr: Boolean(prevGames.wyr) || nextGame2Paid,
        nhie_paid: nextGame1Paid,
        wyr_paid: nextGame2Paid,
        nhie_expires_at: nextGame1Paid ? null : prevGames.nhie_expires_at || null,
        wyr_expires_at: nextGame2Paid ? null : prevGames.wyr_expires_at || null,
        vip_games_expires_at: null,
        paid_currency: chosenCurrency,
        paid_reference: cleanRef,
      };

      const nextFeatures = {
        ...prevFeatures,
        goldBadge: true,
        main_vip_active: prevMainActive,
      };

      const nextVipType = computeVipTypeServer({
        mainVipActive: prevMainActive,
        game1Active: nextGame1Paid,
        game2Active: nextGame2Paid,
      });
      const nextPaidTag = computePaidTagServer({
        mainVipActive: prevMainActive,
        game1Active: nextGame1Paid,
        game2Active: nextGame2Paid,
      });
      const nextStatus = prevMainActive ? 'active' : 'inactive';

      await supabaseServer.from('vip_room').upsert(
        {
          ghost_number: gh,
          vip_status: nextStatus,
          vip_games: nextGames,
          vip_features: nextFeatures,
        },
        { onConflict: 'ghost_number' }
      );

      await syncVipTables({
        gh,
        email: reqEmail,
        isVip: true,
        startDate: prevMainActive ? prevFeatures.vip_start_date : nowIso,
        endDate: prevMainActive ? prevFeatures.vip_expires_at : null,
        plan: prevMainActive ? prevFeatures.vip_plan : purchaseType,
        vipType: nextVipType,
        paidTag: nextPaidTag,
      });

      return res.json({
        success: true,
        purchaseType,
        reference: cleanRef,
        ghostNumber: gh,
        vip_status: nextStatus,
        vip_type: nextVipType,
        vip_expires_at: prevMainActive ? prevFeatures.vip_expires_at : null,
        paid_tag: nextPaidTag,
        vip_games: nextGames,
        vip_features: nextFeatures,
        vip_games_expires_at: null,
        currency: chosenCurrency,
        displayPrice:
          displayPrice ||
          (purchaseType === 'vip_games'
            ? currency === 'USD'
              ? '$2'
              : '₦2,700'
            : currency === 'USD'
            ? '$1'
            : '₦1,000'),
        amount: verifiedAmount,
        verifiedAt: nowIso,
      });
    }

    // MAIN VIP Subscription (Daily / Monthly / Yearly — STOPS ADS)
    const validPlan = plan === 'daily' || plan === 'yearly' ? plan : 'monthly';
    const vipExpiresAt = computePlanExpiryIso(validPlan);

    const game1Active =
      Boolean(prevGames.nhie_paid) &&
      isOptionalExpiryValidServer(prevGames.nhie_expires_at || prevGames.vip_games_expires_at);
    const game2Active =
      Boolean(prevGames.wyr_paid) &&
      isOptionalExpiryValidServer(prevGames.wyr_expires_at || prevGames.vip_games_expires_at);

    const nextVipType = computeVipTypeServer({
      mainVipActive: true,
      game1Active,
      game2Active,
    });
    const nextPaidTag = computePaidTagServer({
      mainVipActive: true,
      game1Active,
      game2Active,
    });

    const nextFeatures = {
      ...prevFeatures,
      goldBadge: true,
      vipThemeGlow: false,
      main_vip_active: true,
      vip_plan: validPlan,
      vip_start_date: nowIso,
      vip_expires_at: vipExpiresAt,
      email: reqEmail || prevFeatures.email,
      paidCurrency: chosenCurrency,
      paidReference: cleanRef,
      paidAt: nowIso,
    };

    const nextGames = {
      ...prevGames,
      nhie: Boolean(prevGames.nhie),
      wyr: Boolean(prevGames.wyr),
    };

    await supabaseServer.from('vip_room').upsert(
      {
        ghost_number: gh,
        vip_status: 'active',
        vip_games: nextGames,
        vip_features: nextFeatures,
      },
      { onConflict: 'ghost_number' }
    );

    await syncVipTables({
      gh,
      email: reqEmail,
      isVip: true,
      startDate: nowIso,
      endDate: vipExpiresAt,
      plan: validPlan,
      vipType: nextVipType,
      paidTag: nextPaidTag,
    });

    return res.json({
      success: true,
      purchaseType: 'vip_subscription',
      plan: validPlan,
      reference: cleanRef,
      ghostNumber: gh,
      vip_status: 'active',
      vip_type: nextVipType,
      vip_start_date: nowIso,
      vip_expires_at: vipExpiresAt,
      paid_tag: nextPaidTag,
      vip_games: nextGames,
      vip_features: nextFeatures,
      currency: chosenCurrency,
      displayPrice: displayPrice || undefined,
      amount: verifiedAmount,
      verifiedAt: nowIso,
    });
  } catch (err: any) {
    console.error('Error verifying Paystack payment:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Server error' });
  }
});

app.post('/api/vip/activate-trial', async (req: Request, res: Response) => {
  try {
    const gh = normalizeGhostNumberServer(req.body?.ghostNumber);
    if (!gh) {
      return res.status(400).json({ success: false, error: 'Valid GH-XXXX number required.' });
    }
    const nowIso = new Date().toISOString();
    const endIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const reqEmail =
      String(req.body?.email || '').trim().toLowerCase() || (await resolveEmailForGhServer(gh));

    const { data: existingRow } = await supabaseServer
      .from('vip_room')
      .select('*')
      .eq('ghost_number', gh)
      .maybeSingle();

    const prevGames = existingRow?.vip_games || {};
    const game1Active = Boolean(prevGames.nhie_paid);
    const game2Active = Boolean(prevGames.wyr_paid);
    const nextVipType = computeVipTypeServer({ mainVipActive: true, game1Active, game2Active });
    const nextPaidTag = computePaidTagServer({ mainVipActive: true, game1Active, game2Active });

    const vipGames = {
      ...prevGames,
      nhie: Boolean(prevGames.nhie),
      wyr: Boolean(prevGames.wyr),
    };
    const vipFeatures = {
      ...(existingRow?.vip_features || {
        goldBadge: true,
        secretGhostMode: false,
        vipThemeGlow: false,
      }),
      goldBadge: true,
      vipThemeGlow: false,
      main_vip_active: true,
      vip_plan: 'trial_1h',
      vip_start_date: nowIso,
      vip_expires_at: endIso,
      email: reqEmail || existingRow?.vip_features?.email,
      paidAt: nowIso,
    };

    await supabaseServer.from('vip_room').upsert(
      {
        ghost_number: gh,
        vip_status: 'active',
        vip_games: vipGames,
        vip_features: vipFeatures,
      },
      { onConflict: 'ghost_number' }
    );

    await syncVipTables({
      gh,
      email: reqEmail,
      isVip: true,
      startDate: nowIso,
      endDate: endIso,
      plan: 'trial_1h',
      vipType: nextVipType,
      paidTag: nextPaidTag,
    });

    return res.json({
      success: true,
      record: {
        ghost_number: gh,
        vip_status: 'active',
        vip_type: nextVipType,
        vip_expires_at: endIso,
        paid_tag: nextPaidTag,
        vip_games: vipGames,
        vip_features: vipFeatures,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Could not activate VIP trial.' });
  }
});

app.post('/api/vip/status', async (req: Request, res: Response) => {
  try {
    const rawList: string[] = Array.isArray(req.body?.ghostNumbers)
      ? req.body.ghostNumbers
      : req.body?.ghostNumber
      ? [String(req.body.ghostNumber)]
      : [];
    const map = await resolveVipStatusBatch(rawList);
    return res.json({ success: true, map });
  } catch (err: any) {
    return res.status(500).json({ success: false, map: {}, error: err?.message || 'VIP check failed' });
  }
});

const GNROOM_PREFIX = 'GNROOM::';
const LEGACY_DELETED_PREFIX = 'DELETED_EMAIL::';
const LEGACY_USED_PREFIX = 'USED_EMAIL::';
const LEGACY_RESET_MARKER = 'SYSTEM::GH_NUMBER_ROOM_CLEAN_V1';

function normalizeEmailServer(raw?: string | null): string {
  return String(raw || '').trim().toLowerCase();
}

function isValidEmailServer(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifyPasswordScrypt(password: string, storedHash?: string | null): boolean {
  if (!storedHash || !password) return false;
  const parts = String(storedHash).split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const [, salt, hex] = parts;
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallbackValue: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallbackValue);
      }
    }, ms);
    promise
      .then((val) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(val);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallbackValue);
        }
      });
  });
}

async function safeDeleteFromOptionalTable(
  table: string,
  column: string,
  value: string
): Promise<void> {
  if (!value) return;
  try {
    await supabaseServer.from(table).delete().eq(column, value);
  } catch {}
}

interface UnifiedGhostNumberRow {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar: string;
  profile_pic: string;
  password_hash: string;
  gh_number: string;
  location: string;
  location_hidden: boolean;
  status: 'active' | 'signed_out' | 'deleted';
  email_used_forever: boolean;
  created_at: string;
  last_login_at: string;
  updated_at: string;
  auth_user_id?: string;
}

function parseUnifiedRow(row: any): UnifiedGhostNumberRow {
  const rawStatus = String(row?.status || 'active').toLowerCase();
  const status: 'active' | 'signed_out' | 'deleted' =
    rawStatus === 'deleted'
      ? 'deleted'
      : rawStatus === 'signed_out'
      ? 'signed_out'
      : 'active';

  const displayName = String(row?.display_name || row?.username || row?.gh_number || 'Ghost User');
  return {
    id: String(row?.id || crypto.randomUUID()),
    email: normalizeEmailServer(row?.email),
    username: String(row?.username || displayName),
    display_name: displayName,
    avatar: String(row?.avatar || row?.profile_pic || ''),
    profile_pic: String(row?.profile_pic || row?.avatar || ''),
    password_hash: String(row?.password_hash || ''),
    gh_number: normalizeGhostNumberServer(row?.gh_number),
    location: String(row?.location || 'Unknown'),
    location_hidden: Boolean(row?.location_hidden),
    status,
    email_used_forever: Boolean(row?.email_used_forever) || status === 'deleted',
    created_at: String(row?.created_at || new Date().toISOString()),
    last_login_at: String(row?.last_login_at || row?.updated_at || new Date().toISOString()),
    updated_at: String(row?.updated_at || new Date().toISOString()),
    auth_user_id: typeof row?.auth_user_id === 'string' ? row.auth_user_id : undefined,
  };
}

async function findRoomRowByEmail(rawEmail: string): Promise<UnifiedGhostNumberRow | null> {
  const email = normalizeEmailServer(rawEmail);
  if (!email) return null;

  try {
    const { data: rows } = await supabaseServer
      .from('ghosted_room')
      .select('ghost_number, display_name, profile_pic, location, room_code, game_data, last_active')
      .in('ghost_number', [
        `${GNROOM_PREFIX}${email}`,
        `${LEGACY_USED_PREFIX}${email}`,
        `${LEGACY_DELETED_PREFIX}${email}`,
      ]);

    if (Array.isArray(rows) && rows.length > 0) {
      const gnRow = rows.find((r: any) => r.ghost_number === `${GNROOM_PREFIX}${email}`);
      if (gnRow?.game_data) {
        return parseUnifiedRow({
          ...gnRow.game_data,
          email,
          display_name: gnRow.display_name || gnRow.game_data.display_name,
          profile_pic: gnRow.profile_pic || gnRow.game_data.profile_pic,
          location: gnRow.location || gnRow.game_data.location,
          gh_number: gnRow.room_code || gnRow.game_data.gh_number,
        });
      }

      const legacyBlocked = rows[0];
      return parseUnifiedRow({
        email,
        display_name: 'DELETED',
        gh_number: legacyBlocked?.game_data?.ghost_number || '',
        status: 'deleted',
        email_used_forever: true,
        created_at: legacyBlocked?.game_data?.deleted_at || legacyBlocked?.last_active,
      });
    }
  } catch {}

  return null;
}

async function findRoomRowByGhNumber(rawGh: string): Promise<UnifiedGhostNumberRow | null> {
  const gh = normalizeGhostNumberServer(rawGh);
  if (!gh) return null;

  try {
    const { data: gnRows } = await supabaseServer
      .from('ghosted_room')
      .select('ghost_number, display_name, profile_pic, location, room_code, game_data, last_active')
      .like('ghost_number', `${GNROOM_PREFIX}%`)
      .eq('room_code', gh)
      .limit(5);

    if (Array.isArray(gnRows)) {
      const activeGn = gnRows.find(
        (r: any) => String(r?.game_data?.status || '').toLowerCase() !== 'deleted'
      );
      if (activeGn?.game_data) {
        const email = normalizeEmailServer(
          activeGn.game_data.email || String(activeGn.ghost_number || '').replace(GNROOM_PREFIX, '')
        );
        return parseUnifiedRow({
          ...activeGn.game_data,
          email,
          display_name: activeGn.display_name || activeGn.game_data.display_name,
          profile_pic: activeGn.profile_pic || activeGn.game_data.profile_pic,
          location: activeGn.location || activeGn.game_data.location,
          gh_number: activeGn.room_code || activeGn.game_data.gh_number || gh,
        });
      }
    }
  } catch {}

  return null;
}

async function saveRoomRow(row: UnifiedGhostNumberRow): Promise<void> {
  const email = normalizeEmailServer(row.email);
  const nowIso = new Date().toISOString();

  await supabaseServer.from('ghosted_room').upsert(
    {
      ghost_number: `${GNROOM_PREFIX}${email}`,
      display_name: row.display_name,
      profile_pic: row.profile_pic || row.avatar || '',
      location: row.location_hidden ? 'Hidden' : row.location || 'Unknown',
      room_code: row.gh_number,
      game_type: 'ghosted_number_room',
      call_status: 'idle',
      game_data: {
        kind: 'ghosted_number_room',
        id: row.id,
        email,
        username: row.username || row.display_name,
        display_name: row.display_name,
        avatar: row.avatar || row.profile_pic || '',
        profile_pic: row.profile_pic || row.avatar || '',
        password_hash: row.password_hash || '',
        gh_number: row.gh_number,
        location: row.location_hidden ? 'Hidden' : row.location || 'Unknown',
        location_hidden: Boolean(row.location_hidden),
        status: row.status,
        email_used_forever: Boolean(row.email_used_forever),
        created_at: row.created_at || nowIso,
        last_login_at: row.last_login_at || nowIso,
        updated_at: nowIso,
        ...(row.auth_user_id ? { auth_user_id: row.auth_user_id } : {}),
      },
      last_active: nowIso,
    },
    { onConflict: 'ghost_number' }
  );
}

async function generateNextFreeGhNumber(): Promise<string> {
  const takenSet = new Set<string>();
  let maxCounter = 0; // Counter starts at 001 -> GH-1001, GH-1002 ... GH-1999, GH-11000 ...

  try {
    const { data: roomRows } = await supabaseServer
      .from('ghosted_room')
      .select('ghost_number, room_code, game_data')
      .or(
        `ghost_number.eq.SYSTEM::GHOST_COUNTER,ghost_number.like.GHREGISTRY::%,ghost_number.like.${GNROOM_PREFIX}%,ghost_number.like.GH-%`
      )
      .limit(1000);

    if (Array.isArray(roomRows)) {
      for (const r of roomRows) {
        const gKey = String(r?.ghost_number || '');
        if (gKey === 'SYSTEM::GHOST_COUNTER') {
          const lastNum = Number(r?.game_data?.last_number || 0);
          if (Number.isFinite(lastNum) && lastNum > maxCounter) {
            maxCounter = lastNum;
          }
        } else if (gKey.startsWith('GHREGISTRY::')) {
          const gd = r?.game_data || {};
          const gh = normalizeGhostNumberServer(gd.ghost_number || gKey.replace('GHREGISTRY::', ''));
          if (gh) takenSet.add(gh);
          const cVal = Number(gd.counter || extractCounterFromGhServer(gh) || 0);
          if (Number.isFinite(cVal) && cVal > maxCounter) {
            maxCounter = cVal;
          }
        } else if (gKey.startsWith(GNROOM_PREFIX)) {
          const gd = r?.game_data || {};
          const gh = normalizeGhostNumberServer(gd.gh_number || r.room_code);
          if (!gh) continue;
          // NEVER reuse deleted GH-Numbers — record all previously issued numbers & counters
          takenSet.add(gh);
          const cVal = extractCounterFromGhServer(gh);
          if (cVal && cVal > maxCounter) {
            maxCounter = cVal;
          }
        } else if (/^GH-\d{4,}$/.test(gKey)) {
          takenSet.add(gKey);
          const cVal = extractCounterFromGhServer(gKey);
          if (cVal && cVal > maxCounter) {
            maxCounter = cVal;
          }
        }
      }
    }
  } catch {}

  let next = maxCounter + 1;
  let ghostNumber = formatGhostNumberFromCounterServer(next);
  while (takenSet.has(ghostNumber)) {
    next += 1;
    ghostNumber = formatGhostNumberFromCounterServer(next);
  }

  const nowIso = new Date().toISOString();

  // Persist last_number counter & permanent ghost_number record inside `ghosted_room` (never delete)
  await supabaseServer.from('ghosted_room').upsert(
    [
      {
        ghost_number: 'SYSTEM::GHOST_COUNTER',
        display_name: 'SYSTEM',
        room_code: String(next),
        game_type: 'ghost_counter',
        game_data: {
          kind: 'ghost_counter',
          id: 1,
          last_number: next,
          updated_at: nowIso,
        },
        last_active: nowIso,
      },
      {
        ghost_number: `GHREGISTRY::${ghostNumber}`,
        display_name: ghostNumber,
        room_code: String(next),
        game_type: 'ghost_numbers',
        game_data: {
          kind: 'ghost_numbers',
          ghost_number: ghostNumber,
          counter: next,
          created_at: nowIso,
        },
        last_active: nowIso,
      },
    ],
    { onConflict: 'ghost_number' }
  );

  return ghostNumber;
}

async function checkEmailIsDeleted(rawEmail?: string | null): Promise<boolean> {
  const row = await findRoomRowByEmail(rawEmail || '');
  if (!row) return false;
  return row.status === 'deleted' || row.email_used_forever;
}

async function cleanupLegacyPoolKeysOnce(): Promise<void> {
  try {
    const { data: marker } = await supabaseServer
      .from('ghosted_room')
      .select('ghost_number')
      .eq('ghost_number', LEGACY_RESET_MARKER)
      .maybeSingle();
    if (marker) return;

    // Migrate any legacy USED_EMAIL:: / DELETED_EMAIL:: / ACCOUNTS:: into GNROOM:: so nothing is lost
    const { data: legacyRows } = await supabaseServer
      .from('ghosted_room')
      .select('ghost_number, display_name, room_code, game_data, last_active')
      .or(
        'ghost_number.like.GHPOOL::%,ghost_number.like.USED_EMAIL::%,ghost_number.like.DELETED_EMAIL::%,ghost_number.like.ACCOUNTS::%,ghost_number.eq.SYSTEM::GH_POOL_RESET_V2'
      )
      .limit(500);

    if (Array.isArray(legacyRows)) {
      const toDeleteKeys: string[] = [];
      for (const r of legacyRows) {
        const key = String(r?.ghost_number || '');
        if (key.startsWith('GHPOOL::') || key === 'SYSTEM::GH_POOL_RESET_V2') {
          toDeleteKeys.push(key);
        } else if (key.startsWith(LEGACY_USED_PREFIX) || key.startsWith(LEGACY_DELETED_PREFIX)) {
          const email = normalizeEmailServer(
            r?.game_data?.email ||
              key.replace(LEGACY_USED_PREFIX, '').replace(LEGACY_DELETED_PREFIX, '')
          );
          if (email) {
            const existing = await findRoomRowByEmail(email);
            if (!existing) {
              await saveRoomRow({
                id: crypto.randomUUID(),
                email,
                username: 'DELETED',
                display_name: 'DELETED',
                avatar: '',
                profile_pic: '',
                password_hash: '',
                gh_number: normalizeGhostNumberServer(r?.game_data?.ghost_number) || '',
                location: 'Deleted',
                location_hidden: true,
                status: 'deleted',
                email_used_forever: true,
                created_at: r?.game_data?.deleted_at || r?.last_active || new Date().toISOString(),
                last_login_at: r?.last_active || new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
            }
          }
          toDeleteKeys.push(key);
        } else if (key.startsWith('ACCOUNTS::')) {
          const gd = r?.game_data || {};
          const email = normalizeEmailServer(gd.email || key.replace('ACCOUNTS::', ''));
          if (email) {
            const existing = await findRoomRowByEmail(email);
            if (!existing) {
              await saveRoomRow({
                id: String(gd.id || crypto.randomUUID()),
                email,
                username: String(gd.username || r.display_name || 'Ghost User'),
                display_name: String(gd.username || r.display_name || 'Ghost User'),
                avatar: '',
                profile_pic: '',
                password_hash: String(gd.password_hash || ''),
                gh_number: normalizeGhostNumberServer(gd.gh_number || r.room_code),
                location: 'Unknown',
                location_hidden: false,
                status: gd.is_deleted ? 'deleted' : 'active',
                email_used_forever: Boolean(gd.is_deleted),
                created_at: String(gd.created_at || r.last_active || new Date().toISOString()),
                last_login_at: String(r.last_active || new Date().toISOString()),
                updated_at: new Date().toISOString(),
              });
            }
          }
          toDeleteKeys.push(key);
        }
      }
      if (toDeleteKeys.length > 0) {
        await supabaseServer.from('ghosted_room').delete().in('ghost_number', toDeleteKeys);
      }
    }

    await supabaseServer.from('ghosted_room').upsert(
      {
        ghost_number: LEGACY_RESET_MARKER,
        display_name: 'SYSTEM',
        game_type: 'system',
        game_data: { kind: 'system_cleanup', at: new Date().toISOString() },
        last_active: new Date().toISOString(),
      },
      { onConflict: 'ghost_number' }
    );
  } catch {}
}

app.post('/api/accounts/signup', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmailServer(req.body?.email);
    const password = String(req.body?.password || '');
    const displayName =
      String(req.body?.displayName || req.body?.username || 'Ghost User').trim() || 'Ghost User';
    const profilePic = String(req.body?.profilePic || '').trim();
    const locationHidden = Boolean(req.body?.locationHidden);
    const location = locationHidden
      ? 'Hidden'
      : String(req.body?.location || '').trim() || 'Unknown';
    const acceptedLegal = req.body?.acceptedLegal === true;

    if (!acceptedLegal) {
      return res.status(400).json({ error: 'Please accept Terms & Conditions to continue' });
    }
    if (!email || !isValidEmailServer(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    // a) Check `ghosted_number_room` FIRST — if email exists OR email_used_forever = true, BLOCK signup
    const existing = await findRoomRowByEmail(email);
    if (existing) {
      if (existing.email_used_forever || existing.status === 'deleted') {
        return res.status(403).json({
          blocked: true,
          error: 'This email has been used before',
        });
      }
      return res.status(403).json({
        blocked: true,
        alreadyExists: true,
        error: 'This email has been used before',
      });
    }

    // b) Create Supabase Auth user (with 5s timeout guard so it never hangs)
    let authUserId = '';
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const adminRes = await withTimeout<any>(
        supabaseServer.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { display_name: displayName },
        }),
        5000,
        { data: null, error: null }
      );
      if (adminRes?.error) {
        const msg = String(adminRes.error.message || '');
        if (!msg.toLowerCase().includes('already')) {
          return res.status(400).json({ error: msg || 'Could not create GH-Number, try again' });
        }
      } else if (adminRes?.data?.user?.id) {
        authUserId = adminRes.data.user.id;
      }
    } else {
      const suRes = await withTimeout<any>(
        supabaseServer.auth.signUp({
          email,
          password,
          options: { data: { display_name: displayName } },
        }),
        5000,
        { data: null, error: null }
      );
      if (suRes?.data?.user?.id) {
        authUserId = suRes.data.user.id;
      }
    }

    // c) Generate next sequential GH-Number (GH-1 + counter, never reuses deleted numbers)
    const { data: ghNumber, error: ghError } = await supabaseServer.rpc('get_next_ghost_number');
if (ghError || !ghNumber) throw new Error('Could not create GH-Number, try again');
    const nowIso = new Date().toISOString();
    const rowId =
      authUserId && /^[0-9a-f-]{36}$/i.test(authUserId) ? authUserId : crypto.randomUUID();
    const passwordHash = hashPasswordScrypt(password);

    const unifiedRow: UnifiedGhostNumberRow = {
      id: rowId,
      email,
      username: displayName,
      display_name: displayName,
      avatar: profilePic,
      profile_pic: profilePic,
      password_hash: passwordHash,
      gh_number: ghNumber,
      location,
      location_hidden: locationHidden,
      status: 'active',
      email_used_forever: false,
      created_at: nowIso,
      last_login_at: nowIso,
      updated_at: nowIso,
      ...(authUserId ? { auth_user_id: authUserId } : {}),
    };

    // d) INSERT ONE ROW into `ghosted_number_room` (+ ghosted_room profile for chats/calls/map)
    await saveRoomRow(unifiedRow);

    const profilePayload = {
      ghost_number: ghNumber,
      display_name: displayName,
      profile_pic: profilePic,
      location,
      call_status: 'idle',
      game_data: {
        kind: 'profile',
        status: 'active',
        email,
        ...(authUserId ? { auth_user_id: authUserId } : {}),
        legal_accepted_at: nowIso,
        location_hidden: locationHidden,
        blocked_users: [],
        friends: [],
        tracker: [],
      },
      last_active: nowIso,
    };

    const { data: profData, error: profErr } = await supabaseServer
      .from('ghosted_room')
      .upsert(profilePayload, { onConflict: 'ghost_number' })
      .select('*')
      .single();

    if (profErr) {
      return res.status(500).json({ error: 'Could not create GH-Number, try again' });
    }

    return res.json({
      success: true,
      account: {
        id: unifiedRow.id,
        email: unifiedRow.email,
        display_name: unifiedRow.display_name,
        gh_number: unifiedRow.gh_number,
        location: unifiedRow.location,
        location_hidden: unifiedRow.location_hidden,
        status: 'active',
        email_used_forever: false,
        created_at: unifiedRow.created_at,
      },
      profileRow: profData,
    });
  } catch (err: any) {
    console.error('Signup failed:', err);
    return res.status(500).json({ error: 'Could not create GH-Number, try again' });
  }
});

app.post('/api/accounts/signin', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmailServer(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email || !isValidEmailServer(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Enter your password.' });
    }

    // 1. Fetch row from `ghosted_number_room` by email
    const roomRow = await findRoomRowByEmail(email);
    if (roomRow && (roomRow.status === 'deleted' || roomRow.email_used_forever)) {
      return res.status(403).json({
        blocked: true,
        error: 'This email has been used before',
      });
    }

    // 2. Verify with Supabase Auth + scrypt password_hash
    let authUserId = roomRow?.auth_user_id || '';
    let authSession: any = null;
    let authVerified = false;
    let authErrorMessage = '';

    const authRes = await withTimeout<any>(
      supabaseServer.auth.signInWithPassword({ email, password }),
      5000,
      { data: null, error: { message: 'Auth timeout' } }
    );
    if (!authRes?.error && authRes?.data?.user) {
      authVerified = true;
      authUserId = authRes.data.user.id;
      authSession = authRes.data.session || null;
    } else if (authRes?.error) {
      authErrorMessage = String(authRes.error.message || '');
    }

    const hashVerified = roomRow ? verifyPasswordScrypt(password, roomRow.password_hash) : false;

    if (!authVerified && !hashVerified) {
      const lowerAuthErr = authErrorMessage.toLowerCase();
      if (!(lowerAuthErr.includes('email not confirmed') && roomRow)) {
        return res.status(401).json({
          error: roomRow
            ? 'Invalid email or password.'
            : 'Invalid login credentials. No account found for this email.',
        });
      }
    }

    let activeRow = roomRow;
    const nowIso = new Date().toISOString();

    if (!activeRow && authVerified) {
      const ghNumber = await generateNextFreeGhNumber();
      activeRow = {
        id: authUserId && /^[0-9a-f-]{36}$/i.test(authUserId) ? authUserId : crypto.randomUUID(),
        email,
        username: 'Ghost User',
        display_name: 'Ghost User',
        avatar: '',
        profile_pic: '',
        password_hash: hashPasswordScrypt(password),
        gh_number: ghNumber,
        location: 'Unknown',
        location_hidden: false,
        status: 'active',
        email_used_forever: false,
        created_at: nowIso,
        last_login_at: nowIso,
        updated_at: nowIso,
        auth_user_id: authUserId,
      };
    }

    if (!activeRow || !activeRow.gh_number) {
      return res.status(401).json({ error: 'Invalid login credentials.' });
    }

    // Update status -> active and last_login_at
    activeRow.status = 'active';
    activeRow.last_login_at = nowIso;
    activeRow.updated_at = nowIso;
    if (!activeRow.password_hash) {
      activeRow.password_hash = hashPasswordScrypt(password);
    }
    if (authUserId) {
      activeRow.auth_user_id = authUserId;
    }

    // Load or restore profile in `ghosted_room` so username, GH-Number, avatar, location & chats load on any new phone
    let { data: profRow } = await supabaseServer
      .from('ghosted_room')
      .select('*')
      .eq('ghost_number', activeRow.gh_number)
      .maybeSingle();

    if (!profRow) {
      const { data: restored } = await supabaseServer
        .from('ghosted_room')
        .upsert(
          {
            ghost_number: activeRow.gh_number,
            display_name: activeRow.display_name,
            profile_pic: activeRow.profile_pic || activeRow.avatar || '',
            location: activeRow.location_hidden ? 'Hidden' : activeRow.location || 'Unknown',
            call_status: 'idle',
            game_data: {
              kind: 'profile',
              status: 'active',
              email,
              ...(authUserId ? { auth_user_id: authUserId } : {}),
              legal_accepted_at: activeRow.created_at,
              location_hidden: activeRow.location_hidden,
              blocked_users: [],
              friends: [],
              tracker: [],
            },
            last_active: nowIso,
          },
          { onConflict: 'ghost_number' }
        )
        .select('*')
        .single();
      profRow = restored;
    } else {
      activeRow.display_name = profRow.display_name || activeRow.display_name;
      activeRow.username = activeRow.display_name;
      activeRow.profile_pic = profRow.profile_pic || activeRow.profile_pic;
      activeRow.avatar = activeRow.profile_pic;
      activeRow.location = profRow.location || activeRow.location;
      activeRow.location_hidden =
        Boolean(profRow.game_data?.location_hidden) || profRow.location === 'Hidden';

      const { data: updatedProf } = await supabaseServer
        .from('ghosted_room')
        .update({
          last_active: nowIso,
          game_data: {
            ...(profRow.game_data || { kind: 'profile', tracker: [] }),
            status: 'active',
            email,
            ...(authUserId ? { auth_user_id: authUserId } : {}),
          },
        })
        .eq('ghost_number', activeRow.gh_number)
        .select('*')
        .single();
      if (updatedProf) profRow = updatedProf;
    }

    await saveRoomRow(activeRow);

    return res.json({
      success: true,
      account: {
        id: activeRow.id,
        email: activeRow.email,
        display_name: activeRow.display_name,
        gh_number: activeRow.gh_number,
        location: activeRow.location,
        location_hidden: activeRow.location_hidden,
        status: 'active',
      },
      profileRow: profRow,
      session: authSession,
    });
  } catch (err: any) {
    console.error('Sign in failed:', err);
    return res.status(500).json({ error: err?.message || 'Could not sign in.' });
  }
});

app.post('/api/accounts/signout', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmailServer(req.body?.email);
    const gh = normalizeGhostNumberServer(req.body?.ghostNumber);
    const nowIso = new Date().toISOString();

    // Update row in `ghosted_room`: status = signed_out. DO NOT delete row!
    let roomRow = email ? await findRoomRowByEmail(email) : null;
    if (!roomRow && gh) {
      roomRow = await findRoomRowByGhNumber(gh);
    }

    if (roomRow && roomRow.status !== 'deleted') {
      roomRow.status = 'signed_out';
      roomRow.updated_at = nowIso;
      await saveRoomRow(roomRow);
    }

    const targetGh = gh || roomRow?.gh_number || '';
    if (targetGh) {
      try {
        const { data: profRow } = await supabaseServer
          .from('ghosted_room')
          .select('game_data')
          .eq('ghost_number', targetGh)
          .maybeSingle();
        if (profRow) {
          await supabaseServer
            .from('ghosted_room')
            .update({
              last_active: nowIso,
              game_data: {
                ...(profRow.game_data || { kind: 'profile' }),
                status: 'signed_out',
              },
            })
            .eq('ghost_number', targetGh);
        }
      } catch {}
    }

    return res.json({ success: true, status: 'signed_out' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Sign out update failed' });
  }
});

app.post('/api/accounts/update-username', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmailServer(req.body?.email);
    const gh = normalizeGhostNumberServer(req.body?.ghostNumber);
    const username = String(req.body?.username || '').trim();
    if (!username) {
      return res.status(400).json({ success: false, error: 'Username required' });
    }
    const roomRow = (email ? await findRoomRowByEmail(email) : null) || (gh ? await findRoomRowByGhNumber(gh) : null);
    if (roomRow && roomRow.status !== 'deleted') {
      roomRow.display_name = username;
      roomRow.username = username;
      roomRow.updated_at = new Date().toISOString();
      await saveRoomRow(roomRow);
    }
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Update failed' });
  }
});

app.post('/api/check-deleted-email', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmailServer(req.body?.email);
    if (!email) {
      return res.json({ deleted: false });
    }
    const deleted = await checkEmailIsDeleted(email);
    return res.json({ deleted });
  } catch (err: any) {
    return res.status(500).json({ deleted: false, error: err?.message || 'Check failed' });
  }
});

app.post('/api/gh-number-live', async (req: Request, res: Response) => {
  try {
    const gh = normalizeGhostNumberServer(req.body?.ghostNumber);
    const displayName = String(req.body?.displayName || '').trim() || gh;
    const avatar = String(req.body?.avatar || req.body?.profilePic || '').trim();
    const location = req.body?.location ? String(req.body.location) : undefined;
    const locationHidden =
      typeof req.body?.locationHidden === 'boolean' ? req.body.locationHidden : undefined;
    const nowIso = new Date().toISOString();

    if (!gh) {
      return res.status(400).json({ success: false, error: 'Valid GH-XXXX number required.' });
    }

    try {
      const { data: gnRows } = await supabaseServer
        .from('ghosted_room')
        .select('ghost_number, game_data')
        .like('ghost_number', `${GNROOM_PREFIX}%`)
        .eq('room_code', gh)
        .limit(3);

      if (Array.isArray(gnRows)) {
        for (const row of gnRows) {
          if (row?.game_data?.status === 'deleted') continue;
          await supabaseServer
            .from('ghosted_room')
            .update({
              display_name: displayName,
              profile_pic: avatar,
              ...(location !== undefined ? { location } : {}),
              game_data: {
                ...(row.game_data || {}),
                display_name: displayName,
                username: displayName,
                avatar,
                profile_pic: avatar,
                ...(location !== undefined ? { location } : {}),
                ...(locationHidden !== undefined ? { location_hidden: locationHidden } : {}),
                status: 'active',
                updated_at: nowIso,
              },
              last_active: nowIso,
            })
            .eq('ghost_number', row.ghost_number);
        }
      }
    } catch {}

    return res.json({
      success: true,
      ghost_number: gh,
      status: 'active',
      updatedAt: nowIso,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to save live GH-Number' });
  }
});

app.post('/api/gh-number-check', async (req: Request, res: Response) => {
  try {
    const gh = normalizeGhostNumberServer(req.body?.ghostNumber);
    if (!gh) {
      return res.status(400).json({ found: false, live: false, error: 'Invalid GH-XXXX number.' });
    }

    const vipMap = await resolveVipStatusBatch([gh]);
    const vipInfo = vipMap[gh] || {
      gh_number: gh,
      is_vip: false,
      plan: null,
      vip_start_date: null,
      vip_end_date: null,
    };

    const { data: gnRows } = await supabaseServer
      .from('ghosted_room')
      .select('*')
      .like('ghost_number', `${GNROOM_PREFIX}%`)
      .eq('room_code', gh)
      .limit(5);

    const activeGn = Array.isArray(gnRows)
      ? gnRows.find((r: any) => String(r?.game_data?.status || '').toLowerCase() !== 'deleted')
      : null;

    if (activeGn) {
      const gd = activeGn.game_data || {};
      return res.json({
        found: true,
        live: true,
        source: 'ghosted_room_gnroom',
        profile: {
          ghost_number: gh,
          display_name: activeGn.display_name || gd.display_name || gh,
          avatar: activeGn.profile_pic || gd.avatar || gd.profile_pic || '',
          profile_pic: activeGn.profile_pic || gd.profile_pic || gd.avatar || '',
          status: gd.status || 'active',
          is_vip: Boolean(vipInfo.is_vip),
          vip_start_date: vipInfo.vip_start_date || null,
          vip_end_date: vipInfo.vip_end_date || null,
          vip_plan: vipInfo.plan || null,
          updated_at: activeGn.last_active || gd.updated_at || new Date().toISOString(),
        },
      });
    }

    const { data: profRow } = await supabaseServer
      .from('ghosted_room')
      .select('*')
      .eq('ghost_number', gh)
      .maybeSingle();

    if (!profRow) {
      return res.json({ found: false, live: false });
    }

    const profStatus = String(profRow?.game_data?.status || 'active').toLowerCase();
    if (profStatus === 'deleted') {
      return res.json({ found: false, live: false, explicitlyNotLive: true });
    }

    return res.json({
      found: true,
      live: true,
      source: 'ghosted_room_profile',
      profile: {
        ghost_number: gh,
        display_name: profRow.display_name || gh,
        avatar: profRow.profile_pic || '',
        profile_pic: profRow.profile_pic || '',
        status: profStatus,
        is_vip: Boolean(vipInfo.is_vip),
        vip_start_date: vipInfo.vip_start_date || null,
        vip_end_date: vipInfo.vip_end_date || null,
        vip_plan: vipInfo.plan || null,
        updated_at: profRow.last_active || new Date().toISOString(),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ found: false, live: false, error: err?.message || 'Check failed' });
  }
});

app.post('/api/delete-account', async (req: Request, res: Response) => {
  try {
    const gh = normalizeGhostNumberServer(req.body?.ghostNumber);
    const email = normalizeEmailServer(req.body?.email);
    const authUserId = String(req.body?.authUserId || '').trim();
    const nowIso = new Date().toISOString();

    if (!gh && !email) {
      return res.status(400).json({ success: false, error: 'Missing account identifier.' });
    }

    // 1. Update `GNROOM::<email>` row in `ghosted_room`: status = 'deleted', email_used_forever = true
    //    KEEP the row and `ghost_numbers` record forever — GH-Number is NEVER deleted or reused!
    let targetEmail = email;
    let existing = email ? await findRoomRowByEmail(email) : null;
    if (!existing && gh) {
      existing = await findRoomRowByGhNumber(gh);
      if (existing?.email) targetEmail = existing.email;
    }

    if (targetEmail) {
      await saveRoomRow({
        id: existing?.id || crypto.randomUUID(),
        email: targetEmail,
        username: existing?.username || 'DELETED',
        display_name: existing?.display_name || 'DELETED',
        avatar: '',
        profile_pic: '',
        password_hash: '',
        gh_number: gh || existing?.gh_number || '',
        location: 'Deleted',
        location_hidden: true,
        status: 'deleted',
        email_used_forever: true,
        created_at: existing?.created_at || nowIso,
        last_login_at: existing?.last_login_at || nowIso,
        updated_at: nowIso,
      });
    }

    // 2. Delete chats/messages/profile/location/friend requests/VIP data ONLY on Delete Account
    if (gh) {
      try {
        await supabaseServer.from('messages').delete().or(`sender_gh.eq.${gh},receiver_gh.eq.${gh}`);
      } catch {}
      try {
        await supabaseServer.from('chats').delete().or(`user1_gh.eq.${gh},user2_gh.eq.${gh}`);
      } catch {}

      await safeDeleteFromOptionalTable('ghosted_room', 'ghost_number', `GHNUM::${gh}`);
      await safeDeleteFromOptionalTable('ghosted_room', 'ghost_number', gh);

      try {
        await supabaseServer
          .from('ghosted_room')
          .update({ chat_with_ghost_number: null })
          .eq('chat_with_ghost_number', gh);
      } catch {}
      try {
        await supabaseServer
          .from('ghosted_room')
          .update({ call_with_ghost_number: null, call_status: 'idle' })
          .eq('call_with_ghost_number', gh);
      } catch {}

      try {
        const { data: roomRows } = await supabaseServer
          .from('ghosted_room')
          .select('ghost_number, room_code, game_data')
          .or(
            'ghost_number.like.CHAT::%,ghost_number.like.MAP::%,ghost_number.like.GAME::%,ghost_number.like.FRIENDREQ::%'
          )
          .limit(300);

        if (Array.isArray(roomRows)) {
          const keysToDelete = roomRows
            .filter((r: any) => {
              const gnum = String(r?.ghost_number || '');
              const rcode = String(r?.room_code || '');
              const gd = r?.game_data || {};
              const participants: string[] = Array.isArray(gd?.participants)
                ? gd.participants
                : Array.isArray(gd?.players)
                ? gd.players
                : [];
              const partKeys =
                gd?.participants && !Array.isArray(gd.participants)
                  ? Object.keys(gd.participants)
                  : [];

              return (
                gnum.includes(gh) ||
                rcode.includes(gh) ||
                gd?.host === gh ||
                gd?.sender === gh ||
                gd?.receiver === gh ||
                gd?.inviter === gh ||
                gd?.invitee === gh ||
                participants.includes(gh) ||
                partKeys.includes(gh)
              );
            })
            .map((r: any) => r.ghost_number);

          if (keysToDelete.length > 0) {
            await supabaseServer.from('ghosted_room').delete().in('ghost_number', keysToDelete);
          }
        }
      } catch {}

      await safeDeleteFromOptionalTable('vip_table', 'gh_number', gh);
      await safeDeleteFromOptionalTable('profiles', 'gh_number', gh);
      await safeDeleteFromOptionalTable('vip_room', 'ghost_number', gh);
      try {
        const { data: vipGameRows } = await supabaseServer
          .from('vip_room')
          .select('ghost_number, vip_games')
          .like('ghost_number', 'VIPGAME::%')
          .limit(200);
        if (Array.isArray(vipGameRows)) {
          const vipKeys = vipGameRows
            .filter((r: any) => {
              const vg = r?.vip_games || {};
              return vg?.host === gh || (Array.isArray(vg?.players) && vg.players.includes(gh));
            })
            .map((r: any) => r.ghost_number);
          if (vipKeys.length > 0) {
            await supabaseServer.from('vip_room').delete().in('ghost_number', vipKeys);
          }
        }
      } catch {}
    }

    // 3. Delete Supabase Auth user when service role key is configured
    let authDeleted = false;
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      let targetUid = authUserId;
      if (!targetUid && targetEmail) {
        try {
          const { data: listData } = await supabaseServer.auth.admin.listUsers({
            page: 1,
            perPage: 1000,
          });
          const matched = listData?.users?.find(
            (u) => String(u.email || '').toLowerCase() === targetEmail
          );
          if (matched?.id) targetUid = matched.id;
        } catch {}
      }
      if (targetUid) {
        try {
          const { error: delAuthErr } = await supabaseServer.auth.admin.deleteUser(targetUid);
          if (!delAuthErr) authDeleted = true;
        } catch {}
      }
    }

    return res.json({
      success: true,
      ghostNumber: gh || null,
      email: targetEmail || null,
      authDeleted,
      deletedAt: nowIso,
    });
  } catch (err: any) {
    console.error('Error deleting account:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to delete account' });
  }
});

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ghosted Server running on http://0.0.0.0:${PORT}`);
    cleanupLegacyPoolKeysOnce().catch(() => {});
  });
}

startServer();
