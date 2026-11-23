import { getEffectiveAdMobIds, parseAdMobUnitId } from '../config/admobConfig';

declare global {
  interface Window {
    AdMob?: any;
    admob?: any;
    adsbygoogle?: any[];
  }
}

let adSensePromise: Promise<boolean> | null = null;

export function hasNativeAdMobBridge(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.AdMob || window.admob);
}

export function loadGoogleAdSenseForPublisher(publisherId: string): Promise<boolean> {
  if (typeof window === 'undefined' || !publisherId) return Promise.resolve(false);
  if (Array.isArray(window.adsbygoogle)) return Promise.resolve(true);
  if (adSensePromise) return adSensePromise;

  adSensePromise = new Promise((resolve) => {
    const existing = document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]');
    if (existing) {
      resolve(true);
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
      publisherId
    )}`;

    const timer = setTimeout(() => {
      adSensePromise = null;
      resolve(false);
    }, 5000);

    script.onload = () => {
      clearTimeout(timer);
      window.adsbygoogle = window.adsbygoogle || [];
      resolve(true);
    };
    script.onerror = () => {
      clearTimeout(timer);
      adSensePromise = null;
      resolve(false);
    };

    document.head.appendChild(script);
  });

  return adSensePromise;
}

export async function triggerNativeBannerIfAvailable(show: boolean): Promise<boolean> {
  if (!hasNativeAdMobBridge()) return false;
  const ids = getEffectiveAdMobIds();
  try {
    const bridge = window.AdMob || window.admob;
    if (!show) {
      if (typeof bridge?.hideBanner === 'function') {
        await bridge.hideBanner();
        return true;
      }
      return false;
    }

    if (!ids.bannerId) return false;

    if (typeof bridge?.showBanner === 'function') {
      await bridge.showBanner({
        adId: ids.bannerId,
        isTesting: false,
      });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function triggerNativeInterstitialIfAvailable(): Promise<'shown' | 'failed' | 'no_bridge'> {
  if (!hasNativeAdMobBridge()) return 'no_bridge';
  const ids = getEffectiveAdMobIds();
  if (!ids.interstitialId) return 'failed';

  try {
    const bridge = window.AdMob || window.admob;
    if (
      typeof bridge?.prepareInterstitial === 'function' &&
      typeof bridge?.showInterstitial === 'function'
    ) {
      await bridge.prepareInterstitial({
        adId: ids.interstitialId,
        isTesting: false,
      });
      await bridge.showInterstitial();
      return 'shown';
    }
    return 'failed';
  } catch {
    return 'failed';
  }
}

export const AD_TOTAL_DURATION_SECONDS = 15;
export const AD_CLOSE_UNLOCK_SECONDS = 10;
export const CHAT_INTERSTITIAL_COOLDOWN_MS = 2 * 60 * 1000;

export function shouldTriggerGamesInterstitial(
  isVip: boolean,
  completedGamesCount: number = 1
): boolean {
  if (isVip) return false;
  return completedGamesCount > 0;
}

export function shouldTriggerChatInterstitial(
  isVip: boolean,
  messagesSinceLastAd: number,
  lastAdShownAtMs: number,
  nowMs: number = Date.now()
): boolean {
  if (isVip) return false;
  if (messagesSinceLastAd < 10) return false;
  return nowMs - lastAdShownAtMs >= CHAT_INTERSTITIAL_COOLDOWN_MS;
}

export function shouldTriggerMapInterstitial(
  isVip: boolean,
  mapOpenCount: number = 1
): boolean {
  if (isVip) return false;
  return mapOpenCount > 0;
}

export function shouldTriggerCallEndInterstitial(isVip: boolean): boolean {
  return !isVip;
}

export { getEffectiveAdMobIds, parseAdMobUnitId };
