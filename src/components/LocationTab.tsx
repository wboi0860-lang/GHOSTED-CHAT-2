import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Crosshair,
  Eye,
  EyeOff,
  GripHorizontal,
  Layers,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  StopCircle,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  GhostRoomProfile,
  MapParticipant,
  MapSessionData,
} from '../types';
import {
  applyPrivacyOffset,
  fetchAllMapSessionsForUser,
  fetchFriendRequestsForUser,
  getDistance,
  leaveMapSession,
  requestUserGeoCoords,
  respondToMapInvite,
  sendMapInvite,
  subscribeToMapSessions,
  updateGhostProfile,
  updateMyMapCoordinates,
  updateSoloLocationSharing,
} from '../services/roomService';
import { GhostAvatarView } from './GhostAvatarView';
import { getSortedRoomCode } from '../utils/ghostNumber';
import { VipBadge } from './VipBadge';

interface LocationTabProps {
  profile: GhostRoomProfile;
  focusRoomCode?: string | null;
  onProfileUpdated: (next: GhostRoomProfile) => void;
}

type LocationConsentState = 'asking' | 'granted' | 'denied' | 'stopped';
type MapStyle = 'street' | 'satellite';

export const LocationTab: React.FC<LocationTabProps> = ({
  profile,
  focusRoomCode,
  onProfileUpdated,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const hasCenteredOnceRef = useRef(false);
  const lastRemotePushRef = useRef(0);

  const [hasCenteredOnce, setHasCenteredOnce] = useState(false);
  const [followUser, setFollowUser] = useState(false);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [mapStyle, setMapStyle] = useState<MapStyle>('street');
  const [locationConsent, setLocationConsent] = useState<LocationConsentState>('asking');
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [myCoords, setMyCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [allSessions, setAllSessions] = useState<MapSessionData[]>([]);
  const [friendsList, setFriendsList] = useState<GhostRoomProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyPeer, setBusyPeer] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState('');
  const [stoppedFriendNotice, setStoppedFriendNotice] = useState<string | null>(null);
  const dismissedStoppedAtRef = useRef<Record<string, string>>({});

  // User-editable Location text & Hide/Show privacy toggle
  const [myLocationText, setMyLocationText] = useState(
    profile.location === 'Hidden' ? '' : profile.location || ''
  );
  const [savingLoc, setSavingLoc] = useState(false);

  // Invite Friend modal (FRIENDS ONLY — never strangers or all users)
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [friendFilterQuery, setFriendFilterQuery] = useState('');

  // Mutual consent ONLY: both users must have accepted AND both must be active participants
  const acceptedSessions = allSessions.filter((s) => {
    const peerGh = s.inviter === profile.ghost_number ? s.invitee : s.inviter;
    return (
      s.status === 'accepted' &&
      Boolean(s.participants?.[profile.ghost_number]) &&
      Boolean(s.participants?.[peerGh])
    );
  });

  const acceptedRoomCodesRef = useRef<string[]>([]);
  const acceptedRoomCodesKey = acceptedSessions
    .map((s) => s.room_code)
    .sort()
    .join(',');

  useEffect(() => {
    acceptedRoomCodesRef.current = acceptedSessions.map((s) => s.room_code);
  }, [acceptedSessions]);

  const stopGeoWatcher = useCallback(() => {
    if (
      watchIdRef.current !== null &&
      typeof navigator !== 'undefined' &&
      navigator.geolocation
    ) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const loadData = useCallback(async () => {
    const [sessionsList, friendData] = await Promise.all([
      fetchAllMapSessionsForUser(profile.ghost_number),
      fetchFriendRequestsForUser(profile.ghost_number),
    ]);
    setAllSessions(sessionsList);
    setFriendsList(friendData.acceptedContacts);
    setLoading(false);

    // Notify immediately if a friend tapped Stop Sharing
    const stoppedByFriend = sessionsList.find(
      (s) =>
        s.status === 'stopped' &&
        Boolean(s.stopped_by) &&
        s.stopped_by !== profile.ghost_number &&
        s.stopped_at &&
        dismissedStoppedAtRef.current[s.room_code] !== s.stopped_at
    );
    if (stoppedByFriend) {
      setStoppedFriendNotice('Friend stopped sharing');
    }

    return sessionsList;
  }, [profile.ghost_number]);

  const pushCoordsToSupabase = useCallback(
    async (coords: { lat: number; lng: number }, force = false) => {
      const now = Date.now();
      if (!force && now - lastRemotePushRef.current < 2800) return;
      lastRemotePushRef.current = now;
      await updateMyMapCoordinates(profile, acceptedRoomCodesRef.current, coords).catch(() => {});
    },
    [profile]
  );

  const startLiveGpsWatch = useCallback(
    (initialCoords: { lat: number; lng: number }) => {
      stopGeoWatcher();
      try {
        localStorage.removeItem('ghosted_loc_stopped');
      } catch {}
      setMyCoords(initialCoords);
      setLocationConsent('granted');

      pushCoordsToSupabase(initialCoords, true);

      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => {
            const nextCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            setMyCoords(nextCoords);
            pushCoordsToSupabase(nextCoords);
          },
          () => {},
          {
            enableHighAccuracy: true,
            maximumAge: 4000,
            timeout: 10000,
          }
        );
      }
    },
    [pushCoordsToSupabase, stopGeoWatcher]
  );

  const handleAllowLocation = async (): Promise<{ lat: number; lng: number } | null> => {
    setRequestingPerm(true);
    setStatusNotice('');
    try {
      try {
        localStorage.removeItem('ghosted_loc_stopped');
      } catch {}
      const res = await requestUserGeoCoords();
      if (!res.granted) {
        stopGeoWatcher();
        setMyCoords(null);
        setLocationConsent('denied');
        await updateSoloLocationSharing({ me: profile, sharing: false, coords: null });
        setStatusNotice('Location permission denied. Map stays empty until you allow location.');
        return null;
      }
      startLiveGpsWatch(res.coords);
      return res.coords;
    } finally {
      setRequestingPerm(false);
    }
  };

  const handleDenyLocation = async () => {
    stopGeoWatcher();
    try {
      localStorage.setItem('ghosted_loc_stopped', 'true');
    } catch {}
    setMyCoords(null);
    setLocationConsent('denied');
    await updateSoloLocationSharing({ me: profile, sharing: false, coords: null });
    setStatusNotice('Location access declined. Map remains empty.');
  };

  // Auto-resume GPS if browser permission was already granted and user didn't Stop Sharing
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem('ghosted_loc_stopped') === 'true') return;
        if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
        const perm = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        if (!cancelled && perm.state === 'granted') {
          const res = await requestUserGeoCoords();
          if (!cancelled && res.granted) {
            startLiveGpsWatch(res.coords);
          }
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [startLiveGpsWatch]);

  // Immediately push my latest fuzzy coords into newly accepted sessions even if stationary
  useEffect(() => {
    if (locationConsent === 'granted' && myCoords && acceptedRoomCodesKey) {
      pushCoordsToSupabase(myCoords, true);
    }
  }, [acceptedRoomCodesKey, locationConsent, myCoords, pushCoordsToSupabase]);

  // Center ONLY ONCE when user location first arrives; do not follow afterwards
  useEffect(() => {
    if (locationConsent === 'granted' && myCoords && !hasCenteredOnce) {
      const fuzzy = applyPrivacyOffset(myCoords);
      setMapCenter(fuzzy);
      setHasCenteredOnce(true);
      hasCenteredOnceRef.current = true;
      setFollowUser(false);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([fuzzy.lat, fuzzy.lng], 15, {
          animate: true,
        });
      }
    }
  }, [myCoords, locationConsent, hasCenteredOnce]);

  const handleMyLocationClick = useCallback(async () => {
    if (locationConsent !== 'granted') {
      const coords = await handleAllowLocation();
      if (coords && mapInstanceRef.current) {
        const fuzzy = applyPrivacyOffset(coords);
        setMapCenter(fuzzy);
        mapInstanceRef.current.setView([fuzzy.lat, fuzzy.lng], 15, { animate: true });
      }
      return;
    }

    if (myCoords && mapInstanceRef.current) {
      const fuzzy = applyPrivacyOffset(myCoords);
      setMapCenter(fuzzy);
      mapInstanceRef.current.setView([fuzzy.lat, fuzzy.lng], 15, { animate: true });
    }

    const res = await requestUserGeoCoords().catch(() => null);
    if (res?.granted) {
      const fuzzy = applyPrivacyOffset(res.coords);
      setMyCoords(res.coords);
      setMapCenter(fuzzy);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([fuzzy.lat, fuzzy.lng], 15, { animate: true });
      }
      pushCoordsToSupabase(res.coords, true);
    }
  }, [locationConsent, myCoords, pushCoordsToSupabase]);

  const handleRefreshGps = useCallback(async () => {
    if (locationConsent !== 'granted') {
      await handleAllowLocation();
      return;
    }
    setRefreshing(true);
    try {
      const res = await requestUserGeoCoords();
      if (!res.granted) {
        stopGeoWatcher();
        setMyCoords(null);
        setLocationConsent('denied');
        return;
      }
      setMyCoords(res.coords);
      await pushCoordsToSupabase(res.coords, true);
      await loadData();
    } finally {
      setRefreshing(false);
    }
  }, [locationConsent, loadData, pushCoordsToSupabase, stopGeoWatcher]);

  useEffect(() => {
    loadData();
    const unsub = subscribeToMapSessions(() => {
      loadData();
    });
    const pollInterval = setInterval(() => {
      loadData();
    }, 3000);
    return () => {
      clearInterval(pollInterval);
      stopGeoWatcher();
      unsub();
    };
  }, [loadData, stopGeoWatcher]);

  // Initialize Leaflet Map once (scrollWheelZoom: false, dragging: true, attributionControl: false)
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [6.5244, 3.3792],
      zoom: 13,
      zoomControl: false,
      scrollWheelZoom: false,
      dragging: true,
      attributionControl: false,
    });

    L.control.zoom({ position: 'topleft' }).addTo(map);

    map.on('dragstart', () => {
      setFollowUser(false);
    });
    map.on('zoomstart', () => {
      setFollowUser(false);
    });

    const group = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;
    layerGroupRef.current = group;

    const resizeTimer = setTimeout(() => {
      map.invalidateSize();
    }, 150);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
      observer = new ResizeObserver(() => {
        map.invalidateSize();
      });
      observer.observe(mapContainerRef.current);
    }

    return () => {
      clearTimeout(resizeTimer);
      observer?.disconnect();
      map.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // Street / Satellite tile layer switcher
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    let fallbackActivated = false;

    if (mapStyle === 'satellite') {
      const satLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 19 }
      ).addTo(map);

      satLayer.on('tileerror', () => {
        if (!fallbackActivated) {
          fallbackActivated = true;
          tileLayerRef.current = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
          }).addTo(map);
        }
      });
      tileLayerRef.current = satLayer;
    } else {
      const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      osmLayer.on('tileerror', () => {
        if (!fallbackActivated) {
          fallbackActivated = true;
          tileLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            subdomains: 'abc',
            maxZoom: 19,
          }).addTo(map);
        }
      });
      tileLayerRef.current = osmLayer;
    }
  }, [mapStyle]);

  // Draw map pins ONLY when user opted in (`locationConsent === 'granted'` + `myCoords` present):
  // - Alone -> ONLY You pin
  // - Mutual consent accepted -> You pin + Accepted Friend pin + PURPLE LINE + live km/m distance
  useEffect(() => {
    const map = mapInstanceRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    // Map MUST stay completely empty unless user opted-in and allowed location
    if (locationConsent !== 'granted' || !myCoords) {
      return;
    }

    const orderedAccepted = focusRoomCode
      ? [...acceptedSessions].sort((a, b) =>
          a.room_code === focusRoomCode ? -1 : b.room_code === focusRoomCode ? 1 : 0
        )
      : acceptedSessions;

    const activePeers = new Map<string, MapParticipant>();
    orderedAccepted.forEach((s) => {
      const peerGh = s.inviter === profile.ghost_number ? s.invitee : s.inviter;
      const peer = s.participants?.[peerGh];
      if (peer && typeof peer.lat === 'number' && typeof peer.lng === 'number') {
        activePeers.set(peer.ghost_number, peer);
      }
    });

    const myFuzzyCoords = applyPrivacyOffset(myCoords);
    const boundsPoints: L.LatLngExpression[] = [];
    const myLatLng: [number, number] = [myFuzzyCoords.lat, myFuzzyCoords.lng];
    boundsPoints.push(myLatLng);

    // 1. User A's Pin ("You") — plotted with privacy offset
    const myHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
        <div style="width:28px;height:28px;border-radius:9999px;background:#2563EB;border:4px solid #FFFFFF;box-shadow:0 0 20px rgba(37,99,235,0.95),0 2px 10px rgba(0,0,0,0.45);"></div>
        <span style="margin-top:6px;padding:3px 10px;border-radius:9999px;background:#1E3A8A;color:#FFFFFF;font-family:ui-monospace,monospace;font-size:12px;font-weight:900;white-space:nowrap;border:2px solid #FFFFFF;box-shadow:0 4px 12px rgba(0,0,0,0.5);">
          You (${profile.ghost_number})
        </span>
      </div>
    `;

    L.marker(myLatLng, {
      icon: L.divIcon({
        html: myHtml,
        className: 'ghosted-map-pin',
        iconSize: [0, 0],
      }),
    }).addTo(group);

    // 2. Accepted Friend Pin(s) + PURPLE LINE (#A855F7) + live km/m distance
    activePeers.forEach((p) => {
      const peerLatLng: [number, number] = [p.lat, p.lng];
      boundsPoints.push(peerLatLng);

      const peerHtml = `
        <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
          <div style="width:26px;height:26px;border-radius:9999px;background:#A855F7;border:4px solid #FFFFFF;box-shadow:0 0 18px rgba(168,85,247,0.95),0 2px 10px rgba(0,0,0,0.45);"></div>
          <span style="margin-top:6px;padding:3px 10px;border-radius:9999px;background:#581C87;color:#FFFFFF;font-family:ui-monospace,monospace;font-size:12px;font-weight:900;white-space:nowrap;border:2px solid #FFFFFF;box-shadow:0 4px 12px rgba(0,0,0,0.5);">
            ${p.display_name} (${p.ghost_number})
          </span>
        </div>
      `;

      L.marker(peerLatLng, {
        icon: L.divIcon({
          html: peerHtml,
          className: 'ghosted-map-pin',
          iconSize: [0, 0],
        }),
      }).addTo(group);

      const distLabel = getDistance(myFuzzyCoords.lat, myFuzzyCoords.lng, p.lat, p.lng);
      const line = L.polyline(
        [
          [myFuzzyCoords.lat, myFuzzyCoords.lng],
          [p.lat, p.lng],
        ],
        {
          color: '#A855F7',
          weight: 4,
          opacity: 0.95,
        }
      ).addTo(group);

      line.bindTooltip(distLabel, {
        permanent: true,
        direction: 'center',
        className: 'ghosted-dist-tooltip',
      });
    });

    // Respect user drag/zoom: only fit/center automatically if not yet centered once
    if (!hasCenteredOnceRef.current && boundsPoints.length > 0) {
      hasCenteredOnceRef.current = true;
      setHasCenteredOnce(true);
      setMapCenter(myFuzzyCoords);
      if (boundsPoints.length === 1) {
        map.setView(boundsPoints[0], 15);
      } else {
        map.fitBounds(L.latLngBounds(boundsPoints), { padding: [56, 56], maxZoom: 15 });
      }
    }
  }, [acceptedSessions, myCoords, locationConsent, focusRoomCode, profile.ghost_number]);

  const handleSaveMyLocationText = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLoc(true);
    try {
      const updated = await updateGhostProfile(profile.ghost_number, {
        location: myLocationText.trim() || 'Unknown',
        location_hidden: false,
      });
      onProfileUpdated(updated);
      setStatusNotice(`Saved location: ${updated.location}`);
    } catch (err: any) {
      setStatusNotice(err?.message || 'Could not save location.');
    } finally {
      setSavingLoc(false);
    }
  };

  const handleToggleHideMyLocation = async () => {
    try {
      const nextHidden = !profile.location_hidden;
      const updated = await updateGhostProfile(profile.ghost_number, {
        location_hidden: nextHidden,
        ...(!nextHidden && myLocationText.trim() ? { location: myLocationText.trim() } : {}),
      });
      onProfileUpdated(updated);
      setStatusNotice(
        nextHidden ? 'Your profile location is now Hidden.' : 'Your profile location is now visible.'
      );
    } catch (err: any) {
      setStatusNotice(err?.message || 'Could not update location privacy.');
    }
  };

  const handleInviteFriend = async (friend: GhostRoomProfile) => {
    setBusyPeer(friend.ghost_number);
    setStatusNotice('');
    try {
      let coords = myCoords;
      if (!coords || locationConsent !== 'granted') {
        coords = await handleAllowLocation();
        if (!coords) {
          setBusyPeer(null);
          return;
        }
      }
      await sendMapInvite({ inviter: profile, invitee: friend, coordsOverride: coords });
      setStatusNotice(
        `Map invite sent to ${friend.display_name} (${friend.ghost_number}). They won't appear until they tap Accept.`
      );
      setShowInviteModal(false);
      setFriendFilterQuery('');
      await loadData();
    } catch (err: any) {
      setStatusNotice(err?.message || 'Could not send map invite.');
    } finally {
      setBusyPeer(null);
    }
  };

  const handleRespondInvite = async (peerGh: string, accept: boolean) => {
    setBusyPeer(peerGh);
    setStatusNotice('');
    try {
      let coords = myCoords;
      if (accept && (!coords || locationConsent !== 'granted')) {
        coords = await handleAllowLocation();
        if (!coords) {
          setBusyPeer(null);
          return;
        }
      }
      await respondToMapInvite({
        responder: profile,
        peerGh,
        accept,
        coordsOverride: coords || undefined,
      });
      setStatusNotice(
        accept
          ? `Accepted ${peerGh} — both of you are now live on the Map.`
          : `Declined map request from ${peerGh}. Location stays hidden.`
      );
      await loadData();
    } catch (err: any) {
      setStatusNotice(err?.message || 'Could not update map request.');
    } finally {
      setBusyPeer(null);
    }
  };

  const handleStopSharingSession = async (roomCode: string) => {
    await leaveMapSession(profile.ghost_number, roomCode);
    const remaining = acceptedSessions.filter((s) => s.room_code !== roomCode);
    if (remaining.length === 0) {
      stopGeoWatcher();
      try {
        localStorage.setItem('ghosted_loc_stopped', 'true');
      } catch {}
      setMyCoords(null);
      setLocationConsent('stopped');
      await updateSoloLocationSharing({ me: profile, sharing: false, coords: null });
    }
    setStatusNotice('You stopped sharing your location.');
    await loadData();
  };

  const handleStopAllSharing = async () => {
    for (const s of acceptedSessions) {
      await leaveMapSession(profile.ghost_number, s.room_code);
    }
    stopGeoWatcher();
    try {
      localStorage.setItem('ghosted_loc_stopped', 'true');
    } catch {}
    setMyCoords(null);
    setLocationConsent('stopped');
    await updateSoloLocationSharing({ me: profile, sharing: false, coords: null });
    setStatusNotice('Stopped sharing. Your location is removed from the map.');
    await loadData();
  };

  const myFuzzyCoords = myCoords ? applyPrivacyOffset(myCoords) : null;

  const activePeerRows: Array<{
    roomCode: string;
    peer: MapParticipant;
    distanceLabel: string;
  }> = [];

  if (locationConsent === 'granted' && myFuzzyCoords) {
    acceptedSessions.forEach((s) => {
      const peerGh = s.inviter === profile.ghost_number ? s.invitee : s.inviter;
      const p = s.participants?.[peerGh];
      if (p) {
        activePeerRows.push({
          roomCode: s.room_code,
          peer: p,
          distanceLabel: getDistance(myFuzzyCoords.lat, myFuzzyCoords.lng, p.lat, p.lng),
        });
      }
    });
  }

  const livePinCount =
    locationConsent === 'granted' && myFuzzyCoords ? 1 + activePeerRows.length : 0;

  const incomingPending = allSessions.filter(
    (s) => s.status === 'pending' && s.invitee === profile.ghost_number
  );

  const filteredFriends = friendsList.filter((f) => {
    const q = friendFilterQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      f.display_name.toLowerCase().includes(q) ||
      f.ghost_number.toLowerCase().includes(q)
    );
  });

  return (
    <div className="w-full space-y-4 pb-6">
      {/* Top Bar Above Map */}
      <div className="px-3 sm:px-4 pr-16 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center space-x-2">
            <h2 className="text-lg font-black text-white">Friend Map</h2>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-black border ${
                locationConsent === 'granted'
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                  : locationConsent === 'denied'
                  ? 'bg-rose-500/20 border-rose-400/50 text-rose-300'
                  : 'bg-zinc-800 border-white/20 text-zinc-300'
              }`}
            >
              {locationConsent === 'granted'
                ? 'Location: Live'
                : locationConsent === 'denied'
                ? 'Permission Denied'
                : locationConsent === 'stopped'
                ? 'Sharing Stopped'
                : 'Map Empty'}
            </span>
          </div>
          <p className="text-xs font-mono text-zinc-400 mt-0.5">
            {livePinCount} {livePinCount === 1 ? 'pin' : 'pins'} live · Mutual consent friends only
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="grid grid-cols-2 p-1 rounded-xl bg-[#120D20] border border-white/15">
            <button
              type="button"
              onClick={() => setMapStyle('street')}
              className={`min-h-[34px] px-2.5 rounded-lg text-[11px] font-black cursor-pointer flex items-center justify-center space-x-1 ${
                mapStyle === 'street' ? 'bg-cyan-400 text-black' : 'text-zinc-300'
              }`}
            >
              <MapPin className="w-3 h-3" />
              <span>Street</span>
            </button>
            <button
              type="button"
              onClick={() => setMapStyle('satellite')}
              className={`min-h-[34px] px-2.5 rounded-lg text-[11px] font-black cursor-pointer flex items-center justify-center space-x-1 ${
                mapStyle === 'satellite' ? 'bg-cyan-400 text-black' : 'text-zinc-300'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>Satellite</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setFriendFilterQuery('');
              setShowInviteModal(true);
            }}
            className="min-h-[42px] px-3.5 rounded-xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black text-xs font-black flex items-center space-x-1.5 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Invite Friend</span>
          </button>

          {(locationConsent === 'granted' || acceptedSessions.length > 0) && (
            <button
              type="button"
              onClick={handleStopAllSharing}
              className="min-h-[42px] px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black flex items-center space-x-1.5 cursor-pointer shadow-lg shadow-rose-950/40"
            >
              <StopCircle className="w-4 h-4" />
              <span>Stop Sharing</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleMyLocationClick}
            disabled={requestingPerm}
            className="min-h-[42px] px-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-black text-white flex items-center space-x-1.5 cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>My Location</span>
          </button>

          <button
            type="button"
            onClick={handleRefreshGps}
            disabled={refreshing || requestingPerm}
            className="min-h-[42px] px-3 rounded-xl bg-[#120D20] hover:bg-white/10 border border-white/15 text-xs font-bold text-white flex items-center space-x-1.5 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-cyan-300 ${refreshing ? 'animate-spin' : ''}`}
            />
            <span>{locationConsent === 'granted' ? 'Refresh GPS' : 'Allow Location'}</span>
          </button>
        </div>
      </div>

      {/* Friend Stopped Sharing Banner */}
      {stoppedFriendNotice && (
        <div className="px-3 sm:px-4">
          <div className="p-3.5 rounded-2xl bg-amber-950/70 border-2 border-amber-400/60 flex items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <StopCircle className="w-4 h-4 text-amber-300 shrink-0" />
              <span className="text-xs font-black text-amber-100">{stoppedFriendNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                allSessions.forEach((s) => {
                  if (s.status === 'stopped' && s.stopped_at) {
                    dismissedStoppedAtRef.current[s.room_code] = s.stopped_at;
                  }
                });
                setStoppedFriendNotice(null);
              }}
              className="min-w-[32px] min-h-[32px] rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-amber-200 cursor-pointer"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Incoming Pending Map Requests Banner */}
      {incomingPending.length > 0 && (
        <div className="px-3 sm:px-4 space-y-2">
          {incomingPending.map((req) => (
            <div
              key={req.session_id}
              className="p-3.5 rounded-2xl bg-purple-950/70 border-2 border-purple-400/50 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center space-x-2">
                <Navigation className="w-4 h-4 text-cyan-300 shrink-0" />
                <span className="text-xs font-bold text-white">
                  {req.inviter} invited you to share live Location on Map
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  disabled={busyPeer === req.inviter || requestingPerm}
                  onClick={() => handleRespondInvite(req.inviter, true)}
                  className="min-h-[38px] px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs flex items-center space-x-1 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Accept</span>
                </button>
                <button
                  type="button"
                  disabled={busyPeer === req.inviter}
                  onClick={() => handleRespondInvite(req.inviter, false)}
                  className="min-h-[38px] px-3.5 rounded-xl bg-rose-600/30 hover:bg-rose-600/50 border border-rose-500/40 text-rose-200 font-bold text-xs flex items-center space-x-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Decline</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FULL-WIDTH 420PX MAP — EMPTY BY DEFAULT UNLESS USER OPTS IN */}
      <div className="px-2 sm:px-3">
        <div
          className={`map-container relative w-full h-[420px] border-t-4 border-purple-500/80 ${
            mapStyle === 'satellite' ? 'bg-[#090710]' : 'bg-[#E5E3DF]'
          }`}
        >
          <div
            ref={mapContainerRef}
            data-follow-user={followUser ? 'true' : 'false'}
            data-map-center={mapCenter ? `${mapCenter.lat},${mapCenter.lng}` : ''}
            className="w-full h-full z-10"
          />

          {/* Live Pin Counter + Distance Badge */}
          <div className="absolute top-3 right-3 z-[400] flex flex-col items-end space-y-1.5 pointer-events-none">
            <div className="px-3 py-1.5 rounded-xl bg-[#090716]/90 border-2 border-purple-400/70 text-xs font-mono font-black text-purple-200 shadow-lg">
              {livePinCount} {livePinCount === 1 ? 'pin' : 'pins'} live
            </div>
            {activePeerRows[0] && (
              <div className="distance-badge shadow-lg">
                📍 {activePeerRows[0].distanceLabel}
              </div>
            )}
          </div>

          {/* Floating My Location Button (Only centers when pressed) */}
          {locationConsent === 'granted' && (
            <button
              type="button"
              onClick={handleMyLocationClick}
              className="absolute bottom-3 left-3 z-[400] min-h-[40px] px-3.5 rounded-xl bg-[#090716]/95 hover:bg-[#17112B] border-2 border-cyan-400/80 text-xs font-black text-cyan-200 flex items-center space-x-1.5 shadow-lg cursor-pointer"
            >
              <Crosshair className="w-3.5 h-3.5 text-cyan-300" />
              <span>My Location</span>
            </button>
          )}

          {/* Explicit "Allow location?" Opt-In Overlay when map is empty */}
          {locationConsent !== 'granted' && (
            <div className="absolute inset-0 z-[410] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-3xl bg-[#120D20] border-2 border-purple-500/60 p-5 text-center space-y-4 shadow-2xl">
                <div className="w-12 h-12 mx-auto rounded-full bg-purple-600/25 border border-purple-400/60 flex items-center justify-center text-purple-300">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-black text-white">Allow location?</h3>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    {locationConsent === 'denied'
                      ? 'Location permission was denied. Your map stays empty with zero locations shown.'
                      : locationConsent === 'stopped'
                      ? 'You stopped sharing your location. Tap Allow Location to see yourself on the map again.'
                      : 'The map is empty by default. Allow location to see only yourself, then invite a friend who must accept before sharing.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDenyLocation}
                    className="flex-1 min-h-[44px] rounded-xl bg-white/10 hover:bg-white/15 text-zinc-200 font-bold text-xs cursor-pointer"
                  >
                    Don&apos;t Allow
                  </button>
                  <button
                    type="button"
                    disabled={requestingPerm}
                    onClick={handleAllowLocation}
                    className="flex-1 min-h-[44px] rounded-xl bg-[#9333EA] hover:bg-[#7E22CE] text-white font-black text-xs cursor-pointer"
                  >
                    {requestingPerm ? 'Requesting...' : 'Allow Location'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Distance Apart & Privacy Tag */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="privacy-tag flex-1">
            🔒 Location is not exact due to user privacy
          </div>
          {activePeerRows[0] && (
            <div className="distance-badge">
              📍 {activePeerRows[0].distanceLabel}
            </div>
          )}
        </div>

        {/* Dedicated Page Scroll Bar Beneath Map */}
        <div className="w-full min-h-[42px] mt-2.5 bg-[#120D20] border-y-2 border-purple-400/50 flex items-center justify-center space-x-2 select-none">
          <GripHorizontal className="w-4 h-4 text-purple-300" />
          <span className="text-[11px] font-mono font-black tracking-widest text-purple-300 uppercase">
            DRAG HERE TO SCROLL PAGE
          </span>
          <GripHorizontal className="w-4 h-4 text-purple-300" />
        </div>
      </div>

      {statusNotice && (
        <div className="px-3 sm:px-4">
          <p className="text-xs font-semibold text-cyan-200 bg-cyan-950/50 border border-cyan-400/40 rounded-xl px-3.5 py-2.5">
            {statusNotice}
          </p>
        </div>
      )}

      {/* Active Mutual-Consent Friends on Map + Per-Friend Stop Sharing Button */}
      {activePeerRows.length > 0 && (
        <div className="px-3 sm:px-4">
          <div className="bg-[#120D20] border-2 border-purple-500/50 rounded-2xl p-4 space-y-2.5">
            <div className="flex items-center space-x-2">
              <Users className="w-4 h-4 text-purple-400" />
              <h3 className="text-xs font-black uppercase tracking-wider text-zinc-200">
                Sharing With ({activePeerRows.length})
              </h3>
            </div>

            {activePeerRows.map((item) => (
              <div
                key={`${item.roomCode}-${item.peer.ghost_number}`}
                className="p-3 rounded-xl bg-black/50 border border-purple-500/30 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-black text-white truncate">
                    {item.peer.display_name}{' '}
                    <span className="font-mono text-xs text-purple-300">
                      ({item.peer.ghost_number})
                    </span>
                  </p>
                  <p className="text-xs font-mono font-bold text-purple-300 tabular-nums mt-0.5">
                    {item.distanceLabel}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleStopSharingSession(item.roomCode)}
                  className="min-h-[40px] px-3.5 rounded-xl bg-rose-600/25 hover:bg-rose-600/45 border border-rose-500/40 text-rose-200 text-xs font-black flex items-center space-x-1.5 cursor-pointer shrink-0"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  <span>Stop Sharing</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* INVITE FRIEND TO MAP (ACCEPTED FRIENDS ONLY — NEVER STRANGERS) */}
      <div className="px-3 sm:px-4">
        <div className="bg-[#120D20] border border-white/15 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <MapPin className="w-4 h-4 text-purple-400" />
              <h3 className="text-xs font-black uppercase tracking-wider text-zinc-200">
                Invite Friend to Map
              </h3>
            </div>
            <span className="text-[11px] text-zinc-400">Friends only · Mutual consent</span>
          </div>

          {loading ? (
            <p className="px-4 py-6 text-xs text-zinc-500 text-center">Loading your friends...</p>
          ) : friendsList.length === 0 ? (
            <div className="px-4 py-6 text-center space-y-2">
              <p className="text-xs text-zinc-400">
                No accepted friends yet. Add a friend in Chats first — strangers can never see your
                location.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {friendsList.map((friend) => {
                const roomCode = getSortedRoomCode(profile.ghost_number, friend.ghost_number);
                const session = allSessions.find((s) => s.room_code === roomCode);
                const isAccepted =
                  session?.status === 'accepted' &&
                  Boolean(session.participants?.[friend.ghost_number]) &&
                  Boolean(session.participants?.[profile.ghost_number]);
                const isPendingFromMe =
                  session?.status === 'pending' && session.inviter === profile.ghost_number;
                const isPendingFromPeer =
                  session?.status === 'pending' && session.invitee === profile.ghost_number;
                const isDeclined = session?.status === 'declined';
                const isStopped = session?.status === 'stopped';

                return (
                  <div
                    key={friend.ghost_number}
                    className="px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <div
                        className={`rounded-full shrink-0 ${
                          friend.is_vip ? 'p-0.5 ring-2 ring-amber-400' : ''
                        }`}
                      >
                        <GhostAvatarView config={friend.profile_pic} size={40} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center space-x-1.5 min-w-0">
                          <p className="text-sm font-bold text-white truncate">
                            {friend.display_name}
                          </p>
                          {friend.is_vip && <VipBadge />}
                        </div>
                        <p className="text-xs font-mono text-zinc-400 truncate">
                          {friend.ghost_number}
                          {isDeclined ? ' · Declined (hidden)' : ''}
                          {isStopped ? ' · Stopped sharing' : ''}
                          {isPendingFromMe ? ' · Waiting for Accept' : ''}
                          {isAccepted ? ' · Live on Map' : ''}
                        </p>
                      </div>
                    </div>

                    {isAccepted ? (
                      <button
                        type="button"
                        onClick={() => handleStopSharingSession(roomCode)}
                        className="min-h-[40px] px-3.5 rounded-xl bg-rose-600/25 hover:bg-rose-600/40 border border-rose-500/40 text-rose-200 text-xs font-black cursor-pointer shrink-0"
                      >
                        Stop Sharing
                      </button>
                    ) : isPendingFromPeer ? (
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={busyPeer === friend.ghost_number}
                          onClick={() => handleRespondInvite(friend.ghost_number, true)}
                          className="min-h-[38px] px-3 rounded-xl bg-emerald-500 text-black font-black text-xs cursor-pointer"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={busyPeer === friend.ghost_number}
                          onClick={() => handleRespondInvite(friend.ghost_number, false)}
                          className="min-h-[38px] px-3 rounded-xl bg-white/10 text-zinc-300 font-bold text-xs cursor-pointer"
                        >
                          Decline
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={busyPeer === friend.ghost_number}
                        onClick={() => handleInviteFriend(friend)}
                        className="min-h-[40px] px-3.5 rounded-xl bg-[#9333EA] hover:bg-[#7E22CE] text-white font-black text-xs flex items-center space-x-1.5 cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>
                          {busyPeer === friend.ghost_number
                            ? 'Sending...'
                            : isPendingFromMe
                            ? 'Re-Invite'
                            : 'Invite Friend'}
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit / Hide My Profile Location Bar */}
      <div className="px-3 sm:px-4">
        <div className="bg-[#120D20] border border-white/15 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wider text-zinc-300">
                My Profile Location
              </p>
              <p className="text-sm font-bold text-white truncate">
                {profile.location_hidden ? 'Hidden from profile' : profile.location || 'Not set'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleHideMyLocation}
              className={`min-h-[40px] px-3.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 cursor-pointer shrink-0 ${
                profile.location_hidden
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                  : 'bg-white/10 hover:bg-white/15 text-zinc-200'
              }`}
            >
              {profile.location_hidden ? (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  <span>Show Location</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>Hide Location</span>
                </>
              )}
            </button>
          </div>

          <form onSubmit={handleSaveMyLocationText} className="flex items-center space-x-2">
            <input
              type="text"
              value={myLocationText}
              onChange={(e) => setMyLocationText(e.target.value)}
              placeholder="Add your city / country (e.g. Lagos, Nigeria)"
              maxLength={50}
              className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-black/60 border border-white/15 text-white placeholder-zinc-500 text-xs focus:outline-none focus:border-cyan-400"
            />
            <button
              type="submit"
              disabled={savingLoc}
              className="min-h-[42px] px-4 rounded-xl bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-black text-xs cursor-pointer"
            >
              {savingLoc ? '...' : 'Save'}
            </button>
          </form>
        </div>
      </div>

      {/* INVITE FRIEND MODAL (STRICTLY CONFIRMED FRIENDS ONLY) */}
      {showInviteModal && (
        <div className="fixed inset-0 z-[500] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-[#120D20] border-2 border-purple-500/60 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <UserPlus className="w-5 h-5 text-purple-400" />
                <h3 className="text-base font-black text-white">Invite Friend to Map</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={friendFilterQuery}
                onChange={(e) => setFriendFilterQuery(e.target.value)}
                placeholder="Filter accepted friends by name or GH-XXXX..."
                className="w-full min-h-[44px] pl-10 pr-3 rounded-xl bg-black/60 border border-white/15 text-white text-sm focus:outline-none focus:border-purple-400"
              />
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2">
              {friendsList.length === 0 ? (
                <p className="text-xs text-zinc-400 text-center py-4">
                  You have no accepted friends yet. Send a Friend Request in Chats first.
                </p>
              ) : filteredFriends.length === 0 ? (
                <p className="text-xs text-rose-300 text-center py-4">
                  No accepted friend matches &quot;{friendFilterQuery}&quot;. Only accepted friends
                  can be invited.
                </p>
              ) : (
                filteredFriends.map((friend) => (
                  <div
                    key={friend.ghost_number}
                    className="p-3 rounded-2xl bg-black/50 border border-white/10 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <GhostAvatarView config={friend.profile_pic} size={40} />
                      <div className="min-w-0">
                        <div className="flex items-center space-x-1.5 min-w-0">
                          <p className="text-sm font-bold text-white truncate">
                            {friend.display_name}
                          </p>
                          {friend.is_vip && <VipBadge />}
                        </div>
                        <p className="text-xs font-mono text-purple-300">{friend.ghost_number}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={busyPeer === friend.ghost_number}
                      onClick={() => handleInviteFriend(friend)}
                      className="min-h-[40px] px-3.5 rounded-xl bg-[#9333EA] hover:bg-[#7E22CE] text-white font-black text-xs flex items-center space-x-1.5 cursor-pointer shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{busyPeer === friend.ghost_number ? 'Sending...' : 'Invite'}</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Location-only Fixed Round Cyan Scroll Buttons */}
      <button
        type="button"
        aria-label="Scroll page up"
        onClick={() => window.scrollBy({ top: -400, behavior: 'smooth' })}
        className="fixed top-[68px] right-3 z-[450] w-11 h-11 rounded-full bg-[#00F5FF] hover:bg-[#67E8F9] active:scale-95 text-black font-black border-2 border-white shadow-[0_0_18px_rgba(0,245,255,0.75)] flex items-center justify-center cursor-pointer"
      >
        <ArrowUp className="w-6 h-6" strokeWidth={3} />
      </button>

      <button
        type="button"
        aria-label="Scroll page down"
        onClick={() => window.scrollBy({ top: 400, behavior: 'smooth' })}
        className="fixed bottom-[76px] right-3 z-[450] w-11 h-11 rounded-full bg-[#00F5FF] hover:bg-[#67E8F9] active:scale-95 text-black font-black border-2 border-white shadow-[0_0_18px_rgba(0,245,255,0.75)] flex items-center justify-center cursor-pointer"
      >
        <ArrowDown className="w-6 h-6" strokeWidth={3} />
      </button>
    </div>
  );
};
