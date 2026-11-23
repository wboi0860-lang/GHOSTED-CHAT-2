import { supabase } from '../supabase';
import {
  ChatMessage,
  ChatRoomRow,
  ConversationPreview,
  CurrencyCode,
  FreeGameRoomData,
  FreeGameType,
  FriendRequestRecord,
  FriendRequestStatus,
  GhostRoomProfile,
  IdeaRecord,
  MapParticipant,
  MapSessionData,
  TrackerEntry,
  VipFeaturesConfig,
  VipGameSessionData,
  VipGameType,
  VipPlanType,
  VipRoomRecord,
} from '../types';
import {
  buildGameLink,
  extractGameCodeFromInput,
  generateGameCode,
  generateUniqueGhostNumber,
  getSortedRoomCode,
  isValidGhostNumber,
  normalizeGhostNumber,
} from '../utils/ghostNumber';
import { generateRandomGhostAvatar, serializeGhostAvatar } from '../utils/ghostAvatar';
import { apiUrl } from '../utils/api';

const STORAGE_ACTIVE_GH = 'ghosted_active_gh_number';
const STORAGE_PROFILE_CACHE = 'ghosted_room_profile_cache';
const STORAGE_VIP_CACHE = 'ghosted_vip_room_cache';
const STORAGE_LAST_LOGIN_TIME = 'lastLoginTime';
const STORAGE_GHOSTED_ACCOUNT = 'ghostedAccount';
const STORAGE_USER_TOKEN = 'userToken';

export const SESSION_DAYS = 30;
const SESSION_DURATION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const chatKey = (roomCode: string) => `CHAT::${roomCode}`;
const gameKey = (code: string) => `GAME::${code.toUpperCase()}`;
const vipGameKey = (code: string) => `VIPGAME::${code.toUpperCase()}`;
const mapKey = (roomCode: string) => `MAP::${roomCode}`;
const locPinKey = (gh: string) => `LOC::${normalizeGhostNumber(gh)}`;
const friendReqKey = (roomCode: string) => `FRIENDREQ::${roomCode}`;

const STORAGE_PRIVACY_OFFSET = 'ghosted_privacy_offset';
let inMemoryPrivacyOffset: { dLat: number; dLng: number } | null = null;
let locationsTableMissing = true;
let legacyLocationTableMissing = true;

export function getSavedGhostNumber(): string {
  try {
    const raw = localStorage.getItem(STORAGE_ACTIVE_GH);
    return normalizeGhostNumber(raw);
  } catch {
    return '';
  }
}

export function markLoginSessionNow(): void {
  try {
    localStorage.setItem(STORAGE_LAST_LOGIN_TIME, Date.now().toString());
  } catch {}
}

export function isSessionWithin30Days(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_LAST_LOGIN_TIME);
    if (!raw) return false;
    const lastLogin = Number(raw);
    if (!Number.isFinite(lastLogin) || lastLogin <= 0) return false;
    return Date.now() - lastLogin < SESSION_DURATION_MS;
  } catch {
    return false;
  }
}

export function isStoredSessionExpired(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_LAST_LOGIN_TIME);
    if (!raw) return false;
    const lastLogin = Number(raw);
    if (!Number.isFinite(lastLogin) || lastLogin <= 0) return true;
    return Date.now() - lastLogin >= SESSION_DURATION_MS;
  } catch {
    return false;
  }
}

export function hasExistingGhostedAccount(): boolean {
  try {
    return Boolean(localStorage.getItem(STORAGE_GHOSTED_ACCOUNT));
  } catch {
    return false;
  }
}

export function checkLoginSession(isCreatingNewAccount: boolean): {
  allowed: boolean;
  reason?: 'double_account' | 'needs_signin';
  message?: string;
} {
  if (isCreatingNewAccount && hasExistingGhostedAccount()) {
    return {
      allowed: false,
      reason: 'double_account',
      message: 'You already have an account. Delete and burn your old account to create a new one.',
    };
  }
  if (isSessionWithin30Days()) {
    return { allowed: true };
  }
  return { allowed: true, reason: 'needs_signin' };
}

export function deleteAndBurnAccountStorage(): void {
  try {
    localStorage.removeItem(STORAGE_GHOSTED_ACCOUNT);
    localStorage.removeItem(STORAGE_LAST_LOGIN_TIME);
    localStorage.removeItem(STORAGE_USER_TOKEN);
    localStorage.removeItem(STORAGE_ACTIVE_GH);
    localStorage.removeItem('ghost_number');
    localStorage.removeItem(STORAGE_PROFILE_CACHE);
    localStorage.removeItem(STORAGE_VIP_CACHE);
  } catch {}
}

export function saveLocalGhostSession(profile: GhostRoomProfile): void {
  try {
    localStorage.setItem(STORAGE_ACTIVE_GH, profile.ghost_number);
    localStorage.setItem('ghost_number', profile.ghost_number);
    localStorage.setItem(STORAGE_PROFILE_CACHE, JSON.stringify(profile));
    localStorage.setItem(
      STORAGE_GHOSTED_ACCOUNT,
      JSON.stringify({
        ghost_number: profile.ghost_number,
        email: profile.email || '',
        display_name: profile.display_name,
      })
    );
    localStorage.setItem(STORAGE_USER_TOKEN, profile.ghost_number);
    if (!localStorage.getItem(STORAGE_LAST_LOGIN_TIME)) {
      localStorage.setItem(STORAGE_LAST_LOGIN_TIME, Date.now().toString());
    }
  } catch {}
}

export function getCachedGhostProfile(): GhostRoomProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_PROFILE_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GhostRoomProfile;
    if (!isValidGhostNumber(parsed.ghost_number)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLocalGhostSession(): void {
  try {
    localStorage.removeItem(STORAGE_ACTIVE_GH);
    localStorage.removeItem('ghost_number');
    localStorage.removeItem(STORAGE_PROFILE_CACHE);
    localStorage.removeItem(STORAGE_VIP_CACHE);
    localStorage.removeItem(STORAGE_LAST_LOGIN_TIME);
    localStorage.removeItem(STORAGE_USER_TOKEN);
  } catch {}
}

// =========================================================================
// PRESENCE & 24-HOUR COUNTDOWN FORMATTERS
// =========================================================================

export function isUserOnline(lastActiveIso?: string | null): boolean {
  if (!lastActiveIso) return false;
  const ageMs = Date.now() - new Date(lastActiveIso).getTime();
  return ageMs >= 0 && ageMs < 90 * 1000;
}

export function formatLastActiveText(lastActiveIso?: string | null): string {
  if (!lastActiveIso) return 'Offline';
  const diffMs = Date.now() - new Date(lastActiveIso).getTime();
  if (diffMs < 90 * 1000) return 'Online';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `Last active ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Last active ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `Last active ${days}d ago`;
}

export function formatDeletesInCountdown(expiresAtIso?: string | null, createdAtIso?: string | null): string {
  const targetMs = expiresAtIso
    ? new Date(expiresAtIso).getTime()
    : createdAtIso
    ? new Date(createdAtIso).getTime() + TWENTY_FOUR_HOURS_MS
    : Date.now() + TWENTY_FOUR_HOURS_MS;

  const remainingMs = Math.max(0, targetMs - Date.now());
  if (remainingMs <= 0) return 'Deleting soon';
  const totalMinutes = Math.floor(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `Deletes in ${hours}h ${mins}m`;
}

export function isExpired24h(expiresAtIso?: string | null, createdAtIso?: string | null): boolean {
  if (expiresAtIso) {
    return Date.now() >= new Date(expiresAtIso).getTime();
  }
  if (createdAtIso) {
    return Date.now() - new Date(createdAtIso).getTime() >= TWENTY_FOUR_HOURS_MS;
  }
  return false;
}

const STORAGE_DELETED_EMAILS = 'ghosted_deleted_emails';
const GNROOM_PREFIX = 'GNROOM::';

function normalizeEmail(raw?: string | null): string {
  return String(raw || '').trim().toLowerCase();
}

function getLocalDeletedEmails(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_DELETED_EMAILS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((e) => normalizeEmail(e)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function addLocalDeletedEmail(email: string): void {
  const clean = normalizeEmail(email);
  if (!clean) return;
  try {
    const list = getLocalDeletedEmails();
    if (!list.includes(clean)) {
      localStorage.setItem(STORAGE_DELETED_EMAILS, JSON.stringify([...list, clean]));
    }
  } catch {}
}

const GH_NUM_REGISTRY_PREFIX = 'GHNUM::';

export async function saveLiveGhostNumberRecord(params: {
  ghostNumber: string;
  displayName: string;
  profilePic: string;
  location?: string;
  locationHidden?: boolean;
  status?: string;
}): Promise<void> {
  const gh = normalizeGhostNumber(params.ghostNumber);
  if (!gh) return;
  const displayName = String(params.displayName || '').trim() || gh;
  const avatar = String(params.profilePic || '').trim();
  const status = params.status || 'active';

  try {
    await fetch(apiUrl('/api/gh-number-live'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ghostNumber: gh,
        displayName,
        avatar,
        profilePic: avatar,
        ...(params.location !== undefined ? { location: params.location } : {}),
        ...(params.locationHidden !== undefined ? { locationHidden: params.locationHidden } : {}),
        status,
      }),
    });
  } catch {}
}

function mapProfileRow(row: any): GhostRoomProfile {
  const gd = row?.game_data && typeof row.game_data === 'object' ? row.game_data : {};
  const rawTracker: TrackerEntry[] = Array.isArray(gd.tracker) ? gd.tracker : [];
  const liveTracker = rawTracker.filter(
    (entry) => !isExpired24h(entry.expires_at, entry.timestamp)
  );
  const cleanEmail = typeof gd.email === 'string' ? normalizeEmail(gd.email) : undefined;
  const authUid = typeof gd.auth_user_id === 'string' ? gd.auth_user_id : undefined;
  const statusStr = typeof gd.status === 'string' ? gd.status : undefined;
  const friends: string[] = Array.isArray(gd.friends)
    ? gd.friends.map((f: any) => normalizeGhostNumber(f)).filter(Boolean)
    : [];
  const blockedUsers: string[] = Array.isArray(gd.blocked_users)
    ? gd.blocked_users.map((b: any) => normalizeGhostNumber(b)).filter(Boolean)
    : [];
  const legalAcceptedAt =
    typeof gd.legal_accepted_at === 'string' ? gd.legal_accepted_at : undefined;

  const vipEndDate = typeof gd.vip_end_date === 'string' ? gd.vip_end_date : null;
  const vipStartDate = typeof gd.vip_start_date === 'string' ? gd.vip_start_date : null;
  const vipPlan = typeof gd.vip_plan === 'string' ? gd.vip_plan : null;
  const rawIsVip = Boolean(gd.is_vip);
  const effectiveIsVip =
    rawIsVip && (!vipEndDate || Date.now() < new Date(vipEndDate).getTime());

  return {
    id: row.id,
    ghost_number: row.ghost_number,
    display_name: row.display_name || row.ghost_number,
    profile_pic: row.profile_pic || serializeGhostAvatar(generateRandomGhostAvatar()),
    location: row.location || 'Unknown',
    status: statusStr,
    email: cleanEmail,
    auth_user_id: authUid,
    location_hidden: Boolean(gd.location_hidden) || row.location === 'Hidden',
    gh_number_hidden: Boolean(gd.gh_number_hidden),
    is_vip: effectiveIsVip,
    vip_start_date: vipStartDate,
    vip_end_date: vipEndDate,
    vip_plan: vipPlan,
    vip_type: (gd.vip_type as 'MAIN' | 'GAME' | 'BOTH' | null) || null,
    vip_expires_at: vipEndDate,
    paid_tag: typeof gd.paid_tag === 'string' ? gd.paid_tag : null,
    blocked_users: blockedUsers,
    legal_accepted_at: legalAcceptedAt,
    room_code: row.room_code || null,
    chat_with_ghost_number: row.chat_with_ghost_number || null,
    call_with_ghost_number: row.call_with_ghost_number || null,
    call_status: row.call_status || 'idle',
    game_type: row.game_type || null,
    game_data: {
      kind: 'profile',
      ...(statusStr ? { status: statusStr } : {}),
      ...(cleanEmail ? { email: cleanEmail } : {}),
      ...(authUid ? { auth_user_id: authUid } : {}),
      ...(legalAcceptedAt ? { legal_accepted_at: legalAcceptedAt } : {}),
      is_vip: effectiveIsVip,
      ...(vipStartDate ? { vip_start_date: vipStartDate } : {}),
      ...(vipEndDate ? { vip_end_date: vipEndDate } : {}),
      ...(vipPlan ? { vip_plan: vipPlan } : {}),
      ...(gd.vip_type ? { vip_type: gd.vip_type } : {}),
      ...(gd.paid_tag ? { paid_tag: gd.paid_tag } : {}),
      location_hidden: Boolean(gd.location_hidden),
      gh_number_hidden: Boolean(gd.gh_number_hidden),
      friends,
      blocked_users: blockedUsers,
      tracker: liveTracker,
    },
    last_active: row.last_active || new Date().toISOString(),
  };
}

// =========================================================================
// 1. SIGNUP / LOGIN (1 EMAIL = 1 GH-NUMBER FOREVER) / DELETE ACCOUNT
// =========================================================================

export async function isEmailInDeletedBlocklist(rawEmail: string): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (!email) return false;

  if (getLocalDeletedEmails().includes(email)) {
    return true;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(apiUrl('/api/check-deleted-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (res.ok) {
      const json = await res.json();
      if (json?.deleted) {
        addLocalDeletedEmail(email);
        return true;
      }
    }
  } catch {}

  return false;
}

export async function findGhostProfileByEmail(rawEmail: string): Promise<GhostRoomProfile | null> {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;

  try {
    const { data, error } = await supabase
      .from('ghosted_room')
      .select('*')
      .filter('game_data->>email', 'eq', email)
      .limit(20);

    if (!error && Array.isArray(data)) {
      const profileRow = data.find((r: any) => isValidGhostNumber(r?.ghost_number));
      if (profileRow) return mapProfileRow(profileRow);
    }
  } catch {}

  return null;
}

export async function createGhostAccountWithEmail(params: {
  email: string;
  password: string;
  displayName: string;
  profilePic?: string;
  location?: string;
  locationHidden?: boolean;
  acceptedLegal?: boolean;
}): Promise<GhostRoomProfile> {
  const guard = checkLoginSession(true);
  if (!guard.allowed) {
    throw new Error(
      guard.message ||
        'You already have an account. Delete and burn your old account to create a new one.'
    );
  }

  if (params.acceptedLegal !== true) {
    throw new Error('Please accept Terms & Conditions to continue');
  }

  const email = normalizeEmail(params.email);
  const password = String(params.password || '');
  const cleanName = params.displayName.trim() || 'Ghost User';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const pic = params.profilePic || serializeGhostAvatar(generateRandomGhostAvatar());
  const loc = params.locationHidden ? 'Hidden' : (params.location?.trim() || 'Unknown');

  // Strict 10-second timeout so Sign Up NEVER gets stuck spinning on "Creating GH-Number..."
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  let res: Response;
  try {
    res = await fetch(apiUrl('/api/accounts/signup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        username: cleanName,
        displayName: cleanName,
        profilePic: pic,
        location: loc,
        locationHidden: Boolean(params.locationHidden),
        acceptedLegal: true,
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      throw new Error('Could not create GH-Number, try again');
    }
    throw new Error('Could not create GH-Number, try again');
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403 || payload?.blocked) {
      addLocalDeletedEmail(email);
      throw new Error(payload?.error || 'This email has been used before');
    }
    throw new Error(payload?.error || 'Could not create GH-Number, try again');
  }

  const profileRow = payload?.profileRow;
  if (!profileRow) {
    throw new Error('Could not create GH-Number, try again');
  }

  // Non-blocking Auth session sync so UI navigates to Chats immediately
  supabase.auth.signInWithPassword({ email, password }).catch(() => {});

  const mapped = mapProfileRow(profileRow);
  saveLocalGhostSession(mapped);
  markLoginSessionNow();
  return mapped;
}

export async function signInWithEmail(
  rawEmail: string,
  password: string
): Promise<GhostRoomProfile> {
  const email = normalizeEmail(rawEmail);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }
  if (!password) {
    throw new Error('Enter your password.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  let res: Response;
  try {
    res = await fetch(apiUrl('/api/accounts/signin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      throw new Error('Sign in timed out. Please try again.');
    }
    throw new Error('Could not sign in. Please try again.');
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403 || payload?.blocked) {
      addLocalDeletedEmail(email);
      await supabase.auth.signOut().catch(() => {});
      throw new Error(payload?.error || 'This email has been used before');
    }
    throw new Error(payload?.error || 'Invalid login credentials.');
  }

  if (payload?.session?.access_token && payload?.session?.refresh_token) {
    supabase.auth
      .setSession({
        access_token: payload.session.access_token,
        refresh_token: payload.session.refresh_token,
      })
      .catch(() => {});
  }

  const profileRow = payload?.profileRow;
  if (!profileRow) {
    throw new Error('Could not load account profile from Supabase.');
  }

  const mapped = mapProfileRow(profileRow);
  saveLocalGhostSession(mapped);
  markLoginSessionNow();
  return mapped;
}

export async function signOutGhostAccount(params?: {
  email?: string;
  ghostNumber?: string;
}): Promise<void> {
  const cached = getCachedGhostProfile();
  const email = params?.email || cached?.email || '';
  const ghostNumber = params?.ghostNumber || cached?.ghost_number || getSavedGhostNumber() || '';

  // Update row in `ghosted_number_room`: status = signed_out. Do NOT delete row, GH-Number stays locked!
  try {
    await fetch(apiUrl('/api/accounts/signout'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, ghostNumber }),
    });
  } catch {}

  try {
    await supabase.auth.signOut();
  } catch {}
  clearLocalGhostSession();
}

export async function createGhostAccount(params: {
  displayName: string;
  profilePic?: string;
  location?: string;
  locationHidden?: boolean;
}): Promise<GhostRoomProfile> {
  const ghostNumber = await generateUniqueGhostNumber();
  const pic = params.profilePic || serializeGhostAvatar(generateRandomGhostAvatar());
  const cleanName = params.displayName.trim() || 'Ghost User';
  const loc = params.locationHidden ? 'Hidden' : (params.location?.trim() || 'Unknown');
  const nowIso = new Date().toISOString();

  const rowPayload = {
    ghost_number: ghostNumber,
    display_name: cleanName,
    profile_pic: pic,
    location: loc,
    call_status: 'idle',
    game_data: {
      kind: 'profile',
      status: 'live',
      location_hidden: Boolean(params.locationHidden),
      tracker: [],
    },
    last_active: nowIso,
  };

  const { data, error } = await supabase
    .from('ghosted_room')
    .insert(rowPayload)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'Could not create GH-XXXX profile in ghosted_room.');
  }

  await saveLiveGhostNumberRecord({
    ghostNumber,
    displayName: cleanName,
    profilePic: pic,
    status: 'live',
  });

  const mapped = mapProfileRow(data);
  saveLocalGhostSession(mapped);
  return mapped;
}

export async function signInWithGhostNumber(rawInput: string): Promise<GhostRoomProfile> {
  const gh = normalizeGhostNumber(rawInput);
  if (!gh) {
    throw new Error('Enter a valid GH-XXXX number (e.g. GH-4821).');
  }

  const { data, error } = await supabase
    .from('ghosted_room')
    .select('*')
    .eq('ghost_number', gh)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to look up GH-XXXX in ghosted_room.');
  }
  if (!data) {
    throw new Error(`${gh} not found.`);
  }

  const mapped = mapProfileRow(data);
  if (mapped.email && (await isEmailInDeletedBlocklist(mapped.email))) {
    throw new Error('Account Deleted - This email cannot create a new account.');
  }

  await supabase
    .from('ghosted_room')
    .update({ last_active: new Date().toISOString() })
    .eq('ghost_number', gh);

  await saveLiveGhostNumberRecord({
    ghostNumber: mapped.ghost_number,
    displayName: mapped.display_name,
    profilePic: mapped.profile_pic,
    status: 'live',
  });

  saveLocalGhostSession(mapped);
  return mapped;
}

export async function deleteAccountPermanently(params: {
  profile: GhostRoomProfile;
  emailOverride?: string;
}): Promise<{ deletedEmail: string }> {
  const gh = normalizeGhostNumber(params.profile.ghost_number);

  let authUserId = params.profile.auth_user_id || '';
  let authEmail = '';
  try {
    const { data: userRes } = await supabase.auth.getUser();
    if (userRes?.user) {
      authUserId = authUserId || userRes.user.id;
      authEmail = normalizeEmail(userRes.user.email);
    }
  } catch {}

  const deletedEmail = normalizeEmail(
    params.emailOverride || params.profile.email || authEmail || ''
  );

  // 1. Record email locally + mark `status = 'deleted', email_used_forever = true` in `ghosted_number_room`
  if (deletedEmail) {
    addLocalDeletedEmail(deletedEmail);
    try {
      await supabase.from('ghosted_room').upsert(
        {
          ghost_number: `${GNROOM_PREFIX}${deletedEmail}`,
          display_name: params.profile.display_name || 'DELETED',
          location: 'Deleted',
          room_code: gh || null,
          game_type: 'ghosted_number_room',
          game_data: {
            kind: 'ghosted_number_room',
            email: deletedEmail,
            gh_number: gh || null,
            status: 'deleted',
            email_used_forever: true,
            updated_at: new Date().toISOString(),
          },
          last_active: new Date().toISOString(),
        },
        { onConflict: 'ghost_number' }
      );
    } catch {}
  }

  // 2. Call server endpoint to delete ALL Supabase records (all tables + Auth user + deleted_emails)
  try {
    await fetch(apiUrl('/api/delete-account'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ghostNumber: gh,
        email: deletedEmail,
        authUserId,
      }),
    });
  } catch {}

  // 3. Direct client-side cleanup pass ONLY on Delete Account (messages, chats, ghosted_room, vip_room)
  if (gh) {
    try {
      await supabase.from('messages').delete().or(`sender_gh.eq.${gh},receiver_gh.eq.${gh}`);
    } catch {}
    try {
      await supabase.from('chats').delete().or(`user1_gh.eq.${gh},user2_gh.eq.${gh}`);
    } catch {}
    try {
      await supabase.from('ghosted_room').delete().eq('ghost_number', `${GH_NUM_REGISTRY_PREFIX}${gh}`);
    } catch {}
    try {
      await supabase.from('ghosted_room').delete().eq('ghost_number', gh);
    } catch {}
    try {
      await supabase.from('vip_room').delete().eq('ghost_number', gh);
    } catch {}
    try {
      await supabase.from('vip_table').delete().eq('gh_number', gh);
    } catch {}
    try {
      await supabase.from('profiles').delete().eq('gh_number', gh);
    } catch {}
    try {
      await supabase
        .from('ghosted_room')
        .delete()
        .like('ghost_number', 'IDEA::%')
        .eq('room_code', gh);
    } catch {}
    try {
      await supabase.from('ghosted_room').delete().eq('ghost_number', locPinKey(gh));
    } catch {}
    try {
      const { data: extraRows } = await supabase
        .from('ghosted_room')
        .select('ghost_number, room_code, game_data')
        .or(
          `ghost_number.like.CHAT::%,ghost_number.like.MAP::%,ghost_number.like.GAME::%,ghost_number.like.FRIENDREQ::%,ghost_number.like.LOC::%`
        )
        .limit(250);
      if (Array.isArray(extraRows)) {
        const toDel = extraRows
          .filter((r: any) => {
            const g = String(r?.ghost_number || '');
            const rc = String(r?.room_code || '');
            const gd = r?.game_data || {};
            return (
              g.includes(gh) ||
              rc.includes(gh) ||
              gd?.host === gh ||
              gd?.sender === gh ||
              gd?.receiver === gh ||
              gd?.inviter === gh ||
              gd?.invitee === gh
            );
          })
          .map((r: any) => r.ghost_number);
        if (toDel.length > 0) {
          await supabase.from('ghosted_room').delete().in('ghost_number', toDel);
        }
      }
    } catch {}
  }

  // 4. Sign out Auth session
  try {
    await supabase.auth.signOut();
  } catch {}

  // 5. Wipe local storage session, ghostedAccount lock & avatar cache (allows creating a new account)
  deleteAndBurnAccountStorage();
  try {
    localStorage.removeItem('ghosted_avatar_config');
    localStorage.removeItem('ghosted_legal_accepted');
  } catch {}

  return { deletedEmail };
}

const ghostProfileCache = new Map<string, { profile: GhostRoomProfile | null; cachedAt: number }>();
const GHOST_PROFILE_CACHE_TTL_MS = 15000;

export function invalidateGhostProfileCache(rawGh?: string): void {
  if (!rawGh) {
    ghostProfileCache.clear();
    return;
  }
  const gh = normalizeGhostNumber(rawGh);
  if (gh) ghostProfileCache.delete(gh);
}

export async function fetchGhostProfile(rawGh: string): Promise<GhostRoomProfile | null> {
  const gh = normalizeGhostNumber(rawGh);
  if (!gh) return null;

  const cached = ghostProfileCache.get(gh);
  if (cached && Date.now() - cached.cachedAt < GHOST_PROFILE_CACHE_TTL_MS) {
    return cached.profile;
  }

  const { data, error } = await supabase
    .from('ghosted_room')
    .select('*')
    .eq('ghost_number', gh)
    .maybeSingle();

  if (error || !data) return null;
  const mapped = mapProfileRow(data);
  ghostProfileCache.set(gh, { profile: mapped, cachedAt: Date.now() });
  return mapped;
}

export async function updatePresenceHeartbeat(ghostNumber: string): Promise<void> {
  const gh = normalizeGhostNumber(ghostNumber);
  if (!gh) return;
  await supabase
    .from('ghosted_room')
    .update({ last_active: new Date().toISOString() })
    .eq('ghost_number', gh);
}

export async function updateGhostProfile(
  ghostNumber: string,
  patch: {
    display_name?: string;
    profile_pic?: string;
    location?: string;
    location_hidden?: boolean;
    gh_number_hidden?: boolean;
  }
): Promise<GhostRoomProfile> {
  const gh = normalizeGhostNumber(ghostNumber);
  if (!gh) throw new Error('Invalid GH-XXXX number.');

  const existing = await fetchGhostProfile(gh);
  const prevGameData = existing?.game_data || { kind: 'profile', tracker: [] };
  const nextHidden =
    patch.location_hidden !== undefined
      ? patch.location_hidden
      : Boolean(prevGameData.location_hidden);
  const nextGhHidden =
    patch.gh_number_hidden !== undefined
      ? patch.gh_number_hidden
      : Boolean(prevGameData.gh_number_hidden);

  const nextLocation =
    patch.location !== undefined
      ? patch.location
      : existing?.location || 'Unknown';

  const updatePayload: Record<string, any> = {
    last_active: new Date().toISOString(),
    game_data: {
      ...prevGameData,
      kind: 'profile',
      status: 'active',
      location_hidden: nextHidden,
      gh_number_hidden: nextGhHidden,
    },
  };

  if (patch.display_name !== undefined) {
    updatePayload.display_name = patch.display_name.trim() || gh;
  }
  if (patch.profile_pic !== undefined) {
    updatePayload.profile_pic = patch.profile_pic;
  }
  if (patch.location !== undefined || patch.location_hidden !== undefined) {
    updatePayload.location = nextHidden ? 'Hidden' : nextLocation;
  }

  const { data, error } = await supabase
    .from('ghosted_room')
    .update(updatePayload)
    .eq('ghost_number', gh)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'Could not update profile in ghosted_room.');
  }

  const mapped = mapProfileRow(data);
  await saveLiveGhostNumberRecord({
    ghostNumber: mapped.ghost_number,
    displayName: mapped.display_name,
    profilePic: mapped.profile_pic,
    location: mapped.location,
    locationHidden: mapped.location_hidden,
    status: 'active',
  });

  if (patch.display_name !== undefined) {
    fetch(apiUrl('/api/accounts/update-username'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: mapped.email,
        ghostNumber: mapped.ghost_number,
        username: mapped.display_name,
      }),
    }).catch(() => {});
  }

  ghostProfileCache.set(mapped.ghost_number, { profile: mapped, cachedAt: Date.now() });
  saveLocalGhostSession(mapped);
  return mapped;
}

export async function detectCityCountry(): Promise<string> {
  try {
    const res = await fetch('https://ipapi.co/json/');
    if (res.ok) {
      const data = await res.json();
      if (data.city && data.country_name) {
        return `${data.city}, ${data.country_name}`;
      }
      if (data.country_name) return data.country_name;
    }
  } catch {}
  return 'Unknown Location';
}

// =========================================================================
// 2. LIVE GH-NUMBER CHECK (`ghosted_number_room` + `ghosted_room` live check)
// =========================================================================

export interface VipStatusSummary {
  is_vip: boolean;
  main_vip_active?: boolean;
  game1_active?: boolean;
  game2_active?: boolean;
  vip_type?: 'MAIN' | 'GAME' | 'BOTH' | null;
  vip_expires_at?: string | null;
  paid_tag?: string | null;
  plan?: string | null;
  vip_start_date?: string | null;
  vip_end_date?: string | null;
}

export async function fetchVipStatusMap(
  ghostNumbers: string[]
): Promise<Record<string, VipStatusSummary>> {
  const uniqueGhs = Array.from(
    new Set(ghostNumbers.map((g) => normalizeGhostNumber(g)).filter(Boolean))
  );
  const map: Record<string, VipStatusSummary> = {};
  if (uniqueGhs.length === 0) return map;

  try {
    const res = await fetch(apiUrl('/api/vip/status'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ghostNumbers: uniqueGhs }),
    });
    if (res.ok) {
      const payload = await res.json();
      if (payload?.map && typeof payload.map === 'object') {
        return payload.map as Record<string, VipStatusSummary>;
      }
    }
  } catch {}

  try {
    const { data: vtRows, error: vtErr } = await supabase
      .from('vip_table')
      .select('gh_number, is_vip, plan, vip_start_date, vip_end_date')
      .in('gh_number', uniqueGhs);
    if (!vtErr && Array.isArray(vtRows)) {
      vtRows.forEach((r: any) => {
        const gh = normalizeGhostNumber(r.gh_number);
        if (!gh) return;
        const expired =
          Boolean(r.is_vip) &&
          (!r.vip_end_date || Date.now() >= new Date(r.vip_end_date).getTime());
        map[gh] = {
          is_vip: Boolean(r.is_vip) && !expired,
          plan: r.plan || null,
          vip_start_date: r.vip_start_date || null,
          vip_end_date: r.vip_end_date || null,
        };
      });
    }
  } catch {}

  try {
    const { data: vrRows } = await supabase
      .from('vip_room')
      .select('ghost_number, vip_status, vip_features')
      .in('ghost_number', uniqueGhs);
    if (Array.isArray(vrRows)) {
      vrRows.forEach((r: any) => {
        const gh = normalizeGhostNumber(r.ghost_number);
        if (!gh || map[gh]?.is_vip) return;
        const f = r.vip_features || {};
        const active =
          r.vip_status === 'active' &&
          Boolean(f.vip_expires_at) &&
          Date.now() < new Date(f.vip_expires_at).getTime();
        if (active) {
          map[gh] = {
            is_vip: true,
            plan: f.vip_plan || null,
            vip_start_date: f.vip_start_date || f.paidAt || null,
            vip_end_date: f.vip_expires_at || null,
          };
        }
      });
    }
  } catch {}

  return map;
}

export async function searchByGhostNumber(query: string): Promise<GhostRoomProfile | null> {
  const gh = normalizeGhostNumber(query);
  if (!gh) {
    throw new Error('Enter a valid GH-XXXX number (e.g. GH-4821).');
  }

  // 1. Live check via `/api/gh-number-check` (checks `ghosted_room` + `vip_table` + `vip_room`)
  try {
    const res = await fetch(apiUrl('/api/gh-number-check'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ghostNumber: gh }),
    });
    if (res.ok) {
      const payload = await res.json();
      if (payload?.found && payload?.live && payload?.profile) {
        const { data: fullRow } = await supabase
          .from('ghosted_room')
          .select('*')
          .eq('ghost_number', gh)
          .maybeSingle();

        const isVipFlag = Boolean(payload.profile.is_vip);

        if (fullRow) {
          const mapped = mapProfileRow(fullRow);
          return {
            ...mapped,
            display_name: payload.profile.display_name || mapped.display_name,
            profile_pic:
              payload.profile.avatar || payload.profile.profile_pic || mapped.profile_pic,
            is_vip: isVipFlag,
            vip_start_date: payload.profile.vip_start_date || mapped.vip_start_date || null,
            vip_end_date: payload.profile.vip_end_date || mapped.vip_end_date || null,
            vip_plan: payload.profile.vip_plan || mapped.vip_plan || null,
            status: 'live',
          };
        }

        return {
          ghost_number: gh,
          display_name: payload.profile.display_name || gh,
          profile_pic:
            payload.profile.avatar ||
            payload.profile.profile_pic ||
            serializeGhostAvatar(generateRandomGhostAvatar()),
          location: 'Hidden',
          is_vip: isVipFlag,
          vip_start_date: payload.profile.vip_start_date || null,
          vip_end_date: payload.profile.vip_end_date || null,
          vip_plan: payload.profile.vip_plan || null,
          status: 'live',
          last_active: payload.profile.updated_at || new Date().toISOString(),
        };
      }

      if (payload?.explicitlyNotLive) {
        return null;
      }
    }
  } catch {}

  // 2. Direct live check in `ghosted_room` (`GHNUM::GH-XXXX` live record + `GH-XXXX` profile) + `vip_table`
  const vipMap = await fetchVipStatusMap([gh]);
  const vipInfo = vipMap[gh];

  const { data: regRow } = await supabase
    .from('ghosted_room')
    .select('*')
    .eq('ghost_number', `${GH_NUM_REGISTRY_PREFIX}${gh}`)
    .maybeSingle();

  if (regRow) {
    const gd = regRow.game_data || {};
    if (String(gd.status || '').toLowerCase() !== 'live') {
      return null;
    }
  }

  const { data, error } = await supabase
    .from('ghosted_room')
    .select('*')
    .eq('ghost_number', gh)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Search failed.');
  }

  if (!data) {
    if (regRow) {
      return {
        ghost_number: gh,
        display_name: regRow.display_name || gh,
        profile_pic: regRow.profile_pic || serializeGhostAvatar(generateRandomGhostAvatar()),
        location: 'Hidden',
        is_vip: Boolean(vipInfo?.is_vip),
        vip_start_date: vipInfo?.vip_start_date || null,
        vip_end_date: vipInfo?.vip_end_date || null,
        vip_plan: vipInfo?.plan || null,
        status: 'live',
        last_active: regRow.last_active || new Date().toISOString(),
      };
    }
    return null;
  }

  const mapped = mapProfileRow(data);
  if (mapped.status && mapped.status.toLowerCase() === 'deleted') {
    return null;
  }

  return {
    ...mapped,
    is_vip: vipInfo !== undefined ? vipInfo.is_vip : Boolean(mapped.is_vip),
    vip_start_date: vipInfo?.vip_start_date ?? mapped.vip_start_date ?? null,
    vip_end_date: vipInfo?.vip_end_date ?? mapped.vip_end_date ?? null,
    vip_plan: vipInfo?.plan ?? mapped.vip_plan ?? null,
    status: 'live',
  };
}

// =========================================================================
// 3. CLEANUP SWEEP + TRACKER (Chats & Messages persist until Delete Account)
// =========================================================================

export async function purgeExpiredRooms(myGhostNumber: string): Promise<void> {
  const myGh = normalizeGhostNumber(myGhostNumber);
  if (!myGh) return;

  // NOTE: Delete Account is the ONLY place that deletes chats/messages.
  // We intentionally do NOT auto-delete chats or messages here so chats persist across Sign Out / Sign In.

  // 2) Purge expired MAP:: rows in ghosted_room
  const { data: mapRows } = await supabase
    .from('ghosted_room')
    .select('ghost_number, game_data, last_active')
    .like('ghost_number', 'MAP::%')
    .limit(80);

  if (Array.isArray(mapRows)) {
    const expiredMapKeys = mapRows
      .filter((r: any) =>
        isExpired24h(r?.game_data?.expires_at, r?.game_data?.created_at || r?.last_active)
      )
      .map((r: any) => r.ghost_number);

    if (expiredMapKeys.length > 0) {
      await supabase
        .from('ghosted_room')
        .delete()
        .in('ghost_number', expiredMapKeys);
    }
  }

  // 3) Clean expired tracker items (>24h) on my profile row
  const { data: myRow } = await supabase
    .from('ghosted_room')
    .select('game_data')
    .eq('ghost_number', myGh)
    .maybeSingle();

  const gd = myRow?.game_data;
  if (gd && Array.isArray(gd.tracker)) {
    const kept = gd.tracker.filter(
      (t: TrackerEntry) => !isExpired24h(t.expires_at, t.timestamp)
    );
    if (kept.length !== gd.tracker.length) {
      await supabase
        .from('ghosted_room')
        .update({
          game_data: {
            ...gd,
            tracker: kept,
          },
        })
        .eq('ghost_number', myGh);
    }
  }
}

export async function recordTrackerEvent(params: {
  myGhostNumber: string;
  peerGhostNumber: string;
  peerName?: string;
  kind: 'chat' | 'call' | 'game' | 'map';
  roomCode: string;
  status?: string;
}): Promise<TrackerEntry[]> {
  const myGh = normalizeGhostNumber(params.myGhostNumber);
  const peerGh = normalizeGhostNumber(params.peerGhostNumber) || params.peerGhostNumber;
  if (!myGh) return [];

  const profile = await fetchGhostProfile(myGh);
  const existingTracker: TrackerEntry[] = Array.isArray(profile?.game_data?.tracker)
    ? profile!.game_data!.tracker!.filter(
        (t) => !isExpired24h(t.expires_at, t.timestamp)
      )
    : [];

  const summary =
    params.kind === 'chat'
      ? `You chatted with ${peerGh}`
      : params.kind === 'call'
      ? `You called ${peerGh}`
      : params.kind === 'map'
      ? `Map session with ${peerGh}`
      : `You played with ${peerGh}`;

  const nowMs = Date.now();
  const newEntry: TrackerEntry = {
    id: `trk-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
    kind: params.kind,
    peer_ghost_number: peerGh,
    peer_name: params.peerName,
    room_code: params.roomCode,
    summary,
    timestamp: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + TWENTY_FOUR_HOURS_MS).toISOString(),
    status: params.status,
  };

  const filtered = existingTracker.filter((item, idx) => {
    if (idx === 0 && item.kind === params.kind && item.peer_ghost_number === peerGh) {
      const ageMs = nowMs - new Date(item.timestamp).getTime();
      if (ageMs < 60000) return false;
    }
    return true;
  });

  const nextTracker = [newEntry, ...filtered].slice(0, 35);

  const updateFields: Record<string, any> = {
    room_code: params.roomCode,
    last_active: new Date(nowMs).toISOString(),
    game_data: {
      ...(profile?.game_data || {}),
      kind: 'profile',
      location_hidden: Boolean(profile?.location_hidden),
      tracker: nextTracker,
    },
  };

  if (params.kind === 'chat') {
    updateFields.chat_with_ghost_number = peerGh;
  } else if (params.kind === 'call') {
    updateFields.call_with_ghost_number = peerGh;
  }

  await supabase
    .from('ghosted_room')
    .update(updateFields)
    .eq('ghost_number', myGh);

  return nextTracker;
}

// =========================================================================
// 4. PERSONAL CHAT — LOCAL ONLY (NO SUPABASE MESSAGE SAVE) + LIVE BROADCAST
// =========================================================================

const STORAGE_PERSONAL_CHAT_PREFIX = 'ghosted_personal_chat::';
const STORAGE_PERSONAL_ROOMS_INDEX = 'ghosted_personal_chat_rooms';

interface LocalPersonalChatData {
  room_code: string;
  participants: string[];
  messages: ChatMessage[];
  created_at: string;
  expires_at: string;
  last_active: string;
}

const personalChatMemoryCache = new Map<string, LocalPersonalChatData>();
const roomAccessCache = new Map<string, { allowed: boolean; reason?: string; checkedAt: number }>();
const ROOM_ACCESS_CACHE_TTL_MS = 60000;
const peerPreviewCache = new Map<
  string,
  {
    display_name: string;
    profile_pic: string;
    is_vip: boolean;
    last_active?: string;
    cachedAt: number;
  }
>();

export function invalidateRoomAccessCache(ghA?: string, ghB?: string): void {
  if (ghA && ghB) {
    roomAccessCache.delete(getSortedRoomCode(ghA, ghB));
    return;
  }
  roomAccessCache.clear();
}

function readLocalPersonalChat(roomCode: string): LocalPersonalChatData | null {
  const mem = personalChatMemoryCache.get(roomCode);
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(`${STORAGE_PERSONAL_CHAT_PREFIX}${roomCode}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalPersonalChatData;
    if (!parsed || typeof parsed !== 'object') return null;
    const normalized: LocalPersonalChatData = {
      room_code: parsed.room_code || roomCode,
      participants: Array.isArray(parsed.participants) ? parsed.participants : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      created_at: parsed.created_at || new Date().toISOString(),
      expires_at:
        parsed.expires_at || new Date(Date.now() + TWENTY_FOUR_HOURS_MS).toISOString(),
      last_active: parsed.last_active || new Date().toISOString(),
    };
    personalChatMemoryCache.set(roomCode, normalized);
    return normalized;
  } catch {
    return null;
  }
}

export function getCachedPersonalChat(
  myGhostNumber: string,
  peerGhostNumber: string
): ChatRoomRow | null {
  const myGh = normalizeGhostNumber(myGhostNumber);
  const peerGh = normalizeGhostNumber(peerGhostNumber);
  if (!myGh || !peerGh) return null;
  const roomCode = getSortedRoomCode(myGh, peerGh);
  return readLocalPersonalChat(roomCode);
}

function writeLocalPersonalChat(room: LocalPersonalChatData): void {
  personalChatMemoryCache.set(room.room_code, room);
  try {
    localStorage.setItem(`${STORAGE_PERSONAL_CHAT_PREFIX}${room.room_code}`, JSON.stringify(room));
    const idxRaw = localStorage.getItem(STORAGE_PERSONAL_ROOMS_INDEX);
    const list: string[] = idxRaw ? JSON.parse(idxRaw) : [];
    if (!list.includes(room.room_code)) {
      localStorage.setItem(
        STORAGE_PERSONAL_ROOMS_INDEX,
        JSON.stringify([...list, room.room_code])
      );
    }
  } catch {}
}

function removeLocalPersonalChat(roomCode: string): void {
  personalChatMemoryCache.delete(roomCode);
  roomAccessCache.delete(roomCode);
  try {
    localStorage.removeItem(`${STORAGE_PERSONAL_CHAT_PREFIX}${roomCode}`);
    const idxRaw = localStorage.getItem(STORAGE_PERSONAL_ROOMS_INDEX);
    const list: string[] = idxRaw ? JSON.parse(idxRaw) : [];
    localStorage.setItem(
      STORAGE_PERSONAL_ROOMS_INDEX,
      JSON.stringify(list.filter((c) => c !== roomCode))
    );
  } catch {}
}

function mergeChatMessages(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const m of [...a, ...b]) {
    if (!m || !m.id) continue;
    const prev = map.get(m.id);
    if (!prev) {
      map.set(m.id, m);
    } else {
      map.set(m.id, {
        ...prev,
        ...m,
        deleted_for: Array.from(
          new Set([
            ...(Array.isArray(prev.deleted_for) ? prev.deleted_for : []),
            ...(Array.isArray(m.deleted_for) ? m.deleted_for : []),
          ])
        ),
        deleted_for_everyone: Boolean(prev.deleted_for_everyone || m.deleted_for_everyone),
      });
    }
  }
  return Array.from(map.values()).sort(
    (x, y) => new Date(x.timestamp).getTime() - new Date(y.timestamp).getTime()
  );
}

type RealtimeChannelType = ReturnType<typeof supabase.channel>;
const activePersonalChannels = new Map<string, { channel: RealtimeChannelType; ready: boolean }>();
const warmOutboundChannels = new Map<
  string,
  { channel: RealtimeChannelType; ready: boolean; waiting: Array<() => void> }
>();
const chatActivityListeners = new Set<(roomCode: string, room: LocalPersonalChatData) => void>();

export function subscribeToPersonalChatActivity(
  listener: (roomCode: string, room: LocalPersonalChatData) => void
): () => void {
  chatActivityListeners.add(listener);
  return () => {
    chatActivityListeners.delete(listener);
  };
}

function notifyPersonalChatActivity(roomCode: string, room: LocalPersonalChatData): void {
  chatActivityListeners.forEach((fn) => {
    try {
      fn(roomCode, room);
    } catch {}
  });
}

function getOrWarmOutboundChannel(channelTopic: string): {
  channel: RealtimeChannelType;
  sendWhenReady: (event: string, payload: any) => void;
} {
  let entry = warmOutboundChannels.get(channelTopic);
  if (!entry) {
    const ch = supabase.channel(channelTopic, {
      config: { broadcast: { self: false, ack: false } },
    });
    entry = { channel: ch, ready: false, waiting: [] };
    warmOutboundChannels.set(channelTopic, entry);
    ch.subscribe((status) => {
      const current = warmOutboundChannels.get(channelTopic);
      if (!current || current.channel !== ch) return;
      if (status === 'SUBSCRIBED') {
        current.ready = true;
        const flushed = current.waiting.splice(0, current.waiting.length);
        flushed.forEach((fn) => fn());
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        current.ready = false;
      }
    });
  }

  return {
    channel: entry.channel,
    sendWhenReady: (event: string, payload: any) => {
      const current = warmOutboundChannels.get(channelTopic);
      if (!current) return;
      const fire = () => {
        current.channel.send({ type: 'broadcast', event, payload }).catch(() => {});
      };
      if (current.ready) {
        fire();
      } else {
        current.waiting.push(fire);
      }
    },
  };
}

export function warmChatChannels(myGhostNumber: string, peerGhostNumber: string): void {
  const myGh = normalizeGhostNumber(myGhostNumber);
  const peerGh = normalizeGhostNumber(peerGhostNumber);
  if (!myGh || !peerGh) return;
  getOrWarmOutboundChannel(`user_inbox_${peerGh}`);
}

function broadcastPersonalChatEvent(
  roomCode: string,
  event: 'personal_msg' | 'personal_delete',
  payload: any,
  peerGh?: string
): void {
  try {
    // 1. Broadcast directly to room channel (active when peer has thread open)
    const activeRoom = activePersonalChannels.get(roomCode);
    if (activeRoom && activeRoom.ready) {
      activeRoom.channel.send({ type: 'broadcast', event, payload }).catch(() => {});
    } else {
      getOrWarmOutboundChannel(`personal_chat_${roomCode}`).sendWhenReady(event, payload);
    }

    // 2. Simultaneously broadcast to peer's global inbox channel (instant even when peer is on Chats list or another tab)
    const normalizedPeer = normalizeGhostNumber(peerGh);
    if (normalizedPeer) {
      getOrWarmOutboundChannel(`user_inbox_${normalizedPeer}`).sendWhenReady(event, payload);
    }
  } catch {}
}

async function verifyRoomAccessUncached(myGh: string, peerGh: string): Promise<void> {
  const roomCode = getSortedRoomCode(myGh, peerGh);
  if (await isEitherUserBlocked(myGh, peerGh)) {
    roomAccessCache.set(roomCode, {
      allowed: false,
      reason: 'This chat is unavailable because a user is blocked.',
      checkedAt: Date.now(),
    });
    throw new Error('This chat is unavailable because a user is blocked.');
  }

  const friendsConfirmed = await areUsersFriends(myGh, peerGh);
  if (!friendsConfirmed) {
    roomAccessCache.set(roomCode, {
      allowed: false,
      reason: 'Friend request must be accepted before chatting.',
      checkedAt: Date.now(),
    });
    throw new Error('Friend request must be accepted before chatting.');
  }

  roomAccessCache.set(roomCode, { allowed: true, checkedAt: Date.now() });
}

export async function openOrCreateChatRoom(
  myGhostNumber: string,
  peerGhostNumber: string
): Promise<ChatRoomRow> {
  const myGh = normalizeGhostNumber(myGhostNumber);
  const peerGh = normalizeGhostNumber(peerGhostNumber);
  if (!myGh || !peerGh) throw new Error('Invalid GH-XXXX number.');
  if (myGh === peerGh) throw new Error('Cannot open a chat with your own GH-Number.');

  const roomCode = getSortedRoomCode(myGh, peerGh);
  const existing = readLocalPersonalChat(roomCode);
  const cachedAccess = roomAccessCache.get(roomCode);
  const accessFresh =
    cachedAccess && Date.now() - cachedAccess.checkedAt < ROOM_ACCESS_CACHE_TTL_MS;

  if (existing) {
    if (cachedAccess && !cachedAccess.allowed && accessFresh) {
      throw new Error(cachedAccess.reason || 'Chat unavailable.');
    }
    if (!accessFresh) {
      // Background verify without blocking instant room display
      verifyRoomAccessUncached(myGh, peerGh).catch(() => {});
    }
    const participants =
      existing.participants.length > 0 ? existing.participants : [myGh, peerGh].sort();
    return {
      room_code: roomCode,
      participants,
      messages: existing.messages,
      created_at: existing.created_at,
      expires_at: existing.expires_at,
      last_active: existing.last_active,
    };
  }

  if (!accessFresh) {
    await verifyRoomAccessUncached(myGh, peerGh);
  } else if (!cachedAccess?.allowed) {
    throw new Error(cachedAccess?.reason || 'Chat unavailable.');
  }

  const nowIso = new Date().toISOString();
  const created: LocalPersonalChatData = {
    room_code: roomCode,
    participants: [myGh, peerGh].sort(),
    messages: [],
    created_at: nowIso,
    expires_at: new Date(Date.now() + TWENTY_FOUR_HOURS_MS).toISOString(),
    last_active: nowIso,
  };
  writeLocalPersonalChat(created);
  return created;
}

export async function sendChatMessage(params: {
  myGhostNumber: string;
  peerGhostNumber: string;
  text: string;
  gameCode?: string;
  gameType?: FreeGameType;
  gameLink?: string;
  mapSessionId?: string;
}): Promise<ChatRoomRow> {
  const myGh = normalizeGhostNumber(params.myGhostNumber);
  const peerGh = normalizeGhostNumber(params.peerGhostNumber);
  const roomCode = getSortedRoomCode(myGh, peerGh);

  // Fast-path: use RAM/localStorage room immediately so message sends with 0 network wait!
  let current = readLocalPersonalChat(roomCode);
  if (!current) {
    current = await openOrCreateChatRoom(myGh, peerGh);
  } else {
    const cachedAccess = roomAccessCache.get(roomCode);
    if (cachedAccess && !cachedAccess.allowed && Date.now() - cachedAccess.checkedAt < ROOM_ACCESS_CACHE_TTL_MS) {
      throw new Error(cachedAccess.reason || 'Chat unavailable.');
    }
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const msg: ChatMessage = {
    id: `msg-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
    from: myGh,
    to: peerGh,
    text: params.text.trim(),
    timestamp: nowIso,
    gameCode: params.gameCode,
    gameType: params.gameType,
    gameLink: params.gameLink,
    mapSessionId: params.mapSessionId,
  };

  // Save locally ONLY — DO NOT insert/save personal chat messages in Supabase
  const nextMessages = [...current.messages, msg].slice(-200);
  const participants =
    current.participants.length > 0 ? current.participants : [myGh, peerGh].sort();

  const nextRoom: LocalPersonalChatData = {
    room_code: roomCode,
    participants,
    messages: nextMessages,
    created_at: current.created_at,
    expires_at: current.expires_at,
    last_active: nowIso,
  };
  writeLocalPersonalChat(nextRoom);
  broadcastPersonalChatEvent(roomCode, 'personal_msg', msg, peerGh);
  notifyPersonalChatActivity(roomCode, nextRoom);

  return nextRoom;
}

export async function deleteChatMessage(params: {
  myGhostNumber: string;
  peerGhostNumber: string;
  messageId: string;
  mode: 'me' | 'everyone';
}): Promise<ChatRoomRow> {
  const myGh = normalizeGhostNumber(params.myGhostNumber);
  const peerGh = normalizeGhostNumber(params.peerGhostNumber);
  const roomCode = getSortedRoomCode(myGh, peerGh);

  const current = readLocalPersonalChat(roomCode) || {
    room_code: roomCode,
    participants: [myGh, peerGh].sort(),
    messages: [],
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + TWENTY_FOUR_HOURS_MS).toISOString(),
    last_active: new Date().toISOString(),
  };

  let updatedTargetMsg: ChatMessage | null = null;
  const nextMessages: ChatMessage[] = current.messages.map((m) => {
    if (m.id !== params.messageId) return m;
    if (params.mode === 'everyone') {
      if (m.from !== myGh) return m;
      updatedTargetMsg = {
        ...m,
        text: 'This message was deleted',
        deleted_for_everyone: true,
        gameCode: undefined,
        gameType: undefined,
        gameLink: undefined,
        mapSessionId: undefined,
      };
      return updatedTargetMsg;
    }
    const prevDeletedFor = Array.isArray(m.deleted_for) ? m.deleted_for : [];
    updatedTargetMsg = {
      ...m,
      deleted_for: prevDeletedFor.includes(myGh) ? prevDeletedFor : [...prevDeletedFor, myGh],
    };
    return updatedTargetMsg;
  });

  const nowIso = new Date().toISOString();
  const nextRoom: LocalPersonalChatData = {
    room_code: roomCode,
    participants: current.participants,
    messages: nextMessages,
    created_at: current.created_at,
    expires_at: current.expires_at,
    last_active: nowIso,
  };
  writeLocalPersonalChat(nextRoom);
  notifyPersonalChatActivity(roomCode, nextRoom);

  if (params.mode === 'everyone' && updatedTargetMsg) {
    broadcastPersonalChatEvent(
      roomCode,
      'personal_delete',
      {
        roomCode,
        messageId: params.messageId,
        message: updatedTargetMsg,
      },
      peerGh
    );
  }

  return nextRoom;
}

function readLocalConversationRawItems(
  myGh: string,
  blockedSet: Set<string>
): Array<{
  roomCode: string;
  peerGh: string;
  lastMessage: string;
  lastTimestamp: string;
  expiresAt: string;
}> {
  const byRoomCode = new Map<
    string,
    {
      roomCode: string;
      peerGh: string;
      lastMessage: string;
      lastTimestamp: string;
      expiresAt: string;
    }
  >();

  try {
    const idxRaw = localStorage.getItem(STORAGE_PERSONAL_ROOMS_INDEX);
    const roomCodes: string[] = idxRaw ? JSON.parse(idxRaw) : [];
    for (const rc of roomCodes) {
      const localRoom = readLocalPersonalChat(rc);
      if (!localRoom) continue;
      if (!localRoom.participants.includes(myGh) && !rc.includes(myGh)) continue;

      const peerGh =
        localRoom.participants.find((p) => p !== myGh) ||
        rc
          .split('-')
          .reduce<string[]>((acc, part, idx, arr) => {
            if (part === 'GH' && arr[idx + 1]) acc.push(`GH-${arr[idx + 1]}`);
            return acc;
          }, [])
          .find((g) => g !== myGh) ||
        '';
      if (!peerGh || blockedSet.has(peerGh)) continue;

      const visibleMessages = localRoom.messages.filter(
        (m) => !Array.isArray(m.deleted_for) || !m.deleted_for.includes(myGh)
      );
      const last = visibleMessages[visibleMessages.length - 1];
      byRoomCode.set(rc, {
        roomCode: rc,
        peerGh,
        lastMessage: last?.text || 'Local chat ready',
        lastTimestamp: last?.timestamp || localRoom.last_active,
        expiresAt: localRoom.expires_at,
      });
    }
  } catch {}

  return Array.from(byRoomCode.values()).sort(
    (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  );
}

export function getLocalChatConversationsFast(myGhostNumber: string): ConversationPreview[] {
  const myGh = normalizeGhostNumber(myGhostNumber);
  if (!myGh) return [];
  const cachedMe = ghostProfileCache.get(myGh)?.profile || getCachedGhostProfile();
  const blockedSet = new Set<string>(cachedMe?.blocked_users || []);
  const items = readLocalConversationRawItems(myGh, blockedSet);
  return items.map((item) => {
    const cachedPeer = peerPreviewCache.get(item.peerGh);
    return {
      room_code: item.roomCode,
      peer_ghost_number: item.peerGh,
      peer_name: cachedPeer?.display_name || item.peerGh,
      peer_pic: cachedPeer?.profile_pic || '',
      peer_is_vip: cachedPeer?.is_vip || false,
      peer_last_active: cachedPeer?.last_active,
      last_message: item.lastMessage,
      last_timestamp: item.lastTimestamp,
      expires_at: item.expiresAt,
    };
  });
}

export async function fetchMyChatConversations(myGhostNumber: string): Promise<ConversationPreview[]> {
  const myGh = normalizeGhostNumber(myGhostNumber);
  if (!myGh) return [];

  const myProfile = await fetchGhostProfile(myGh);
  const blockedSet = new Set<string>(myProfile?.blocked_users || []);
  const items = readLocalConversationRawItems(myGh, blockedSet);

  const peerNumbers = Array.from(new Set(items.map((i) => i.peerGh).filter(Boolean)));
  const peerProfiles: Record<string, GhostRoomProfile> = {};
  const vipMap: Record<string, VipStatusSummary> = {};

  if (peerNumbers.length > 0) {
    const [profRes, vipRes] = await Promise.all([
      supabase
        .from('ghosted_room')
        .select('ghost_number, display_name, profile_pic, location, game_data, last_active')
        .in('ghost_number', peerNumbers),
      fetchVipStatusMap(peerNumbers),
    ]);
    if (Array.isArray(profRes.data)) {
      profRes.data.forEach((p: any) => {
        peerProfiles[p.ghost_number] = mapProfileRow(p);
      });
    }
    Object.assign(vipMap, vipRes);
  }

  return items.map((item) => {
    const peerProfile = peerProfiles[item.peerGh];
    const peerVip = vipMap[item.peerGh];
    const isVip = peerVip ? peerVip.is_vip : Boolean(peerProfile?.is_vip);
    const displayName = peerProfile?.display_name || item.peerGh;
    const pic = peerProfile?.profile_pic || '';

    if (peerProfile) {
      peerPreviewCache.set(item.peerGh, {
        display_name: displayName,
        profile_pic: pic,
        is_vip: isVip,
        last_active: peerProfile.last_active,
        cachedAt: Date.now(),
      });
    }

    return {
      room_code: item.roomCode,
      peer_ghost_number: item.peerGh,
      peer_name: displayName,
      peer_pic: pic,
      peer_is_vip: isVip,
      peer_last_active: peerProfile?.last_active,
      last_message: item.lastMessage,
      last_timestamp: item.lastTimestamp,
      expires_at: item.expiresAt,
    };
  });
}

function makeUniqueChannelName(base: string): string {
  return `${base}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function applyIncomingBroadcastMsg(roomCode: string, msg: ChatMessage): LocalPersonalChatData {
  const current = readLocalPersonalChat(roomCode) || {
    room_code: roomCode,
    participants: [msg.from, msg.to].filter(Boolean).sort(),
    messages: [],
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + TWENTY_FOUR_HOURS_MS).toISOString(),
    last_active: new Date().toISOString(),
  };
  const merged = mergeChatMessages(current.messages, [msg]).slice(-200);
  const updated: LocalPersonalChatData = {
    ...current,
    messages: merged,
    last_active: msg.timestamp || new Date().toISOString(),
  };
  writeLocalPersonalChat(updated);
  notifyPersonalChatActivity(roomCode, updated);
  return updated;
}

function applyIncomingBroadcastDelete(
  roomCode: string,
  messageId: string,
  replacement: ChatMessage
): LocalPersonalChatData | null {
  const current = readLocalPersonalChat(roomCode);
  if (!current) return null;
  const updated: LocalPersonalChatData = {
    ...current,
    messages: current.messages.map((m) => (m.id === messageId ? replacement : m)),
    last_active: new Date().toISOString(),
  };
  writeLocalPersonalChat(updated);
  notifyPersonalChatActivity(roomCode, updated);
  return updated;
}

export function subscribeToChatRoom(
  roomCode: string,
  onUpdate: (room: ChatRoomRow | null) => void
): () => void {
  const entry = { channel: null as any, ready: false };
  const channel = supabase
    .channel(`personal_chat_${roomCode}`, {
      config: { broadcast: { self: false, ack: false } },
    })
    .on('broadcast', { event: 'personal_msg' }, ({ payload }) => {
      const msg = payload as ChatMessage;
      if (!msg || !msg.id) return;
      const updated = applyIncomingBroadcastMsg(roomCode, msg);
      onUpdate(updated);
    })
    .on('broadcast', { event: 'personal_delete' }, ({ payload }) => {
      const messageId = payload?.messageId as string | undefined;
      const replacement = payload?.message as ChatMessage | undefined;
      if (!messageId || !replacement) return;
      const updated = applyIncomingBroadcastDelete(roomCode, messageId, replacement);
      if (updated) onUpdate(updated);
    })
    .subscribe((status) => {
      entry.ready = status === 'SUBSCRIBED';
    });

  entry.channel = channel;
  activePersonalChannels.set(roomCode, entry);

  // Also forward any message received via global user inbox for this roomCode!
  const unsubActivity = subscribeToPersonalChatActivity((changedRoom, updated) => {
    if (changedRoom === roomCode) {
      onUpdate(updated);
    }
  });

  return () => {
    unsubActivity();
    if (activePersonalChannels.get(roomCode)?.channel === channel) {
      activePersonalChannels.delete(roomCode);
    }
    supabase.removeChannel(channel);
  };
}

export function subscribeToUserInbox(
  myGhostNumber: string,
  onIncomingMessage?: (msg: ChatMessage, room: ChatRoomRow) => void
): () => void {
  const myGh = normalizeGhostNumber(myGhostNumber);
  if (!myGh) return () => {};

  const channel = supabase
    .channel(`user_inbox_${myGh}`, {
      config: { broadcast: { self: false, ack: false } },
    })
    .on('broadcast', { event: 'personal_msg' }, ({ payload }) => {
      const msg = payload as ChatMessage;
      if (!msg || !msg.id || !msg.from) return;
      const peerGh = normalizeGhostNumber(msg.from) === myGh ? normalizeGhostNumber(msg.to) : normalizeGhostNumber(msg.from);
      if (!peerGh) return;
      const roomCode = getSortedRoomCode(myGh, peerGh);
      const updated = applyIncomingBroadcastMsg(roomCode, msg);
      onIncomingMessage?.(msg, updated);
    })
    .on('broadcast', { event: 'personal_delete' }, ({ payload }) => {
      const messageId = payload?.messageId as string | undefined;
      const replacement = payload?.message as ChatMessage | undefined;
      const roomCode =
        (payload?.roomCode as string | undefined) ||
        (replacement?.from && replacement?.to
          ? getSortedRoomCode(replacement.from, replacement.to)
          : '');
      if (!messageId || !replacement || !roomCode) return;
      applyIncomingBroadcastDelete(roomCode, messageId, replacement);
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// =========================================================================
// 5. VOICE CALLS (SAME room_code = GH-A-GH-B, REALTIME POPUP + TRACKER)
// =========================================================================

export async function startGhostCallRow(
  callerGh: string,
  receiverGh: string
): Promise<{ roomCode: string }> {
  const caller = normalizeGhostNumber(callerGh);
  const receiver = normalizeGhostNumber(receiverGh);
  if (!caller || !receiver) throw new Error('Invalid GH-XXXX number.');
  if (caller === receiver) throw new Error('You cannot call your own GH-Number.');

  if (await isEitherUserBlocked(caller, receiver)) {
    throw new Error('Cannot call this user because one of you has blocked the other.');
  }

  const target = await fetchGhostProfile(receiver);
  if (!target) {
    throw new Error(`${receiver} not found in Ghosted Room.`);
  }

  const roomCode = getSortedRoomCode(caller, receiver);
  const nowIso = new Date().toISOString();

  await supabase
    .from('ghosted_room')
    .update({
      room_code: roomCode,
      call_with_ghost_number: caller,
      call_status: 'ringing',
      last_active: nowIso,
    })
    .eq('ghost_number', receiver);

  await supabase
    .from('ghosted_room')
    .update({
      room_code: roomCode,
      call_with_ghost_number: receiver,
      call_status: 'ringing',
      last_active: nowIso,
    })
    .eq('ghost_number', caller);

  await recordTrackerEvent({
    myGhostNumber: caller,
    peerGhostNumber: receiver,
    peerName: target.display_name,
    kind: 'call',
    roomCode,
    status: 'ringing',
  });

  return { roomCode };
}

export async function updateCallStatusBoth(
  myGh: string,
  peerGh: string,
  roomCode: string,
  status: 'active' | 'ended' | 'idle'
): Promise<void> {
  const me = normalizeGhostNumber(myGh);
  const peer = normalizeGhostNumber(peerGh);
  const nowIso = new Date().toISOString();

  if (me) {
    await supabase
      .from('ghosted_room')
      .update({
        room_code: roomCode,
        call_with_ghost_number: status === 'idle' ? null : peer,
        call_status: status,
        last_active: nowIso,
      })
      .eq('ghost_number', me);
  }

  if (peer) {
    await supabase
      .from('ghosted_room')
      .update({
        room_code: roomCode,
        call_with_ghost_number: status === 'idle' ? null : me,
        call_status: status,
        last_active: nowIso,
      })
      .eq('ghost_number', peer);
  }
}

export function subscribeToMyCallRow(
  myGhostNumber: string,
  onIncomingRing: (callerGh: string, roomCode: string) => void,
  onCallStatusRow: (status: string) => void
): () => void {
  const myGh = normalizeGhostNumber(myGhostNumber);
  if (!myGh) return () => {};

  const handleRow = (row: any) => {
    if (!row) return;
    const status = row.call_status;
    const peer = normalizeGhostNumber(row.call_with_ghost_number);
    const roomCode = row.room_code || (peer ? getSortedRoomCode(myGh, peer) : '');

    if (status === 'ringing' && peer && peer !== myGh) {
      onIncomingRing(peer, roomCode);
    } else if (status === 'active' || status === 'ended' || status === 'idle') {
      onCallStatusRow(status);
    }
  };

  const channel = supabase
    .channel(makeUniqueChannelName(`my_call_row_${myGh}`))
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'ghosted_room',
        filter: `ghost_number=eq.${myGh}`,
      },
      (payload) => handleRow(payload.new)
    )
    .subscribe();

  const pollInterval = setInterval(async () => {
    const { data } = await supabase
      .from('ghosted_room')
      .select('call_status, call_with_ghost_number, room_code')
      .eq('ghost_number', myGh)
      .maybeSingle();
    if (data) handleRow(data);
  }, 3500);

  return () => {
    clearInterval(pollInterval);
    supabase.removeChannel(channel);
  };
}

// =========================================================================
// =========================================================================
// 6. LOCATION + FRIEND-ONLY MUTUAL CONSENT MAP (`location` + `ghosted_room`)
// =========================================================================

export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

export function formatDistanceApart(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): string {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const meters = R * c;
  if (meters < 1000) {
    return `${Math.max(1, Math.round(meters))} m apart`;
  }
  return `${(meters / 1000).toFixed(1)} km apart`;
}

export const getDistance = formatDistanceApart;

function isMissingLocationsTableError(error: any): boolean {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('public.locations') ||
    msg.includes('public.location') ||
    msg.includes('does not exist')
  );
}

function getOrCreatePrivacyOffset(): { dLat: number; dLng: number } {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(STORAGE_PRIVACY_OFFSET);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          typeof parsed?.dLat === 'number' &&
          typeof parsed?.dLng === 'number' &&
          (parsed.dLat !== 0 || parsed.dLng !== 0)
        ) {
          return parsed;
        }
      }
      let dLat = (Math.random() - 0.5) * 0.002;
      let dLng = (Math.random() - 0.5) * 0.002;
      if (Math.abs(dLat) < 0.00015) dLat = dLat >= 0 ? 0.00035 : -0.00035;
      if (Math.abs(dLng) < 0.00015) dLng = dLng >= 0 ? 0.00035 : -0.00035;
      const offset = { dLat, dLng };
      sessionStorage.setItem(STORAGE_PRIVACY_OFFSET, JSON.stringify(offset));
      return offset;
    }
  } catch {}

  if (!inMemoryPrivacyOffset) {
    let dLat = (Math.random() - 0.5) * 0.002;
    let dLng = (Math.random() - 0.5) * 0.002;
    if (Math.abs(dLat) < 0.00015) dLat = dLat >= 0 ? 0.00035 : -0.00035;
    if (Math.abs(dLng) < 0.00015) dLng = dLng >= 0 ? 0.00035 : -0.00035;
    inMemoryPrivacyOffset = { dLat, dLng };
  }
  return inMemoryPrivacyOffset;
}

export function clearPrivacyOffset(): void {
  inMemoryPrivacyOffset = null;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(STORAGE_PRIVACY_OFFSET);
    }
  } catch {}
}

export function applyPrivacyOffset(coords: {
  lat: number;
  lng: number;
}): { lat: number; lng: number } {
  const { dLat, dLng } = getOrCreatePrivacyOffset();
  return {
    lat: coords.lat + dLat,
    lng: coords.lng + dLng,
  };
}

export interface StoredUserLocation {
  ghost_number: string;
  lat: number;
  lng: number;
  display_name?: string;
  profile_pic?: string;
  updated_at: string;
}

export async function updateMyLocation(
  ghostNumberRaw: string,
  lat: number,
  lng: number,
  profileMeta?: { display_name?: string; profile_pic?: string }
): Promise<StoredUserLocation | null> {
  const ghostNumber = normalizeGhostNumber(ghostNumberRaw) || getSavedGhostNumber();
  if (!ghostNumber || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const fuzzy = applyPrivacyOffset({ lat, lng });
  const nowIso = new Date().toISOString();

  if (!locationsTableMissing) {
    try {
      const { error } = await supabase.from('locations').upsert(
        [
          {
            ghost_number: ghostNumber,
            lat: fuzzy.lat,
            lng: fuzzy.lng,
            updated_at: nowIso,
          },
        ],
        { onConflict: 'ghost_number' }
      );
      if (error && isMissingLocationsTableError(error)) {
        locationsTableMissing = true;
      }
    } catch {}
  }

  try {
    await supabase.from('ghosted_room').upsert(
      {
        ghost_number: locPinKey(ghostNumber),
        display_name: profileMeta?.display_name || ghostNumber,
        room_code: ghostNumber,
        game_type: 'location_pin',
        game_data: {
          kind: 'location_pin',
          ghost_number: ghostNumber,
          display_name: profileMeta?.display_name || ghostNumber,
          profile_pic: profileMeta?.profile_pic || '',
          lat: fuzzy.lat,
          lng: fuzzy.lng,
          is_sharing: true,
          updated_at: nowIso,
        },
        last_active: nowIso,
      },
      { onConflict: 'ghost_number' }
    );
  } catch {}

  return {
    ghost_number: ghostNumber,
    lat: fuzzy.lat,
    lng: fuzzy.lng,
    display_name: profileMeta?.display_name,
    profile_pic: profileMeta?.profile_pic,
    updated_at: nowIso,
  };
}

export async function stopMyLocationPin(ghostNumberRaw: string): Promise<void> {
  const ghostNumber = normalizeGhostNumber(ghostNumberRaw);
  clearPrivacyOffset();
  if (!ghostNumber) return;

  const nowIso = new Date().toISOString();
  if (!locationsTableMissing) {
    try {
      const { error } = await supabase
        .from('locations')
        .delete()
        .eq('ghost_number', ghostNumber);
      if (error && isMissingLocationsTableError(error)) {
        locationsTableMissing = true;
      }
    } catch {}
  }

  try {
    await supabase.from('ghosted_room').upsert(
      {
        ghost_number: locPinKey(ghostNumber),
        display_name: ghostNumber,
        room_code: ghostNumber,
        game_type: 'location_pin',
        game_data: {
          kind: 'location_pin',
          ghost_number: ghostNumber,
          lat: null,
          lng: null,
          is_sharing: false,
          updated_at: nowIso,
        },
        last_active: nowIso,
      },
      { onConflict: 'ghost_number' }
    );
  } catch {}
}

export async function loadLocationsForGhostNumbers(
  ghostNumbers: string[]
): Promise<Record<string, StoredUserLocation>> {
  const normalized = Array.from(
    new Set(ghostNumbers.map((g) => normalizeGhostNumber(g)).filter(Boolean))
  );
  const result: Record<string, StoredUserLocation> = {};
  if (normalized.length === 0) return result;

  if (!locationsTableMissing) {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .in('ghost_number', normalized);
      if (error) {
        if (isMissingLocationsTableError(error)) {
          locationsTableMissing = true;
        }
      } else if (Array.isArray(data)) {
        data.forEach((row: any) => {
          const gh = normalizeGhostNumber(row?.ghost_number);
          if (gh && typeof row?.lat === 'number' && typeof row?.lng === 'number') {
            result[gh] = {
              ghost_number: gh,
              lat: row.lat,
              lng: row.lng,
              updated_at: row.updated_at || new Date().toISOString(),
            };
          }
        });
      }
    } catch {}
  }

  try {
    const keys = normalized.map((gh) => locPinKey(gh));
    const { data: grData } = await supabase
      .from('ghosted_room')
      .select('ghost_number, game_data, last_active')
      .in('ghost_number', keys);

    if (Array.isArray(grData)) {
      grData.forEach((row: any) => {
        const gd = row?.game_data;
        if (!gd || gd.is_sharing === false) return;
        const gh = normalizeGhostNumber(gd.ghost_number || String(row.ghost_number).replace(/^LOC::/, ''));
        if (gh && typeof gd.lat === 'number' && typeof gd.lng === 'number') {
          const existing = result[gh];
          const gdTime = new Date(gd.updated_at || row.last_active || 0).getTime();
          const exTime = existing ? new Date(existing.updated_at || 0).getTime() : -1;
          if (!existing || gdTime >= exTime) {
            result[gh] = {
              ghost_number: gh,
              lat: gd.lat,
              lng: gd.lng,
              display_name: gd.display_name,
              profile_pic: gd.profile_pic,
              updated_at: gd.updated_at || row.last_active || new Date().toISOString(),
            };
          }
        }
      });
    }
  } catch {}

  return result;
}

export async function loadBothLocations(
  myGhostNumberRaw: string,
  friendGhostNumberRaw: string
): Promise<{
  myLoc: StoredUserLocation | null;
  friendLoc: StoredUserLocation | null;
}> {
  const myGh = normalizeGhostNumber(myGhostNumberRaw) || getSavedGhostNumber();
  const friendGh = normalizeGhostNumber(friendGhostNumberRaw);
  const targets = [myGh, friendGh].filter(Boolean);
  const map = await loadLocationsForGhostNumbers(targets);
  return {
    myLoc: myGh ? map[myGh] || null : null,
    friendLoc: friendGh ? map[friendGh] || null : null,
  };
}

export async function requestUserGeoCoords(): Promise<
  | { granted: true; coords: { lat: number; lng: number } }
  | { granted: false; reason: 'denied' | 'unavailable' }
> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { granted: false, reason: 'unavailable' };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          granted: true,
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        });
      },
      async (err) => {
        if (err && err.code === 1) {
          resolve({ granted: false, reason: 'denied' });
          return;
        }
        // If permission was explicitly granted at browser level, try IP fallback; otherwise treat as not granted
        try {
          if (navigator.permissions?.query) {
            const perm = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
            if (perm.state === 'denied' || perm.state === 'prompt') {
              resolve({ granted: false, reason: 'denied' });
              return;
            }
            if (perm.state === 'granted') {
              const res = await fetch('https://ipapi.co/json/').catch(() => null);
              if (res?.ok) {
                const data = await res.json();
                if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
                  resolve({ granted: true, coords: { lat: data.latitude, lng: data.longitude } });
                  return;
                }
              }
            }
          }
        } catch {}
        resolve({ granted: false, reason: 'unavailable' });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 10000,
      }
    );
  });
}

export async function getCurrentGeoCoords(): Promise<{ lat: number; lng: number }> {
  const res = await requestUserGeoCoords();
  if (res.granted) return res.coords;
  throw new Error('Location permission denied.');
}

async function syncMapSessionToLocationTable(session: MapSessionData): Promise<void> {
  if (legacyLocationTableMissing) return;
  const nowIso = new Date().toISOString();
  const inviter = normalizeGhostNumber(session.inviter);
  const invitee = normalizeGhostNumber(session.invitee);
  if (!inviter || !invitee) return;

  const pairs: Array<[string, string]> = [
    [inviter, invitee],
    [invitee, inviter],
  ];

  for (const [gh, friendGh] of pairs) {
    const p = session.participants?.[gh];
    const isSharing =
      session.status === 'accepted' &&
      Boolean(p) &&
      typeof p?.lat === 'number' &&
      typeof p?.lng === 'number';
    try {
      const { error } = await supabase.from('location').upsert(
        {
          id: `${session.room_code}::${gh}`,
          room_code: session.room_code,
          gh_number: gh,
          friend_gh: friendGh,
          display_name: p?.display_name || gh,
          profile_pic: p?.profile_pic || '',
          lat: isSharing ? p!.lat : null,
          lng: isSharing ? p!.lng : null,
          status: session.status,
          is_sharing: isSharing,
          inviter_gh: inviter,
          invitee_gh: invitee,
          stopped_by: session.stopped_by || null,
          updated_at: nowIso,
          created_at: session.created_at || nowIso,
        },
        { onConflict: 'id' }
      );
      if (error && isMissingLocationsTableError(error)) {
        legacyLocationTableMissing = true;
        return;
      }
    } catch {}
  }
}

export async function updateSoloLocationSharing(params: {
  me: GhostRoomProfile;
  sharing: boolean;
  coords?: { lat: number; lng: number } | null;
}): Promise<void> {
  const myGh = normalizeGhostNumber(params.me.ghost_number);
  if (!myGh) return;
  const nowIso = new Date().toISOString();

  let fuzzyCoords: { lat: number; lng: number } | null = null;
  if (params.sharing && params.coords) {
    const saved = await updateMyLocation(myGh, params.coords.lat, params.coords.lng, {
      display_name: params.me.display_name,
      profile_pic: params.me.profile_pic,
    });
    fuzzyCoords = saved
      ? { lat: saved.lat, lng: saved.lng }
      : applyPrivacyOffset(params.coords);
  } else if (!params.sharing) {
    await stopMyLocationPin(myGh);
  }

  if (legacyLocationTableMissing) return;
  try {
    const { error } = await supabase.from('location').upsert(
      {
        id: `SOLO::${myGh}`,
        room_code: `SOLO::${myGh}`,
        gh_number: myGh,
        friend_gh: myGh,
        display_name: params.me.display_name,
        profile_pic: params.me.profile_pic,
        lat: fuzzyCoords ? fuzzyCoords.lat : null,
        lng: fuzzyCoords ? fuzzyCoords.lng : null,
        status: params.sharing ? 'active' : 'stopped',
        is_sharing: params.sharing,
        inviter_gh: myGh,
        invitee_gh: myGh,
        stopped_by: params.sharing ? null : myGh,
        updated_at: nowIso,
      },
      { onConflict: 'id' }
    );
    if (error && isMissingLocationsTableError(error)) {
      legacyLocationTableMissing = true;
    }
  } catch {}
}

export async function sendMapInvite(params: {
  inviter: GhostRoomProfile;
  invitee: GhostRoomProfile;
  coordsOverride?: { lat: number; lng: number };
}): Promise<MapSessionData> {
  const inviterGh = normalizeGhostNumber(params.inviter.ghost_number);
  const inviteeGh = normalizeGhostNumber(params.invitee.ghost_number);
  if (!inviterGh || !inviteeGh || inviterGh === inviteeGh) {
    throw new Error('Pick a valid friend to invite.');
  }

  // Strictly enforce friends-only: NEVER invite strangers or non-friends
  const confirmedFriend = await areUsersFriends(inviterGh, inviteeGh);
  if (!confirmedFriend) {
    throw new Error('You can only invite accepted friends to your Map.');
  }

  const roomCode = getSortedRoomCode(inviterGh, inviteeGh);
  const rowKey = mapKey(roomCode);
  const rawCoords = params.coordsOverride || (await getCurrentGeoCoords());
  const fuzzyCoords = applyPrivacyOffset(rawCoords);

  await updateMyLocation(inviterGh, rawCoords.lat, rawCoords.lng, {
    display_name: params.inviter.display_name,
    profile_pic: params.inviter.profile_pic,
  });

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const expiresIso = new Date(nowMs + TWENTY_FOUR_HOURS_MS).toISOString();
  const sessionId = `map-${nowMs}`;

  const session: MapSessionData = {
    kind: 'map',
    session_id: sessionId,
    room_code: roomCode,
    inviter: inviterGh,
    invitee: inviteeGh,
    status: 'pending',
    participants: {
      [inviterGh]: {
        ghost_number: inviterGh,
        display_name: params.inviter.display_name,
        profile_pic: params.inviter.profile_pic,
        lat: fuzzyCoords.lat,
        lng: fuzzyCoords.lng,
        updated_at: nowIso,
      },
    },
    created_at: nowIso,
    expires_at: expiresIso,
  };

  await supabase.from('ghosted_room').upsert(
    {
      ghost_number: rowKey,
      display_name: `Map ${roomCode}`,
      room_code: roomCode,
      chat_with_ghost_number: inviteeGh,
      game_type: 'map',
      game_data: session,
      last_active: nowIso,
    },
    { onConflict: 'ghost_number' }
  );

  await syncMapSessionToLocationTable(session);

  await sendChatMessage({
    myGhostNumber: inviterGh,
    peerGhostNumber: inviteeGh,
    text: `Map Request from ${inviterGh} — Tap Accept to share live pins & distance on the Map.`,
    mapSessionId: sessionId,
  });

  return session;
}

export async function respondToMapInvite(params: {
  responder: GhostRoomProfile;
  peerGh: string;
  accept: boolean;
  coordsOverride?: { lat: number; lng: number };
}): Promise<MapSessionData | null> {
  const myGh = normalizeGhostNumber(params.responder.ghost_number);
  const peer = normalizeGhostNumber(params.peerGh);
  const roomCode = getSortedRoomCode(myGh, peer);
  const rowKey = mapKey(roomCode);

  const { data } = await supabase
    .from('ghosted_room')
    .select('*')
    .eq('ghost_number', rowKey)
    .maybeSingle();

  if (!data?.game_data) return null;
  const session = data.game_data as MapSessionData;
  const nowIso = new Date().toISOString();

  if (!params.accept) {
    const declinedParticipants = { ...(session.participants || {}) };
    delete declinedParticipants[myGh];
    const declinedSession: MapSessionData = {
      ...session,
      status: 'declined',
      participants: declinedParticipants,
    };
    await supabase
      .from('ghosted_room')
      .update({
        game_data: declinedSession,
        last_active: nowIso,
      })
      .eq('ghost_number', rowKey);

    await syncMapSessionToLocationTable(declinedSession);

    await sendChatMessage({
      myGhostNumber: myGh,
      peerGhostNumber: peer,
      text: `${myGh} declined the Map request.`,
    });
    return declinedSession;
  }

  const rawCoords = params.coordsOverride || (await getCurrentGeoCoords());
  const fuzzyCoords = applyPrivacyOffset(rawCoords);

  await updateMyLocation(myGh, rawCoords.lat, rawCoords.lng, {
    display_name: params.responder.display_name,
    profile_pic: params.responder.profile_pic,
  });

  const latestLocations = await loadLocationsForGhostNumbers([peer]);
  const peerLiveLoc = latestLocations[peer];
  const existingPeerEntry = session.participants?.[peer];

  const nextParticipants: Record<string, MapParticipant> = {
    ...(session.participants || {}),
    ...(peerLiveLoc && existingPeerEntry
      ? {
          [peer]: {
            ...existingPeerEntry,
            lat: peerLiveLoc.lat,
            lng: peerLiveLoc.lng,
            updated_at: peerLiveLoc.updated_at,
          },
        }
      : {}),
    [myGh]: {
      ghost_number: myGh,
      display_name: params.responder.display_name,
      profile_pic: params.responder.profile_pic,
      lat: fuzzyCoords.lat,
      lng: fuzzyCoords.lng,
      updated_at: nowIso,
    },
  };

  const acceptedSession: MapSessionData = {
    ...session,
    status: 'accepted',
    stopped_by: undefined,
    stopped_at: undefined,
    participants: nextParticipants,
  };

  await supabase
    .from('ghosted_room')
    .update({
      game_data: acceptedSession,
      last_active: nowIso,
    })
    .eq('ghost_number', rowKey);

  await syncMapSessionToLocationTable(acceptedSession);

  await sendChatMessage({
    myGhostNumber: myGh,
    peerGhostNumber: peer,
    text: `${myGh} accepted the Map request! You are both live on the Map.`,
    mapSessionId: acceptedSession.session_id,
  });

  await recordTrackerEvent({
    myGhostNumber: myGh,
    peerGhostNumber: peer,
    kind: 'map',
    roomCode,
    status: 'accepted',
  });

  return acceptedSession;
}

export async function updateMyMapCoordinates(
  me: GhostRoomProfile,
  roomCodes: string[],
  coordsOverride?: { lat: number; lng: number }
): Promise<MapParticipant> {
  const myGh = normalizeGhostNumber(me.ghost_number);
  const rawCoords = coordsOverride || (await getCurrentGeoCoords());
  const fuzzyCoords = applyPrivacyOffset(rawCoords);
  const nowIso = new Date().toISOString();
  const myEntry: MapParticipant = {
    ghost_number: myGh,
    display_name: me.display_name,
    profile_pic: me.profile_pic,
    lat: fuzzyCoords.lat,
    lng: fuzzyCoords.lng,
    updated_at: nowIso,
  };

  await updateSoloLocationSharing({ me, sharing: true, coords: rawCoords });

  for (const rc of roomCodes) {
    const rowKey = mapKey(rc);
    const { data } = await supabase
      .from('ghosted_room')
      .select('game_data')
      .eq('ghost_number', rowKey)
      .maybeSingle();

    if (data?.game_data && data.game_data.status === 'accepted') {
      const nextSession: MapSessionData = {
        ...data.game_data,
        participants: {
          ...(data.game_data.participants || {}),
          [myGh]: myEntry,
        },
      };
      await supabase
        .from('ghosted_room')
        .update({
          game_data: nextSession,
          last_active: nowIso,
        })
        .eq('ghost_number', rowKey);

      await syncMapSessionToLocationTable(nextSession);
    }
  }

  return myEntry;
}

export async function leaveMapSession(myGhRaw: string, roomCode: string): Promise<void> {
  const myGh = normalizeGhostNumber(myGhRaw);
  const rowKey = mapKey(roomCode);
  const { data } = await supabase
    .from('ghosted_room')
    .select('game_data')
    .eq('ghost_number', rowKey)
    .maybeSingle();

  if (!data?.game_data) return;
  const session = data.game_data as MapSessionData;
  const nextParticipants = { ...(session.participants || {}) };
  delete nextParticipants[myGh];
  const nowIso = new Date().toISOString();

  const nextSession: MapSessionData = {
    ...session,
    status: 'stopped',
    stopped_by: myGh,
    stopped_at: nowIso,
    participants: nextParticipants,
  };

  await supabase
    .from('ghosted_room')
    .update({
      game_data: nextSession,
      last_active: nowIso,
    })
    .eq('ghost_number', rowKey);

  await syncMapSessionToLocationTable(nextSession);
}

export async function fetchMapSessionByRoom(roomCode: string): Promise<MapSessionData | null> {
  const { data } = await supabase
    .from('ghosted_room')
    .select('game_data')
    .eq('ghost_number', mapKey(roomCode))
    .maybeSingle();

  if (!data?.game_data) return null;
  const session = data.game_data as MapSessionData;
  if (isExpired24h(session.expires_at, session.created_at)) {
    await supabase.from('ghosted_room').delete().eq('ghost_number', mapKey(roomCode));
    return null;
  }
  return session;
}

async function enrichAcceptedSessionsWithLatestLocations(
  sessions: MapSessionData[]
): Promise<MapSessionData[]> {
  const participantGhs = new Set<string>();
  sessions.forEach((s) => {
    if (s.status !== 'accepted') return;
    if (s.inviter) participantGhs.add(normalizeGhostNumber(s.inviter));
    if (s.invitee) participantGhs.add(normalizeGhostNumber(s.invitee));
  });

  if (participantGhs.size === 0) return sessions;
  const latestMap = await loadLocationsForGhostNumbers(Array.from(participantGhs));

  return sessions.map((s) => {
    if (s.status !== 'accepted') return s;
    const inviter = normalizeGhostNumber(s.inviter);
    const invitee = normalizeGhostNumber(s.invitee);
    const nextParticipants = { ...(s.participants || {}) };

    [inviter, invitee].forEach((gh) => {
      if (!gh) return;
      const existing = nextParticipants[gh];
      const live = latestMap[gh];
      if (!existing && !live) return;

      const existingTime = existing ? new Date(existing.updated_at || 0).getTime() : 0;
      const liveTime = live ? new Date(live.updated_at || 0).getTime() : 0;

      if (live && (!existing || liveTime >= existingTime)) {
        nextParticipants[gh] = {
          ghost_number: gh,
          display_name: existing?.display_name || live.display_name || gh,
          profile_pic: existing?.profile_pic || live.profile_pic || '',
          lat: live.lat,
          lng: live.lng,
          updated_at: live.updated_at,
        };
      }
    });

    return {
      ...s,
      participants: nextParticipants,
    };
  });
}

export async function fetchAllAcceptedMapSessionsForUser(
  myGhRaw: string
): Promise<MapSessionData[]> {
  const myGh = normalizeGhostNumber(myGhRaw);
  if (!myGh) return [];

  const { data } = await supabase
    .from('ghosted_room')
    .select('ghost_number, game_data')
    .like('ghost_number', 'MAP::%')
    .ilike('room_code', `%${myGh}%`)
    .limit(50);

  if (!Array.isArray(data)) return [];
  const rawAccepted: MapSessionData[] = [];
  const expiredKeys: string[] = [];

  data.forEach((row: any) => {
    const s = row?.game_data as MapSessionData | undefined;
    if (!s) return;
    if (isExpired24h(s.expires_at, s.created_at)) {
      expiredKeys.push(row.ghost_number);
      return;
    }
    if (s.status === 'accepted' && (s.inviter === myGh || s.invitee === myGh)) {
      rawAccepted.push(s);
    }
  });

  if (expiredKeys.length > 0) {
    supabase.from('ghosted_room').delete().in('ghost_number', expiredKeys).then(() => {});
  }

  const enriched = await enrichAcceptedSessionsWithLatestLocations(rawAccepted);
  return enriched.filter((s) => {
    const peerGh = s.inviter === myGh ? s.invitee : s.inviter;
    return Boolean(s.participants?.[myGh]) && Boolean(s.participants?.[peerGh]);
  });
}

export async function fetchAllMapSessionsForUser(
  myGhRaw: string
): Promise<MapSessionData[]> {
  const myGh = normalizeGhostNumber(myGhRaw);
  if (!myGh) return [];

  const { data } = await supabase
    .from('ghosted_room')
    .select('ghost_number, game_data')
    .like('ghost_number', 'MAP::%')
    .ilike('room_code', `%${myGh}%`)
    .limit(60);

  if (!Array.isArray(data)) return [];
  const sessions: MapSessionData[] = [];
  const expiredKeys: string[] = [];

  data.forEach((row: any) => {
    const s = row?.game_data as MapSessionData | undefined;
    if (!s) return;
    if (isExpired24h(s.expires_at, s.created_at)) {
      expiredKeys.push(row.ghost_number);
      return;
    }
    if (s.inviter === myGh || s.invitee === myGh) {
      sessions.push(s);
    }
  });

  if (expiredKeys.length > 0) {
    supabase.from('ghosted_room').delete().in('ghost_number', expiredKeys).then(() => {});
  }

  return enrichAcceptedSessionsWithLatestLocations(sessions);
}

export function subscribeToMapSessions(onChange: () => void): () => void {
  const channel = supabase
    .channel(makeUniqueChannelName('map_sessions_live'))
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'ghosted_room',
      },
      (payload) => {
        const gh = String((payload.new as any)?.ghost_number || (payload.old as any)?.ghost_number || '');
        if (gh.startsWith('MAP::') || gh.startsWith('LOC::')) {
          onChange();
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// =========================================================================
// 7. FREE GAMES IN `ghosted_room` (rps, tictactoe, twotruths)
// =========================================================================

function buildInitialGameState(
  gameType: FreeGameType,
  code: string,
  hostGh: string
): FreeGameRoomData {
  const base: FreeGameRoomData = {
    kind: 'game',
    room_code: code,
    game_type: gameType,
    host: hostGh,
    players: [hostGh],
    round: 1,
    created_at: new Date().toISOString(),
  };

  if (gameType === 'rps') {
    base.rps = {
      choices: { [hostGh]: null },
      scores: { [hostGh]: 0 },
      phase: 'choosing',
      winner: null,
    };
  } else if (gameType === 'tictactoe') {
    base.tictactoe = {
      board: Array(9).fill(null),
      turn: 'X',
      playerX: hostGh,
      playerO: null,
      winner: null,
      winLine: null,
    };
  } else {
    base.twotruths = {
      writer: hostGh,
      guesser: null,
      statements: ['', '', ''],
      lieIndex: null,
      guessIndex: null,
      revealed: false,
      scores: { [hostGh]: 0 },
    };
  }

  return base;
}

export async function createFreeGameRoom(
  hostGh: string,
  gameType: FreeGameType
): Promise<{ roomCode: string; link: string; gameData: FreeGameRoomData }> {
  const host = normalizeGhostNumber(hostGh);
  if (!host) throw new Error('Sign in with a GH-XXXX number first.');

  let lastErrorMsg = 'Failed to create game room in Supabase.';

  for (let attempt = 1; attempt <= 3; attempt++) {
    const code = generateGameCode(6);
    const initialState = buildInitialGameState(gameType, code, host);

    const { error } = await supabase.from('ghosted_room').insert({
      ghost_number: gameKey(code),
      display_name: `Game ${code}`,
      room_code: code,
      game_type: gameType,
      game_data: initialState,
      last_active: new Date().toISOString(),
    });

    if (!error) {
      return {
        roomCode: code,
        link: buildGameLink(code),
        gameData: initialState,
      };
    }

    lastErrorMsg = error.message || JSON.stringify(error);
    console.error(`[createFreeGameRoom] Attempt ${attempt}/3 failed:`, error);
  }

  throw new Error(lastErrorMsg);
}

export async function joinFreeGameRoom(
  myGh: string,
  rawCodeOrLink: string
): Promise<FreeGameRoomData> {
  const me = normalizeGhostNumber(myGh);
  if (!me) throw new Error('Sign in with a GH-XXXX number first.');

  const code = extractGameCodeFromInput(rawCodeOrLink);
  if (!code || code.length < 4) {
    throw new Error('Enter a valid game code or link.');
  }

  const rowKey = gameKey(code);
  const { data, error } = await supabase
    .from('ghosted_room')
    .select('*')
    .eq('ghost_number', rowKey)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Could not load game room.');
  }
  if (!data || !data.game_data) {
    throw new Error(`Game room ${code} not found.`);
  }

  const game = data.game_data as FreeGameRoomData;
  const players = Array.isArray(game.players) ? [...game.players] : [];

  if (!players.includes(me)) {
    if (players.length >= 2) {
      throw new Error('Room full - max 2 players');
    }
    players.push(me);
    game.players = players;

    if (game.game_type === 'rps' && game.rps) {
      game.rps.choices[me] = game.rps.choices[me] ?? null;
      game.rps.scores[me] = game.rps.scores[me] ?? 0;
    } else if (game.game_type === 'tictactoe' && game.tictactoe && !game.tictactoe.playerO) {
      game.tictactoe.playerO = me;
    } else if (game.game_type === 'twotruths' && game.twotruths) {
      game.twotruths.guesser = game.twotruths.guesser || me;
      game.twotruths.scores[me] = game.twotruths.scores[me] ?? 0;
    }
  }

  game.leftPlayer = null;
  game.leftAt = null;
  game.updatedAt = Date.now();

  const { error: updateErr } = await supabase
    .from('ghosted_room')
    .update({
      game_data: game,
      last_active: new Date().toISOString(),
    })
    .eq('ghost_number', rowKey);

  if (updateErr) {
    throw new Error(updateErr.message || 'Could not join game room.');
  }

  return game;
}

export async function leaveFreeGameRoom(
  roomCode: string,
  myGh: string
): Promise<'Player 1' | 'Player 2'> {
  const me = normalizeGhostNumber(myGh);
  const current = await fetchFreeGameState(roomCode);
  if (!current) return 'Player 1';

  const isPlayer1 = current.host === me || current.players?.[0] === me;
  const playerLabel: 'Player 1' | 'Player 2' = isPlayer1 ? 'Player 1' : 'Player 2';
  const nextPlayers = isPlayer1
    ? current.players
    : (current.players || []).filter((p) => p !== me);

  const nextData: FreeGameRoomData = {
    ...current,
    players: nextPlayers,
    leftPlayer: playerLabel,
    leftAt: new Date().toISOString(),
    updatedAt: Date.now(),
  };
  await updateFreeGameState(roomCode, nextData).catch(() => {});
  return playerLabel;
}

export async function updateFreeGameState(
  roomCode: string,
  nextData: FreeGameRoomData
): Promise<void> {
  const rowKey = gameKey(roomCode);
  const { error } = await supabase
    .from('ghosted_room')
    .update({
      game_data: nextData,
      last_active: new Date().toISOString(),
    })
    .eq('ghost_number', rowKey);

  if (error) {
    throw new Error(error.message || 'Could not sync game move.');
  }
}

export async function fetchFreeGameState(roomCode: string): Promise<FreeGameRoomData | null> {
  const { data } = await supabase
    .from('ghosted_room')
    .select('game_data')
    .eq('ghost_number', gameKey(roomCode))
    .maybeSingle();

  return (data?.game_data as FreeGameRoomData) || null;
}

export function subscribeToFreeGameRoom(
  roomCode: string,
  onUpdate: (data: FreeGameRoomData) => void
): () => void {
  const rowKey = gameKey(roomCode);
  const channel = supabase
    .channel(makeUniqueChannelName(`free_game_${roomCode}`))
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'ghosted_room',
        filter: `ghost_number=eq.${rowKey}`,
      },
      (payload) => {
        const gd = (payload.new as any)?.game_data;
        if (gd) onUpdate(gd as FreeGameRoomData);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// =========================================================================
// 8. ROOM 2: VIP ROOM (`vip_room` ONLY — EXPIRY, TRIAL, 8-MONTH VIP GAMES)
// =========================================================================

export function computePaidTag(flags: {
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

export function computeVipType(flags: {
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

function isOptionalGameExpiryValid(expiresAt?: string | null): boolean {
  if (!expiresAt) return true; // No expiry unless explicitly set
  const ms = new Date(expiresAt).getTime();
  return !Number.isNaN(ms) && Date.now() < ms;
}

export function isVipSubscriptionActive(vipRecord?: VipRoomRecord | null): boolean {
  if (!vipRecord) return false;
  const isMainClaimed =
    vipRecord.vip_features?.main_vip_active !== false && vipRecord.vip_status === 'active';
  if (!isMainClaimed) return false;
  const expiresAt = vipRecord.vip_features?.vip_expires_at || vipRecord.vip_expires_at;
  if (!expiresAt) return false;
  return Date.now() < new Date(expiresAt).getTime();
}

export function isMainVipActive(
  vipRecord?: VipRoomRecord | null,
  profile?: GhostRoomProfile | null
): boolean {
  if (isVipSubscriptionActive(vipRecord)) return true;
  if (
    profile?.paid_tag?.startsWith('PAID') &&
    profile?.vip_expires_at &&
    Date.now() < new Date(profile.vip_expires_at).getTime()
  ) {
    return true;
  }
  return false;
}

export function isGame1PaidActive(vipRecord?: VipRoomRecord | null): boolean {
  if (!vipRecord) return false;
  const g = vipRecord.vip_games;
  const tag = String(vipRecord.paid_tag || '').trim();
  const claimed =
    Boolean(g?.nhie_paid) ||
    tag === 'GAME 1 ✅' ||
    tag === 'PAID GAME 1 ✅' ||
    tag === 'GAMES ✅' ||
    tag === 'PAID GAMES ✅';
  if (!claimed) return false;
  return isOptionalGameExpiryValid(g?.nhie_expires_at || g?.vip_games_expires_at);
}

export function isGame2PaidActive(vipRecord?: VipRoomRecord | null): boolean {
  if (!vipRecord) return false;
  const g = vipRecord.vip_games;
  const tag = String(vipRecord.paid_tag || '').trim();
  const claimed =
    Boolean(g?.wyr_paid) ||
    tag === 'GAME 2 ✅' ||
    tag === 'PAID GAME 2 ✅' ||
    tag === 'GAMES ✅' ||
    tag === 'PAID GAMES ✅';
  if (!claimed) return false;
  return isOptionalGameExpiryValid(g?.wyr_expires_at || g?.vip_games_expires_at);
}

export function isAnyGameVipActive(vipRecord?: VipRoomRecord | null): boolean {
  return isGame1PaidActive(vipRecord) || isGame2PaidActive(vipRecord);
}

export function isGame1Unlocked(vipRecord?: VipRoomRecord | null): boolean {
  return isGame1PaidActive(vipRecord);
}

export function isGame2Unlocked(vipRecord?: VipRoomRecord | null): boolean {
  return isGame2PaidActive(vipRecord);
}

export function isVipGamesUnlocked(vipRecord?: VipRoomRecord | null): boolean {
  return isGame1Unlocked(vipRecord) && isGame2Unlocked(vipRecord);
}

export function hasActiveVipBadge(
  vipRecord?: VipRoomRecord | null,
  profile?: GhostRoomProfile | null
): boolean {
  if (isMainVipActive(vipRecord, profile)) return true;
  if (isAnyGameVipActive(vipRecord)) return true;
  if (profile?.is_vip) {
    const exp = profile.vip_expires_at || profile.vip_end_date;
    if (!exp || Date.now() < new Date(exp).getTime()) return true;
  }
  return false;
}

export function getEffectivePaidTag(
  vipRecord?: VipRoomRecord | null,
  profile?: GhostRoomProfile | null
): string | null {
  const mainVipActive = isMainVipActive(vipRecord, profile);
  const g1 = isGame1PaidActive(vipRecord);
  const g2 = isGame2PaidActive(vipRecord);
  const computed = computePaidTag({ mainVipActive, game1Active: g1, game2Active: g2 });
  if (computed) return computed;

  const rawTag = vipRecord?.paid_tag || profile?.paid_tag || null;
  if (!rawTag) return null;
  if (!mainVipActive && rawTag.startsWith('PAID')) {
    const stripped = rawTag.replace(/^PAID\s*/i, '').trim();
    return stripped || null;
  }
  return rawTag;
}

export function formatExpiryDateLabel(isoDate?: string | null): string {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function fetchVipRoom(ghostNumber: string): Promise<VipRoomRecord | null> {
  const gh = normalizeGhostNumber(ghostNumber);
  if (!gh) return null;

  // Enforce expiry across `profiles`, `vip_table`, `vip_room`, and `ghosted_room` via backend sync first
  const statusMap = await fetchVipStatusMap([gh]);
  const resolved = statusMap[gh];

  // Also fetch direct `profiles` table row if present
  let profileTableRow: any = null;
  try {
    const { data: pData, error: pErr } = await supabase
      .from('profiles')
      .select('gh_number, vip_type, vip_expires_at, paid_tag')
      .eq('gh_number', gh)
      .maybeSingle();
    if (!pErr && pData) profileTableRow = pData;
  } catch {}

  const { data, error } = await supabase
    .from('vip_room')
    .select('*')
    .eq('ghost_number', gh)
    .maybeSingle();

  if (error || !data) {
    const hasAny =
      resolved?.main_vip_active ||
      resolved?.game1_active ||
      resolved?.game2_active ||
      Boolean(profileTableRow?.paid_tag);
    if (hasAny) {
      const mainActive = Boolean(resolved?.main_vip_active);
      const g1 = Boolean(resolved?.game1_active);
      const g2 = Boolean(resolved?.game2_active);
      const paidTag =
        resolved?.paid_tag ||
        computePaidTag({ mainVipActive: mainActive, game1Active: g1, game2Active: g2 });
      const vipType =
        resolved?.vip_type ||
        computeVipType({ mainVipActive: mainActive, game1Active: g1, game2Active: g2 });
      const synthetic: VipRoomRecord = {
        ghost_number: gh,
        vip_status: mainActive ? 'active' : 'inactive',
        vip_type: vipType,
        vip_expires_at: resolved?.vip_expires_at || profileTableRow?.vip_expires_at || null,
        paid_tag: paidTag,
        vip_games: {
          nhie: g1,
          wyr: g2,
          nhie_paid: g1,
          wyr_paid: g2,
        },
        vip_features: {
          goldBadge: Boolean(mainActive || g1 || g2),
          secretGhostMode: false,
          vipThemeGlow: false,
          main_vip_active: mainActive,
          vip_plan: (resolved?.plan as VipPlanType) || 'monthly',
          vip_expires_at: mainActive ? resolved?.vip_end_date || resolved?.vip_expires_at || null : null,
        },
      };
      try {
        localStorage.setItem(STORAGE_VIP_CACHE, JSON.stringify(synthetic));
      } catch {}
      return synthetic;
    }
    return null;
  }

  const rawGames = data.vip_games || { nhie: false, wyr: false, vip_games_expires_at: null };
  const rawFeatures = data.vip_features || {
    goldBadge: false,
    secretGhostMode: false,
    vipThemeGlow: false,
    vip_expires_at: null,
  };

  const mainEnd = rawFeatures.vip_expires_at || profileTableRow?.vip_expires_at || null;
  const subExpired =
    (data.vip_status === 'active' || Boolean(rawFeatures.main_vip_active)) &&
    (!mainEnd || Date.now() >= new Date(mainEnd).getTime());

  const gamesExpired =
    Boolean(rawGames.vip_games_expires_at) &&
    Date.now() >= new Date(rawGames.vip_games_expires_at).getTime();

  const game1Active =
    (Boolean(rawGames.nhie_paid) || Boolean(resolved?.game1_active)) && !gamesExpired;
  const game2Active =
    (Boolean(rawGames.wyr_paid) || Boolean(resolved?.game2_active)) && !gamesExpired;
  const mainActive =
    (data.vip_status === 'active' || Boolean(rawFeatures.main_vip_active)) && !subExpired;

  const computedTag = computePaidTag({
    mainVipActive: mainActive,
    game1Active,
    game2Active,
  });
  const computedType = computeVipType({
    mainVipActive: mainActive,
    game1Active,
    game2Active,
  });

  const record: VipRoomRecord = {
    id: data.id,
    ghost_number: data.ghost_number,
    vip_status: mainActive ? 'active' : 'inactive',
    vip_type: computedType,
    vip_expires_at: mainActive ? mainEnd : null,
    paid_tag: computedTag,
    vip_games: {
      ...rawGames,
      nhie: game1Active,
      wyr: game2Active,
      nhie_paid: game1Active,
      wyr_paid: game2Active,
      vip_games_expires_at: gamesExpired ? null : rawGames.vip_games_expires_at || null,
    },
    vip_features: {
      ...rawFeatures,
      main_vip_active: mainActive,
      goldBadge: mainActive || game1Active || game2Active,
      vipThemeGlow: false,
    },
  };

  if (subExpired || gamesExpired) {
    await supabase
      .from('vip_room')
      .update({
        vip_status: record.vip_status,
        vip_features: record.vip_features,
        vip_games: record.vip_games,
      })
      .eq('ghost_number', gh);

    try {
      await supabase
        .from('profiles')
        .upsert(
          {
            gh_number: gh,
            vip_type: computedType,
            vip_expires_at: mainActive ? mainEnd : null,
            paid_tag: computedTag,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'gh_number' }
        );
    } catch {}
  }

  try {
    localStorage.setItem(STORAGE_VIP_CACHE, JSON.stringify(record));
  } catch {}
  return record;
}

export async function purchaseVipSubscription(params: {
  ghostNumber: string;
  email?: string;
  reference: string;
  currency?: CurrencyCode;
  plan: Exclude<VipPlanType, 'trial_1h'>;
  amount: number;
  displayPrice: string;
}): Promise<VipRoomRecord> {
  const gh = normalizeGhostNumber(params.ghostNumber);
  if (!gh) throw new Error('Invalid GH-XXXX number.');

  const res = await fetch(apiUrl('/api/verify-paystack'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reference: params.reference,
      ghostNumber: gh,
      email: params.email || getCachedGhostProfile()?.email || '',
      currency: 'NGN',
      plan: params.plan,
      purchaseType: 'vip_subscription',
      amount: params.amount,
      displayPrice: params.displayPrice,
    }),
  });

  const payload = await res.json();
  if (!res.ok || !payload.success) {
    throw new Error(payload?.error || 'Could not verify VIP subscription payment.');
  }

  const record: VipRoomRecord = {
    ghost_number: gh,
    vip_status: 'active',
    vip_type: payload.vip_type || 'MAIN',
    vip_expires_at: payload.vip_expires_at || null,
    paid_tag: payload.paid_tag || 'PAID',
    vip_games: payload.vip_games,
    vip_features: payload.vip_features,
  };

  try {
    localStorage.setItem(STORAGE_VIP_CACHE, JSON.stringify(record));
  } catch {}
  return record;
}

export async function purchaseVipGameSingle(params: {
  ghostNumber: string;
  email?: string;
  gameSlot: 1 | 2 | 'both';
  reference: string;
  currency?: CurrencyCode;
  amount: number;
  displayPrice: string;
}): Promise<VipRoomRecord> {
  const gh = normalizeGhostNumber(params.ghostNumber);
  if (!gh) throw new Error('Invalid GH-XXXX number.');

  const purchaseType =
    params.gameSlot === 1 ? 'vip_game_1' : params.gameSlot === 2 ? 'vip_game_2' : 'vip_games';

  const res = await fetch(apiUrl('/api/verify-paystack'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reference: params.reference,
      ghostNumber: gh,
      email: params.email || getCachedGhostProfile()?.email || '',
      currency: 'NGN',
      purchaseType,
      amount: params.amount,
      displayPrice: params.displayPrice,
    }),
  });

  const payload = await res.json();
  if (!res.ok || !payload.success) {
    throw new Error(payload?.error || 'Could not verify Game VIP payment.');
  }

  const record: VipRoomRecord = {
    ghost_number: gh,
    vip_status: payload.vip_status || 'inactive',
    vip_type: payload.vip_type || 'GAME',
    vip_expires_at: payload.vip_expires_at || null,
    paid_tag: payload.paid_tag || null,
    vip_games: payload.vip_games,
    vip_features: payload.vip_features,
  };

  try {
    localStorage.setItem(STORAGE_VIP_CACHE, JSON.stringify(record));
  } catch {}
  return record;
}

export async function purchaseVipGamesEightMonths(params: {
  ghostNumber: string;
  reference: string;
  currency?: CurrencyCode;
  amount: number;
  displayPrice: string;
}): Promise<VipRoomRecord> {
  return purchaseVipGameSingle({
    ...params,
    gameSlot: 'both',
  });
}

export async function grantOneHourVipTrial(
  ghostNumber: string,
  email?: string
): Promise<VipRoomRecord> {
  const gh = normalizeGhostNumber(ghostNumber);
  if (!gh) throw new Error('Invalid GH-XXXX number.');

  const resolvedEmail = email || getCachedGhostProfile()?.email || '';
  try {
    const res = await fetch(apiUrl('/api/vip/activate-trial'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ghostNumber: gh, email: resolvedEmail }),
    });
    if (res.ok) {
      const payload = await res.json();
      if (payload?.success && payload?.record) {
        try {
          localStorage.setItem(STORAGE_VIP_CACHE, JSON.stringify(payload.record));
        } catch {}
        return payload.record as VipRoomRecord;
      }
    }
  } catch {}

  const existing = await fetchVipRoom(gh);
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const record: VipRoomRecord = {
    ghost_number: gh,
    vip_status: 'active',
    vip_games: {
      ...(existing?.vip_games || {}),
      nhie: true,
      wyr: true,
    },
    vip_features: {
      ...(existing?.vip_features || {
        goldBadge: true,
        secretGhostMode: false,
        vipThemeGlow: false,
      }),
      goldBadge: true,
      vipThemeGlow: false,
      vip_plan: 'trial_1h',
      vip_expires_at: expiresIso,
      paidAt: nowIso,
    },
  };

  const { error } = await supabase.from('vip_room').upsert(record, { onConflict: 'ghost_number' });
  if (error) {
    throw new Error(error.message || 'Could not activate 1 Hour VIP trial.');
  }
  return record;
}

export async function updateVipFeatures(
  ghostNumber: string,
  features: VipFeaturesConfig
): Promise<VipRoomRecord> {
  const gh = normalizeGhostNumber(ghostNumber);
  if (!gh) throw new Error('Invalid GH-XXXX number.');

  const { data, error } = await supabase
    .from('vip_room')
    .update({ vip_features: features })
    .eq('ghost_number', gh)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'Could not update VIP features.');
  }
  return data as VipRoomRecord;
}

// VIP Games sessions stored strictly in `vip_room`
export async function createOrJoinVipGameSession(params: {
  ghostNumber: string;
  gameType: VipGameType;
  roomCode?: string;
}): Promise<VipGameSessionData> {
  const gh = normalizeGhostNumber(params.ghostNumber);
  if (!gh) throw new Error('Invalid GH-XXXX number.');

  if (params.roomCode) {
    const code = extractGameCodeFromInput(params.roomCode);
    const { data, error } = await supabase
      .from('vip_room')
      .select('*')
      .eq('ghost_number', vipGameKey(code))
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data?.vip_games) throw new Error(`VIP game ${code} not found.`);

    const session = data.vip_games as VipGameSessionData;
    if (!session.players.includes(gh)) {
      if (session.players.length >= 2) {
        throw new Error('Room full - max 2 players');
      }
      session.players = [...session.players, gh];
    }
    session.leftPlayer = null;
    session.leftAt = null;
    session.updatedAt = Date.now();
    await supabase
      .from('vip_room')
      .update({ vip_games: session })
      .eq('ghost_number', vipGameKey(code));
    return session;
  }

  const code = generateGameCode(6);
  const session: VipGameSessionData = {
    kind: 'vip_game',
    room_code: code,
    game_type: params.gameType,
    host: gh,
    players: [gh],
    prompt_index: 0,
    votes: {},
    created_at: new Date().toISOString(),
    updatedAt: Date.now(),
    leftPlayer: null,
    leftAt: null,
  };

  const { error } = await supabase.from('vip_room').insert({
    ghost_number: vipGameKey(code),
    vip_status: 'active',
    vip_games: session,
    vip_features: { room_code: code },
  });

  if (error) {
    throw new Error(error.message || 'Could not create VIP game session.');
  }
  return session;
}

export async function leaveVipGameSession(
  roomCode: string,
  myGh: string
): Promise<'Player 1' | 'Player 2'> {
  const me = normalizeGhostNumber(myGh);
  const current = await fetchVipGameSession(roomCode);
  if (!current) return 'Player 1';

  const isPlayer1 = current.host === me || current.players?.[0] === me;
  const playerLabel: 'Player 1' | 'Player 2' = isPlayer1 ? 'Player 1' : 'Player 2';
  const nextPlayers = isPlayer1
    ? current.players
    : (current.players || []).filter((p) => p !== me);

  const nextSession: VipGameSessionData = {
    ...current,
    players: nextPlayers,
    leftPlayer: playerLabel,
    leftAt: new Date().toISOString(),
    updatedAt: Date.now(),
  };
  await updateVipGameSession(nextSession).catch(() => {});
  return playerLabel;
}

export async function updateVipGameSession(session: VipGameSessionData): Promise<void> {
  const { error } = await supabase
    .from('vip_room')
    .update({ vip_games: session })
    .eq('ghost_number', vipGameKey(session.room_code));
  if (error) throw new Error(error.message || 'Could not sync VIP game.');
}

export async function fetchVipGameSession(roomCode: string): Promise<VipGameSessionData | null> {
  const { data } = await supabase
    .from('vip_room')
    .select('vip_games')
    .eq('ghost_number', vipGameKey(roomCode))
    .maybeSingle();
  return (data?.vip_games as VipGameSessionData) || null;
}

export function subscribeToVipGameSession(
  roomCode: string,
  onUpdate: (session: VipGameSessionData) => void
): () => void {
  const rowKey = vipGameKey(roomCode);
  const channel = supabase
    .channel(makeUniqueChannelName(`vip_game_${roomCode}`))
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'vip_room',
        filter: `ghost_number=eq.${rowKey}`,
      },
      (payload) => {
        const vg = (payload.new as any)?.vip_games;
        if (vg) onUpdate(vg as VipGameSessionData);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// =========================================================================
// 10. FRIEND REQUEST FLOW (SAVED STRICTLY INSIDE `ghosted_room`)
// =========================================================================

function parseFriendReqFromRow(row: any): FriendRequestRecord | null {
  if (!row) return null;
  const gd = row.game_data;
  if (gd && gd.kind === 'friend_request' && gd.sender && gd.receiver) {
    const status: FriendRequestStatus =
      gd.status === 'accepted' || gd.status === 'declined' ? gd.status : 'pending';
    return {
      id: String(gd.id || row.ghost_number),
      sender: normalizeGhostNumber(gd.sender),
      receiver: normalizeGhostNumber(gd.receiver),
      status,
      sender_name: gd.sender_name,
      sender_pic: gd.sender_pic,
      receiver_name: gd.receiver_name,
      receiver_pic: gd.receiver_pic,
      created_at: gd.created_at || row.last_active || new Date().toISOString(),
      updated_at: gd.updated_at || row.last_active || new Date().toISOString(),
    };
  }
  return null;
}

async function syncFriendRequestIntoUserRows(record: FriendRequestRecord): Promise<void> {
  const roomCode = getSortedRoomCode(record.sender, record.receiver);
  const pair: [string, string][] = [
    [record.sender, record.receiver],
    [record.receiver, record.sender],
  ];

  for (const [owner, peer] of pair) {
    try {
      const { data: row } = await supabase
        .from('ghosted_room')
        .select('*')
        .eq('ghost_number', owner)
        .maybeSingle();
      if (!row) continue;

      const gd = row.game_data && typeof row.game_data === 'object' ? row.game_data : {};
      const existingReqs: Record<string, FriendRequestRecord> =
        gd.friend_requests && typeof gd.friend_requests === 'object' ? gd.friend_requests : {};
      const nextReqs = {
        ...existingReqs,
        [roomCode]: record,
      };

      const existingFriends: string[] = Array.isArray(gd.friends)
        ? gd.friends.map((f: any) => normalizeGhostNumber(f)).filter(Boolean)
        : [];
      const nextFriends =
        record.status === 'accepted'
          ? Array.from(new Set([...existingFriends, peer]))
          : existingFriends;

      await supabase
        .from('ghosted_room')
        .update({
          last_active: new Date().toISOString(),
          game_data: {
            ...gd,
            kind: 'profile',
            friend_requests: nextReqs,
            friends: nextFriends,
          },
        })
        .eq('ghost_number', owner);
    } catch {}
  }
}

export async function getFriendRequestBetween(
  myGhRaw: string,
  peerGhRaw: string
): Promise<FriendRequestRecord | null> {
  const myGh = normalizeGhostNumber(myGhRaw);
  const peerGh = normalizeGhostNumber(peerGhRaw);
  if (!myGh || !peerGh || myGh === peerGh) return null;

  const roomCode = getSortedRoomCode(myGh, peerGh);

  // 1. Check `ghosted_room` FRIENDREQ:: room row
  try {
    const { data: grRow } = await supabase
      .from('ghosted_room')
      .select('*')
      .eq('ghost_number', friendReqKey(roomCode))
      .maybeSingle();
    const parsed = parseFriendReqFromRow(grRow);
    if (parsed) return parsed;
  } catch {}

  // 2. Check inside user's `ghosted_room` profile game_data
  try {
    const { data: myRow } = await supabase
      .from('ghosted_room')
      .select('game_data')
      .eq('ghost_number', myGh)
      .maybeSingle();
    const gd = myRow?.game_data || {};
    const embedded = gd.friend_requests?.[roomCode];
    if (embedded && embedded.sender && embedded.receiver) {
      return embedded as FriendRequestRecord;
    }
    if (Array.isArray(gd.friends) && gd.friends.includes(peerGh)) {
      return {
        id: `accepted-${roomCode}`,
        sender: myGh,
        receiver: peerGh,
        status: 'accepted',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
  } catch {}

  return null;
}

export async function isEitherUserBlocked(myGhRaw: string, peerGhRaw: string): Promise<boolean> {
  const myGh = normalizeGhostNumber(myGhRaw);
  const peerGh = normalizeGhostNumber(peerGhRaw);
  if (!myGh || !peerGh || myGh === peerGh) return false;
  const [me, peer] = await Promise.all([fetchGhostProfile(myGh), fetchGhostProfile(peerGh)]);
  const myBlocked = me?.blocked_users || [];
  const peerBlocked = peer?.blocked_users || [];
  return myBlocked.includes(peerGh) || peerBlocked.includes(myGh);
}

export async function blockContactUser(myGhRaw: string, peerGhRaw: string): Promise<void> {
  const myGh = normalizeGhostNumber(myGhRaw);
  const peerGh = normalizeGhostNumber(peerGhRaw);
  if (!myGh || !peerGh || myGh === peerGh) throw new Error('Invalid GH-XXXX number.');

  const roomCode = getSortedRoomCode(myGh, peerGh);
  const nowIso = new Date().toISOString();

  // 1. Add peerGh to my blocked_users and remove peerGh from friends + friend_requests
  const { data: myRow } = await supabase
    .from('ghosted_room')
    .select('*')
    .eq('ghost_number', myGh)
    .maybeSingle();

  if (myRow) {
    const gd = myRow.game_data && typeof myRow.game_data === 'object' ? myRow.game_data : {};
    const prevBlocked: string[] = Array.isArray(gd.blocked_users)
      ? gd.blocked_users.map((b: any) => normalizeGhostNumber(b)).filter(Boolean)
      : [];
    const nextBlocked = Array.from(new Set([...prevBlocked, peerGh]));
    const nextFriends = (Array.isArray(gd.friends) ? gd.friends : []).filter(
      (f: any) => normalizeGhostNumber(f) !== peerGh
    );
    const nextReqs = { ...(gd.friend_requests || {}) };
    delete nextReqs[roomCode];

    await supabase
      .from('ghosted_room')
      .update({
        last_active: nowIso,
        game_data: {
          ...gd,
          kind: 'profile',
          blocked_users: nextBlocked,
          friends: nextFriends,
          friend_requests: nextReqs,
        },
      })
      .eq('ghost_number', myGh);
  }

  // 2. Remove myGh from peer's friends + friend_requests
  const { data: peerRow } = await supabase
    .from('ghosted_room')
    .select('*')
    .eq('ghost_number', peerGh)
    .maybeSingle();

  if (peerRow) {
    const gd = peerRow.game_data && typeof peerRow.game_data === 'object' ? peerRow.game_data : {};
    const nextFriends = (Array.isArray(gd.friends) ? gd.friends : []).filter(
      (f: any) => normalizeGhostNumber(f) !== myGh
    );
    const nextReqs = { ...(gd.friend_requests || {}) };
    delete nextReqs[roomCode];

    await supabase
      .from('ghosted_room')
      .update({
        game_data: {
          ...gd,
          kind: 'profile',
          friends: nextFriends,
          friend_requests: nextReqs,
        },
      })
      .eq('ghost_number', peerGh);
  }

  invalidateGhostProfileCache(myGh);
  invalidateGhostProfileCache(peerGh);
  invalidateRoomAccessCache(myGh, peerGh);
  // 3. Delete FRIENDREQ::, CHAT::, and MAP:: rows (+ chats/messages tables) for this blocked pair
  try {
    removeLocalPersonalChat(roomCode);
  } catch {}
  try {
    await supabase
      .from('ghosted_room')
      .delete()
      .in('ghost_number', [friendReqKey(roomCode), chatKey(roomCode), mapKey(roomCode)]);
  } catch {}
  try {
    await supabase.from('messages').delete().eq('room_code', roomCode);
  } catch {}
  try {
    await supabase.from('chats').delete().eq('room_code', roomCode);
  } catch {}
}

export async function unblockContactUser(myGhRaw: string, peerGhRaw: string): Promise<void> {
  const myGh = normalizeGhostNumber(myGhRaw);
  const peerGh = normalizeGhostNumber(peerGhRaw);
  if (!myGh || !peerGh) return;

  const { data: myRow } = await supabase
    .from('ghosted_room')
    .select('*')
    .eq('ghost_number', myGh)
    .maybeSingle();

  if (!myRow) return;
  const gd = myRow.game_data && typeof myRow.game_data === 'object' ? myRow.game_data : {};
  const nextBlocked = (Array.isArray(gd.blocked_users) ? gd.blocked_users : []).filter(
    (b: any) => normalizeGhostNumber(b) !== peerGh
  );

  await supabase
    .from('ghosted_room')
    .update({
      last_active: new Date().toISOString(),
      game_data: {
        ...gd,
        kind: 'profile',
        blocked_users: nextBlocked,
      },
    })
    .eq('ghost_number', myGh);
}

export async function deleteContactUser(myGhRaw: string, peerGhRaw: string): Promise<void> {
  const myGh = normalizeGhostNumber(myGhRaw);
  const peerGh = normalizeGhostNumber(peerGhRaw);
  if (!myGh || !peerGh || myGh === peerGh) throw new Error('Invalid GH-XXXX number.');

  const roomCode = getSortedRoomCode(myGh, peerGh);
  const pair: [string, string][] = [
    [myGh, peerGh],
    [peerGh, myGh],
  ];

  for (const [owner, other] of pair) {
    try {
      const { data: row } = await supabase
        .from('ghosted_room')
        .select('*')
        .eq('ghost_number', owner)
        .maybeSingle();
      if (!row) continue;

      const gd = row.game_data && typeof row.game_data === 'object' ? row.game_data : {};
      const nextFriends = (Array.isArray(gd.friends) ? gd.friends : []).filter(
        (f: any) => normalizeGhostNumber(f) !== other
      );
      const nextReqs = { ...(gd.friend_requests || {}) };
      delete nextReqs[roomCode];

      await supabase
        .from('ghosted_room')
        .update({
          game_data: {
            ...gd,
            kind: 'profile',
            friends: nextFriends,
            friend_requests: nextReqs,
          },
        })
        .eq('ghost_number', owner);
    } catch {}
  }

  try {
    removeLocalPersonalChat(roomCode);
  } catch {}
  invalidateGhostProfileCache(myGh);
  invalidateGhostProfileCache(peerGh);
  invalidateRoomAccessCache(myGh, peerGh);
  try {
    await supabase
      .from('ghosted_room')
      .delete()
      .in('ghost_number', [friendReqKey(roomCode), chatKey(roomCode), mapKey(roomCode)]);
  } catch {}
  try {
    await supabase.from('messages').delete().eq('room_code', roomCode);
  } catch {}
  try {
    await supabase.from('chats').delete().eq('room_code', roomCode);
  } catch {}
}

export async function areUsersFriends(myGhRaw: string, peerGhRaw: string): Promise<boolean> {
  if (await isEitherUserBlocked(myGhRaw, peerGhRaw)) return false;
  const req = await getFriendRequestBetween(myGhRaw, peerGhRaw);
  if (req?.status === 'accepted') return true;
  if (req?.status === 'declined') return false;

  // Fallback: if an existing persistent chat room already exists between both users, allow opening it
  const myGh = normalizeGhostNumber(myGhRaw);
  const peerGh = normalizeGhostNumber(peerGhRaw);
  if (myGh && peerGh) {
    const roomCode = getSortedRoomCode(myGh, peerGh);
    try {
      const { data: chatRow } = await supabase
        .from('ghosted_room')
        .select('ghost_number')
        .eq('ghost_number', chatKey(roomCode))
        .maybeSingle();
      if (chatRow) return true;
    } catch {}
  }

  return false;
}

export async function sendFriendRequest(
  senderProfile: GhostRoomProfile,
  receiverProfile: GhostRoomProfile
): Promise<FriendRequestRecord> {
  const senderGh = normalizeGhostNumber(senderProfile.ghost_number);
  const receiverGh = normalizeGhostNumber(receiverProfile.ghost_number);
  if (!senderGh || !receiverGh) throw new Error('Invalid GH-XXXX number.');
  if (senderGh === receiverGh) throw new Error('You cannot send a friend request to yourself.');

  if (await isEitherUserBlocked(senderGh, receiverGh)) {
    throw new Error('Cannot send friend request to a blocked user.');
  }

  const existing = await getFriendRequestBetween(senderGh, receiverGh);
  if (existing?.status === 'accepted') return existing;
  if (existing?.status === 'pending' && existing.sender === senderGh) return existing;

  const nowIso = new Date().toISOString();
  const roomCode = getSortedRoomCode(senderGh, receiverGh);

  const record: FriendRequestRecord = {
    id: friendReqKey(roomCode),
    sender: senderGh,
    receiver: receiverGh,
    status: 'pending',
    sender_name: senderProfile.display_name,
    sender_pic: senderProfile.profile_pic,
    receiver_name: receiverProfile.display_name,
    receiver_pic: receiverProfile.profile_pic,
    created_at: nowIso,
    updated_at: nowIso,
  };

  // Save directly in `ghosted_room` FRIENDREQ:: row + both users' `ghosted_room` profile rows
  const { error } = await supabase.from('ghosted_room').upsert(
    {
      ghost_number: friendReqKey(roomCode),
      display_name: roomCode,
      room_code: roomCode,
      call_status: 'idle',
      game_data: {
        kind: 'friend_request',
        ...record,
      },
      last_active: nowIso,
    },
    { onConflict: 'ghost_number' }
  );

  if (error) {
    throw new Error(error.message || 'Could not save friend request in ghosted_room.');
  }

  await syncFriendRequestIntoUserRows(record);
  return record;
}

export async function respondToFriendRequest(params: {
  responder: GhostRoomProfile;
  senderGh: string;
  accept: boolean;
}): Promise<FriendRequestRecord> {
  const responderGh = normalizeGhostNumber(params.responder.ghost_number);
  const senderGh = normalizeGhostNumber(params.senderGh);
  if (!responderGh || !senderGh) throw new Error('Invalid GH-XXXX number.');

  const status: FriendRequestStatus = params.accept ? 'accepted' : 'declined';
  const nowIso = new Date().toISOString();
  const roomCode = getSortedRoomCode(senderGh, responderGh);

  const existing = await getFriendRequestBetween(senderGh, responderGh);
  const senderProf = await fetchGhostProfile(senderGh);

  const updatedRecord: FriendRequestRecord = {
    id: existing?.id || friendReqKey(roomCode),
    sender: senderGh,
    receiver: responderGh,
    status,
    sender_name: senderProf?.display_name || existing?.sender_name || senderGh,
    sender_pic: senderProf?.profile_pic || existing?.sender_pic || '',
    receiver_name: params.responder.display_name,
    receiver_pic: params.responder.profile_pic,
    created_at: existing?.created_at || nowIso,
    updated_at: nowIso,
  };

  const { error } = await supabase.from('ghosted_room').upsert(
    {
      ghost_number: friendReqKey(roomCode),
      display_name: roomCode,
      room_code: roomCode,
      call_status: 'idle',
      game_data: {
        kind: 'friend_request',
        ...updatedRecord,
      },
      last_active: nowIso,
    },
    { onConflict: 'ghost_number' }
  );

  if (error) {
    throw new Error(error.message || 'Could not update friend request in ghosted_room.');
  }

  await syncFriendRequestIntoUserRows(updatedRecord);
  invalidateRoomAccessCache(senderGh, responderGh);
  return updatedRecord;
}

export async function fetchFriendRequestsForUser(myGhRaw: string): Promise<{
  incomingPending: FriendRequestRecord[];
  outgoing: FriendRequestRecord[];
  acceptedContacts: GhostRoomProfile[];
}> {
  const myGh = normalizeGhostNumber(myGhRaw);
  if (!myGh) {
    return { incomingPending: [], outgoing: [], acceptedContacts: [] };
  }

  const byRoom = new Map<string, FriendRequestRecord>();

  // 1. Read from user's own `ghosted_room` row (embedded friend_requests)
  let embeddedFriends: string[] = [];
  let myBlockedSet = new Set<string>();
  try {
    const { data: myRow } = await supabase
      .from('ghosted_room')
      .select('game_data')
      .eq('ghost_number', myGh)
      .maybeSingle();
    const gd = myRow?.game_data || {};
    if (Array.isArray(gd.blocked_users)) {
      myBlockedSet = new Set(gd.blocked_users.map((b: any) => normalizeGhostNumber(b)).filter(Boolean));
    }
    if (Array.isArray(gd.friends)) {
      embeddedFriends = gd.friends
        .map((f: any) => normalizeGhostNumber(f))
        .filter((f: string) => Boolean(f) && !myBlockedSet.has(f));
    }
    if (gd.friend_requests && typeof gd.friend_requests === 'object') {
      Object.values(gd.friend_requests).forEach((val: any) => {
        if (val && val.sender && val.receiver) {
          const peer = val.sender === myGh ? val.receiver : val.sender;
          if (myBlockedSet.has(normalizeGhostNumber(peer))) return;
          const rc = getSortedRoomCode(val.sender, val.receiver);
          byRoom.set(rc, val as FriendRequestRecord);
        }
      });
    }
  } catch {}

  // 2. Read all FRIENDREQ::% rows from `ghosted_room`
  try {
    const { data: grRows } = await supabase
      .from('ghosted_room')
      .select('*')
      .like('ghost_number', 'FRIENDREQ::%')
      .limit(200);

    if (Array.isArray(grRows)) {
      grRows.forEach((r: any) => {
        const parsed = parseFriendReqFromRow(r);
        if (!parsed) return;
        if (parsed.sender !== myGh && parsed.receiver !== myGh) return;
        const peer = parsed.sender === myGh ? parsed.receiver : parsed.sender;
        if (myBlockedSet.has(peer)) return;
        const rc = getSortedRoomCode(parsed.sender, parsed.receiver);
        const existing = byRoom.get(rc);
        if (
          !existing ||
          new Date(parsed.updated_at).getTime() >= new Date(existing.updated_at).getTime()
        ) {
          byRoom.set(rc, parsed);
        }
      });
    }
  } catch {}

  const allReqs = Array.from(byRoom.values());
  const peerGhSet = new Set<string>(embeddedFriends);
  allReqs.forEach((r) => {
    const peer = r.sender === myGh ? r.receiver : r.sender;
    if (peer && !myBlockedSet.has(peer)) peerGhSet.add(peer);
  });

  const profileMap: Record<string, GhostRoomProfile> = {};
  const peerList = Array.from(peerGhSet);
  if (peerList.length > 0) {
    const { data: profRows } = await supabase
      .from('ghosted_room')
      .select('*')
      .in('ghost_number', peerList);
    if (Array.isArray(profRows)) {
      profRows.forEach((p: any) => {
        const mapped = mapProfileRow(p);
        profileMap[mapped.ghost_number] = mapped;
      });
    }
  }

  const vipMap = peerList.length > 0 ? await fetchVipStatusMap(peerList) : {};

  const enriched = allReqs.map((r) => ({
    ...r,
    sender_name: profileMap[r.sender]?.display_name || r.sender_name || r.sender,
    sender_pic: profileMap[r.sender]?.profile_pic || r.sender_pic || '',
    sender_is_vip: vipMap[r.sender]
      ? vipMap[r.sender].is_vip
      : Boolean(profileMap[r.sender]?.is_vip),
    receiver_name: profileMap[r.receiver]?.display_name || r.receiver_name || r.receiver,
    receiver_pic: profileMap[r.receiver]?.profile_pic || r.receiver_pic || '',
    receiver_is_vip: vipMap[r.receiver]
      ? vipMap[r.receiver].is_vip
      : Boolean(profileMap[r.receiver]?.is_vip),
  }));

  const incomingPending = enriched.filter(
    (r) => r.receiver === myGh && r.status === 'pending' && !myBlockedSet.has(r.sender)
  );
  const outgoing = enriched.filter(
    (r) => r.sender === myGh && !myBlockedSet.has(r.receiver)
  );

  const acceptedPeerGhs = new Set<string>(embeddedFriends);
  enriched.forEach((r) => {
    if (r.status === 'accepted') {
      const peer = r.sender === myGh ? r.receiver : r.sender;
      if (!myBlockedSet.has(peer)) acceptedPeerGhs.add(peer);
    }
  });

  const acceptedContacts: GhostRoomProfile[] = Array.from(acceptedPeerGhs)
    .map((gh): GhostRoomProfile | null => {
      const p = profileMap[gh];
      if (!p) return null;
      return {
        ...p,
        is_vip: vipMap[gh] ? vipMap[gh].is_vip : Boolean(p.is_vip),
      };
    })
    .filter((p): p is GhostRoomProfile => Boolean(p));

  return { incomingPending, outgoing, acceptedContacts };
}

export function subscribeToFriendRequests(
  myGhRaw: string,
  onUpdate: () => void
): () => void {
  const myGh = normalizeGhostNumber(myGhRaw);
  const ch = supabase
    .channel(makeUniqueChannelName(`friend_reqs_${myGh || 'anon'}`))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'ghosted_room' },
      (payload) => {
        const gnum = String(
          (payload.new as any)?.ghost_number || (payload.old as any)?.ghost_number || ''
        );
        if (gnum.startsWith('FRIENDREQ::') || gnum === myGh) {
          onUpdate();
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(ch);
  };
}

// =========================================================================
// 10. SHARE IDEAS — TEXT POST + LIKE + SAVE IN SUPABASE BY GHOST NUMBER
// =========================================================================

const IDEA_PREFIX = 'IDEA::';
let ideasTableMissing = true;

function isMissingIdeasTableError(error: any): boolean {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return (
    code === 'PGRST205' ||
    code === '42P01' ||
    msg.includes('public.ideas') ||
    msg.includes('relation "ideas" does not exist')
  );
}

function computeIdeaExpiresAt(createdAtIso: string, expiresAtIso?: string | null): string {
  if (expiresAtIso && !Number.isNaN(new Date(expiresAtIso).getTime())) {
    return expiresAtIso;
  }
  const baseMs = new Date(createdAtIso).getTime();
  const validBaseMs = Number.isNaN(baseMs) ? Date.now() : baseMs;
  return new Date(validBaseMs + TWENTY_FOUR_HOURS_MS).toISOString();
}

function mapIdeaTableRow(row: any): IdeaRecord {
  const createdAt = row.created_at || new Date().toISOString();
  return {
    id: String(row.id),
    ghost_number: normalizeGhostNumber(row.ghost_number) || String(row.ghost_number || 'GH-0000'),
    text: String(row.text || ''),
    likes: typeof row.likes === 'number' ? row.likes : Number(row.likes || 0),
    created_at: createdAt,
    expires_at: computeIdeaExpiresAt(createdAt, row.expires_at),
  };
}

function mapIdeaGhostRoomRow(row: any): IdeaRecord {
  const gd = row?.game_data && typeof row.game_data === 'object' ? row.game_data : {};
  const createdAt = gd.created_at || row.last_active || new Date().toISOString();
  const likedBy: string[] = Array.isArray(gd.liked_by)
    ? Array.from(
        new Set(
          gd.liked_by.map((g: any) => normalizeGhostNumber(g)).filter(Boolean)
        )
      )
    : [];
  const rawLikes = typeof gd.likes === 'number' ? gd.likes : Number(gd.likes || 0);
  return {
    id: String(gd.id || row.ghost_number),
    ghost_number:
      normalizeGhostNumber(gd.ghost_number || row.room_code) ||
      String(gd.ghost_number || row.room_code || 'GH-0000'),
    text: String(gd.text || row.display_name || ''),
    likes: Math.max(rawLikes, likedBy.length),
    liked_by: likedBy,
    created_at: createdAt,
    expires_at: computeIdeaExpiresAt(createdAt, gd.expires_at),
  };
}

async function syncIdeaToGhostedNumberRoom(idea: IdeaRecord): Promise<void> {
  const ownerGh = normalizeGhostNumber(idea.ghost_number);
  if (!ownerGh) return;
  try {
    const { data: gnRows } = await supabase
      .from('ghosted_room')
      .select('ghost_number, game_data')
      .like('ghost_number', `${GNROOM_PREFIX}%`)
      .eq('room_code', ownerGh)
      .limit(3);

    const activeRow = Array.isArray(gnRows)
      ? gnRows.find((r: any) => String(r?.game_data?.status || '').toLowerCase() !== 'deleted')
      : null;

    if (!activeRow) return;

    const gd =
      activeRow.game_data && typeof activeRow.game_data === 'object' ? activeRow.game_data : {};
    const prevIdeas: IdeaRecord[] = Array.isArray(gd.ideas) ? gd.ideas : [];
    const freshPrev = prevIdeas.filter(
      (item) => item?.id && item.id !== idea.id && !isExpired24h(item.expires_at, item.created_at)
    );
    const nextIdeas = [idea, ...freshPrev]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 100);

    await supabase
      .from('ghosted_room')
      .update({
        game_data: {
          ...gd,
          kind: 'ghosted_number_room',
          ideas: nextIdeas,
          updated_at: new Date().toISOString(),
        },
        last_active: new Date().toISOString(),
      })
      .eq('ghost_number', activeRow.ghost_number);
  } catch {}
}

async function syncLikerIdeaToGhostedNumberRoom(likerGhRaw: string, ideaId: string): Promise<void> {
  const likerGh = normalizeGhostNumber(likerGhRaw);
  if (!likerGh || !ideaId) return;
  try {
    const { data: gnRows } = await supabase
      .from('ghosted_room')
      .select('ghost_number, game_data')
      .like('ghost_number', `${GNROOM_PREFIX}%`)
      .eq('room_code', likerGh)
      .limit(3);

    const activeRow = Array.isArray(gnRows)
      ? gnRows.find((r: any) => String(r?.game_data?.status || '').toLowerCase() !== 'deleted')
      : null;

    if (!activeRow) return;

    const gd =
      activeRow.game_data && typeof activeRow.game_data === 'object' ? activeRow.game_data : {};
    const prevIds: string[] = Array.isArray(gd.liked_idea_ids) ? gd.liked_idea_ids : [];
    if (prevIds.includes(ideaId)) return;

    const nextIds = [...prevIds, ideaId].slice(-200);
    await supabase
      .from('ghosted_room')
      .update({
        game_data: {
          ...gd,
          kind: 'ghosted_number_room',
          liked_idea_ids: nextIds,
          updated_at: new Date().toISOString(),
        },
      })
      .eq('ghost_number', activeRow.ghost_number);
  } catch {}
}

async function pruneExpiredIdeasFromGhostedNumberRoom(expiredIdeas: IdeaRecord[]): Promise<void> {
  if (!expiredIdeas.length) return;
  const expiredByOwner = new Map<string, Set<string>>();
  expiredIdeas.forEach((idea) => {
    const ownerGh = normalizeGhostNumber(idea.ghost_number);
    if (!ownerGh) return;
    if (!expiredByOwner.has(ownerGh)) expiredByOwner.set(ownerGh, new Set());
    expiredByOwner.get(ownerGh)!.add(idea.id);
  });

  for (const [ownerGh, expiredIdSet] of expiredByOwner.entries()) {
    try {
      const { data: gnRows } = await supabase
        .from('ghosted_room')
        .select('ghost_number, game_data')
        .like('ghost_number', `${GNROOM_PREFIX}%`)
        .eq('room_code', ownerGh)
        .limit(3);

      const activeRow = Array.isArray(gnRows)
        ? gnRows.find((r: any) => String(r?.game_data?.status || '').toLowerCase() !== 'deleted')
        : null;
      if (!activeRow) continue;

      const gd =
        activeRow.game_data && typeof activeRow.game_data === 'object' ? activeRow.game_data : {};
      const prevIdeas: IdeaRecord[] = Array.isArray(gd.ideas) ? gd.ideas : [];
      const keptIdeas = prevIdeas.filter(
        (item) =>
          item?.id &&
          !expiredIdSet.has(item.id) &&
          !isExpired24h(item.expires_at, item.created_at)
      );
      if (keptIdeas.length !== prevIdeas.length) {
        await supabase
          .from('ghosted_room')
          .update({
            game_data: {
              ...gd,
              kind: 'ghosted_number_room',
              ideas: keptIdeas,
              updated_at: new Date().toISOString(),
            },
          })
          .eq('ghost_number', activeRow.ghost_number);
      }
    } catch {}
  }
}

export async function loadIdeas(): Promise<IdeaRecord[]> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const legacyCutoffIso = new Date(nowMs - TWENTY_FOUR_HOURS_MS).toISOString();

  if (!ideasTableMissing) {
    try {
      // Delete expired ideas automatically from `ideas` table
      const { error: delErr } = await supabase.from('ideas').delete().lt('expires_at', nowIso);
      if (delErr && isMissingIdeasTableError(delErr)) {
        ideasTableMissing = true;
      } else if (!delErr) {
        await supabase
          .from('ideas')
          .delete()
          .is('expires_at', null)
          .lt('created_at', legacyCutoffIso);
      }

      if (!ideasTableMissing) {
        // Load only fresh (non-expired) ideas
        const { data, error } = await supabase
          .from('ideas')
          .select('*')
          .gt('expires_at', nowIso)
          .order('created_at', { ascending: false })
          .limit(200);

        if (!error && Array.isArray(data)) {
          return data
            .map(mapIdeaTableRow)
            .filter((item) => !isExpired24h(item.expires_at, item.created_at));
        }

        if (error && isMissingIdeasTableError(error)) {
          ideasTableMissing = true;
        } else if (error) {
          throw error;
        }
      }
    } catch (err: any) {
      if (isMissingIdeasTableError(err)) {
        ideasTableMissing = true;
      } else {
        console.error('loadIdeas table error:', err);
      }
    }
  }

  const { data: grRows, error: grErr } = await supabase
    .from('ghosted_room')
    .select('*')
    .like('ghost_number', `${IDEA_PREFIX}%`)
    .order('last_active', { ascending: false })
    .limit(200);

  if (grErr || !Array.isArray(grRows)) return [];

  const freshIdeas: IdeaRecord[] = [];
  const expiredKeys: string[] = [];
  const expiredIdeas: IdeaRecord[] = [];

  grRows.forEach((row: any) => {
    const mapped = mapIdeaGhostRoomRow(row);
    if (isExpired24h(mapped.expires_at, mapped.created_at)) {
      expiredKeys.push(String(row.ghost_number));
      expiredIdeas.push(mapped);
    } else {
      freshIdeas.push(mapped);
    }
  });

  if (expiredKeys.length > 0) {
    try {
      await supabase.from('ghosted_room').delete().in('ghost_number', expiredKeys);
    } catch {}
    pruneExpiredIdeasFromGhostedNumberRoom(expiredIdeas).catch(() => {});
  }

  return freshIdeas.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function postIdea(
  rawGhostNumber: string,
  rawText: string
): Promise<IdeaRecord | null> {
  const text = rawText.trim();
  if (!text) return null;

  const storedGh =
    typeof localStorage !== 'undefined' ? localStorage.getItem('ghost_number') : '';
  const ghostNumber =
    normalizeGhostNumber(rawGhostNumber) ||
    normalizeGhostNumber(storedGh) ||
    getSavedGhostNumber();
  if (!ghostNumber) {
    throw new Error('Sign in with a GH-Number to post an idea.');
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAtIso = new Date(now.getTime() + TWENTY_FOUR_HOURS_MS).toISOString();

  if (!ideasTableMissing) {
    const { data, error } = await supabase
      .from('ideas')
      .insert([
        {
          ghost_number: ghostNumber,
          text,
          likes: 0,
          created_at: nowIso,
          expires_at: expiresAtIso,
        },
      ])
      .select();

    if (!error && Array.isArray(data) && data[0]) {
      return mapIdeaTableRow(data[0]);
    }

    if (error && isMissingIdeasTableError(error)) {
      ideasTableMissing = true;
    } else if (error) {
      throw new Error(error.message || 'Could not post idea.');
    }
  }

  const ideaKey = `${IDEA_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const { data: grData, error: grErr } = await supabase
    .from('ghosted_room')
    .insert({
      ghost_number: ideaKey,
      display_name: ghostNumber,
      room_code: ghostNumber,
      game_type: 'idea',
      game_data: {
        kind: 'idea',
        id: ideaKey,
        ghost_number: ghostNumber,
        text,
        likes: 0,
        liked_by: [],
        created_at: nowIso,
        expires_at: expiresAtIso,
      },
      last_active: nowIso,
    })
    .select('*')
    .single();

  if (grErr) {
    throw new Error(grErr.message || 'Could not save idea in Supabase.');
  }
  const mappedIdea = mapIdeaGhostRoomRow(grData);
  await syncIdeaToGhostedNumberRoom(mappedIdea);
  return mappedIdea;
}

export async function likeIdea(
  ideaId: string,
  _currentLikes: number,
  likerGhostNumber?: string
): Promise<IdeaRecord | null> {
  const storedGh =
    typeof localStorage !== 'undefined' ? localStorage.getItem('ghost_number') : '';
  const likerGh =
    normalizeGhostNumber(likerGhostNumber) ||
    normalizeGhostNumber(storedGh) ||
    getSavedGhostNumber();
  if (!likerGh) {
    throw new Error('Sign in with a GH-Number to like an idea.');
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('ghosted_room')
    .select('*')
    .eq('ghost_number', String(ideaId))
    .maybeSingle();

  if (fetchErr || !existing) return null;

  const gd = existing.game_data && typeof existing.game_data === 'object' ? existing.game_data : {};
  const ownerGh = normalizeGhostNumber(gd.ghost_number || existing.room_code);
  if (ownerGh && ownerGh === likerGh) {
    throw new Error('You cannot like your own idea.');
  }

  const prevLikedBy: string[] = Array.isArray(gd.liked_by)
    ? Array.from(
        new Set(
          gd.liked_by.map((g: any) => normalizeGhostNumber(g)).filter(Boolean)
        )
      )
    : [];

  if (prevLikedBy.includes(likerGh)) {
    throw new Error('You already liked this idea.');
  }

  const nextLikedBy = [...prevLikedBy, likerGh];
  const prevLikes = typeof gd.likes === 'number' ? gd.likes : Number(gd.likes || 0);
  const latestLikes = Math.max(prevLikes + 1, nextLikedBy.length);

  const { data: updated, error: updateErr } = await supabase
    .from('ghosted_room')
    .update({
      game_data: {
        ...gd,
        kind: 'idea',
        likes: latestLikes,
        liked_by: nextLikedBy,
      },
    })
    .eq('ghost_number', String(ideaId))
    .select('*')
    .single();

  if (updateErr) {
    throw new Error(updateErr.message || 'Could not like idea.');
  }
  const updatedIdea = mapIdeaGhostRoomRow(updated);
  await Promise.all([
    syncIdeaToGhostedNumberRoom(updatedIdea),
    syncLikerIdeaToGhostedNumberRoom(likerGh, updatedIdea.id),
  ]);
  return updatedIdea;
}

export function subscribeToIdeas(onUpdate: () => void): () => void {
  const ch = supabase
    .channel(makeUniqueChannelName('ghosted_ideas_feed'))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'ghosted_room' },
      (payload) => {
        const gnum = String(
          (payload.new as any)?.ghost_number || (payload.old as any)?.ghost_number || ''
        );
        if (gnum.startsWith(IDEA_PREFIX)) {
          onUpdate();
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(ch);
  };
}
