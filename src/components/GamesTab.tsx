import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Gamepad2,
  Link2,
  Lock,
  Send,
  Users,
  X,
} from 'lucide-react';
import {
  ConversationPreview,
  CurrencyCode,
  FreeGameRoomData,
  FreeGameType,
  GhostRoomProfile,
  VipGameSessionData,
  VipGameType,
  VipRoomRecord,
} from '../types';
import {
  createFreeGameRoom,
  createOrJoinVipGameSession,
  fetchFreeGameState,
  fetchMyChatConversations,
  fetchVipGameSession,
  formatExpiryDateLabel,
  isGame1Unlocked,
  isGame2Unlocked,
  isVipGamesUnlocked,
  joinFreeGameRoom,
  leaveFreeGameRoom,
  leaveVipGameSession,
  purchaseVipGameSingle,
  sendChatMessage,
  subscribeToFreeGameRoom,
  subscribeToVipGameSession,
  updateFreeGameState,
  updateVipGameSession,
} from '../services/roomService';
import {
  NEVER_HAVE_I_EVER_PROMPTS,
  WOULD_YOU_RATHER_PROMPTS,
} from '../data/gamePrompts';
import { buildGameLink, normalizeGhostNumber } from '../utils/ghostNumber';
import { AdMobBanner } from './AdMobComponents';

interface GamesTabProps {
  profile: GhostRoomProfile;
  vipRecord: VipRoomRecord | null;
  isVip: boolean;
  pendingJoinCode?: string | null;
  onClearPendingJoinCode: () => void;
  onVipUpdated: (next: VipRoomRecord) => void;
  onGameFinished: () => void;
}

const PAYSTACK_PUBLIC_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PAYSTACK_PUBLIC_KEY) ||
  'pk_live_6bb17b3f5f8f9b76df19f27dc25b6e0d61d7d6cb';

type GameCatalogItem =
  | {
      tier: 'free';
      type: FreeGameType;
      title: string;
      emoji: string;
      subtitle: string;
    }
  | {
      tier: 'vip';
      type: VipGameType;
      title: string;
      emoji: string;
      subtitle: string;
    };

// EXACT ORDER REQUIRED:
// 1. Tic Tac Toe (FREE)
// 2. Two Truths One Lie (FREE)
// 3. Never Have I Ever (VIP GAMES)
// 4. Would You Rather (VIP GAMES)
const FOUR_GAMES_CATALOG: GameCatalogItem[] = [
  {
    tier: 'free',
    type: 'tictactoe',
    title: 'Tic Tac Toe',
    emoji: '❌⭕',
    subtitle: 'Classic 3×3 grid with winning strike line',
  },
  {
    tier: 'free',
    type: 'twotruths',
    title: 'Two Truths One Lie',
    emoji: '🎭',
    subtitle: 'Write 2 truths + 1 lie, friend guesses the lie',
  },
  {
    tier: 'vip',
    type: 'nhie',
    title: 'Never Have I Ever',
    emoji: '🤫',
    subtitle: 'Live 2-player confession prompts & votes',
  },
  {
    tier: 'vip',
    type: 'wyr',
    title: 'Would You Rather',
    emoji: '⚖️',
    subtitle: 'Option A vs Option B live choices',
  },
];

const WIN_COMBOS: Array<{ line: [number, number, number]; coords: [number, number, number, number] }> = [
  { line: [0, 1, 2], coords: [16, 16.6, 84, 16.6] },
  { line: [3, 4, 5], coords: [16, 50, 84, 50] },
  { line: [6, 7, 8], coords: [16, 83.3, 84, 83.3] },
  { line: [0, 3, 6], coords: [16.6, 14, 16.6, 86] },
  { line: [1, 4, 7], coords: [50, 14, 50, 86] },
  { line: [2, 5, 8], coords: [83.3, 14, 83.3, 86] },
  { line: [0, 4, 8], coords: [14, 14, 86, 86] },
  { line: [2, 4, 6], coords: [86, 14, 14, 86] },
];

export const GamesTab: React.FC<GamesTabProps> = ({
  profile,
  vipRecord,
  isVip,
  pendingJoinCode,
  onClearPendingJoinCode,
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

  const [activeGame, setActiveGame] = useState<FreeGameRoomData | null>(null);
  const [activeVipGame, setActiveVipGame] = useState<VipGameSessionData | null>(null);
  const [creatingType, setCreatingType] = useState<string | null>(null);
  const [processingGamesPay, setProcessingGamesPay] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [payNotice, setPayNotice] = useState('');

  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [joining, setJoining] = useState(false);

  const [copiedLink, setCopiedLink] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [recentChats, setRecentChats] = useState<ConversationPreview[]>([]);
  const [customShareGh, setCustomShareGh] = useState('');
  const [shareStatus, setShareStatus] = useState('');

  const [rpsCountdown, setRpsCountdown] = useState<string>('');
  const [ttStatements, setTtStatements] = useState<[string, string, string]>(['', '', '']);
  const [ttLieIdx, setTtLieIdx] = useState<number>(2);
  const [submittingTt, setSubmittingTt] = useState(false);
  const [guessingTt, setGuessingTt] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const finishedKeyRef = useRef<string>('');
  const lastMutationAtRef = useRef<number>(0);
  const lastLeaveKeyRef = useRef<string>('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 4000);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const game1Unlocked = isGame1Unlocked(vipRecord);
  const game2Unlocked = isGame2Unlocked(vipRecord);
  const gamesUnlocked = isVipGamesUnlocked(vipRecord);
  const gamesExpiryLabel = formatExpiryDateLabel(vipRecord?.vip_games?.vip_games_expires_at);

  useEffect(() => {
    try {
      localStorage.setItem('ghosted_vip_currency', currency);
    } catch {}
  }, [currency]);

  const joinAnyGameRoom = async (codeOrLink: string) => {
    try {
      const freeGame = await joinFreeGameRoom(profile.ghost_number, codeOrLink);
      setActiveVipGame(null);
      setActiveGame(freeGame);
      return;
    } catch (freeErr: any) {
      if (String(freeErr?.message || '').includes('Room full')) {
        throw freeErr;
      }
      // Try VIP game session if unlocked
      const vipSession = await createOrJoinVipGameSession({
        ghostNumber: profile.ghost_number,
        gameType: 'nhie',
        roomCode: codeOrLink,
      }).catch(() => null);

      if (vipSession) {
        const canPlay = vipSession.game_type === 'nhie' ? game1Unlocked : game2Unlocked;
        if (!canPlay) {
          throw new Error(
            vipSession.game_type === 'nhie'
              ? 'Unlock Game 1 (Never Have I Ever) to join this VIP room.'
              : 'Unlock Game 2 (Would You Rather) to join this VIP room.'
          );
        }
        setActiveGame(null);
        setActiveVipGame(vipSession);
        return;
      }
      throw freeErr;
    }
  };

  // Auto-join from chat or URL link
  useEffect(() => {
    if (!pendingJoinCode) return;
    setErrorMsg('');
    setJoining(true);
    joinAnyGameRoom(pendingJoinCode)
      .then(() => {
        setShowJoinModal(false);
      })
      .catch((err: any) => {
        setErrorMsg(err?.message || 'Could not join game room.');
      })
      .finally(() => {
        setJoining(false);
        onClearPendingJoinCode();
      });
  }, [pendingJoinCode, profile.ghost_number]);

  // Clear local Two Truths inputs whenever a new round starts
  useEffect(() => {
    setTtStatements(['', '', '']);
    setTtLieIdx(2);
    setSubmittingTt(false);
    setGuessingTt(false);
  }, [activeGame?.room_code, activeGame?.round]);

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

  // Realtime subscription + light 2.5s sync poll when inside an active FREE game room
  useEffect(() => {
    if (!activeGame?.room_code) return;
    const code = activeGame.room_code;

    const applyIncomingFree = (next: FreeGameRoomData) => {
      if (next.updatedAt && next.updatedAt < lastMutationAtRef.current) return;
      if (next.leftPlayer && next.leftAt) {
        const leaveKey = `${code}-${next.leftPlayer}-${next.leftAt}`;
        if (lastLeaveKeyRef.current !== leaveKey) {
          lastLeaveKeyRef.current = leaveKey;
          const isP1 = next.host === profile.ghost_number || next.players?.[0] === profile.ghost_number;
          onPlayerLeave(next.leftPlayer, isP1 ? 'Player 1' : 'Player 2');
        }
      }
      setActiveGame(next);
    };

    const unsub = subscribeToFreeGameRoom(code, applyIncomingFree);

    const interval = setInterval(() => {
      const fetchStartedAt = Date.now();
      fetchFreeGameState(code).then((fresh) => {
        if (fresh && lastMutationAtRef.current <= fetchStartedAt) {
          applyIncomingFree(fresh);
        }
      });
    }, 2500);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [activeGame?.room_code, profile.ghost_number]);

  // Realtime subscription + 2.5s poll when inside an active VIP game room
  useEffect(() => {
    if (!activeVipGame?.room_code) return;
    const code = activeVipGame.room_code;

    const applyIncomingVip = (next: VipGameSessionData) => {
      if (next.updatedAt && next.updatedAt < lastMutationAtRef.current) return;
      if (next.leftPlayer && next.leftAt) {
        const leaveKey = `${code}-${next.leftPlayer}-${next.leftAt}`;
        if (lastLeaveKeyRef.current !== leaveKey) {
          lastLeaveKeyRef.current = leaveKey;
          const isP1 = next.host === profile.ghost_number || next.players?.[0] === profile.ghost_number;
          onPlayerLeave(next.leftPlayer, isP1 ? 'Player 1' : 'Player 2');
        }
      }
      setActiveVipGame(next);
    };

    const unsub = subscribeToVipGameSession(code, applyIncomingVip);

    const interval = setInterval(() => {
      const fetchStartedAt = Date.now();
      fetchVipGameSession(code).then((fresh) => {
        if (fresh && lastMutationAtRef.current <= fetchStartedAt) {
          applyIncomingVip(fresh);
        }
      });
    }, 2500);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [activeVipGame?.room_code, profile.ghost_number]);

  // Detect game finish to trigger Interstitial Ad for Free users
  useEffect(() => {
    if (!activeGame) return;
    const isFinished =
      (activeGame.game_type === 'rps' && activeGame.rps?.phase === 'reveal') ||
      (activeGame.game_type === 'tictactoe' && Boolean(activeGame.tictactoe?.winner)) ||
      (activeGame.game_type === 'twotruths' && Boolean(activeGame.twotruths?.revealed));

    if (isFinished) {
      const key = `${activeGame.room_code}-${activeGame.round}`;
      if (finishedKeyRef.current !== key) {
        finishedKeyRef.current = key;
        const t = setTimeout(() => {
          onGameFinished();
        }, 900);
        return () => clearTimeout(t);
      }
    }
  }, [
    activeGame?.room_code,
    activeGame?.round,
    activeGame?.rps?.phase,
    activeGame?.tictactoe?.winner,
    activeGame?.twotruths?.revealed,
    onGameFinished,
  ]);

  // Trigger RPS countdown if joined from chat
  useEffect(() => {
    if (
      activeGame?.game_type === 'rps' &&
      activeGame.rps?.phase === 'countdown'
    ) {
      const steps = ['Rock...', 'Paper...', 'Scissors...'];
      setRpsCountdown(steps[0]);
      const t1 = setTimeout(() => setRpsCountdown(steps[1]), 450);
      const t2 = setTimeout(() => setRpsCountdown(steps[2]), 900);
      const t3 = setTimeout(async () => {
        setRpsCountdown('');
        if (activeGame.host === profile.ghost_number && activeGame.rps) {
          const [p1, p2] = activeGame.players;
          const c1 = activeGame.rps.choices[p1];
          const c2 = activeGame.rps.choices[p2];
          let winner: string | 'draw' = 'draw';
          if (c1 && c2 && c1 !== c2) {
            const p1Wins =
              (c1 === 'rock' && c2 === 'scissors') ||
              (c1 === 'paper' && c2 === 'rock') ||
              (c1 === 'scissors' && c2 === 'paper');
            winner = p1Wins ? p1 : p2;
          }
          const nextScores = { ...activeGame.rps.scores };
          if (winner !== 'draw') {
            nextScores[winner] = (nextScores[winner] || 0) + 1;
          }
          const updated: FreeGameRoomData = {
            ...activeGame,
            rps: {
              ...activeGame.rps,
              phase: 'reveal',
              winner,
              scores: nextScores,
            },
          };
          setActiveGame(updated);
          await updateFreeGameState(activeGame.room_code, updated).catch(() => {});
        }
      }, 1350);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    } else {
      setRpsCountdown('');
    }
  }, [activeGame?.rps?.phase, activeGame?.round]);

  const handleCreateFreeGame = async (gameType: FreeGameType) => {
    setErrorMsg('');
    setCreatingType(gameType);
    try {
      const { gameData } = await createFreeGameRoom(profile.ghost_number, gameType);
      setActiveVipGame(null);
      setActiveGame(gameData);
      setShowJoinModal(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not create game room in Supabase.');
    } finally {
      setCreatingType(null);
    }
  };

  const handleCreateVipGame = async (gameType: VipGameType) => {
    const unlocked = gameType === 'nhie' ? game1Unlocked : game2Unlocked;
    if (!unlocked) {
      setErrorMsg(
        gameType === 'nhie'
          ? 'Pay to unlock Game 1 (Never Have I Ever).'
          : 'Pay to unlock Game 2 (Would You Rather).'
      );
      return;
    }
    setErrorMsg('');
    setCreatingType(gameType);
    try {
      const session = await createOrJoinVipGameSession({
        ghostNumber: profile.ghost_number,
        gameType,
      });
      setActiveGame(null);
      setActiveVipGame(session);
      setShowJoinModal(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not create VIP game.');
    } finally {
      setCreatingType(null);
    }
  };

  const handlePayVipGamesUnlock = (gameSlot: 1 | 2 | 'both' = 'both') => {
    setErrorMsg('');
    setPayNotice('');
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
        setPayNotice(
          gameSlot === 1
            ? 'Game 1 (Never Have I Ever) unlocked!'
            : gameSlot === 2
            ? 'Game 2 (Would You Rather) unlocked!'
            : 'Both VIP Games unlocked!'
        );
      } catch (err: any) {
        setErrorMsg(err?.message || 'Payment verification failed.');
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
        setErrorMsg(err?.message || 'Could not launch Paystack.');
        setProcessingGamesPay(false);
        return;
      }
    }

    setErrorMsg('Paystack checkout script is unavailable right now. Please refresh.');
    setProcessingGamesPay(false);
  };

  const handleJoinByInput = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinInput.trim()) return;
    setErrorMsg('');
    setJoining(true);
    try {
      await joinAnyGameRoom(joinInput);
      setShowJoinModal(false);
      setJoinInput('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not join game room.');
    } finally {
      setJoining(false);
    }
  };

  const activeRoomCode = activeGame?.room_code || activeVipGame?.room_code || '';

  const handleCopyLink = () => {
    if (!activeRoomCode) return;
    const link = buildGameLink(activeRoomCode);
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1800);
  };

  const openShareDrawer = async () => {
    setShareStatus('');
    setShowShareModal(true);
    const list = await fetchMyChatConversations(profile.ghost_number);
    setRecentChats(list);
  };

  const sendInviteToGh = async (targetGhRaw: string) => {
    if (!activeRoomCode) return;
    const peerGh = normalizeGhostNumber(targetGhRaw);
    if (!peerGh) {
      setShareStatus('Enter a valid GH-XXXX number.');
      return;
    }
    try {
      const link = buildGameLink(activeRoomCode);
      const title = activeGame
        ? FOUR_GAMES_CATALOG.find((g) => g.type === activeGame.game_type)?.title || 'Game'
        : activeVipGame?.game_type === 'nhie'
        ? 'Never Have I Ever'
        : 'Would You Rather';

      await sendChatMessage({
        myGhostNumber: profile.ghost_number,
        peerGhostNumber: peerGh,
        text: `Join my ${title} room! Code: ${activeRoomCode} — ${link}`,
        gameCode: activeRoomCode,
        gameLink: link,
      });
      setShareStatus(`Sent to ${peerGh}!`);
    } catch (err: any) {
      setShareStatus(err?.message || 'Could not send invite.');
    }
  };

  const handleRpsPick = async (choice: 'rock' | 'paper' | 'scissors') => {
    if (!activeGame || !activeGame.rps) return;
    if (activeGame.rps.phase !== 'choosing') return;

    const nextChoices = {
      ...activeGame.rps.choices,
      [profile.ghost_number]: choice,
    };
    const bothChosen =
      activeGame.players.length === 2 &&
      activeGame.players.every((p) => Boolean(nextChoices[p]));

    const nextGame: FreeGameRoomData = {
      ...activeGame,
      rps: {
        ...activeGame.rps,
        choices: nextChoices,
        phase: bothChosen ? 'countdown' : 'choosing',
      },
    };
    setActiveGame(nextGame);
    await updateFreeGameState(activeGame.room_code, nextGame).catch((e) =>
      setErrorMsg(e.message)
    );
  };

  const handleRpsNextRound = async () => {
    if (!activeGame || !activeGame.rps) return;
    const resetChoices: Record<string, null> = {};
    activeGame.players.forEach((p) => {
      resetChoices[p] = null;
    });
    const nextGame: FreeGameRoomData = {
      ...activeGame,
      round: activeGame.round + 1,
      rps: {
        ...activeGame.rps,
        choices: resetChoices,
        phase: 'choosing',
        winner: null,
      },
    };
    setActiveGame(nextGame);
    await updateFreeGameState(activeGame.room_code, nextGame).catch(() => {});
  };

  const handleTttCell = async (idx: number) => {
    if (!activeGame || !activeGame.tictactoe) return;
    const ttt = activeGame.tictactoe;
    if (ttt.winner || ttt.board[idx] !== null) return;

    const myMark =
      ttt.playerX === profile.ghost_number
        ? 'X'
        : ttt.playerO === profile.ghost_number
        ? 'O'
        : null;
    if (!myMark || ttt.turn !== myMark) return;

    const nextBoard = [...ttt.board];
    nextBoard[idx] = myMark;

    let winner: 'X' | 'O' | 'draw' | null = null;
    let winLine: number[] | null = null;

    for (const combo of WIN_COMBOS) {
      const [a, b, c] = combo.line;
      if (nextBoard[a] && nextBoard[a] === nextBoard[b] && nextBoard[a] === nextBoard[c]) {
        winner = nextBoard[a];
        winLine = combo.line;
        break;
      }
    }

    if (!winner && nextBoard.every((cell) => cell !== null)) {
      winner = 'draw';
    }

    const nextGame: FreeGameRoomData = {
      ...activeGame,
      tictactoe: {
        ...ttt,
        board: nextBoard,
        turn: myMark === 'X' ? 'O' : 'X',
        winner,
        winLine,
      },
    };
    setActiveGame(nextGame);
    await updateFreeGameState(activeGame.room_code, nextGame).catch((e) =>
      setErrorMsg(e.message)
    );
  };

  const handleTttReset = async () => {
    if (!activeGame || !activeGame.tictactoe) return;
    const nextGame: FreeGameRoomData = {
      ...activeGame,
      round: activeGame.round + 1,
      tictactoe: {
        ...activeGame.tictactoe,
        board: Array(9).fill(null),
        turn: 'X',
        winner: null,
        winLine: null,
      },
    };
    setActiveGame(nextGame);
    await updateFreeGameState(activeGame.room_code, nextGame).catch(() => {});
  };

  const handleExitFreeGame = async () => {
    const code = activeGame?.room_code;
    setActiveGame(null);
    setErrorMsg('');
    if (code) {
      await leaveFreeGameRoom(code, profile.ghost_number).catch(() => {});
    }
  };

  const handleExitVipGame = async () => {
    const code = activeVipGame?.room_code;
    setActiveVipGame(null);
    setErrorMsg('');
    if (code) {
      await leaveVipGameSession(code, profile.ghost_number).catch(() => {});
    }
  };

  const handleSubmitTwoTruths = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGame || !activeGame.twotruths || submittingTt) return;
    if (ttStatements.some((s) => !s || !s.trim())) {
      setErrorMsg('Fill in all 3 statements first (2 truths and 1 lie).');
      return;
    }

    setSubmittingTt(true);
    setErrorMsg('');

    try {
      // Shuffle 3 statements (2 truths, 1 lie) using Fisher-Yates before saving
      const entries = ttStatements.map((text, i) => ({
        text: text.trim(),
        isLie: i === ttLieIdx,
      }));
      for (let i = entries.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = entries[i];
        entries[i] = entries[j];
        entries[j] = tmp;
      }
      const shuffledStatements = entries.map((entry) => entry.text);
      const shuffledLieIndex = entries.findIndex((entry) => entry.isLie);

      const now = Date.now();
      lastMutationAtRef.current = now;
      const nextGame: FreeGameRoomData = {
        ...activeGame,
        updatedAt: now,
        twotruths: {
          ...activeGame.twotruths,
          statements: shuffledStatements,
          lieIndex: shuffledLieIndex >= 0 ? shuffledLieIndex : 0,
          guessIndex: null,
          revealed: false,
          winner: null,
          scores: activeGame.twotruths.scores || {},
        },
      };
      setActiveGame(nextGame);
      await updateFreeGameState(activeGame.room_code, nextGame);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not submit statements.');
    } finally {
      setSubmittingTt(false);
    }
  };

  const handleGuessLie = async (idx: number) => {
    if (!activeGame || !activeGame.twotruths || guessingTt) return;
    const tt = activeGame.twotruths;
    if (
      tt.revealed ||
      tt.writer === profile.ghost_number ||
      typeof tt.lieIndex !== 'number' ||
      idx < 0 ||
      idx > 2
    ) {
      return;
    }

    setGuessingTt(true);
    try {
      const isCorrect = idx === tt.lieIndex;
      const currentScores = tt.scores && typeof tt.scores === 'object' ? tt.scores : {};
      const nextScores = { ...currentScores };
      if (isCorrect) {
        nextScores[profile.ghost_number] = (nextScores[profile.ghost_number] || 0) + 1;
      } else if (tt.writer) {
        nextScores[tt.writer] = (nextScores[tt.writer] || 0) + 1;
      }

      const now = Date.now();
      lastMutationAtRef.current = now;
      const nextGame: FreeGameRoomData = {
        ...activeGame,
        updatedAt: now,
        twotruths: {
          ...tt,
          guesser: tt.guesser || profile.ghost_number,
          guessIndex: idx,
          revealed: true,
          winner: isCorrect ? 'guesser' : 'writer',
          scores: nextScores,
        },
      };
      setActiveGame(nextGame);
      await updateFreeGameState(activeGame.room_code, nextGame);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not reveal choice.');
    } finally {
      setGuessingTt(false);
    }
  };

  const handleSwapTwoTruths = async () => {
    if (!activeGame || !activeGame.twotruths) return;
    const tt = activeGame.twotruths;
    const players = Array.isArray(activeGame.players) ? activeGame.players : [tt.writer];
    const other = players.find((p) => p !== tt.writer) || null;
    const nextWriter = other || tt.writer;
    const nextGuesser = other ? tt.writer : null;

    setTtStatements(['', '', '']);
    setTtLieIdx(2);
    setErrorMsg('');

    const now = Date.now();
    lastMutationAtRef.current = now;
    const nextGame: FreeGameRoomData = {
      ...activeGame,
      round: (activeGame.round || 1) + 1,
      updatedAt: now,
      twotruths: {
        ...tt,
        writer: nextWriter,
        guesser: nextGuesser,
        statements: ['', '', ''],
        lieIndex: null,
        guessIndex: null,
        revealed: false,
        winner: null,
        scores: tt.scores && typeof tt.scores === 'object' ? tt.scores : {},
      },
    };
    setActiveGame(nextGame);
    await updateFreeGameState(activeGame.room_code, nextGame).catch(() => {});
  };

  const voteVipGame = async (choice: string) => {
    if (!activeVipGame) return;
    const now = Date.now();
    lastMutationAtRef.current = now;
    const next: VipGameSessionData = {
      ...activeVipGame,
      updatedAt: now,
      votes: {
        ...(activeVipGame.votes || {}),
        [profile.ghost_number]: choice,
      },
    };
    setActiveVipGame(next);
    await updateVipGameSession(next).catch(() => {});
  };

  const nextVipPrompt = async () => {
    if (!activeVipGame) return;
    const maxLen =
      activeVipGame.game_type === 'nhie'
        ? NEVER_HAVE_I_EVER_PROMPTS.length
        : WOULD_YOU_RATHER_PROMPTS.length;
    const now = Date.now();
    lastMutationAtRef.current = now;
    const next: VipGameSessionData = {
      ...activeVipGame,
      updatedAt: now,
      prompt_index: ((activeVipGame.prompt_index || 0) + 1) % maxLen,
      votes: {},
    };
    setActiveVipGame(next);
    await updateVipGameSession(next).catch(() => {});
    if (!isVip) {
      onGameFinished();
    }
  };

  // ==================== ACTIVE VIP GAME SESSION (NHIE / WYR) ====================
  if (activeVipGame) {
    const hostGh = activeVipGame.host || activeVipGame.players?.[0] || profile.ghost_number;
    const secondPlayerGh =
      (activeVipGame.players || []).find((p) => p !== hostGh) || null;
    const host = { gh: hostGh, displayName: 'Player 1' as const };
    const secondPlayer = { gh: secondPlayerGh, displayName: 'Player 2' as const };
    const myDisplayName = host.gh === profile.ghost_number ? host.displayName : secondPlayer.displayName;
    const peerDisplayName = myDisplayName === 'Player 1' ? secondPlayer.displayName : host.displayName;

    const votes = Object.values(activeVipGame.votes || {});
    const totalVotes = votes.length || 1;
    const isNhie = activeVipGame.game_type === 'nhie';
    const promptIndex = Math.max(0, activeVipGame.prompt_index || 0);
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
              className="min-h-[44px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold text-zinc-200 flex items-center space-x-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Exit</span>
            </button>

            <div className="text-center">
              <p className="text-xs font-bold text-amber-300">
                {isNhie ? '🤫 Never Have I Ever 🍻' : '⚖️ Would You Rather ✨'}
              </p>
              <p className="text-[11px] font-mono text-zinc-400">
                🔑 {activeVipGame.room_code} · 👥 {(activeVipGame.players || []).length}/2
              </p>
            </div>

            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={handleCopyLink}
                className="min-h-[44px] px-3 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-bold text-white flex items-center space-x-1 cursor-pointer"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
              </button>
              <button
                type="button"
                onClick={openShareDrawer}
                className="min-h-[44px] px-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-black text-xs font-black flex items-center space-x-1 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Share</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs">
            <span className="font-mono text-zinc-300">🎮 {myDisplayName} (You)</span>
            <span className="text-zinc-500">⚡ VS ⚡</span>
            <span className="font-mono text-amber-300">
              {secondPlayer.gh ? `👑 ${peerDisplayName}` : '⏳ Waiting for Player 2...'}
            </span>
          </div>
        </div>

        <div className="bg-[#120D20] border border-amber-400/30 rounded-3xl p-6 space-y-5 text-center">
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
                activeVipGame.votes?.[profile.ghost_number] === 'A'
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
                activeVipGame.votes?.[profile.ghost_number] === 'B'
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
            className="min-h-[46px] px-6 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-black text-sm cursor-pointer"
          >
            ➡️ NEXT
          </button>
        </div>

        {showShareModal && (
          <ShareGameModal
            recentChats={recentChats}
            customShareGh={customShareGh}
            shareStatus={shareStatus}
            onChangeCustomGh={(val) => setCustomShareGh(val.toUpperCase())}
            onSend={sendInviteToGh}
            onClose={() => setShowShareModal(false)}
          />
        )}
      </div>
    );
  }

  // ==================== ACTIVE FREE GAME ROOM VIEW ====================
  if (activeGame) {
    const players = Array.isArray(activeGame.players) ? activeGame.players : [activeGame.host];
    const hostGh = activeGame.host || players[0] || profile.ghost_number;
    const secondPlayerGh = players.find((p) => p !== hostGh) || null;
    const host = { gh: hostGh, displayName: 'Player 1' as const };
    const secondPlayer = { gh: secondPlayerGh, displayName: 'Player 2' as const };
    const myDisplayName = host.gh === profile.ghost_number ? host.displayName : secondPlayer.displayName;
    const peerDisplayName = myDisplayName === 'Player 1' ? secondPlayer.displayName : host.displayName;
    const getPlayerDisplayName = (gh?: string | null) => {
      if (!gh) return 'Player 2';
      return gh === host.gh ? host.displayName : secondPlayer.displayName;
    };

    const rpsEmoji = (c: string | null | undefined) =>
      c === 'rock' ? '✊' : c === 'paper' ? '✋' : c === 'scissors' ? '✌️' : '❓';

    const winLineCoords =
      activeGame.tictactoe?.winLine
        ? WIN_COMBOS.find(
            (w) => w.line.join(',') === activeGame.tictactoe!.winLine!.join(',')
          )?.coords
        : null;

    const activeTitle =
      activeGame.game_type === 'rps'
        ? 'Rock Paper Scissors'
        : activeGame.game_type === 'tictactoe'
        ? 'Tic Tac Toe'
        : 'Two Truths One Lie';

    // Two Truths One Lie safe derived state
    const tt = activeGame.twotruths;
    const ttSafeStatements = Array.isArray(tt?.statements) ? tt.statements : [];
    const ttHasSubmitted =
      Boolean(tt) &&
      ttSafeStatements.length === 3 &&
      ttSafeStatements.every((s) => typeof s === 'string' && s.trim().length > 0) &&
      typeof tt?.lieIndex === 'number';
    const ttWriterName = getPlayerDisplayName(tt?.writer);
    const ttGuesserName = getPlayerDisplayName(tt?.guesser || secondPlayer.gh);
    const ttScores = tt?.scores && typeof tt.scores === 'object' ? tt.scores : {};
    const ttGuessedRight =
      Boolean(tt?.revealed) &&
      typeof tt?.lieIndex === 'number' &&
      typeof tt?.guessIndex === 'number' &&
      tt.guessIndex === tt.lieIndex;
    const iAmTtWriter = tt?.writer === profile.ghost_number;

    return (
      <div className="max-w-xl mx-auto space-y-4 pb-6">
        {toastMsg && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-[#1A102B] border border-cyan-400/70 text-cyan-200 text-xs font-bold shadow-xl">
            👋 {toastMsg}
          </div>
        )}

        <div className="bg-[#120D20] border border-purple-500/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleExitFreeGame}
              className="min-h-[44px] px-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold text-zinc-200 flex items-center space-x-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Exit</span>
            </button>

            <div className="text-center">
              <p className="text-xs font-bold text-white">{activeTitle}</p>
              <p className="text-[11px] font-mono text-cyan-300">
                Code {activeGame.room_code} · Players {players.length}/2
              </p>
            </div>

            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={handleCopyLink}
                className="min-h-[44px] px-3 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-bold text-white flex items-center space-x-1 cursor-pointer"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
              </button>
              <button
                type="button"
                onClick={openShareDrawer}
                className="min-h-[44px] px-3 rounded-xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black text-xs font-black flex items-center space-x-1 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Share</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs">
            <div className="flex items-center space-x-1.5 text-zinc-300">
              <Users className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-mono">{myDisplayName} (You)</span>
            </div>
            <span className="text-zinc-500">vs</span>
            <span className="font-mono text-purple-300">
              {secondPlayer.gh ? peerDisplayName : 'Waiting for Player 2...'}
            </span>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-500/40 text-xs text-rose-300">
            {errorMsg}
          </div>
        )}

        {/* ROCK PAPER SCISSORS */}
        {activeGame.game_type === 'rps' && activeGame.rps && (
          <div className="bg-[#120D20] border border-white/10 rounded-2xl p-5 space-y-5 text-center">
            <div className="flex items-center justify-around text-xs font-mono">
              <div>
                <p className="text-zinc-400">{myDisplayName} (You)</p>
                <p className="text-lg font-black text-cyan-300 tabular-nums">
                  {activeGame.rps.scores[profile.ghost_number] || 0}
                </p>
              </div>
              <div className="text-zinc-500 font-bold">Round {activeGame.round}</div>
              <div>
                <p className="text-zinc-400">{peerDisplayName}</p>
                <p className="text-lg font-black text-purple-300 tabular-nums">
                  {secondPlayer.gh ? activeGame.rps.scores[myDisplayName === 'Player 1' ? secondPlayer.gh : host.gh] || 0 : 0}
                </p>
              </div>
            </div>

            {activeGame.rps.phase === 'countdown' && (
              <div className="py-8">
                <p className="text-2xl font-black text-cyan-300 animate-pulse">{rpsCountdown}</p>
              </div>
            )}

            {activeGame.rps.phase === 'reveal' && (
              <div className="space-y-4 py-2">
                <div className="flex items-center justify-center space-x-8">
                  <div className="space-y-1">
                    <div className="text-5xl animate-bounce">
                      {rpsEmoji(activeGame.rps.choices[profile.ghost_number])}
                    </div>
                    <p className="text-xs font-mono text-zinc-400">{myDisplayName} (You)</p>
                  </div>
                  <span className="text-sm font-black text-zinc-500">VS</span>
                  <div className="space-y-1">
                    <div className="text-5xl animate-bounce">
                      {secondPlayer.gh ? rpsEmoji(activeGame.rps.choices[myDisplayName === 'Player 1' ? secondPlayer.gh : host.gh]) : '❓'}
                    </div>
                    <p className="text-xs font-mono text-zinc-400">{peerDisplayName}</p>
                  </div>
                </div>

                <p className="text-lg font-black text-white">
                  {activeGame.rps.winner === 'draw'
                    ? 'Draw!'
                    : activeGame.rps.winner === profile.ghost_number
                    ? 'You Win!'
                    : 'You Lose!'}
                </p>

                <button
                  type="button"
                  onClick={handleRpsNextRound}
                  className="min-h-[46px] px-6 rounded-xl bg-[#00F5FF] text-black font-black text-sm cursor-pointer"
                >
                  Next Round
                </button>
              </div>
            )}

            {activeGame.rps.phase === 'choosing' && (
              <div className="space-y-4">
                <p className="text-xs text-zinc-400">
                  {activeGame.rps.choices[profile.ghost_number]
                    ? `You picked ${rpsEmoji(activeGame.rps.choices[profile.ghost_number])}. Waiting for ${peerDisplayName}...`
                    : 'Tap your move'}
                </p>

                <div className="grid grid-cols-3 gap-3">
                  {(['rock', 'paper', 'scissors'] as const).map((move) => {
                    const picked = activeGame.rps?.choices[profile.ghost_number] === move;
                    return (
                      <button
                        key={move}
                        type="button"
                        disabled={Boolean(activeGame.rps?.choices[profile.ghost_number])}
                        onClick={() => handleRpsPick(move)}
                        className={`min-h-[88px] rounded-2xl border text-4xl flex items-center justify-center transition cursor-pointer ${
                          picked
                            ? 'bg-purple-600/40 border-cyan-400 scale-105'
                            : 'bg-black/50 border-white/15 hover:border-purple-400'
                        }`}
                      >
                        {rpsEmoji(move)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TIC TAC TOE */}
        {activeGame.game_type === 'tictactoe' && activeGame.tictactoe && (
          <div className="bg-[#120D20] border border-white/10 rounded-2xl p-5 space-y-4 text-center">
            <div className="text-xs font-mono text-zinc-300">
              {activeGame.tictactoe.winner ? (
                <span className="text-base font-black text-cyan-300">
                  {activeGame.tictactoe.winner === 'draw'
                    ? "It's a Draw!"
                    : `${activeGame.tictactoe.winner === 'X' ? host.displayName : secondPlayer.displayName} (${activeGame.tictactoe.winner}) Wins!`}
                </span>
              ) : (
                <span>
                  You are{' '}
                  <strong className="text-cyan-300">
                    {activeGame.tictactoe.playerX === profile.ghost_number ? 'X' : 'O'}
                  </strong>{' '}
                  · Turn:{' '}
                  <strong className="text-purple-300">
                    {activeGame.tictactoe.turn === 'X' ? host.displayName : secondPlayer.displayName} ({activeGame.tictactoe.turn})
                  </strong>
                </span>
              )}
            </div>

            <div className="relative w-64 h-64 mx-auto grid grid-cols-3 gap-2">
              {activeGame.tictactoe.board.map((cell, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleTttCell(idx)}
                  className="bg-black/60 border border-white/15 hover:border-purple-400 rounded-2xl text-3xl font-black flex items-center justify-center cursor-pointer transition"
                >
                  <span className={cell === 'X' ? 'text-cyan-400' : 'text-purple-400'}>
                    {cell}
                  </span>
                </button>
              ))}

              {winLineCoords && (
                <svg
                  viewBox="0 0 100 100"
                  className="absolute inset-0 w-full h-full pointer-events-none"
                >
                  <line
                    x1={winLineCoords[0]}
                    y1={winLineCoords[1]}
                    x2={winLineCoords[2]}
                    y2={winLineCoords[3]}
                    stroke="#00F5FF"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </div>

            {activeGame.tictactoe.winner && (
              <button
                type="button"
                onClick={handleTttReset}
                className="min-h-[44px] px-6 rounded-xl bg-[#00F5FF] text-black font-black text-sm cursor-pointer"
              >
                Play Again
              </button>
            )}
          </div>
        )}

        {/* TWO TRUTHS ONE LIE */}
        {activeGame.game_type === 'twotruths' && tt && (
          <div className="bg-[#120D20] border border-white/10 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
              <span>✍️ Writer: {ttWriterName}</span>
              <span>Round {activeGame.round || 1}</span>
            </div>

            {/* Scoreboard */}
            <div className="grid grid-cols-2 gap-2 text-center text-xs font-mono">
              <div className="px-3 py-2 rounded-xl bg-black/40 border border-white/10">
                <span className="text-zinc-400">{host.displayName}: </span>
                <span className="text-cyan-300 font-black tabular-nums">
                  {ttScores[host.gh] || 0}
                </span>
              </div>
              <div className="px-3 py-2 rounded-xl bg-black/40 border border-white/10">
                <span className="text-zinc-400">{secondPlayer.displayName}: </span>
                <span className="text-purple-300 font-black tabular-nums">
                  {secondPlayer.gh ? ttScores[secondPlayer.gh] || 0 : 0}
                </span>
              </div>
            </div>

            {!ttHasSubmitted ? (
              iAmTtWriter ? (
                <form onSubmit={handleSubmitTwoTruths} className="space-y-3">
                  <p className="text-xs font-bold text-cyan-300">
                    🎭 Write 2 truths and 1 lie, tap which statement is the Lie (we shuffle them automatically!):
                  </p>
                  {[0, 1, 2].map((idx) => (
                    <div key={idx} className="flex items-center space-x-2">
                      <input
                        type="text"
                        value={ttStatements[idx] || ''}
                        onChange={(e) => {
                          const next = [...ttStatements] as [string, string, string];
                          next[idx] = e.target.value;
                          setTtStatements(next);
                        }}
                        placeholder={`Statement #${idx + 1}`}
                        className="flex-1 min-h-[44px] px-3 rounded-xl bg-black/60 border border-white/15 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-400"
                      />
                      <button
                        type="button"
                        onClick={() => setTtLieIdx(idx)}
                        className={`min-h-[44px] px-3 rounded-xl text-xs font-bold border cursor-pointer shrink-0 ${
                          ttLieIdx === idx
                            ? 'bg-rose-500/25 border-rose-400 text-rose-200'
                            : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                        }`}
                      >
                        {ttLieIdx === idx ? '🤥 Lie' : '✅ Truth'}
                      </button>
                    </div>
                  ))}
                  <button
                    type="submit"
                    disabled={submittingTt}
                    className="w-full min-h-[46px] rounded-xl bg-[#00F5FF] text-black font-black text-sm cursor-pointer disabled:opacity-50"
                  >
                    {submittingTt ? 'Shuffling & Sending...' : '🔀 Shuffle & Send Statements'}
                  </button>
                </form>
              ) : (
                <p className="text-sm text-zinc-400 text-center py-6">
                  ⏳ Waiting for {ttWriterName} to write 2 truths and 1 lie...
                </p>
              )
            ) : (
              <div className="space-y-3">
                {tt.revealed ? (
                  <div
                    className={`p-3 rounded-xl border text-center text-sm font-black ${
                      (iAmTtWriter ? !ttGuessedRight : ttGuessedRight)
                        ? 'bg-emerald-950/60 border-emerald-400 text-emerald-200'
                        : 'bg-rose-950/60 border-rose-400 text-rose-200'
                    }`}
                  >
                    {iAmTtWriter
                      ? ttGuessedRight
                        ? `💥 You Lose! ${ttGuesserName} spotted your lie!`
                        : `🏆 You Win! ${ttGuesserName} fell for your lie!`
                      : ttGuessedRight
                      ? '🏆 You Win! You spotted the lie!'
                      : '💥 You Lose! That was actually a truth!'}
                  </div>
                ) : (
                  <p className="text-xs font-bold text-purple-200">
                    {iAmTtWriter
                      ? `🕵️ Shuffled! Waiting for ${ttGuesserName} to pick the lie...`
                      : '🕵️ Statements shuffled! Tap the 1 statement you think is the LIE:'}
                  </p>
                )}

                {ttSafeStatements.map((stmt, idx) => {
                  const revealed = Boolean(tt.revealed);
                  const isLie = typeof tt.lieIndex === 'number' && idx === tt.lieIndex;
                  const isGuessed = typeof tt.guessIndex === 'number' && idx === tt.guessIndex;
                  return (
                    <button
                      key={idx}
                      type="button"
                      disabled={revealed || iAmTtWriter || guessingTt}
                      onClick={() => handleGuessLie(idx)}
                      className={`w-full min-h-[50px] px-4 py-3 rounded-xl border text-left text-sm flex items-center justify-between gap-2 transition ${
                        revealed
                          ? isLie
                            ? 'bg-rose-950/60 border-rose-400 text-rose-100'
                            : isGuessed
                            ? 'bg-amber-950/60 border-amber-400 text-amber-100'
                            : 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                          : iAmTtWriter
                          ? 'bg-black/40 border-white/15 text-zinc-200 cursor-default'
                          : 'bg-black/60 border-white/15 hover:border-cyan-400 text-white cursor-pointer'
                      }`}
                    >
                      <span>{stmt}</span>
                      {revealed && (
                        <span className="text-[11px] font-black uppercase shrink-0">
                          {isLie ? '🤥 LIE' : isGuessed ? '👈 Picked (Truth)' : '✅ Truth'}
                        </span>
                      )}
                    </button>
                  );
                })}

                {tt.revealed && (
                  <button
                    type="button"
                    onClick={handleSwapTwoTruths}
                    className="w-full min-h-[46px] rounded-xl bg-[#00F5FF] text-black font-black text-sm cursor-pointer mt-2"
                  >
                    🔄 Swap Roles &amp; Next Round
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {showShareModal && (
          <ShareGameModal
            recentChats={recentChats}
            customShareGh={customShareGh}
            shareStatus={shareStatus}
            onChangeCustomGh={(val) => setCustomShareGh(val.toUpperCase())}
            onSend={sendInviteToGh}
            onClose={() => setShowShareModal(false)}
          />
        )}
      </div>
    );
  }

  // ==================== ALL 4 GAMES LOBBY (IN EXACT ORDER) ====================
  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white">Ghosted Games</h2>
          <p className="text-xs text-zinc-400">
            2 Free Games &amp; 2 VIP Games · 2 players max per room
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <div className="grid grid-cols-2 p-1 rounded-xl bg-[#120D20] border border-white/10">
            <button
              type="button"
              onClick={() => setCurrency('NGN')}
              className={`min-h-[36px] px-2.5 rounded-lg text-[11px] font-bold cursor-pointer ${
                currency === 'NGN' ? 'bg-amber-400 text-black' : 'text-zinc-400'
              }`}
            >
              ₦ Naira
            </button>
            <button
              type="button"
              onClick={() => setCurrency('USD')}
              className={`min-h-[36px] px-2.5 rounded-lg text-[11px] font-bold cursor-pointer ${
                currency === 'USD' ? 'bg-amber-400 text-black' : 'text-zinc-400'
              }`}
            >
              $ Dollar
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setErrorMsg('');
              setShowJoinModal(true);
            }}
            className="min-h-[44px] px-4 rounded-xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-black text-xs flex items-center space-x-1.5 cursor-pointer shrink-0"
          >
            <Link2 className="w-4 h-4" />
            <span>Join Game</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-rose-950/70 border border-rose-500/40 text-xs text-rose-300 font-medium">
          {errorMsg}
        </div>
      )}

      {payNotice && (
        <div className="p-3.5 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-300 font-bold">
          {payNotice}
        </div>
      )}

      {/* ALL 4 GAMES VISIBLE & SCROLLABLE IN EXACT ORDER */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {FOUR_GAMES_CATALOG.map((game) => {
          const isVipTier = game.tier === 'vip';
          const gameSlot: 1 | 2 | null =
            game.type === 'nhie' ? 1 : game.type === 'wyr' ? 2 : null;
          const locked =
            game.type === 'nhie'
              ? !game1Unlocked
              : game.type === 'wyr'
              ? !game2Unlocked
              : false;

          return (
            <div
              key={game.type}
              className={`rounded-2xl p-5 flex flex-col justify-between space-y-4 border transition ${
                isVipTier
                  ? 'bg-gradient-to-b from-[#1C1409] to-[#120D20] border-amber-400/35'
                  : 'bg-[#120D20] border-purple-500/30'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-3xl">{game.emoji}</span>
                  {isVipTier ? (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-amber-400/20 border border-amber-400/40 text-[10px] font-black uppercase text-amber-300">
                      {locked ? <Lock className="w-3 h-3" /> : <Crown className="w-3 h-3" />}
                      <span>{gameSlot === 1 ? 'GAME 1 VIP' : 'GAME 2 VIP'}</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-cyan-400/15 border border-cyan-400/40 text-[10px] font-black uppercase text-cyan-300">
                      FREE
                    </span>
                  )}
                </div>

                <h3 className="text-base font-bold text-white">{game.title}</h3>
                <p className="text-xs text-zinc-400">{game.subtitle}</p>

                {locked && (
                  <div className="p-2.5 rounded-xl bg-black/55 border border-amber-400/30">
                    <p className="text-[11px] font-bold text-amber-200">
                      GAME {gameSlot} VIP - {currency === 'USD' ? '$1' : '₦1,000'} - Pay to Unlock (Ads Still Show)
                    </p>
                  </div>
                )}

                {isVipTier && !locked && (
                  <p className="text-[11px] font-mono text-emerald-300">
                    {gamesExpiryLabel ? `Unlocked Until: ${gamesExpiryLabel}` : 'Unlocked'}
                  </p>
                )}
              </div>

              {locked && gameSlot ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={processingGamesPay}
                    onClick={() => handlePayVipGamesUnlock(gameSlot)}
                    className="w-full min-h-[44px] px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-black text-xs cursor-pointer transition disabled:opacity-50"
                  >
                    {processingGamesPay
                      ? 'Opening Paystack...'
                      : `Unlock Game ${gameSlot} (${currency === 'USD' ? '$1' : '₦1,000'})`}
                  </button>
                  {!gamesUnlocked && (
                    <button
                      type="button"
                      disabled={processingGamesPay}
                      onClick={() => handlePayVipGamesUnlock('both')}
                      className="w-full min-h-[38px] px-3 rounded-xl bg-white/10 hover:bg-white/15 text-amber-200 font-bold text-[11px] cursor-pointer transition disabled:opacity-50"
                    >
                      Unlock Both Games ({currency === 'USD' ? '$2' : '₦2,700'})
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={creatingType !== null}
                  onClick={() =>
                    game.tier === 'free'
                      ? handleCreateFreeGame(game.type)
                      : handleCreateVipGame(game.type)
                  }
                  className={`w-full min-h-[44px] px-4 rounded-xl font-black text-xs flex items-center justify-center cursor-pointer transition disabled:opacity-50 ${
                    isVipTier
                      ? 'bg-amber-400 hover:bg-amber-300 text-black'
                      : 'bg-[#00F5FF] hover:bg-[#00d8e6] text-black'
                  }`}
                >
                  {creatingType === game.type ? 'Creating Room...' : 'Create Game'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Real Google AdMob Banner (Free users only; hidden if VIP or if AdMob has no fill) */}
      <AdMobBanner isVip={isVip} placement="games" />

      {showJoinModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-[#120D20] border border-purple-500/40 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Gamepad2 className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-black text-white">Join or Create Game</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowJoinModal(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleJoinByInput} className="space-y-2">
              <label className="text-xs font-semibold text-zinc-300 block">
                Paste Room Code or Link
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                  placeholder="ABC123 or .../game/ABC123"
                  className="flex-1 min-h-[46px] px-3.5 rounded-xl bg-black/60 border border-white/15 text-white placeholder-zinc-500 font-mono text-sm focus:outline-none focus:border-cyan-400"
                />
                <button
                  type="submit"
                  disabled={joining || !joinInput.trim()}
                  className="min-h-[46px] px-5 rounded-xl bg-[#00F5FF] text-black font-black text-xs cursor-pointer disabled:opacity-40"
                >
                  {joining ? '...' : 'Join'}
                </button>
              </div>
            </form>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-400">Free Games — Quick Create:</p>
              <div className="space-y-2">
                {FOUR_GAMES_CATALOG.filter((g) => g.tier === 'free').map((g) => (
                  <button
                    key={g.type}
                    type="button"
                    disabled={creatingType !== null}
                    onClick={() => handleCreateFreeGame(g.type as FreeGameType)}
                    className="w-full min-h-[48px] px-4 rounded-xl bg-black/50 hover:bg-white/10 border border-white/15 flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center space-x-3">
                      <span className="text-xl">{g.emoji}</span>
                      <span className="text-sm font-bold text-white">{g.title}</span>
                    </div>
                    <span className="text-xs font-bold text-cyan-300">
                      {creatingType === g.type ? 'Creating...' : 'Create Game'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {errorMsg && (
              <p className="text-xs text-rose-400 bg-rose-950/50 border border-rose-500/30 rounded-xl px-3 py-2">
                {errorMsg}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ShareGameModal: React.FC<{
  recentChats: ConversationPreview[];
  customShareGh: string;
  shareStatus: string;
  onChangeCustomGh: (val: string) => void;
  onSend: (gh: string) => void;
  onClose: () => void;
}> = ({
  recentChats,
  customShareGh,
  shareStatus,
  onChangeCustomGh,
  onSend,
  onClose,
}) => (
  <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="w-full max-w-sm rounded-3xl bg-[#120D20] border border-purple-500/40 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-white">Share Game Link</h3>
        <button
          type="button"
          onClick={onClose}
          className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-zinc-400 hover:text-white cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex items-center space-x-2">
        <input
          type="text"
          value={customShareGh}
          onChange={(e) => onChangeCustomGh(e.target.value)}
          placeholder="Enter friend GH-1001"
          maxLength={14}
          className="flex-1 min-h-[44px] px-3 rounded-xl bg-black/60 border border-white/15 text-white font-mono text-sm"
        />
        <button
          type="button"
          onClick={() => onSend(customShareGh)}
          className="min-h-[44px] px-4 rounded-xl bg-[#00F5FF] text-black font-black text-xs cursor-pointer"
        >
          Send
        </button>
      </div>

      {recentChats.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          <p className="text-xs text-zinc-400">Recent Chats</p>
          {recentChats.map((c) => (
            <button
              key={c.room_code}
              type="button"
              onClick={() => onSend(c.peer_ghost_number)}
              className="w-full min-h-[44px] px-3 rounded-xl bg-black/40 hover:bg-white/10 border border-white/10 flex items-center justify-between text-xs cursor-pointer"
            >
              <span className="font-semibold text-white">{c.peer_name}</span>
              <span className="font-mono text-cyan-300">{c.peer_ghost_number}</span>
            </button>
          ))}
        </div>
      )}

      {shareStatus && (
        <p className="text-xs text-emerald-400 font-semibold">{shareStatus}</p>
      )}
    </div>
  </div>
);
