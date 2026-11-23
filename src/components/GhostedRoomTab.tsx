import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Bell,
  Check,
  Clock,
  Gamepad2,
  Heart,
  History,
  Lightbulb,
  Lock,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  Search,
  Send,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  ChatMessage,
  ChatRoomRow,
  ConversationPreview,
  FreeGameType,
  FriendRequestRecord,
  GhostRoomProfile,
  IdeaRecord,
  MapSessionData,
  TrackerEntry,
} from '../types';
import {
  areUsersFriends,
  blockContactUser,
  createFreeGameRoom,
  deleteChatMessage,
  deleteContactUser,
  fetchFriendRequestsForUser,
  fetchMapSessionByRoom,
  fetchMyChatConversations,
  formatDeletesInCountdown,
  formatLastActiveText,
  getFriendRequestBetween,
  isUserOnline,
  likeIdea,
  loadIdeas,
  openOrCreateChatRoom,
  postIdea,
  respondToFriendRequest,
  respondToMapInvite,
  searchByGhostNumber,
  sendChatMessage,
  sendFriendRequest,
  sendMapInvite,
  subscribeToChatRoom,
  subscribeToFriendRequests,
  subscribeToIdeas,
  subscribeToMapSessions,
} from '../services/roomService';
import { GhostAvatarView } from './GhostAvatarView';
import { getSortedRoomCode, normalizeGhostNumber } from '../utils/ghostNumber';
import { AdMobBanner } from './AdMobComponents';
import { VipBadge } from './VipBadge';

interface GhostedRoomTabProps {
  profile: GhostRoomProfile;
  isVip: boolean;
  selectedChatPeer?: GhostRoomProfile | null;
  onSelectChatPeer: (peer: GhostRoomProfile | null) => void;
  onChatOpened: () => void;
  onMessageSent?: () => void;
  onCallPeer: (peer: GhostRoomProfile) => void;
  onJoinGameFromChat: (codeOrLink: string) => void;
  onOpenMap: (roomCode?: string) => void;
  onRefreshProfile: () => Promise<void>;
}

type ChatsSubTab = 'chats' | 'ideas' | 'search' | 'tracker' | 'contacts';
const CHATS_SUB_TABS: ChatsSubTab[] = ['chats', 'ideas', 'search', 'tracker', 'contacts'];

export const GhostedRoomTab: React.FC<GhostedRoomTabProps> = ({
  profile,
  isVip,
  selectedChatPeer,
  onSelectChatPeer,
  onChatOpened,
  onMessageSent,
  onCallPeer,
  onJoinGameFromChat,
  onOpenMap,
  onRefreshProfile,
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [searchResult, setSearchResult] = useState<GhostRoomProfile | null>(null);
  const [searchFriendReq, setSearchFriendReq] = useState<FriendRequestRecord | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const [friendBusy, setFriendBusy] = useState<string | null>(null);

  const [incomingRequests, setIncomingRequests] = useState<FriendRequestRecord[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestRecord[]>([]);
  const [acceptedContacts, setAcceptedContacts] = useState<GhostRoomProfile[]>([]);

  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [activeRoom, setActiveRoom] = useState<ChatRoomRow | null>(null);
  const [activeMapSession, setActiveMapSession] = useState<MapSessionData | null>(null);
  const [chatError, setChatError] = useState('');
  const [draftText, setDraftText] = useState('');
  const [sending, setSending] = useState(false);
  const [showGamePicker, setShowGamePicker] = useState(false);
  const [creatingGame, setCreatingGame] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [messageMenuTarget, setMessageMenuTarget] = useState<ChatMessage | null>(null);
  const [messageBusy, setMessageBusy] = useState(false);
  const [contactMenuTarget, setContactMenuTarget] = useState<{
    ghost_number: string;
    display_name: string;
  } | null>(null);
  const [confirmContactAction, setConfirmContactAction] = useState<{
    peer: { ghost_number: string; display_name: string };
    action: 'block' | 'delete';
  } | null>(null);
  const [contactBusy, setContactBusy] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<ChatsSubTab>('chats');
  const [ideas, setIdeas] = useState<IdeaRecord[]>([]);
  const [newIdea, setNewIdea] = useState('');
  const [postingIdea, setPostingIdea] = useState(false);
  const [likingIdeaId, setLikingIdeaId] = useState<string | null>(null);
  const [ideasError, setIdeasError] = useState('');
  const [, setTick] = useState(0);

  const touchStartXRef = useRef<number>(0);
  const touchStartYRef = useRef<number>(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const tracker: TrackerEntry[] = Array.isArray(profile.game_data?.tracker)
    ? profile.game_data!.tracker!
    : [];

  const handleSwipeStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!e.touches || e.touches.length === 0) return;
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
  };

  const handleSwipeEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    const diffX = touchStartXRef.current - e.changedTouches[0].clientX;
    const diffY = touchStartYRef.current - e.changedTouches[0].clientY;
    if (Math.abs(diffX) <= Math.abs(diffY)) return;
    const index = CHATS_SUB_TABS.indexOf(activeSubTab);
    if (diffX > 50 && index < CHATS_SUB_TABS.length - 1) {
      setActiveSubTab(CHATS_SUB_TABS[index + 1]);
    } else if (diffX < -50 && index > 0) {
      setActiveSubTab(CHATS_SUB_TABS[index - 1]);
    }
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = (callback: () => void) => {
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      callback();
    }, 480);
  };

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const loadConversations = useCallback(async () => {
    const list = await fetchMyChatConversations(profile.ghost_number);
    setConversations(list);
  }, [profile.ghost_number]);

  const loadFriendRequestsAndContacts = useCallback(async () => {
    const data = await fetchFriendRequestsForUser(profile.ghost_number);
    setIncomingRequests(data.incomingPending);
    setOutgoingRequests(data.outgoing);
    setAcceptedContacts(data.acceptedContacts);
    if (searchResult) {
      const updatedRel = await getFriendRequestBetween(
        profile.ghost_number,
        searchResult.ghost_number
      );
      setSearchFriendReq(updatedRel);
    }
  }, [profile.ghost_number, searchResult?.ghost_number]);

  const refreshIdeas = useCallback(async () => {
    try {
      const data = await loadIdeas();
      setIdeas(data);
    } catch {}
  }, []);

  useEffect(() => {
    loadConversations();
    loadFriendRequestsAndContacts();
    refreshIdeas();
    const unsubReqs = subscribeToFriendRequests(profile.ghost_number, () => {
      loadFriendRequestsAndContacts();
      onRefreshProfile();
    });
    const unsubIdeas = subscribeToIdeas(() => {
      refreshIdeas();
    });
    const ideasExpiryTimer = setInterval(() => {
      refreshIdeas();
    }, 60000);
    return () => {
      clearInterval(ideasExpiryTimer);
      unsubReqs();
      unsubIdeas();
    };
  }, [loadConversations, loadFriendRequestsAndContacts, refreshIdeas, profile.ghost_number]);

  const handlePostIdea = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newIdea.trim() || postingIdea) return;
    setPostingIdea(true);
    setIdeasError('');
    try {
      const created = await postIdea(profile.ghost_number, newIdea);
      if (created) {
        setNewIdea('');
        await refreshIdeas();
      }
    } catch (err: any) {
      setIdeasError(err?.message || 'Could not post idea.');
    } finally {
      setPostingIdea(false);
    }
  };

  const handleLikeIdea = async (ideaId: string, currentLikes: number) => {
    if (likingIdeaId === ideaId) return;
    setLikingIdeaId(ideaId);
    setIdeasError('');
    setIdeas((prev) =>
      prev.map((idea) => (idea.id === ideaId ? { ...idea, likes: currentLikes + 1 } : idea))
    );
    try {
      const updated = await likeIdea(ideaId, currentLikes);
      if (updated) {
        setIdeas((prev) => prev.map((idea) => (idea.id === ideaId ? updated : idea)));
      }
    } catch (err: any) {
      setIdeasError(err?.message || 'Could not like idea.');
      refreshIdeas();
    } finally {
      setLikingIdeaId(null);
    }
  };

  // Open & subscribe to selected peer chat room + linked map session
  useEffect(() => {
    if (!selectedChatPeer) {
      setActiveRoom(null);
      setActiveMapSession(null);
      return;
    }

    let cancelled = false;
    let unsubChat = () => {};
    let unsubMap = () => {};
    const roomCode = getSortedRoomCode(profile.ghost_number, selectedChatPeer.ghost_number);

    fetchMapSessionByRoom(roomCode).then((ms) => {
      if (!cancelled) setActiveMapSession(ms);
    });

    unsubMap = subscribeToMapSessions(() => {
      fetchMapSessionByRoom(roomCode).then((ms) => {
        if (!cancelled) setActiveMapSession(ms);
      });
    });

    openOrCreateChatRoom(profile.ghost_number, selectedChatPeer.ghost_number)
      .then((room) => {
        if (cancelled) return;
        setActiveRoom(room);
        setChatError('');
        onRefreshProfile();
        loadConversations();
        unsubChat = subscribeToChatRoom(room.room_code, (updated) => {
          if (!updated) {
            onSelectChatPeer(null);
            loadConversations();
            return;
          }
          setActiveRoom(updated);
        });
      })
      .catch((err: any) => {
        if (!cancelled) {
          setChatError(err?.message || 'Could not open chat room.');
        }
      });

    return () => {
      cancelled = true;
      unsubChat();
      unsubMap();
    };
  }, [selectedChatPeer?.ghost_number, profile.ghost_number]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeRoom?.messages.length]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearchError('');
    setSearchResult(null);
    setSearchFriendReq(null);
    const norm = normalizeGhostNumber(searchInput);
    if (!norm) {
      setSearchError('Enter a GH-XXXX number (e.g. GH-4821).');
      return;
    }
    setSearching(true);
    try {
      const found = await searchByGhostNumber(norm);
      if (!found) {
        setSearchError('Number Not Found');
      } else {
        setSearchResult(found);
        if (found.ghost_number !== profile.ghost_number) {
          const rel = await getFriendRequestBetween(profile.ghost_number, found.ghost_number);
          setSearchFriendReq(rel);
        }
      }
    } catch (err: any) {
      setSearchError(err?.message || 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const handleSendFriendRequest = async (peer: GhostRoomProfile) => {
    if (peer.ghost_number === profile.ghost_number) {
      setSearchError('That is your own GH-Number.');
      return;
    }
    setFriendBusy(peer.ghost_number);
    setSearchError('');
    try {
      const req = await sendFriendRequest(profile, peer);
      setSearchFriendReq(req);
      await loadFriendRequestsAndContacts();
    } catch (err: any) {
      setSearchError(err?.message || 'Could not send friend request.');
    } finally {
      setFriendBusy(null);
    }
  };

  const handleRespondFriendRequest = async (senderGh: string, accept: boolean) => {
    setFriendBusy(senderGh);
    setSearchError('');
    try {
      const updated = await respondToFriendRequest({
        responder: profile,
        senderGh,
        accept,
      });
      if (searchResult?.ghost_number === senderGh) {
        setSearchFriendReq(updated);
      }
      await loadFriendRequestsAndContacts();
      await onRefreshProfile();
    } catch (err: any) {
      setSearchError(err?.message || 'Could not respond to friend request.');
    } finally {
      setFriendBusy(null);
    }
  };

  const openChatWithPeer = async (peer: GhostRoomProfile) => {
    if (peer.ghost_number === profile.ghost_number) {
      setSearchError('That is your own GH-Number.');
      return;
    }
    const confirmed = await areUsersFriends(profile.ghost_number, peer.ghost_number);
    if (!confirmed) {
      setSearchError('Chat is blocked until your friend request is accepted.');
      return;
    }
    onSelectChatPeer(peer);
    onChatOpened();
  };

  const handleOpenByGh = async (gh: string, fallbackName?: string, fallbackPic?: string) => {
    const confirmed = await areUsersFriends(profile.ghost_number, gh);
    if (!confirmed) {
      setSearchError(`Send and accept a Friend Request with ${gh} before chatting.`);
      return;
    }
    const found = await searchByGhostNumber(gh).catch(() => null);
    const target: GhostRoomProfile = found || {
      ghost_number: gh,
      display_name: fallbackName || gh,
      profile_pic: fallbackPic || '',
      location: 'Unknown',
    };
    onSelectChatPeer(target);
    onChatOpened();
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChatPeer || !draftText.trim() || sending) return;
    const text = draftText.trim();
    setDraftText('');
    setSending(true);
    try {
      const updated = await sendChatMessage({
        myGhostNumber: profile.ghost_number,
        peerGhostNumber: selectedChatPeer.ghost_number,
        text,
      });
      setActiveRoom(updated);
      loadConversations();
      onMessageSent?.();
    } catch (err: any) {
      setChatError(err?.message || 'Failed to send.');
      setDraftText(text);
    } finally {
      setSending(false);
    }
  };

  const handleSendQuickGameInvite = async (gameType: FreeGameType) => {
    if (!selectedChatPeer || creatingGame) return;
    setCreatingGame(true);
    setChatError('');
    try {
      const { roomCode, link } = await createFreeGameRoom(profile.ghost_number, gameType);
      const label =
        gameType === 'rps'
          ? 'Rock Paper Scissors'
          : gameType === 'tictactoe'
          ? 'Tic Tac Toe'
          : 'Two Truths One Lie';
      const updated = await sendChatMessage({
        myGhostNumber: profile.ghost_number,
        peerGhostNumber: selectedChatPeer.ghost_number,
        text: `Let's play ${label}! Code: ${roomCode} — ${link}`,
        gameCode: roomCode,
        gameType,
        gameLink: link,
      });
      setActiveRoom(updated);
      setShowGamePicker(false);
      onJoinGameFromChat(roomCode);
    } catch (err: any) {
      setChatError(err?.message || 'Failed to create game room.');
    } finally {
      setCreatingGame(false);
    }
  };

  const handleInviteToMap = async () => {
    if (!selectedChatPeer || mapBusy) return;
    setMapBusy(true);
    setChatError('');
    try {
      if (activeMapSession?.status === 'accepted') {
        onOpenMap(activeMapSession.room_code);
      } else {
        const session = await sendMapInvite({
          inviter: profile,
          invitee: selectedChatPeer,
        });
        setActiveMapSession(session);
      }
    } catch (err: any) {
      setChatError(err?.message || 'Could not send map request.');
    } finally {
      setMapBusy(false);
    }
  };

  const handleRespondMap = async (accept: boolean) => {
    if (!selectedChatPeer || mapBusy) return;
    setMapBusy(true);
    try {
      const updated = await respondToMapInvite({
        responder: profile,
        peerGh: selectedChatPeer.ghost_number,
        accept,
      });
      setActiveMapSession(updated);
      if (accept && updated) {
        onOpenMap(updated.room_code);
      }
    } catch (err: any) {
      setChatError(err?.message || 'Could not respond to map request.');
    } finally {
      setMapBusy(false);
    }
  };

  const handleDeleteMessageAction = async (mode: 'me' | 'everyone') => {
    if (!selectedChatPeer || !messageMenuTarget || messageBusy) return;
    setMessageBusy(true);
    try {
      const updated = await deleteChatMessage({
        myGhostNumber: profile.ghost_number,
        peerGhostNumber: selectedChatPeer.ghost_number,
        messageId: messageMenuTarget.id,
        mode,
      });
      setActiveRoom(updated);
      setMessageMenuTarget(null);
      loadConversations();
    } catch (err: any) {
      setChatError(err?.message || 'Could not delete message.');
    } finally {
      setMessageBusy(false);
    }
  };

  const handleConfirmContactModeration = async () => {
    if (!confirmContactAction || contactBusy) return;
    const { peer, action } = confirmContactAction;
    setContactBusy(true);
    setSearchError('');
    try {
      if (action === 'block') {
        await blockContactUser(profile.ghost_number, peer.ghost_number);
      } else {
        await deleteContactUser(profile.ghost_number, peer.ghost_number);
      }
      if (selectedChatPeer?.ghost_number === peer.ghost_number) {
        onSelectChatPeer(null);
      }
      setConfirmContactAction(null);
      setContactMenuTarget(null);
      await Promise.all([loadFriendRequestsAndContacts(), loadConversations(), onRefreshProfile()]);
    } catch (err: any) {
      setSearchError(err?.message || 'Action failed.');
    } finally {
      setContactBusy(false);
    }
  };

  // ==================== ACTIVE WHATSAPP-STYLE DARK CHAT VIEW ====================
  if (selectedChatPeer) {
    const peerOnline = isUserOnline(selectedChatPeer.last_active);

    return (
      <div className="flex flex-col h-[calc(100vh-128px)] max-w-2xl mx-auto bg-[#0B141A] border border-white/10 rounded-2xl overflow-hidden">
        {/* Chat Header */}
        <div className="header bg-[#161F26] border-b border-white/10 px-3 py-2 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center space-x-2 min-w-0">
            <button
              type="button"
              onClick={() => onSelectChatPeer(null)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-white/10 text-zinc-200 cursor-pointer shrink-0"
              aria-label="Back to chats"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div
              className={`rounded-full ${
                selectedChatPeer.is_vip
                  ? 'p-0.5 ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.3)]'
                  : ''
              }`}
            >
              <GhostAvatarView config={selectedChatPeer.profile_pic} size={40} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-1.5 min-w-0">
                <h2 className="text-sm font-bold text-white truncate">
                  {selectedChatPeer.display_name}
                </h2>
                {selectedChatPeer.is_vip && <VipBadge />}
              </div>
              <p className="text-[11px] font-mono text-cyan-300 truncate">
                {selectedChatPeer.ghost_number} ·{' '}
                <span className={peerOnline ? 'text-emerald-400' : 'text-zinc-400'}>
                  {formatLastActiveText(selectedChatPeer.last_active)}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1 shrink-0">
            <button
              type="button"
              disabled={mapBusy}
              onClick={handleInviteToMap}
              className={`min-h-[40px] px-2.5 rounded-xl text-xs font-bold flex items-center space-x-1 cursor-pointer ${
                activeMapSession?.status === 'accepted'
                  ? 'bg-cyan-500 text-black'
                  : 'bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-300'
              }`}
              title="Invite to Live Map"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {activeMapSession?.status === 'accepted' ? 'Open Map' : 'Invite to Map'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setShowGamePicker((v) => !v)}
              className="min-w-[40px] min-h-[40px] px-2.5 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 flex items-center space-x-1 text-xs font-bold cursor-pointer"
              title="Send Free Game Invite"
            >
              <Gamepad2 className="w-4 h-4" />
              <span className="hidden sm:inline">Play</span>
            </button>
            <button
              type="button"
              onClick={() => onCallPeer(selectedChatPeer)}
              className="min-w-[40px] min-h-[40px] px-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-300 flex items-center space-x-1 text-xs font-bold cursor-pointer"
              title="Voice Call"
            >
              <Phone className="w-4 h-4" />
              <span className="hidden sm:inline">Call</span>
            </button>
          </div>
        </div>

        {/* Pending / Accepted Map Banner */}
        {activeMapSession && activeMapSession.status === 'pending' && (
          <div className="bg-[#111C28] border-b border-cyan-500/30 px-4 py-2.5 flex items-center justify-between gap-2 shrink-0">
            {activeMapSession.invitee === profile.ghost_number ? (
              <>
                <span className="text-xs font-semibold text-cyan-200">
                  {activeMapSession.inviter} invited you to share live locations on Map
                </span>
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    type="button"
                    disabled={mapBusy}
                    onClick={() => handleRespondMap(false)}
                    className="min-h-[36px] px-3 rounded-lg bg-rose-600/30 text-rose-200 text-xs font-bold cursor-pointer"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    disabled={mapBusy}
                    onClick={() => handleRespondMap(true)}
                    className="min-h-[36px] px-3 rounded-lg bg-emerald-500 text-black text-xs font-black cursor-pointer"
                  >
                    Accept
                  </button>
                </div>
              </>
            ) : (
              <span className="text-xs text-zinc-300">
                Map Request sent to {activeMapSession.invitee} (waiting for Accept)...
              </span>
            )}
          </div>
        )}

        {activeMapSession && activeMapSession.status === 'accepted' && (
          <div className="bg-[#0B2320] border-b border-emerald-500/30 px-4 py-2 flex items-center justify-between shrink-0">
            <span className="text-xs font-semibold text-emerald-300">
              Live Map Active with {selectedChatPeer.ghost_number}
            </span>
            <button
              type="button"
              onClick={() => onOpenMap(activeMapSession.room_code)}
              className="min-h-[34px] px-3 rounded-lg bg-emerald-400 text-black text-xs font-black cursor-pointer"
            >
              View Map &amp; Distance
            </button>
          </div>
        )}

        {/* Inline Free Game Picker */}
        {showGamePicker && (
          <div className="bg-[#140F22] border-b border-purple-500/30 p-3 space-y-2 shrink-0">
            <p className="text-xs font-bold text-purple-200">
              Invite {selectedChatPeer.ghost_number} to a Free Game
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={creatingGame}
                onClick={() => handleSendQuickGameInvite('rps')}
                className="min-h-[44px] px-2 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-bold text-white cursor-pointer"
              >
                ✊ RPS
              </button>
              <button
                type="button"
                disabled={creatingGame}
                onClick={() => handleSendQuickGameInvite('tictactoe')}
                className="min-h-[44px] px-2 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-bold text-white cursor-pointer"
              >
                ⭕ Tic Tac Toe
              </button>
              <button
                type="button"
                disabled={creatingGame}
                onClick={() => handleSendQuickGameInvite('twotruths')}
                className="min-h-[44px] px-2 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-bold text-white cursor-pointer"
              >
                🎭 2 Truths 1 Lie
              </button>
            </div>
          </div>
        )}

        {chatError && (
          <div className="bg-rose-950/80 border-b border-rose-500/30 px-4 py-2 text-xs text-rose-300 shrink-0">
            {chatError}
          </div>
        )}

        {/* Messages Feed */}
        <div className="chat-list flex-1 overflow-y-auto px-3 py-4 space-y-2.5">
          {(!activeRoom ||
            activeRoom.messages.filter(
              (m) => !Array.isArray(m.deleted_for) || !m.deleted_for.includes(profile.ghost_number)
            ).length === 0) && (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 space-y-2">
              <p className="text-sm font-semibold text-zinc-300">
                Private Room {activeRoom?.room_code || ''}
              </p>
              <p className="text-xs text-zinc-500">
                Personal chat is local only — messages stay on this device and are not saved in Supabase.
              </p>
            </div>
          )}

          {activeRoom?.messages
            .filter(
              (m) => !Array.isArray(m.deleted_for) || !m.deleted_for.includes(profile.ghost_number)
            )
            .map((m) => {
              const isMine = m.from === profile.ghost_number;
              const timeLabel = new Date(m.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              return (
                <div
                  key={m.id}
                  className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    onPointerDown={() => startLongPress(() => setMessageMenuTarget(m))}
                    onPointerUp={clearLongPress}
                    onPointerLeave={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      clearLongPress();
                      setMessageMenuTarget(m);
                    }}
                    title="Long-press to delete message"
                    className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm space-y-1.5 select-none cursor-pointer ${
                      isMine
                        ? 'bg-[#005C4B] text-white rounded-tr-sm'
                        : 'bg-[#1F2C34] text-zinc-100 rounded-tl-sm'
                    }`}
                  >
                    <p
                      className={`leading-relaxed break-words ${
                        m.deleted_for_everyone ? 'italic text-white/60 text-xs' : ''
                      }`}
                    >
                      {m.text}
                    </p>
                    {m.gameCode && !m.deleted_for_everyone && (
                      <button
                        type="button"
                        onClick={() => onJoinGameFromChat(m.gameCode!)}
                        className="w-full min-h-[38px] px-3 rounded-xl bg-black/35 hover:bg-black/55 border border-cyan-400/40 text-cyan-300 text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer"
                      >
                        <Gamepad2 className="w-3.5 h-3.5" />
                        <span>Join Game ({m.gameCode})</span>
                      </button>
                    )}
                    {m.mapSessionId && activeMapSession?.status === 'accepted' && !m.deleted_for_everyone && (
                      <button
                        type="button"
                        onClick={() => onOpenMap(activeMapSession.room_code)}
                        className="w-full min-h-[38px] px-3 rounded-xl bg-black/35 hover:bg-black/55 border border-emerald-400/40 text-emerald-300 text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        <span>Open Live Map</span>
                      </button>
                    )}
                    <div className="text-[10px] text-white/60 text-right tabular-nums">
                      {timeLabel}
                    </div>
                  </div>
                </div>
              );
            })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <form
          onSubmit={handleSendText}
          className="bg-[#161F26] border-t border-white/10 p-2.5 flex items-center space-x-2 shrink-0"
        >
          <input
            type="text"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder={`Message ${selectedChatPeer.ghost_number}...`}
            className="flex-1 min-h-[44px] px-4 rounded-2xl bg-[#202C33] text-white placeholder-zinc-400 text-sm focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draftText.trim() || sending}
            className="min-w-[48px] min-h-[44px] rounded-2xl bg-[#00A884] hover:bg-[#00bf96] text-black font-bold flex items-center justify-center cursor-pointer disabled:opacity-40"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        {/* Long-Press Delete Message Modal (Delete for Me / Delete for Everyone) */}
        {messageMenuTarget && (
          <div
            onClick={() => !messageBusy && setMessageMenuTarget(null)}
            className="fixed inset-0 z-[500] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-3xl bg-[#120D20] border border-white/15 p-5 space-y-3 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-white">Delete Message</h3>
                <button
                  type="button"
                  onClick={() => setMessageMenuTarget(null)}
                  className="text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-zinc-400 bg-black/45 rounded-xl px-3 py-2 truncate">
                {messageMenuTarget.text}
              </p>

              <button
                type="button"
                disabled={messageBusy}
                onClick={() => handleDeleteMessageAction('me')}
                className="w-full min-h-[46px] rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Trash2 className="w-4 h-4 text-zinc-300" />
                <span>{messageBusy ? 'Deleting...' : 'Delete for Me'}</span>
              </button>

              {messageMenuTarget.from === profile.ghost_number &&
                !messageMenuTarget.deleted_for_everyone && (
                  <button
                    type="button"
                    disabled={messageBusy}
                    onClick={() => handleDeleteMessageAction('everyone')}
                    className="w-full min-h-[46px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs flex items-center justify-center space-x-2 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{messageBusy ? 'Deleting...' : 'Delete for Everyone'}</span>
                  </button>
                )}

              <button
                type="button"
                disabled={messageBusy}
                onClick={() => setMessageMenuTarget(null)}
                className="w-full min-h-[42px] rounded-xl bg-transparent hover:bg-white/5 text-zinc-400 font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Filter recent chats & accepted notifications cleanly
  const acceptedOutgoing = outgoingRequests.filter((r) => r.status === 'accepted');
  const pendingOutgoing = outgoingRequests.filter((r) => r.status === 'pending');
  const declinedOutgoing = outgoingRequests.filter((r) => r.status === 'declined');

  // ==================== SEARCH + FRIEND REQUESTS + CONTACTS + CHATS + TRACKER ====================
  return (
    <div className="chats-container max-w-2xl mx-auto space-y-5 pb-4">
      {/* Live Receiver Notification Banner for Incoming Friend Requests */}
      {incomingRequests.length > 0 && (
        <div className="bg-purple-950/75 border-2 border-cyan-400/70 rounded-2xl p-4 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-cyan-300">
              <Bell className="w-4 h-4 animate-bounce" />
              <span className="text-xs font-black uppercase tracking-wider">
                New Friend Request ({incomingRequests.length})
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {incomingRequests.map((req) => (
              <div
                key={req.id}
                className="p-3 rounded-xl bg-black/50 border border-white/15 flex items-center justify-between gap-3"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div
                    className={`rounded-full shrink-0 ${
                      req.sender_is_vip ? 'p-0.5 ring-2 ring-amber-400' : ''
                    }`}
                  >
                    <GhostAvatarView config={req.sender_pic} size={42} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <p className="text-sm font-bold text-white truncate">
                        {req.sender_name || req.sender}
                      </p>
                      {req.sender_is_vip && <VipBadge />}
                    </div>
                    <p className="text-xs font-mono text-cyan-300">{req.sender}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={friendBusy === req.sender}
                    onClick={() => handleRespondFriendRequest(req.sender, true)}
                    className="min-h-[38px] px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs flex items-center space-x-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Accept</span>
                  </button>
                  <button
                    type="button"
                    disabled={friendBusy === req.sender}
                    onClick={() => handleRespondFriendRequest(req.sender, false)}
                    className="min-h-[38px] px-3 rounded-xl bg-rose-600/30 hover:bg-rose-600/50 border border-rose-500/40 text-rose-200 font-bold text-xs flex items-center space-x-1 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Decline</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-Tabs Navigation Bar inside Chats (Tap or Swipe Left/Right) */}
      <div className="tabs-bar border border-white/10">
        {(
          [
            { id: 'chats', label: 'Chats', count: conversations.length },
            { id: 'ideas', label: 'Ideas', count: ideas.length },
            { id: 'search', label: 'Search', count: pendingOutgoing.length },
            { id: 'tracker', label: 'Tracker', count: 0 },
            { id: 'contacts', label: 'Contacts', count: acceptedContacts.length },
          ] as const
        ).map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={`tab-button shrink-0 flex-1 min-w-[74px] min-h-[42px] px-2 text-[11px] sm:text-xs font-bold flex items-center justify-center space-x-1 cursor-pointer ${
                isActive
                  ? 'bg-[#7C3AED] text-white'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="truncate">{tab.label}</span>
              {tab.count > 0 && (
                <span
                  className={`text-[10px] font-mono tabular-nums ${
                    isActive ? 'text-cyan-200' : 'text-zinc-500'
                  }`}
                >
                  ({tab.count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Swipeable Area for Chats / Search Number / Room Tracker / Contacts */}
      <div
        className="swipe-area space-y-5 min-h-[320px]"
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
      >
      {/* Search GH-Number & Friend Requests Tab */}
      {activeSubTab === 'search' && (
      <>
      <div className="bg-[#120D20] border border-purple-500/30 rounded-2xl p-4 space-y-3">
        <label className="text-xs font-bold uppercase tracking-wider text-purple-300 block">
          Search GH-Number
        </label>
        <form onSubmit={handleSearch} className="flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
              placeholder="GH-1001"
              maxLength={14}
              className="w-full min-h-[46px] pl-10 pr-3 rounded-xl bg-black/60 border border-white/15 text-white placeholder-zinc-500 font-mono text-sm tracking-wider focus:outline-none focus:border-cyan-400"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="min-h-[46px] px-5 rounded-xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-black text-sm cursor-pointer disabled:opacity-50"
          >
            {searching ? '...' : 'Search'}
          </button>
        </form>

        {searchError && (
          <p className="text-xs text-rose-400 font-medium">{searchError}</p>
        )}

        {searchResult && (
          <div
            className={`mt-2 p-4 rounded-2xl bg-black/55 space-y-3 ${
              searchResult.is_vip
                ? 'border-2 border-amber-400 shadow-[0_0_22px_rgba(251,191,36,0.2)]'
                : 'border border-cyan-500/30'
            }`}
          >
            <div className="flex items-center space-x-3">
              <div
                className={`rounded-full shrink-0 ${
                  searchResult.is_vip
                    ? 'p-0.5 ring-2 ring-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.35)]'
                    : ''
                }`}
              >
                <GhostAvatarView config={searchResult.profile_pic} size={56} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center space-x-1.5 min-w-0">
                    <h3 className="text-base font-black text-white truncate">
                      {searchResult.display_name}
                    </h3>
                    {searchResult.is_vip && <VipBadge />}
                  </div>
                  <span
                    className={`text-[11px] font-semibold shrink-0 ${
                      isUserOnline(searchResult.last_active)
                        ? 'text-emerald-400'
                        : 'text-zinc-400'
                    }`}
                  >
                    {formatLastActiveText(searchResult.last_active)}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <p className="text-xs font-mono font-bold text-cyan-300">
                    {searchResult.ghost_number}
                  </p>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-[10px] font-black text-emerald-300 uppercase">
                    Live
                  </span>
                </div>
                <p className="text-xs text-zinc-400 flex items-center space-x-1 mt-0.5">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {searchResult.location_hidden ? 'Hidden' : searchResult.location || 'Hidden'}
                  </span>
                </p>
              </div>
            </div>

            {searchResult.ghost_number === profile.ghost_number ? (
              <p className="text-xs font-mono text-zinc-400 text-center py-1">
                This is your own GH-Number.
              </p>
            ) : searchFriendReq?.status === 'accepted' ? (
              <div className="space-y-2">
                <div className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-xs font-bold flex items-center space-x-1.5">
                  <UserCheck className="w-4 h-4 shrink-0" />
                  <span>Friend Request Accepted - Send Messages</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => openChatWithPeer(searchResult)}
                    className="min-h-[44px] rounded-xl bg-[#00A884] hover:bg-[#00bf96] text-black font-bold text-xs flex items-center justify-center space-x-1.5 cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onCallPeer(searchResult)}
                    className="min-h-[44px] rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-300 font-bold text-xs flex items-center justify-center space-x-1.5 cursor-pointer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Voice Call</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const { roomCode, link } = await createFreeGameRoom(
                          profile.ghost_number,
                          'rps'
                        );
                        await sendChatMessage({
                          myGhostNumber: profile.ghost_number,
                          peerGhostNumber: searchResult.ghost_number,
                          text: `Let's play Rock Paper Scissors! Code: ${roomCode} — ${link}`,
                          gameCode: roomCode,
                          gameType: 'rps',
                          gameLink: link,
                        });
                        onJoinGameFromChat(roomCode);
                      } catch (err: any) {
                        setSearchError(err?.message || 'Could not start game.');
                      }
                    }}
                    className="min-h-[44px] rounded-xl bg-purple-600/30 hover:bg-purple-600/45 border border-purple-400/40 text-purple-200 font-bold text-xs flex items-center justify-center space-x-1.5 cursor-pointer"
                  >
                    <Gamepad2 className="w-3.5 h-3.5" />
                    <span>Play</span>
                  </button>
                </div>
              </div>
            ) : searchFriendReq?.status === 'pending' ? (
              searchFriendReq.sender === profile.ghost_number ? (
                <div className="space-y-2">
                  <div className="px-3.5 py-2.5 rounded-xl bg-amber-500/15 border border-amber-400/40 text-amber-200 text-xs font-bold flex items-center justify-between">
                    <span>Friend Request Sent (Pending)</span>
                    <span className="inline-flex items-center space-x-1 text-[11px] text-zinc-400">
                      <Lock className="w-3 h-3" />
                      <span>Chat Locked</span>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-cyan-300">
                    {searchResult.display_name} sent you a Friend Request
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={friendBusy === searchResult.ghost_number}
                      onClick={() => handleRespondFriendRequest(searchResult.ghost_number, true)}
                      className="min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs flex items-center justify-center space-x-1.5 cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>Accept</span>
                    </button>
                    <button
                      type="button"
                      disabled={friendBusy === searchResult.ghost_number}
                      onClick={() => handleRespondFriendRequest(searchResult.ghost_number, false)}
                      className="min-h-[44px] rounded-xl bg-rose-600/30 hover:bg-rose-600/50 border border-rose-500/40 text-rose-200 font-bold text-xs flex items-center justify-center space-x-1.5 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                      <span>Decline</span>
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div className="space-y-2">
                {searchFriendReq?.status === 'declined' && (
                  <p className="text-xs text-rose-400 font-semibold">
                    Friend request declined — no chat or contact saved.
                  </p>
                )}
                {/* Before Accept: ONLY Send Friend Request button shown */}
                <button
                  type="button"
                  disabled={friendBusy === searchResult.ghost_number}
                  onClick={() => handleSendFriendRequest(searchResult)}
                  className="w-full min-h-[46px] rounded-xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-black text-xs flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>
                    {friendBusy === searchResult.ghost_number
                      ? 'Sending Friend Request...'
                      : 'Send Friend Request'}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Friend Requests List (Pending + Outgoing Statuses) */}
      {(incomingRequests.length > 0 || pendingOutgoing.length > 0 || acceptedOutgoing.length > 0 || declinedOutgoing.length > 0) && (
        <div className="bg-[#120D20] border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <UserPlus className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-white">Friend Requests</h2>
            </div>
            <span className="text-xs font-mono text-zinc-400">
              {incomingRequests.length} incoming · {pendingOutgoing.length} pending
            </span>
          </div>

          <div className="divide-y divide-white/10">
            {acceptedOutgoing.map((req) => (
              <div
                key={`acc-${req.id}`}
                className="px-4 py-3 flex items-center justify-between gap-3 bg-emerald-950/20"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div
                    className={`rounded-full shrink-0 ${
                      req.receiver_is_vip ? 'p-0.5 ring-2 ring-amber-400' : ''
                    }`}
                  >
                    <GhostAvatarView config={req.receiver_pic} size={40} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <p className="text-sm font-bold text-white truncate">
                        {req.receiver_name || req.receiver}
                      </p>
                      {req.receiver_is_vip && <VipBadge />}
                      <span className="font-mono text-xs text-cyan-300 shrink-0">
                        ({req.receiver})
                      </span>
                    </div>
                    <p className="text-xs font-bold text-emerald-400">
                      Friend Request Accepted - Send Messages
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleOpenByGh(req.receiver, req.receiver_name, req.receiver_pic)
                  }
                  className="min-h-[38px] px-3.5 rounded-xl bg-[#00A884] hover:bg-[#00bf96] text-black font-black text-xs flex items-center space-x-1.5 cursor-pointer shrink-0"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Chat</span>
                </button>
              </div>
            ))}

            {pendingOutgoing.map((req) => (
              <div key={`pend-${req.id}`} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center space-x-3 min-w-0">
                  <div
                    className={`rounded-full shrink-0 ${
                      req.receiver_is_vip ? 'p-0.5 ring-2 ring-amber-400' : ''
                    }`}
                  >
                    <GhostAvatarView config={req.receiver_pic} size={40} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <p className="text-sm font-bold text-white truncate">
                        {req.receiver_name || req.receiver}
                      </p>
                      {req.receiver_is_vip && <VipBadge />}
                    </div>
                    <p className="text-xs font-mono text-amber-300">
                      {req.receiver} · Pending approval
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-[11px] font-bold text-zinc-400 shrink-0">
                  <Lock className="w-3 h-3" />
                  <span>Chat Locked</span>
                </span>
              </div>
            ))}

            {declinedOutgoing.map((req) => (
              <div key={`dec-${req.id}`} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center space-x-3 min-w-0">
                  <GhostAvatarView config={req.receiver_pic} size={40} />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">
                      {req.receiver_name || req.receiver}
                    </p>
                    <p className="text-xs font-mono text-rose-400">
                      {req.receiver} · Declined (no chat, not saved)
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </>
      )}

      {/* Contacts Section (Own Tab inside Chats) */}
      {activeSubTab === 'contacts' && (
      <div className="bg-[#120D20] border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Users className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">Contacts</h2>
            <span className="text-xs font-mono text-zinc-400 tabular-nums">
              ({acceptedContacts.length})
            </span>
          </div>
          <span className="text-[11px] text-zinc-400">Hold contact to Block / Delete</span>
        </div>

        {acceptedContacts.length === 0 ? (
          <div className="p-5 text-center text-xs text-zinc-400">
            No contacts yet. Search a GH-Number and send a Friend Request to unlock Chat.
          </div>
        ) : (
          <div className="chat-list py-1">
            {acceptedContacts.map((contact) => (
              <div
                key={contact.ghost_number}
                onPointerDown={() =>
                  startLongPress(() =>
                    setContactMenuTarget({
                      ghost_number: contact.ghost_number,
                      display_name: contact.display_name,
                    })
                  )
                }
                onPointerUp={clearLongPress}
                onPointerLeave={clearLongPress}
                onPointerCancel={clearLongPress}
                onContextMenu={(e) => {
                  e.preventDefault();
                  clearLongPress();
                  setContactMenuTarget({
                    ghost_number: contact.ghost_number,
                    display_name: contact.display_name,
                  });
                }}
                title="Long-press to Block or Delete user"
                className="chat-item flex items-center justify-between gap-3 select-none hover:bg-white/5"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <div
                    className={`rounded-full shrink-0 ${
                      contact.is_vip ? 'p-0.5 ring-2 ring-amber-400' : ''
                    }`}
                  >
                    <GhostAvatarView config={contact.profile_pic} size={42} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center space-x-1.5 min-w-0">
                      <p className="text-sm font-bold text-white truncate">
                        {contact.display_name}
                      </p>
                      {contact.is_vip && <VipBadge />}
                    </div>
                    <p className="text-xs font-mono text-cyan-300 truncate">
                      {contact.ghost_number} ·{' '}
                      <span
                        className={
                          isUserOnline(contact.last_active) ? 'text-emerald-400' : 'text-zinc-400'
                        }
                      >
                        {formatLastActiveText(contact.last_active)}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => openChatWithPeer(contact)}
                    className="min-h-[40px] px-3 rounded-xl bg-[#00A884] hover:bg-[#00bf96] text-black font-black text-xs flex items-center space-x-1 cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Chat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onCallPeer(contact)}
                    className="min-w-[40px] min-h-[40px] rounded-xl bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 flex items-center justify-center cursor-pointer"
                    aria-label={`Call ${contact.ghost_number}`}
                  >
                    <Phone className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Recent Chats Section */}
      {activeSubTab === 'chats' && (
      <div className="bg-[#120D20] border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-white">Chats</h2>
            <span className="text-xs font-mono text-zinc-400 tabular-nums">
              ({conversations.length})
            </span>
          </div>
          <button
            type="button"
            onClick={() => onOpenMap()}
            className="min-h-[36px] px-3 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/30 text-cyan-300 text-xs font-bold flex items-center space-x-1.5 cursor-pointer"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>Map</span>
          </button>
        </div>

        {conversations.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-400">
            Accepted friends appear here once you start messaging.
          </div>
        ) : (
          <div className="chat-list py-1">
            {conversations.map((conv) => (
              <div
                key={conv.room_code}
                onPointerDown={() =>
                  startLongPress(() =>
                    setContactMenuTarget({
                      ghost_number: conv.peer_ghost_number,
                      display_name: conv.peer_name,
                    })
                  )
                }
                onPointerUp={clearLongPress}
                onPointerLeave={clearLongPress}
                onPointerCancel={clearLongPress}
                onContextMenu={(e) => {
                  e.preventDefault();
                  clearLongPress();
                  setContactMenuTarget({
                    ghost_number: conv.peer_ghost_number,
                    display_name: conv.peer_name,
                  });
                }}
                className="chat-item flex items-center justify-between gap-3 hover:bg-white/5 select-none"
              >
                <button
                  type="button"
                  onClick={() =>
                    handleOpenByGh(conv.peer_ghost_number, conv.peer_name, conv.peer_pic)
                  }
                  className="flex items-center space-x-3 min-w-0 flex-1 text-left cursor-pointer"
                >
                  <div
                    className={`rounded-full shrink-0 ${
                      conv.peer_is_vip
                        ? 'p-0.5 ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.28)]'
                        : ''
                    }`}
                  >
                    <GhostAvatarView config={conv.peer_pic} size={44} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center space-x-1.5 min-w-0">
                        <p className="text-sm font-bold text-white truncate">
                          {conv.peer_name}
                        </p>
                        {conv.peer_is_vip && <VipBadge />}
                      </div>
                      <span
                        className={`text-[10px] font-semibold shrink-0 ${
                          isUserOnline(conv.peer_last_active)
                            ? 'text-emerald-400'
                            : 'text-zinc-400'
                        }`}
                      >
                        {formatLastActiveText(conv.peer_last_active)}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 truncate mt-0.5">{conv.last_message}</p>
                    <p className="text-[10px] font-mono text-zinc-400 tabular-nums mt-0.5">
                      {conv.peer_ghost_number} ·{' '}
                      {new Date(conv.last_timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onCallPeer({
                      ghost_number: conv.peer_ghost_number,
                      display_name: conv.peer_name,
                      profile_pic: conv.peer_pic,
                      location: 'Unknown',
                    })
                  }
                  className="min-w-[44px] min-h-[44px] rounded-xl bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 flex items-center justify-center cursor-pointer shrink-0"
                  aria-label={`Call ${conv.peer_ghost_number}`}
                >
                  <Phone className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Room Tracker Section (24h auto-delete) */}
      {activeSubTab === 'tracker' && (
      <div className="bg-[#120D20] border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white">Room Tracker</h2>
          </div>
          <span className="text-[11px] text-zinc-400">Auto-deletes in 24h</span>
        </div>

        {tracker.length === 0 ? (
          <div className="p-5 text-center text-xs text-zinc-400">
            No chat or call history yet.
          </div>
        ) : (
          <div className="divide-y divide-white/10">
            {tracker.slice(0, 12).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleOpenByGh(item.peer_ghost_number, item.peer_name)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/5 transition cursor-pointer"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{item.summary}</p>
                  <p className="text-[11px] font-mono text-amber-300/80 tabular-nums mt-0.5">
                    {formatDeletesInCountdown(item.expires_at, item.timestamp)}
                  </p>
                </div>
                <span className="text-[11px] text-zinc-400 tabular-nums shrink-0 ml-2">
                  {new Date(item.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      )}
      {/* Share Ideas Section (Text Post + Like + Saved in Supabase by Ghost Number) */}
      {activeSubTab === 'ideas' && (
      <div className="bg-[#120D20] border border-white/10 rounded-2xl overflow-hidden p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Lightbulb className="w-4 h-4 text-amber-300" />
            <h2 className="text-sm font-bold text-white">Share Ideas</h2>
            <span className="text-xs font-mono text-zinc-400 tabular-nums">
              ({ideas.length})
            </span>
          </div>
          <span className="text-[11px] font-mono text-cyan-300">
            {profile.ghost_number}
          </span>
        </div>

        <form onSubmit={handlePostIdea} className="flex items-center space-x-2">
          <input
            type="text"
            value={newIdea}
            onChange={(e) => setNewIdea(e.target.value)}
            placeholder="Share your idea..."
            maxLength={320}
            className="flex-1 min-h-[46px] px-3.5 rounded-xl bg-black/60 border border-white/15 text-white placeholder-zinc-500 text-sm focus:outline-none focus:border-cyan-400"
          />
          <button
            type="submit"
            disabled={!newIdea.trim() || postingIdea}
            className="min-h-[46px] px-4 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] text-black font-black text-xs sm:text-sm cursor-pointer disabled:opacity-50 shrink-0"
          >
            {postingIdea ? 'Posting...' : 'Post Idea'}
          </button>
        </form>

        {ideasError && (
          <p className="text-xs text-rose-400 font-medium">{ideasError}</p>
        )}

        {ideas.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-400">
            No ideas posted yet. Share an idea so all your friends can see and like it.
          </div>
        ) : (
          <div className="space-y-2.5">
            {ideas.map((idea) => (
              <div key={idea.id} className="idea-card space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-mono font-bold text-cyan-300">
                    <b>{idea.ghost_number}</b>
                  </p>
                  <div className="flex items-center space-x-2 text-[10px] text-zinc-400 tabular-nums">
                    <span className="inline-flex items-center space-x-1 text-amber-300/90">
                      <Clock className="w-3 h-3" />
                      <span>{formatDeletesInCountdown(idea.expires_at, idea.created_at)}</span>
                    </span>
                    <span className="text-zinc-500">
                      {new Date(idea.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-white leading-relaxed break-words">{idea.text}</p>
                <div className="pt-1 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={likingIdeaId === idea.id}
                    onClick={() => handleLikeIdea(idea.id, idea.likes)}
                    className="min-h-[36px] px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-200 text-xs font-bold inline-flex items-center space-x-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <Heart className="w-3.5 h-3.5 fill-rose-400 text-rose-400" />
                    <span>❤️ Like {idea.likes}</span>
                  </button>
                  <span className="text-[10px] font-mono text-zinc-500">Auto-deletes in 24h</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
      </div>

      {/* Real Google AdMob Banner (Free users only; hidden if VIP or if AdMob has no fill) */}
      <AdMobBanner isVip={isVip} placement="chats" />

      {/* Long-Press Contact Action Sheet: Block User / Delete User */}
      {contactMenuTarget && !confirmContactAction && (
        <div
          onClick={() => setContactMenuTarget(null)}
          className="fixed inset-0 z-[500] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-[#120D20] border border-white/15 p-5 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white">{contactMenuTarget.display_name}</h3>
                <p className="text-xs font-mono text-cyan-300">{contactMenuTarget.ghost_number}</p>
              </div>
              <button
                type="button"
                onClick={() => setContactMenuTarget(null)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() =>
                setConfirmContactAction({
                  peer: contactMenuTarget,
                  action: 'block',
                })
              }
              className="w-full min-h-[46px] rounded-xl bg-amber-600/25 hover:bg-amber-600/40 border border-amber-500/40 text-amber-200 font-black text-xs flex items-center justify-center space-x-2 cursor-pointer"
            >
              <Ban className="w-4 h-4" />
              <span>Block User</span>
            </button>

            <button
              type="button"
              onClick={() =>
                setConfirmContactAction({
                  peer: contactMenuTarget,
                  action: 'delete',
                })
              }
              className="w-full min-h-[46px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs flex items-center justify-center space-x-2 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete User</span>
            </button>

            <button
              type="button"
              onClick={() => setContactMenuTarget(null)}
              className="w-full min-h-[42px] rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 font-bold text-xs cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal: "Are you sure?" */}
      {confirmContactAction && (
        <div className="fixed inset-0 z-[520] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-3xl bg-[#120D20] border-2 border-rose-500/70 p-5 space-y-4 shadow-2xl">
            <h3 className="text-lg font-black text-white">Are you sure?</h3>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {confirmContactAction.action === 'block'
                ? `Block ${confirmContactAction.peer.display_name} (${confirmContactAction.peer.ghost_number})? They will be removed from your contacts and blocked from messaging, calling, or sending you friend requests.`
                : `Delete ${confirmContactAction.peer.display_name} (${confirmContactAction.peer.ghost_number})? This removes them from your contacts and deletes your chat history.`}
            </p>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                disabled={contactBusy}
                onClick={() => setConfirmContactAction(null)}
                className="flex-1 min-h-[44px] rounded-xl bg-white/10 hover:bg-white/15 text-zinc-200 font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={contactBusy}
                onClick={handleConfirmContactModeration}
                className="flex-1 min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs cursor-pointer disabled:opacity-50"
              >
                {contactBusy
                  ? 'Please wait...'
                  : confirmContactAction.action === 'block'
                  ? 'Block User'
                  : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
