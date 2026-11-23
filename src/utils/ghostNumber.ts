import { supabase } from '../supabase';

export function isValidGhostNumber(value?: string | null): boolean {
  if (!value) return false;
  return /^GH-\d{4,}$/.test(value.trim().toUpperCase());
}

export function normalizeGhostNumber(value?: string | null): string {
  const raw = String(value || '').toUpperCase().trim();
  const match = raw.match(/^(?:GH[-\s]?)?(\d{4,})$/);
  return match ? `GH-${match[1]}` : '';
}

export function formatGhostNumberFromCounter(counter: number): string {
  const safeCounter = Math.max(1, Math.floor(counter));
  const counterPart = String(safeCounter).padStart(3, '0');
  return `GH-1${counterPart}`;
}

export function extractCounterFromGhostNumber(gh?: string | null): number | null {
  const norm = normalizeGhostNumber(gh);
  if (!norm) return null;
  const match = norm.match(/^GH-1(\d{3,})$/);
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Generates sequential permanent GH-Number: GH-1 + counter (001, 002 ... 999, 1000 ...)
 * Forever growing, never deletes, never reuses, persists directly in `ghosted_room`.
 */
export async function createGhostNumber(): Promise<string> {
  let maxCounter = 0;
  const takenSet = new Set<string>();

  try {
    const { data: roomRows } = await supabase
      .from('ghosted_room')
      .select('ghost_number, room_code, game_data')
      .or(
        'ghost_number.eq.SYSTEM::GHOST_COUNTER,ghost_number.like.GHREGISTRY::%,ghost_number.like.GNROOM::%,ghost_number.like.GH-%'
      )
      .limit(1000);

    if (Array.isArray(roomRows)) {
      for (const r of roomRows) {
        const gKey = String(r?.ghost_number || '');
        if (gKey === 'SYSTEM::GHOST_COUNTER') {
          const lastNum = Number(r?.game_data?.last_number || 0);
          if (Number.isFinite(lastNum) && lastNum > maxCounter) maxCounter = lastNum;
        } else if (gKey.startsWith('GHREGISTRY::')) {
          const gd = r?.game_data || {};
          const gh = normalizeGhostNumber(gd.ghost_number || gKey.replace('GHREGISTRY::', ''));
          if (gh) takenSet.add(gh);
          const cVal = Number(gd.counter || extractCounterFromGhostNumber(gh) || 0);
          if (Number.isFinite(cVal) && cVal > maxCounter) maxCounter = cVal;
        } else if (gKey.startsWith('GNROOM::')) {
          const gh = normalizeGhostNumber(r?.game_data?.gh_number || r?.room_code);
          if (gh) {
            takenSet.add(gh);
            const cVal = extractCounterFromGhostNumber(gh);
            if (cVal && cVal > maxCounter) maxCounter = cVal;
          }
        } else if (/^GH-\d{4,}$/.test(gKey)) {
          takenSet.add(gKey);
          const cVal = extractCounterFromGhostNumber(gKey);
          if (cVal && cVal > maxCounter) maxCounter = cVal;
        }
      }
    }
  } catch {}

  let next = maxCounter + 1;
  let ghostNumber = formatGhostNumberFromCounter(next);
  while (takenSet.has(ghostNumber)) {
    next += 1;
    ghostNumber = formatGhostNumberFromCounter(next);
  }

  const nowIso = new Date().toISOString();

  await supabase.from('ghosted_room').upsert(
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

export async function generateUniqueGhostNumber(): Promise<string> {
  return createGhostNumber();
}

/**
 * Deterministic sorted room_code for 2-user Chat & Call: GH-A-GH-B
 */
export function getSortedRoomCode(ghA: string, ghB: string): string {
  const a = normalizeGhostNumber(ghA) || ghA.trim().toUpperCase();
  const b = normalizeGhostNumber(ghB) || ghB.trim().toUpperCase();
  return [a, b].sort().join('-');
}

const GAME_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateGameCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += GAME_CODE_ALPHABET[Math.floor(Math.random() * GAME_CODE_ALPHABET.length)];
  }
  return code;
}

export function extractGameCodeFromInput(input: string): string {
  const trimmed = String(input || '').trim().toUpperCase();
  const urlMatch = trimmed.match(/\/GAME\/([A-Z0-9]{4,10})/);
  if (urlMatch) return urlMatch[1];
  const tokenMatch = trimmed.match(/\b([A-Z0-9]{6})\b/);
  if (tokenMatch) return tokenMatch[1];
  return trimmed.replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

export function buildGameLink(roomCode: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://ghosted.app';
  return `${origin}/game/${roomCode.toUpperCase()}`;
}
