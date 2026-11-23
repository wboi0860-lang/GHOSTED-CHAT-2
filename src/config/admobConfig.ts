// ============================================================================
// GOOGLE ADMOB CONFIGURATION (PRODUCTION ENV ONLY — NO TEST IDS)
// Reads AdMob unit IDs strictly from Vite environment variables.
// ============================================================================

function readEnv(key: string): string {
  const metaEnv =
    typeof import.meta !== 'undefined' && (import.meta as any).env
      ? String((import.meta as any).env[key] || '')
      : '';
  const procEnv =
    typeof process !== 'undefined' && process.env
      ? String((process.env as any)[key] || '')
      : '';
  return (metaEnv || procEnv).trim();
}

export const ADMOB_APP_ID = readEnv('VITE_ADMOB_APP_ID');
export const BANNER_AD_UNIT_ID = readEnv('VITE_ADMOB_BANNER_ID');
export const INTERSTITIAL_AD_UNIT_ID = readEnv('VITE_ADMOB_INTERSTITIAL_ID');

export function parseAdMobUnitId(unitId: string): {
  publisherId: string;
  slotId: string;
} | null {
  const clean = String(unitId || '').trim();
  const match = clean.match(/^ca-app-pub-(\d+)\/(\d+)$/);
  if (!match) return null;
  return {
    publisherId: `ca-pub-${match[1]}`,
    slotId: match[2],
  };
}

export function getEffectiveAdMobIds() {
  return {
    appId: readEnv('VITE_ADMOB_APP_ID') || ADMOB_APP_ID,
    bannerId: readEnv('VITE_ADMOB_BANNER_ID') || BANNER_AD_UNIT_ID,
    interstitialId: readEnv('VITE_ADMOB_INTERSTITIAL_ID') || INTERSTITIAL_AD_UNIT_ID,
    isTestMode: false as const,
  };
}
