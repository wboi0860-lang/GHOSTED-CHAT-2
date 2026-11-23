import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Crown,
  Gamepad2,
  Lock,
  PlayCircle,
  ShieldCheck,
  ArrowLeft,
} from 'lucide-react';
import {
  CurrencyCode,
  GhostRoomProfile,
  VipGameSessionData,
  VipGameType,
  VipPlanType,
  VipRoomRecord,
} from '../types';
import {
  createOrJoinVipGameSession,
  fetchVipGameSession,
  formatExpiryDateLabel,
  getEffectivePaidTag,
  grantOneHourVipTrial,
  hasActiveVipBadge,
  isGame1Unlocked,
  isGame2Unlocked,
  isMainVipActive,
  leaveVipGameSession,
  purchaseVipGameSingle,
  purchaseVipSubscription,
  subscribeToVipGameSession,
  updateVipGameSession,
} from '../services/roomService';
import {
  NEVER_HAVE_I_EVER_PROMPTS,
  WOULD_YOU_RATHER_PROMPTS,
} from '../data/gamePrompts';
import { AdMobRewardedModal } from './AdMobComponents';

interface VipRoomTabProps {
  profile: GhostRoomProfile;
  vipRecord: VipRoomRecord | null;
  onVipUpdated: (next: VipRoomRecord) => void;
  onGameFinished?: () => void;
}

const PAYSTACK_PUBLIC_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PAYSTACK_PUBLIC_KEY) ||
  'pk_live_6bb17b3f5f8f9b76df19f27dc25b6e0d61d7d6cb';

const VIP_PLANS: Array<{
  id: Exclude<VipPlanType, 'trial_1h'>;
  title: string;
  durationLabel: string;
  ngnLabel: string;
  usdLabel: string;
  ngnAmount: number;
  usdAmount: number;
  badge?: string;
}> = [
  {
    id: 'daily',
    title: 'Daily VIP',
    durationLabel: '24 Hours Access',
    ngnLabel: '₦500',
    usdLabel: '$1',
    ngnAmount: 50000,
    usdAmount: 100,
  },
  {
    id: 'monthly',
    title: 'Monthly VIP',
    durationLabel: '30 Days Access',
    ngnLabel: '₦14,500',
    usdLabel: '$10',
    ngnAmount: 1450000,
    usdAmount: 1000,
    badge: 'Popular',
  },
  {
    id: 'yearly',
    title: 'Yearly VIP',
    durationLabel: '365 Days Access',
    ngnLabel: '₦60,000',
    usdLabel: '$40',
    ngnAmount: 6000000,
    usdAmount: 4000,
    badge: 'Best Value',
  },
];

export const VipRoomTab: React.FC<VipRoomTabProps> = ({
  profile,
  vipRecord,
  onVipUpdated,
  onGameFinished,
}) => {
  const [currency, setCurrency] = useState<CurrencyCode>(() => {
    try {
      const saved = localStorage.getItem('ghosted_vip_currency');
      return saved === 'USD' ? 'USD' : 'NGN';
    } catch {
      return 'NGN';
    }
  });
  const [selectedPlan, setSelectedPlan] = useState<Exclude<VipPlanType, 'trial_1h'>>('monthly');
  const [processingPay, setProcessingPay] = useState(false);
  const [processingGamesPay, setProcessingGamesPay] = useState(false);
  const [payError, setPayError] = useState('');
  const [paySuccess, setPaySuccess] = useState('');

  // Rewarded Ad state (1 Hour VIP Trial)
  const [showRewardedAd, setShowRewardedAd] = useState(false);
  const [adNotice, setAdNotice] = useState('');

  // VIP Game session inside `vip_room` ONLY
  const [vipGame, setVipGame] = useState<VipGameSessionData | null>(null);
  const [vipGameJoinCode, setVipGameJoinCode] = useState('');
  const [vipGameError, setVipGameError] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const lastLeaveKeyRef = React.useRef<string>('');
  const lastMutationAtRef = React.useRef<number>(0);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 4000);
  };

  const onPlayerLeave = (
    player: 'Player 1' | 'Player 2',
    myDisplayName: 'Player 1' | 'Player 2'
  ) => {
    if (player === 'Player 1' && myDisplayName === 'Player 2') {
      showToast('Player 1 left the game');
    } else if (player === 'Player 2' && myDisplayName === 'Player 1') {
      showToast('Player 2 left the game');
    }
  };

  const isVipActive = isMainVipActive(vipRecord, profile);
  const hasVipBadge = hasActiveVipBadge(vipRecord, profile);
  const paidTag = getEffectivePaidTag(vipRecord, profile);
  const game1Unlocked = isGame1Unlocked(vipRecord);
  const game2Unlocked = isGame2Unlocked(vipRecord);
  const vipExpiryLabel = formatExpiryDateLabel(vipRecord?.vip_features?.vip_expires_at);
  const gamesExpiryLabel = formatExpiryDateLabel(vipRecord?.vip_games?.vip_games_expires_at);

  useEffect(() => {
    try {
      localStorage.setItem('ghosted_vip_currency', currency);
    } catch {}
  }, [currency]);

  useEffect(() => {
    if (!vipGame?.room_code) return;
    const code = vipGame.room_code;

    const applyIncoming = (next: VipGameSessionData) => {
      if (next.updatedAt && next.updatedAt < lastMutationAtRef.current) return;
      if (next.leftPlayer && next.leftAt) {
        const key = `${code}-${next.leftPlayer}-${next.leftAt}`;
        if (lastLeaveKeyRef.current !== key) {
          lastLeaveKeyRef.current = key;
          const isP1 = next.host === profile.ghost_number || next.players?.[0] === profile.ghost_number;
          onPlayerLeave(next.leftPlayer, isP1 ? 'Player 1' : 'Player 2');
        }
      }
      setVipGame(next);
    };

    const unsub = subscribeToVipGameSession(code, applyIncoming);
    const interval = setInterval(() => {
      const started = Date.now();
      fetchVipGameSession(code).then((fresh) => {
        if (fresh && lastMutationAtRef.current <= started) applyIncoming(fresh);
      });
    }, 2500);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [vipGame?.room_code, profile.ghost_number]);

  const handlePlanCheckout = (plan: (typeof VIP_PLANS)[number]) => {
    setPayError('');
    setPaySuccess('');
    setProcessingPay(true);

    const uniqueRef = `GHVIP-${plan.id.toUpperCase()}-${profile.ghost_number}-${Date.now()}`;
    // Dollar toggle is display-only: ALWAYS charge NGN in Paystack
    const amountSmallestUnit = plan.ngnAmount;
    const displayPrice = currency === 'USD' ? plan.usdLabel : plan.ngnLabel;

    const finalize = async (ref: string) => {
      try {
        const updated = await purchaseVipSubscription({
          ghostNumber: profile.ghost_number,
          email: profile.email,
          reference: ref,
          currency: 'NGN',
          plan: plan.id,
          amount: amountSmallestUnit,
          displayPrice,
        });
        onVipUpdated(updated);
        setPaySuccess(`${plan.title} activated!`);
      } catch (err: any) {
        setPayError(err?.message || 'Payment verification failed.');
      } finally {
        setProcessingPay(false);
      }
    };

    const paystackPop = (window as any)?.PaystackPop;
    if (paystackPop && typeof paystackPop.setup === 'function') {
      try {
        const handler = paystackPop.setup({
          key: PAYSTACK_PUBLIC_KEY,
          email: `${profile.ghost_number.toLowerCase()}@ghosted.app`,
          amount: amountSmallestUnit,
          currency: 'NGN',
          ref: uniqueRef,
          metadata: {
            ghost_number: profile.ghost_number,
            room: 'vip_room',
            plan: plan.id,
            purchaseType: 'vip_subscription',
            display_currency: currency,
            display_price: displayPrice,
          },
          callback: (response: { reference: string }) => {
            finalize(response.reference || uniqueRef);
          },
          onClose: () => {
            setProcessingPay(false);
          },
        });
        handler.openIframe();
        return;
      } catch (err: any) {
        setPayError(err?.message || 'Could not launch Paystack.');
        setProcessingPay(false);
        return;
      }
    }

    setPayError('Paystack checkout script is unavailable right now. Please refresh.');
    setProcessingPay(false);
  };

  const handleVipGamesCheckout = (gameSlot: 1 | 2 | 'both' = 'both') => {
    setPayError('');
    setPaySuccess('');
    setProcessingGamesPay(true);

    const slotLabel = gameSlot === 1 ? 'G1' : gameSlot === 2 ? 'G2' : 'ALL';
    const uniqueRef = `GHVIPGAMES-${slotLabel}-${profile.ghost_number}-${Date.now()}`;
    const amountSmallestUnit = gameSlot === 'both' ? 270000 : 100000;
    const displayPrice =
      currency === 'USD'
        ? gameSlot === 'both'
          ? '$2'
          : '$1'
        : gameSlot === 'both'
        ? '₦2,700'
        : '₦1,000';

    const finalize = async (ref: string) => {
      try {
        const updated = await purchaseVipGameSingle({
          ghostNumber: profile.ghost_number,
          email: profile.email,
          gameSlot,
          reference: ref,
          currency: 'NGN',
          amount: amountSmallestUnit,
          displayPrice,
        });
        onVipUpdated(updated);
        setPaySuccess(
          gameSlot === 1
            ? 'Game 1 (Never Have I Ever) unlocked!'
            : gameSlot === 2
            ? 'Game 2 (Would You Rather) unlocked!'
            : 'Both VIP Games unlocked!'
        );
      } catch (err: any) {
        setPayError(err?.message || 'VIP Games payment verification failed.');
      } finally {
        setProcessingGamesPay(false);
      }
    };

    const paystackPop = (window as any)?.PaystackPop;
    if (paystackPop && typeof paystackPop.setup === 'function') {
      try {
        const handler = paystackPop.setup({
          key: PAYSTACK_PUBLIC_KEY,
          email: `${profile.ghost_number.toLowerCase()}@ghosted.app`,
          amount: amountSmallestUnit,
          currency: 'NGN',
          ref: uniqueRef,
          metadata: {
            ghost_number: profile.ghost_number,
            room: 'vip_room',
            purchaseType:
              gameSlot === 1 ? 'vip_game_1' : gameSlot === 2 ? 'vip_game_2' : 'vip_games',
            display_currency: currency,
            display_price: displayPrice,
          },
          callback: (response: { reference: string }) => {
            finalize(response.reference || uniqueRef);
          },
          onClose: () => {
            setProcessingGamesPay(false);
          },
        });
        handler.openIframe();
        return;
      } catch (err: any) {
        setPayError(err?.message || 'Could not launch Paystack.');
        setProcessingGamesPay(false);
        return;
      }
    }

    setPayError('Paystack checkout script is unavailable right now. Please refresh.');
    setProcessingGamesPay(false);
  };

  const handleRewardGranted = async () => {
    setShowRewardedAd(false);
    setAdNotice('');
    try {
      const updated = await grantOneHourVipTrial(profile.ghost_number, profile.email);
      onVipUpdated(updated);
      setPaySuccess('1 Hour VIP Trial activated!');
    } catch (err: any) {
      setAdNotice(err?.message || 'Could not activate 1 Hour VIP Trial.');
    }
  };

  const startVipGame = async (type: VipGameType) => {
    const unlocked = type === 'nhie' ? game1Unlocked : game2Unlocked;
    if (!unlocked) {
      setVipGameError(
        type === 'nhie'
          ? 'Unlock Game 1 (Never Have I Ever) to play.'
          : 'Unlock Game 2 (Would You Rather) to play.'
      );
      return;
    }
    setVipGameError('');
    try {
      const session = await createOrJoinVipGameSession({
        ghostNumber: profile.ghost_number,
        gameType: type,
      });
      setVipGame(session);
    } catch (err: any) {
      setVipGameError(err?.message || 'Could not start VIP game.');
    }
  };

  const joinVipGame = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!game1Unlocked && !game2Unlocked) {
      setVipGameError('Unlock Game 1 or Game 2 VIP first.');
      return;
    }
    if (!vipGameJoinCode.trim()) return;
    setVipGameError('');
    try {
      const session = await createOrJoinVipGameSession({
        ghostNumber: profile.ghost_number,
        gameType: 'nhie',
        roomCode: vipGameJoinCode,
      });
      const canPlayThisGame = session.game_type === 'nhie' ? game1Unlocked : game2Unlocked;
      if (!canPlayThisGame) {
        setVipGameError(
          session.game_type === 'nhie'
            ? 'Unlock Game 1 (Never Have I Ever) to join this room.'
            : 'Unlock Game 2 (Would You Rather) to join this room.'
        );
        return;
      }
      setVipGame(session);
      setVipGameJoinCode('');
    } catch (err: any) {
      setVipGameError(err?.message || 'Could not join VIP game.');
    }
  };

  const handleExitVipGame = async () => {
    const code = vipGame?.room_code;
    setVipGame(null);
    if (code) {
      await leaveVipGameSession(code, profile.ghost_number).catch(() => {});
    }
  };

  const voteVipGame = async (choice: string) => {
    if (!vipGame) return;
    const now = Date.now();
    lastMutationAtRef.current = now;
    const next: VipGameSessionData = {
      ...vipGame,
      updatedAt: now,
      votes: {
        ...(vipGame.votes || {}),
        [profile.ghost_number]: choice,
      },
    };
    setVipGame(next);
    await updateVipGameSession(next).catch(() => {});
  };

  const nextVipPrompt = async () => {
    if (!vipGame) return;
    const maxLen =
      vipGame.game_type === 'nhie'
        ? NEVER_HAVE_I_EVER_PROMPTS.length
        : WOULD_YOU_RATHER_PROMPTS.length;
    const now = Date.now();
    lastMutationAtRef.current = now;
    const next: VipGameSessionData = {
      ...vipGame,
      updatedAt: now,
      prompt_index: ((vipGame.prompt_index || 0) + 1) % maxLen,
      votes: {},
    };
    setVipGame(next);
    await updateVipGameSession(next).catch(() => {});
    if (!isVipActive) {
      onGameFinished?.();
    }
  };

  const handleCopyVipGameCode = (code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  };

  // ==================== ACTIVE VIP GAME SESSION ====================
  if (vipGame) {
    const hostGh = vipGame.host || vipGame.players?.[0] || profile.ghost_number;
    const secondPlayerGh = (vipGame.players || []).find((p) => p !== hostGh) || null;
    const host = { gh: hostGh, displayName: 'Player 1' as const };
    const secondPlayer = { gh: secondPlayerGh, displayName: 'Player 2' as const };
    const myDisplayName = host.gh === profile.ghost_number ? host.displayName : secondPlayer.displayName;
    const peerDisplayName = myDisplayName === 'Player 1' ? secondPlayer.displayName : host.displayName;

    const votes = Object.values(vipGame.votes || {});
    const totalVotes = votes.length || 1;
    const isNhie = vipGame.game_type === 'nhie';
    const promptIndex = Math.max(0, vipGame.prompt_index || 0);
    const promptNhie =
      NEVER_HAVE_I_EVER_PROMPTS[promptIndex % NEVER_HAVE_I_EVER_PROMPTS.length] ||
      NEVER_HAVE_I_EVER_PROMPTS[0];
    const promptWyr =
      WOULD_YOU_RATHER_PROMPTS[promptIndex % WOULD_YOU_RATHER_PROMPTS.length] ||
      WOULD_YOU_RATHER_PROMPTS[0];
    const optionA = isNhie ? '🙋 I Have' : `${promptWyr.emojiA} ${promptWyr.optionA}`;
    const optionB = isNhie ? '🙅 Never' : `${promptWyr.emojiB} ${promptWyr.optionB}`;
    const countA = votes.filter((v) => v === 'A').length;
    const countB = votes.filter((v) => v === 'B').length;
    const pctA = votes.length ? Math.round((countA / totalVotes) * 100) : 0;
    const pctB = votes.length ? Math.round((countB / totalVotes) * 100) : 0;

    return (
      <div className="max-w-xl mx-auto space-y-4 pb-6">
        {toastMsg && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-[#1A102B] border border-amber-400/70 text-amber-200 text-xs font-bold shadow-xl">
            👋 {toastMsg}
          </div>
        )}

        <div className="bg-[#120D20] border border-amber-400/40 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleExitVipGame}
              className="min-h-[44px] px-3 rounded-xl bg-white/5 text-xs font-bold text-white flex items-center space-x-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>VIP Room</span>
            </button>
            <div className="text-center min-w-0">
              <p className="text-xs font-bold text-amber-300 truncate">
                {isNhie ? '🤫 Never Have I Ever 🍻' : '⚖️ Would You Rather ✨'}
              </p>
              <p className="text-[11px] font-mono text-zinc-400">
                🔑 {vipGame.room_code} · 👥 {(vipGame.players || []).length}/2
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleCopyVipGameCode(vipGame.room_code)}
              className="min-h-[40px] px-3 rounded-xl bg-amber-400/20 border border-amber-400/40 text-xs font-bold text-amber-300 flex items-center space-x-1 cursor-pointer"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCode ? 'Copied' : 'Code'}</span>
            </button>
          </div>

          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs">
            <span className="font-mono text-zinc-300">🎮 {myDisplayName} (You)</span>
            <span className="text-zinc-500">⚡ VS ⚡</span>
            <span className="font-mono text-amber-300">
              {secondPlayer.gh ? `👑 ${peerDisplayName}` : '⏳ Waiting for Player 2...'}
            </span>
          </div>
        </div>

        <div className="bg-[#120D20] border border-white/10 rounded-3xl p-6 space-y-5 text-center">
          <div className="nhie-emoji bounce" aria-hidden="true">
            {isNhie ? promptNhie.emoji : promptWyr.emoji}
          </div>

          <p className="text-base font-bold text-white leading-relaxed">
            {isNhie ? promptNhie.question : '⚖️ Would you rather...'}
          </p>

          <div className="grid grid-cols-1 gap-3">
            <button
              type="button"
              onClick={() => voteVipGame('A')}
              className={`min-h-[54px] px-4 rounded-2xl border text-sm font-bold flex items-center justify-between cursor-pointer ${
                vipGame.votes?.[profile.ghost_number] === 'A'
                  ? 'bg-amber-400/20 border-amber-400 text-amber-200'
                  : 'bg-black/50 border-white/15 text-white'
              }`}
            >
              <span className="text-left">{optionA}</span>
              <span className="font-mono text-xs text-amber-300 tabular-nums">{pctA}%</span>
            </button>

            <button
              type="button"
              onClick={() => voteVipGame('B')}
              className={`min-h-[54px] px-4 rounded-2xl border text-sm font-bold flex items-center justify-between cursor-pointer ${
                vipGame.votes?.[profile.ghost_number] === 'B'
                  ? 'bg-purple-500/25 border-purple-400 text-purple-200'
                  : 'bg-black/50 border-white/15 text-white'
              }`}
            >
              <span className="text-left">{optionB}</span>
              <span className="font-mono text-xs text-purple-300 tabular-nums">{pctB}%</span>
            </button>
          </div>

          <button
            type="button"
            onClick={nextVipPrompt}
            className="min-h-[46px] px-6 rounded-xl bg-amber-400 text-black font-black text-sm cursor-pointer"
          >
            ➡️ NEXT
          </button>
        </div>
      </div>
    );
  }

  const activePlanObj = VIP_PLANS.find((p) => p.id === selectedPlan) || VIP_PLANS[1];

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-6">
      {/* Header + Currency Toggle */}
      <div className="rounded-3xl p-5 border space-y-4 transition bg-gradient-to-b from-[#1D1508] to-[#120D20] border-amber-400/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-400/20 border border-amber-400/50 flex items-center justify-center shrink-0">
              <Crown className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <div className="flex items-center flex-wrap gap-2">
                <h2 className="text-lg font-black text-white">VIP Room</h2>
                {hasVipBadge && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-400 text-black text-[10px] font-black uppercase">
                    VIP Badge
                  </span>
                )}
              </div>
              <div className="flex items-center flex-wrap gap-2 mt-0.5">
                <span className="text-xs font-mono text-cyan-300 font-bold">
                  {profile.gh_number_hidden ? 'GH-XXXX' : profile.ghost_number}
                </span>
                {paidTag && (
                  <span className="px-2 py-0.5 rounded bg-amber-400/20 border border-amber-400/60 text-[11px] font-black text-amber-300">
                    {paidTag}
                  </span>
                )}
              </div>
              {isVipActive && vipExpiryLabel && (
                <p className="text-[11px] font-mono text-amber-200/80 mt-0.5">
                  Main VIP (Zero Ads) Active Until: {vipExpiryLabel}
                </p>
              )}
              {!isVipActive && hasVipBadge && (
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Game VIP active · Subscribe Main VIP to stop ads
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 p-1 rounded-xl bg-black/50 border border-white/10">
            <button
              type="button"
              onClick={() => setCurrency('NGN')}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-bold cursor-pointer transition ${
                currency === 'NGN' ? 'bg-amber-400 text-black' : 'text-zinc-400'
              }`}
            >
              ₦ Naira
            </button>
            <button
              type="button"
              onClick={() => setCurrency('USD')}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-bold cursor-pointer transition ${
                currency === 'USD' ? 'bg-amber-400 text-black' : 'text-zinc-400'
              }`}
            >
              $ Dollar
            </button>
          </div>
        </div>

        {/* VIP Benefits */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            { icon: ShieldCheck, label: 'Zero Ads' },
            { icon: Crown, label: 'VIP Gold Badge' },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="px-3 py-2.5 rounded-xl bg-black/45 border border-white/10 flex items-center space-x-2 text-zinc-200"
            >
              <Icon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="font-semibold truncate">{label}</span>
            </div>
          ))}
        </div>

        {/* Active Main VIP Card OR Subscription Plans */}
        {isVipActive ? (
          <div className="bg-black/40 border border-amber-400/25 rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-white">Main VIP Active</p>
              <p className="text-xs text-zinc-400">
                Zero ads and VIP Gold Badge enabled
                {vipExpiryLabel ? ` · Until ${vipExpiryLabel}` : ''}
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-amber-400 text-black text-xs font-black uppercase shrink-0">
              ACTIVE
            </span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {VIP_PLANS.map((plan) => {
                const selected = selectedPlan === plan.id;
                const price = currency === 'USD' ? plan.usdLabel : plan.ngnLabel;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between space-y-2 ${
                      selected
                        ? 'bg-amber-400/15 border-amber-400 shadow-lg'
                        : 'bg-black/45 border-white/10 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-zinc-200">{plan.title}</span>
                      {plan.badge && (
                        <span className="text-[10px] font-black uppercase text-amber-300">
                          {plan.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-2xl font-black text-amber-300 tabular-nums">{price}</p>
                    <p className="text-[11px] text-zinc-400">{plan.durationLabel}</p>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={processingPay}
              onClick={() => handlePlanCheckout(activePlanObj)}
              className="w-full min-h-[50px] rounded-2xl bg-amber-400 hover:bg-amber-300 text-black font-black text-sm cursor-pointer transition disabled:opacity-50"
            >
              {processingPay
                ? 'Opening Paystack...'
                : `Subscribe ${activePlanObj.title} (${
                    currency === 'USD' ? activePlanObj.usdLabel : activePlanObj.ngnLabel
                  })`}
            </button>

            {/* Rewarded Google Ad for 1 Hour VIP Trial */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  setAdNotice('');
                  setShowRewardedAd(true);
                }}
                className="w-full min-h-[46px] rounded-2xl bg-white/5 hover:bg-white/10 border border-purple-400/35 text-purple-200 font-bold text-xs flex items-center justify-center space-x-2 cursor-pointer transition"
              >
                <PlayCircle className="w-4 h-4 text-cyan-300" />
                <span>Watch Ad to get 1 Hour VIP Trial</span>
              </button>
              {adNotice && (
                <p className="text-[11px] text-zinc-400 text-center mt-2">{adNotice}</p>
              )}
            </div>
          </div>
        )}

        {payError && (
          <p className="text-xs text-rose-400 bg-rose-950/60 border border-rose-500/30 rounded-xl px-3 py-2">
            {payError}
          </p>
        )}
        {paySuccess && (
          <p className="text-xs text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 rounded-xl px-3 py-2">
            {paySuccess}
          </p>
        )}
      </div>

      {/* VIP GAMES SECTION (8 Months Paywall for Free Users) */}
      <div className="bg-[#120D20] border border-amber-400/30 rounded-3xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <Gamepad2 className="w-5 h-5 text-amber-300" />
            <div>
              <h3 className="text-sm font-black text-white">VIP Exclusive Games</h3>
              <p className="text-[11px] text-zinc-400">
                Never Have I Ever &amp; Would You Rather
              </p>
            </div>
          </div>

          {game1Unlocked && game2Unlocked ? (
            <span className="text-[11px] font-mono text-emerald-300">
              {gamesExpiryLabel ? `Unlocked Until: ${gamesExpiryLabel}` : 'Unlocked'}
            </span>
          ) : (
            <span className="text-[11px] font-bold text-amber-300 flex items-center space-x-1">
              <Lock className="w-3.5 h-3.5" />
              <span>Game VIP (Does Not Stop Ads)</span>
            </span>
          )}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {game1Unlocked ? (
              <button
                type="button"
                onClick={() => startVipGame('nhie')}
                className="min-h-[84px] p-4 rounded-2xl bg-black/50 hover:bg-white/5 border border-amber-400/30 text-left space-y-1 cursor-pointer"
              >
                <p className="text-sm font-bold text-amber-200">Game 1 · Never Have I Ever</p>
                <p className="text-xs text-zinc-400">Create Game &amp; play live (2 players)</p>
              </button>
            ) : (
              <div className="p-4 rounded-2xl bg-black/50 border border-amber-400/25 flex flex-col justify-between space-y-3">
                <div>
                  <p className="text-sm font-bold text-white">Game 1 · Never Have I Ever</p>
                  <p className="text-[11px] text-zinc-400">Unlock Game 1 only (keeps VIP badge)</p>
                </div>
                <button
                  type="button"
                  disabled={processingGamesPay}
                  onClick={() => handleVipGamesCheckout(1)}
                  className="w-full min-h-[42px] rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-black text-xs cursor-pointer transition disabled:opacity-50"
                >
                  {processingGamesPay
                    ? 'Opening Paystack...'
                    : `Unlock Game 1 (${currency === 'USD' ? '$1' : '₦1,000'})`}
                </button>
              </div>
            )}

            {game2Unlocked ? (
              <button
                type="button"
                onClick={() => startVipGame('wyr')}
                className="min-h-[84px] p-4 rounded-2xl bg-black/50 hover:bg-white/5 border border-amber-400/30 text-left space-y-1 cursor-pointer"
              >
                <p className="text-sm font-bold text-amber-200">Game 2 · Would You Rather</p>
                <p className="text-xs text-zinc-400">Create Game &amp; vote Option A vs B</p>
              </button>
            ) : (
              <div className="p-4 rounded-2xl bg-black/50 border border-amber-400/25 flex flex-col justify-between space-y-3">
                <div>
                  <p className="text-sm font-bold text-white">Game 2 · Would You Rather</p>
                  <p className="text-[11px] text-zinc-400">Unlock Game 2 only (keeps VIP badge)</p>
                </div>
                <button
                  type="button"
                  disabled={processingGamesPay}
                  onClick={() => handleVipGamesCheckout(2)}
                  className="w-full min-h-[42px] rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-black text-xs cursor-pointer transition disabled:opacity-50"
                >
                  {processingGamesPay
                    ? 'Opening Paystack...'
                    : `Unlock Game 2 (${currency === 'USD' ? '$1' : '₦1,000'})`}
                </button>
              </div>
            )}
          </div>

          {!(game1Unlocked && game2Unlocked) && (
            <button
              type="button"
              disabled={processingGamesPay}
              onClick={() => handleVipGamesCheckout('both')}
              className="w-full min-h-[48px] rounded-2xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-black text-xs cursor-pointer transition disabled:opacity-50"
            >
              {processingGamesPay
                ? 'Opening Paystack...'
                : `Unlock Both VIP Games (${currency === 'USD' ? '$2' : '₦2,700'})`}
            </button>
          )}

          {(game1Unlocked || game2Unlocked) && (
            <form onSubmit={joinVipGame} className="flex items-center space-x-2">
              <input
                type="text"
                value={vipGameJoinCode}
                onChange={(e) => setVipGameJoinCode(e.target.value.toUpperCase())}
                placeholder="Enter VIP Game Code"
                className="flex-1 min-h-[44px] px-3 rounded-xl bg-black/60 border border-white/15 text-white font-mono text-xs focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                className="min-h-[44px] px-4 rounded-xl bg-amber-400 text-black font-black text-xs cursor-pointer"
              >
                Join
              </button>
            </form>
          )}
        </div>

        {vipGameError && <p className="text-xs text-rose-400">{vipGameError}</p>}
      </div>

      {/* Real Google AdMob Rewarded Ad Modal (Zero fake ads) */}
      <AdMobRewardedModal
        open={showRewardedAd}
        onRewardEarned={handleRewardGranted}
        onUnavailable={(reason) => {
          setShowRewardedAd(false);
          setAdNotice(reason || 'Google Ad is unavailable right now. Please try again later.');
        }}
        onClose={() => setShowRewardedAd(false)}
      />
    </div>
  );
};
