import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Crown, Gamepad2, MapPin, MessageSquare, ShieldAlert, User } from 'lucide-react';
import { ActiveCallState, GhostRoomProfile, VipRoomRecord } from './types';
import {
  clearLocalGhostSession,
  fetchFriendRequestsForUser,
  fetchGhostProfile,
  fetchVipRoom,
  getCachedGhostProfile,
  getEffectivePaidTag,
  getSavedGhostNumber,
  hasActiveVipBadge,
  isEmailInDeletedBlocklist,
  isMainVipActive,
  isStoredSessionExpired,
  purgeExpiredRooms,
  saveLiveGhostNumberRecord,
  saveLocalGhostSession,
  startGhostCallRow,
  subscribeToFriendRequests,
  subscribeToMyCallRow,
  subscribeToUserInbox,
  updateCallStatusBoth,
  updatePresenceHeartbeat,
} from './services/roomService';
import { extractGameCodeFromInput } from './utils/ghostNumber';
import { WebRTCCallSession } from './utils/webrtcManager';
import {
  PhoneRingTonePlayer,
  playConnectedChime,
  playHangupTone,
  stopAllActiveRingtones,
} from './utils/audioTones';
import { SplashScreen } from './components/SplashScreen';
import { OnboardingFlow } from './components/OnboardingFlow';
import { GhostedRoomTab } from './components/GhostedRoomTab';
import { GamesTab } from './components/GamesTab';
import { VipRoomTab } from './components/VipRoomTab';
import { LocationTab } from './components/LocationTab';
import { ProfileTab } from './components/ProfileTab';
import { CallModal } from './components/CallModal';
import { MapModal } from './components/MapModal';
import { AdMobInterstitialOverlay } from './components/AdMobComponents';
import {
  shouldTriggerCallEndInterstitial,
  shouldTriggerGamesInterstitial,
  shouldTriggerMapInterstitial,
} from './services/admobService';

type ActiveTab = 'chats' | 'games' | 'vip' | 'location' | 'profile';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [profile, setProfile] = useState<GhostRoomProfile | null>(() => getCachedGhostProfile());
  const [vipRecord, setVipRecord] = useState<VipRoomRecord | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [accountDeletedEmail, setAccountDeletedEmail] = useState<string | null>(null);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState<string | null>(null);
  const [pendingFriendCount, setPendingFriendCount] = useState(0);
  const [, setExpiryTick] = useState(0);

  const [activeTab, setActiveTab] = useState<ActiveTab>('chats');
  const [selectedChatPeer, setSelectedChatPeer] = useState<GhostRoomProfile | null>(null);
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && /\/game\//i.test(window.location.pathname)) {
      const code = extractGameCodeFromInput(window.location.pathname);
      return code || null;
    }
    return null;
  });

  // Live Interactive Map modal state
  const [showMapModal, setShowMapModal] = useState(false);
  const [mapFocusRoom, setMapFocusRoom] = useState<string | null>(null);

  // Real Google AdMob / IMA Interstitial state (FREE users only)
  const [showInterstitial, setShowInterstitial] = useState(false);

  // Voice Call state
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const rtcRef = useRef<WebRTCCallSession | null>(null);
  const ringPlayerRef = useRef<PhoneRingTonePlayer | null>(null);
  const activeCallRef = useRef<ActiveCallState | null>(null);

  // ONLY Main VIP stops ads; Game VIP gives badge but STILL sees ads + 10s countdown
  const isVip = isMainVipActive(vipRecord, profile);
  const hasVipBadge = hasActiveVipBadge(vipRecord, profile);
  const paidTag = getEffectivePaidTag(vipRecord, profile);
  const isVipRef = useRef(isVip);

  useEffect(() => {
    isVipRef.current = isVip;
  }, [isVip]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    if (pendingJoinCode && profile) {
      setActiveTab('games');
    }
  }, [pendingJoinCode, profile]);

  const refreshProfileAndVip = useCallback(async (ghNumber?: string) => {
    const target = ghNumber || getSavedGhostNumber();
    if (!target) {
      setBootLoading(false);
      return;
    }
    if (!ghNumber && isStoredSessionExpired()) {
      clearLocalGhostSession();
      setProfile(null);
      setVipRecord(null);
      setSessionExpiredNotice('Your 30-day session expired. Please sign in again.');
      setBootLoading(false);
      return;
    }
    const freshProfile = await fetchGhostProfile(target);
    if (!freshProfile) {
      clearLocalGhostSession();
      setProfile(null);
      setVipRecord(null);
      setBootLoading(false);
      return;
    }
    if (freshProfile.email && (await isEmailInDeletedBlocklist(freshProfile.email))) {
      clearLocalGhostSession();
      setProfile(null);
      setVipRecord(null);
      setBootLoading(false);
      return;
    }
    setProfile(freshProfile);
    saveLocalGhostSession(freshProfile);
    saveLiveGhostNumberRecord({
      ghostNumber: freshProfile.ghost_number,
      displayName: freshProfile.display_name,
      profilePic: freshProfile.profile_pic,
      location: freshProfile.location,
      locationHidden: freshProfile.location_hidden,
      status: 'active',
    }).catch(() => {});
    const vip = await fetchVipRoom(freshProfile.ghost_number);
    setVipRecord(vip);
    setBootLoading(false);
  }, []);

  useEffect(() => {
    refreshProfileAndVip();
  }, [refreshProfileAndVip]);

  // Periodic presence heartbeat (30s), 24h auto-delete purge & VIP expiry enforcement (60s),
  // plus 15s local expiry tick so expired VIP badges/ads update promptly.
  useEffect(() => {
    if (!profile?.ghost_number) return;
    const gh = profile.ghost_number;

    updatePresenceHeartbeat(gh);
    purgeExpiredRooms(gh);

    const heartbeatTimer = setInterval(() => {
      updatePresenceHeartbeat(gh);
    }, 30000);

    const sweepTimer = setInterval(() => {
      purgeExpiredRooms(gh);
      fetchVipRoom(gh).then((vip) => setVipRecord(vip));
    }, 60000);

    const tickTimer = setInterval(() => {
      setExpiryTick((t) => t + 1);
    }, 15000);

    fetchFriendRequestsForUser(gh).then((res) => {
      setPendingFriendCount(res.incomingPending.length);
    });
    const unsubFriends = subscribeToFriendRequests(gh, () => {
      fetchFriendRequestsForUser(gh).then((res) => {
        setPendingFriendCount(res.incomingPending.length);
      });
    });
    const unsubInbox = subscribeToUserInbox(gh);

    return () => {
      clearInterval(heartbeatTimer);
      clearInterval(sweepTimer);
      clearInterval(tickTimer);
      unsubFriends();
      unsubInbox();
    };
  }, [profile?.ghost_number]);

  // Call duration counter
  useEffect(() => {
    if (activeCall?.status !== 'active') return;
    const timer = setInterval(() => {
      setActiveCall((prev) =>
        prev && prev.status === 'active'
          ? { ...prev, durationSeconds: prev.durationSeconds + 1 }
          : prev
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [activeCall?.status]);

  const cleanupCallLocal = useCallback(() => {
    activeCallRef.current = null;
    stopAllActiveRingtones();
    ringPlayerRef.current?.stop();
    ringPlayerRef.current = null;
    rtcRef.current?.cleanup();
    rtcRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setActiveCall(null);
  }, []);

  const gamesPlayedCountRef = useRef<number>(0);
  const mapOpenCountRef = useRef<number>(0);

  const showAd = useCallback(() => {
    if (!isVipRef.current) {
      setShowInterstitial(true);
    }
  }, []);

  const triggerInterstitialIfFree = useCallback(() => {
    if (shouldTriggerCallEndInterstitial(isVipRef.current)) {
      showAd();
    }
  }, [showAd]);

  const handleGameFinishedForAds = useCallback(() => {
    if (isVipRef.current) return;
    const next = gamesPlayedCountRef.current + 1;
    gamesPlayedCountRef.current = next;
    if (shouldTriggerGamesInterstitial(false, next)) {
      showAd();
    }
  }, [showAd]);

  const trackFriendMapOpenForAds = useCallback(() => {
    if (isVipRef.current) return;
    const next = mapOpenCountRef.current + 1;
    mapOpenCountRef.current = next;
    if (shouldTriggerMapInterstitial(false, next)) {
      showAd();
    }
  }, [showAd]);

  const handleIncomingRing = useCallback(async (callerGh: string, roomCode: string) => {
    if (activeCallRef.current) return;
    const callerProfile = await fetchGhostProfile(callerGh);
    const ring = new PhoneRingTonePlayer();
    ringPlayerRef.current = ring;
    ring.start();

    setActiveCall({
      roomCode,
      peerGhostNumber: callerGh,
      peerName: callerProfile?.display_name || callerGh,
      peerPic: callerProfile?.profile_pic || '',
      direction: 'incoming',
      status: 'ringing',
      durationSeconds: 0,
      isMuted: false,
      isSpeakerOn: true,
    });
  }, []);

  // Subscribe to Realtime incoming calls & live call status updates on `ghosted_room`
  useEffect(() => {
    if (!profile?.ghost_number) return;
    const gh = profile.ghost_number;

    const unsub = subscribeToMyCallRow(
      gh,
      (callerGh, roomCode) => {
        handleIncomingRing(callerGh, roomCode);
      },
      (status) => {
        const current = activeCallRef.current;
        if (!current) return;

        if (status === 'active') {
          if (current.status !== 'active') {
            stopAllActiveRingtones();
            ringPlayerRef.current?.stop();
            ringPlayerRef.current = null;
            playConnectedChime();
            setActiveCall((prev) => (prev ? { ...prev, status: 'active' } : null));
          }
        } else if (status === 'ended' || status === 'idle') {
          playHangupTone();
          cleanupCallLocal();
          triggerInterstitialIfFree();
        }
      }
    );

    return () => {
      unsub();
    };
  }, [profile?.ghost_number, handleIncomingRing, cleanupCallLocal, triggerInterstitialIfFree]);

  const handleStartCall = async (peer: GhostRoomProfile) => {
    if (!profile || activeCall) return;
    try {
      setIsMuted(false);
      setActiveCall({
        roomCode: '',
        peerGhostNumber: peer.ghost_number,
        peerName: peer.display_name,
        peerPic: peer.profile_pic,
        direction: 'outgoing',
        status: 'calling',
        durationSeconds: 0,
        isMuted: false,
        isSpeakerOn: true,
      });

      const { roomCode } = await startGhostCallRow(profile.ghost_number, peer.ghost_number);

      const ring = new PhoneRingTonePlayer();
      ringPlayerRef.current = ring;
      ring.start();

      const session = new WebRTCCallSession({
        onLocalStream: (stream) => setLocalStream(stream),
        onRemoteStream: (stream) => setRemoteStream(stream),
        onStatusChange: (nextStatus) => {
          if (nextStatus === 'active') {
            stopAllActiveRingtones();
            ringPlayerRef.current?.stop();
            ringPlayerRef.current = null;
            playConnectedChime();
            setActiveCall((prev) => (prev ? { ...prev, status: 'active' } : null));
          } else if (nextStatus === 'ended') {
            if (!activeCallRef.current) return;
            playHangupTone();
            cleanupCallLocal();
            triggerInterstitialIfFree();
          }
        },
      });

      rtcRef.current = session;
      if (activeCallRef.current?.isMuted) {
        session.setMuted(true);
      }
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              roomCode,
              status: prev.status === 'active' ? 'active' : 'ringing',
            }
          : null
      );

      await session.startOutgoing(roomCode, profile.ghost_number, peer.ghost_number);
      session.setMuted(Boolean(activeCallRef.current?.isMuted));
      refreshProfileAndVip(profile.ghost_number);
    } catch (err: any) {
      cleanupCallLocal();
      console.error('Start call failed:', err);
    }
  };

  const handleAcceptIncomingCall = async () => {
    if (!profile || !activeCall) return;
    stopAllActiveRingtones();
    ringPlayerRef.current?.stop();
    ringPlayerRef.current = null;
    playConnectedChime();

    const session = new WebRTCCallSession({
      onLocalStream: (stream) => setLocalStream(stream),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onStatusChange: (nextStatus) => {
        if (nextStatus === 'ended') {
          if (!activeCallRef.current) return;
          playHangupTone();
          cleanupCallLocal();
          triggerInterstitialIfFree();
        }
      },
    });
    rtcRef.current = session;
    if (activeCallRef.current?.isMuted) {
      session.setMuted(true);
    }

    setActiveCall((prev) => (prev ? { ...prev, status: 'active' } : null));
    await updateCallStatusBoth(
      profile.ghost_number,
      activeCall.peerGhostNumber,
      activeCall.roomCode,
      'active'
    );
    await session.answerIncoming(
      activeCall.roomCode,
      profile.ghost_number,
      activeCall.peerGhostNumber
    );
    session.setMuted(Boolean(activeCallRef.current?.isMuted));
  };

  const handleDeclineOrEndCall = async () => {
    const current = activeCallRef.current;
    playHangupTone();
    await rtcRef.current?.sendHangup();
    cleanupCallLocal();
    if (profile && current) {
      await updateCallStatusBoth(
        profile.ghost_number,
        current.peerGhostNumber,
        current.roomCode,
        'idle'
      );
      triggerInterstitialIfFree();
    }
  };

  const handleToggleMute = () => {
    const newMuted = !(activeCallRef.current?.isMuted ?? isMuted);
    setIsMuted(newMuted);
    setActiveCall((prev) => (prev ? { ...prev, isMuted: newMuted } : null));
    if (rtcRef.current) {
      rtcRef.current.setMuted(newMuted);
    }
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !newMuted;
    });
  };

  const handleToggleSpeaker = () => {
    setActiveCall((prev) => (prev ? { ...prev, isSpeakerOn: !prev.isSpeakerOn } : null));
  };

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} durationMs={1600} />;
  }

  if (bootLoading && !profile) {
    return (
      <div className="min-h-screen bg-[#090710] text-white flex items-center justify-center text-sm font-mono">
        Connecting to Ghosted Room...
      </div>
    );
  }

  if (accountDeletedEmail !== null) {
    return (
      <div className="min-h-screen bg-[#090710] text-white flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-[#120D20] border-2 border-rose-500/60 rounded-3xl p-6 text-center space-y-5 shadow-2xl">
          <div className="w-16 h-16 mx-auto rounded-full bg-rose-600/20 border-2 border-rose-500 flex items-center justify-center text-rose-400">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-white">Account Deleted</h1>
            <p className="text-xs text-zinc-300 leading-relaxed">
              All your Ghosted data (profile, chats, messages, ghosted_room, location, VIP, and Auth
              account) has been permanently deleted.
            </p>
            {accountDeletedEmail && (
              <p className="text-xs font-mono text-rose-300 bg-rose-950/50 border border-rose-500/30 rounded-xl px-3 py-2">
                Blocked email: {accountDeletedEmail}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setAccountDeletedEmail(null)}
            className="w-full min-h-[48px] rounded-2xl bg-white/10 hover:bg-white/15 text-white font-bold text-sm cursor-pointer transition"
          >
            Back to Sign Up / Sign In
          </button>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <OnboardingFlow
        sessionExpiredNotice={sessionExpiredNotice}
        onComplete={(newProfile) => {
          setAccountDeletedEmail(null);
          setSessionExpiredNotice(null);
          setProfile(newProfile);
          setActiveTab('chats');
          fetchVipRoom(newProfile.ghost_number).then(setVipRecord);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--bg)] text-white flex flex-col">
      {/* Compact Sticky Top Bar (under 15% viewport height) */}
      <header className="header sticky top-0 z-30 shrink-0 bg-[#0f0f0f] border-b border-white/10 px-4 h-14 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-base font-black tracking-tight text-white">GHOSTED</span>
          {hasVipBadge && (
            <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-amber-400/20 border border-amber-400/70 text-[10px] font-black text-amber-300 uppercase tracking-wider shadow-[0_0_10px_rgba(251,191,36,0.22)]">
              <span aria-hidden="true" className="leading-none">
                👑
              </span>
              <span>VIP</span>
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setActiveTab('profile')}
          className="min-h-[36px] px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-mono font-bold text-cyan-300 flex items-center space-x-1.5 cursor-pointer"
        >
          <span>{profile.gh_number_hidden ? 'GH-XXXX' : profile.ghost_number}</span>
          {paidTag && (
            <span className="px-1.5 py-0.5 rounded bg-amber-400/20 border border-amber-400/50 text-[10px] font-black text-amber-300">
              {paidTag}
            </span>
          )}
        </button>
      </header>

      {/* Main Content */}
      <main className={`flex-1 pb-24 ${activeTab === 'location' ? 'px-0 pt-2' : 'px-3 sm:px-4 pt-4'}`}>
        {activeTab === 'chats' && (
          <GhostedRoomTab
            profile={profile}
            isVip={isVip}
            selectedChatPeer={selectedChatPeer}
            onSelectChatPeer={setSelectedChatPeer}
            onChatOpened={() => {}}
            onMessageSent={() => {}}
            onCallPeer={handleStartCall}
            onJoinGameFromChat={(code) => {
              setPendingJoinCode(code);
              setActiveTab('games');
            }}
            onOpenMap={(roomCode) => {
              setMapFocusRoom(roomCode || null);
              trackFriendMapOpenForAds();
              setActiveTab('location');
            }}
            onRefreshProfile={() => refreshProfileAndVip(profile.ghost_number)}
          />
        )}

        {activeTab === 'games' && (
          <GamesTab
            profile={profile}
            vipRecord={vipRecord}
            isVip={isVip}
            pendingJoinCode={pendingJoinCode}
            onClearPendingJoinCode={() => setPendingJoinCode(null)}
            onVipUpdated={(next) => setVipRecord(next)}
            onGameFinished={handleGameFinishedForAds}
          />
        )}

        {activeTab === 'vip' && (
          <VipRoomTab
            profile={profile}
            vipRecord={vipRecord}
            onVipUpdated={(next) => setVipRecord(next)}
            onGameFinished={handleGameFinishedForAds}
          />
        )}

        {activeTab === 'location' && (
          <LocationTab
            profile={profile}
            focusRoomCode={mapFocusRoom}
            onProfileUpdated={(next) => setProfile(next)}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileTab
            profile={profile}
            vipRecord={vipRecord}
            onProfileUpdated={(next) => setProfile(next)}
            onSignOut={() => {
              clearLocalGhostSession();
              setProfile(null);
              setVipRecord(null);
              setSelectedChatPeer(null);
            }}
            onAccountDeleted={(deletedEmail) => {
              clearLocalGhostSession();
              setProfile(null);
              setVipRecord(null);
              setSelectedChatPeer(null);
              setAccountDeletedEmail(deletedEmail || '');
            }}
          />
        )}
      </main>

      {/* Bottom 5-Tab Navigation Bar: Chats | Games | VIP Room | Location | Profile */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-[#0f0f0f] border-t border-white/10 px-1.5 h-16 flex items-center justify-around">
        {(
          [
            { id: 'chats', label: 'Chats', Icon: MessageSquare },
            { id: 'games', label: 'Games', Icon: Gamepad2 },
            { id: 'vip', label: 'VIP Room', Icon: Crown },
            { id: 'location', label: 'Location', Icon: MapPin },
            { id: 'profile', label: 'Profile', Icon: User },
          ] as const
        ).map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (id === 'location' && activeTab !== 'location') {
                  trackFriendMapOpenForAds();
                }
                setActiveTab(id);
              }}
              className={`relative flex-1 min-w-0 min-h-[48px] flex flex-col items-center justify-center space-y-1 rounded-xl transition cursor-pointer ${
                active
                  ? id === 'vip'
                    ? 'text-amber-300'
                    : 'text-cyan-300'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {id === 'chats' && pendingFriendCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
                    {pendingFriendCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] sm:text-[11px] font-bold truncate">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Active / Incoming Call Modal */}
      {activeCall && (
        <CallModal
          call={activeCall}
          remoteStream={remoteStream}
          onAccept={handleAcceptIncomingCall}
          onDeclineOrEnd={handleDeclineOrEndCall}
          onToggleMute={handleToggleMute}
          onToggleSpeaker={handleToggleSpeaker}
        />
      )}

      {/* Interactive Leaflet Map Modal */}
      {showMapModal && (
        <MapModal
          profile={profile}
          focusRoomCode={mapFocusRoom}
          onClose={() => {
            setShowMapModal(false);
            setMapFocusRoom(null);
          }}
        />
      )}

      {/* Real Google AdMob Interstitial Ad (FREE users only, 15s total / X after 10s) */}
      <AdMobInterstitialOverlay
        open={showInterstitial}
        isVip={isVip}
        onClose={() => setShowInterstitial(false)}
        onUpgradeVip={() => setActiveTab('vip')}
      />
    </div>
  );
}
