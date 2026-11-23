import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crown, X } from 'lucide-react';
import {
  getEffectiveAdMobIds,
  hasNativeAdMobBridge,
  loadGoogleAdSenseForPublisher,
  parseAdMobUnitId,
  triggerNativeBannerIfAvailable,
  triggerNativeInterstitialIfAvailable,
} from '../services/admobService';

// =========================================================================
// 1. REAL GOOGLE ADMOB BANNER AD (ENV ID ONLY)
//    - Never shows for VIP users
//    - Uses ONLY VITE_ADMOB_BANNER_ID
//    - If ad fails to load or unavailable, hides ad space cleanly (null)
// =========================================================================
export const AdMobBanner: React.FC<{ isVip: boolean; placement: 'chats' | 'games' }> = ({
  isVip,
}) => {
  const [bannerVisible, setBannerVisible] = useState(false);

  useEffect(() => {
    if (isVip) {
      triggerNativeBannerIfAvailable(false).catch(() => {});
      setBannerVisible(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const shown = await triggerNativeBannerIfAvailable(true).catch(() => false);
      if (!cancelled) {
        setBannerVisible(shown);
      }
    })();

    return () => {
      cancelled = true;
      triggerNativeBannerIfAvailable(false).catch(() => {});
    };
  }, [isVip]);

  if (isVip || !bannerVisible) return null;

  return <div className="w-full min-h-[50px]" aria-hidden="true" />;
};

// =========================================================================
// 2. FULL-SCREEN 15-SECOND ADMOB INTERSTITIAL AD (ENV ID ONLY)
//    - Uses ONLY VITE_ADMOB_INTERSTITIAL_ID
//    - Total ad duration = 15 seconds
//    - NO X button at start of ad (showCloseButton = false)
//    - X button appears ONLY after 10 seconds (showCloseButton = true)
//    - Ad keeps playing from 10s to 15s even after X appears
//    - User can only close ad by tapping X after 10 seconds (before 10s = ignore)
//    - Auto-closes at 15 seconds and returns user to previous screen
//    - VIP users: ZERO ads, ZERO countdown
//    - If ad fails to load, does NOT block user — closes immediately
// =========================================================================
const AD_DURATION_SECONDS = 15;
const AD_CLOSE_REVEAL_SECONDS = 10;

export const AdMobInterstitialOverlay: React.FC<{
  open: boolean;
  isVip: boolean;
  onClose: () => void;
  onUpgradeVip?: () => void;
}> = ({ open, isVip, onClose, onUpgradeVip }) => {
  const [readyToShow, setReadyToShow] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showCloseButton, setShowCloseButton] = useState(false);
  const insRef = useRef<HTMLModElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closedRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const closeAd = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    setReadyToShow(false);
    setShowCloseButton(false);
    setElapsedSeconds(0);
    onCloseRef.current();
  };

  useEffect(() => {
    if (!open) {
      closedRef.current = false;
      setReadyToShow(false);
      setShowCloseButton(false);
      setElapsedSeconds(0);
      return;
    }

    closedRef.current = false;

    if (isVip) {
      closeAd();
      return;
    }

    const ids = getEffectiveAdMobIds();
    const parsed = parseAdMobUnitId(ids.interstitialId);
    if (!ids.interstitialId || !parsed) {
      closeAd();
      return;
    }

    let cancelled = false;

    const showAd = () => {
      if (cancelled) return;
      setShowCloseButton(false);
      setElapsedSeconds(0);
      setReadyToShow(true);
    };

    (async () => {
      if (hasNativeAdMobBridge()) {
        const nativeResult = await triggerNativeInterstitialIfAvailable();
        if (cancelled) return;
        if (nativeResult === 'failed') {
          closeAd();
          return;
        }
        showAd();
        return;
      }

      const sdkLoaded = await loadGoogleAdSenseForPublisher(parsed.publisherId);
      if (cancelled) return;
      if (!sdkLoaded) {
        closeAd();
        return;
      }

      showAd();

      setTimeout(() => {
        if (cancelled) return;
        try {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch {}
      }, 60);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, isVip]);

  // 10s close button reveal timer, 15s auto-close timer, and 1s elapsed ticker
  useEffect(() => {
    if (!open || isVip || !readyToShow) return;

    setShowCloseButton(false);
    setElapsedSeconds(0);

    const tickInterval = setInterval(() => {
      setElapsedSeconds((prev) => Math.min(AD_DURATION_SECONDS, prev + 1));
    }, 1000);

    const closeRevealTimer = setTimeout(() => {
      setShowCloseButton(true);
    }, AD_CLOSE_REVEAL_SECONDS * 1000);

    const autoCloseTimer = setTimeout(() => {
      closeAd();
    }, AD_DURATION_SECONDS * 1000);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevOverflow;
      clearInterval(tickInterval);
      clearTimeout(closeRevealTimer);
      clearTimeout(autoCloseTimer);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, isVip, readyToShow]);

  if (!open || isVip || !readyToShow) return null;

  const ids = getEffectiveAdMobIds();
  const parsed = parseAdMobUnitId(ids.interstitialId);
  if (!parsed) return null;

  const secondsLeftTotal = Math.max(0, AD_DURATION_SECONDS - elapsedSeconds);
  const secondsUntilClose = Math.max(0, AD_CLOSE_REVEAL_SECONDS - elapsedSeconds);
  const canClose = showCloseButton && elapsedSeconds >= AD_CLOSE_REVEAL_SECONDS;

  const onCloseClick = () => {
    if (!canClose) return;
    closeAd();
  };

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Advertisement"
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 w-screen h-[100dvh] z-[99999] bg-[#06040C] text-white flex flex-col overflow-hidden select-none"
    >
      {/* Top Bar: NO X button at start; X appears ONLY after 10s while ad keeps playing to 15s */}
      <div className="w-full shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-[#0D0916]/95 border-b border-white/10 z-20">
        <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/15">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-xs font-bold tracking-wide text-zinc-100 tabular-nums">
            {secondsLeftTotal > 0 ? `Ad ends in ${secondsLeftTotal}...` : 'Closing ad...'}
          </span>
        </div>

        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 hidden sm:inline">
          Sponsored Ad
        </span>

        {canClose ? (
          <button
            type="button"
            onClick={onCloseClick}
            className="min-w-[44px] min-h-[44px] px-3.5 rounded-full bg-white text-black hover:bg-zinc-200 font-black text-xs flex items-center justify-center space-x-1 cursor-pointer shadow-lg transition"
            aria-label="Close Ad"
          >
            <X className="w-4 h-4" />
            <span>Close</span>
          </button>
        ) : (
          <div className="min-h-[44px] px-3 rounded-full bg-white/5 border border-white/10 flex items-center text-[11px] font-mono text-zinc-400 tabular-nums">
            Wait {secondsUntilClose}s
          </div>
        )}
      </div>

      {/* Edge-to-Edge Full-Screen Interstitial Slot (Real Env Unit ID Only) */}
      <div className="flex-1 w-full h-full flex flex-col items-stretch justify-center bg-[#0B0814] relative overflow-hidden">
        <div className="w-full h-full flex-1 flex items-center justify-center overflow-hidden">
          <ins
            ref={insRef}
            className="adsbygoogle"
            style={{ display: 'block', width: '100%', height: '100%', minHeight: '100%' }}
            data-ad-client={parsed.publisherId}
            data-ad-slot={parsed.slotId}
            data-ad-format="auto"
            data-full-width-responsive="true"
          />
        </div>

        <div className="w-full py-2 px-4 text-center bg-black/50 border-t border-white/5 shrink-0">
          <p className="text-[11px] text-zinc-400">
            {canClose
              ? `Ad keeps playing (${secondsLeftTotal}s left) · Tap X above to close`
              : `Close available in ${secondsUntilClose}s · Total ${secondsLeftTotal}s`}
          </p>
        </div>
      </div>

      {/* Bottom Upsell Bar */}
      <div className="w-full shrink-0 px-4 py-3 bg-[#0D0916]/95 border-t border-white/10 text-center z-20">
        {canClose && onUpgradeVip ? (
          <button
            type="button"
            onClick={() => {
              closeAd();
              onUpgradeVip();
            }}
            className="inline-flex items-center space-x-1.5 text-xs font-bold text-amber-300 hover:text-amber-200 underline underline-offset-4 cursor-pointer"
          >
            <Crown className="w-3.5 h-3.5" />
            <span>Tired of ads? Get VIP - No Ads</span>
          </button>
        ) : (
          <p className="inline-flex items-center space-x-1.5 text-xs font-bold text-amber-300/90">
            <Crown className="w-3.5 h-3.5" />
            <span>Tired of ads? Get VIP - No Ads</span>
          </p>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay;
};

// =========================================================================
// 3. REWARDED AD MODAL (NO FAKE PREROLL VIDEO)
// =========================================================================
export const AdMobRewardedModal: React.FC<{
  open: boolean;
  onRewardEarned: () => void;
  onUnavailable: (reason?: string) => void;
  onClose: () => void;
}> = ({ open, onUnavailable }) => {
  useEffect(() => {
    if (!open) return;
    onUnavailable('AdMob ads are currently limited or unavailable in this browser.');
  }, [open, onUnavailable]);

  return null;
};
