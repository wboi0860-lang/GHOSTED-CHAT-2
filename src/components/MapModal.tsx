import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Crosshair, MapPin, RefreshCw, ShieldCheck, StopCircle, X } from 'lucide-react';
import { GhostRoomProfile, MapParticipant, MapSessionData } from '../types';
import {
  applyPrivacyOffset,
  fetchAllAcceptedMapSessionsForUser,
  fetchAllMapSessionsForUser,
  getDistance,
  leaveMapSession,
  requestUserGeoCoords,
  subscribeToMapSessions,
  updateMyMapCoordinates,
  updateSoloLocationSharing,
} from '../services/roomService';

interface MapModalProps {
  profile: GhostRoomProfile;
  focusRoomCode?: string | null;
  onClose: () => void;
}

export const MapModal: React.FC<MapModalProps> = ({
  profile,
  focusRoomCode,
  onClose,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const hasCenteredOnceRef = useRef(false);

  const [hasCenteredOnce, setHasCenteredOnce] = useState(false);
  const [followUser, setFollowUser] = useState(false);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [locationConsent, setLocationConsent] = useState<'asking' | 'granted' | 'denied' | 'stopped'>('asking');
  const [myCoords, setMyCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [sessions, setSessions] = useState<MapSessionData[]>([]);
  const [stoppedFriendNotice, setStoppedFriendNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadSessions = useCallback(async () => {
    const [acceptedList, allList] = await Promise.all([
      fetchAllAcceptedMapSessionsForUser(profile.ghost_number),
      fetchAllMapSessionsForUser(profile.ghost_number),
    ]);
    setSessions(acceptedList);
    setLoading(false);

    const stopped = allList.find(
      (s) => s.status === 'stopped' && s.stopped_by && s.stopped_by !== profile.ghost_number
    );
    if (stopped) {
      setStoppedFriendNotice('Friend stopped sharing');
    }
    return acceptedList;
  }, [profile.ghost_number]);

  const handleRequestLocation = useCallback(async () => {
    setRefreshing(true);
    try {
      try {
        localStorage.removeItem('ghosted_loc_stopped');
      } catch {}
      const res = await requestUserGeoCoords();
      if (!res.granted) {
        setMyCoords(null);
        setLocationConsent('denied');
        return;
      }
      setMyCoords(res.coords);
      setLocationConsent('granted');
      const activeList = await fetchAllAcceptedMapSessionsForUser(profile.ghost_number);
      await updateMyMapCoordinates(
        profile,
        activeList.map((s) => s.room_code),
        res.coords
      );
      await loadSessions();
    } finally {
      setRefreshing(false);
    }
  }, [profile, loadSessions]);

  // Auto-resume GPS if already granted at browser level and not stopped
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem('ghosted_loc_stopped') === 'true') return;
        if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
        const perm = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        if (!cancelled && perm.state === 'granted') {
          await handleRequestLocation();
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [handleRequestLocation]);

  useEffect(() => {
    loadSessions();
    const unsub = subscribeToMapSessions(() => {
      loadSessions();
    });
    const pollInterval = setInterval(() => {
      loadSessions();
    }, 3000);
    return () => {
      clearInterval(pollInterval);
      unsub();
    };
  }, [loadSessions]);

  useEffect(() => {
    if (locationConsent === 'granted' && myCoords && !hasCenteredOnce) {
      const fuzzy = applyPrivacyOffset(myCoords);
      setMapCenter(fuzzy);
      setHasCenteredOnce(true);
      hasCenteredOnceRef.current = true;
      setFollowUser(false);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([fuzzy.lat, fuzzy.lng], 15, { animate: true });
      }
    }
  }, [myCoords, locationConsent, hasCenteredOnce]);

  const handleMyLocationClick = useCallback(() => {
    if (!myCoords || !mapInstanceRef.current) return;
    const fuzzy = applyPrivacyOffset(myCoords);
    setMapCenter(fuzzy);
    mapInstanceRef.current.setView([fuzzy.lat, fuzzy.lng], 15, { animate: true });
  }, [myCoords]);

  useEffect(() => {
    if (locationConsent !== 'granted') return;
    const interval = setInterval(() => {
      handleRequestLocation();
    }, 10000);
    return () => clearInterval(interval);
  }, [locationConsent, handleRequestLocation]);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [6.5244, 3.3792],
      zoom: 14,
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

    let fallbackActivated = false;
    const primaryLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    primaryLayer.on('tileerror', () => {
      if (!fallbackActivated) {
        fallbackActivated = true;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          subdomains: 'abc',
          maxZoom: 19,
        }).addTo(map);
      }
    });

    const group = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;
    layerGroupRef.current = group;

    const timer = setTimeout(() => map.invalidateSize(), 150);

    return () => {
      clearTimeout(timer);
      map.remove();
      mapInstanceRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  // Draw pins + PURPLE LINE + km/m distance ONLY when user opted in
  useEffect(() => {
    const map = mapInstanceRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    if (locationConsent !== 'granted' || !myCoords) {
      return;
    }

    const orderedSessions = focusRoomCode
      ? [...sessions].sort((a, b) =>
          a.room_code === focusRoomCode ? -1 : b.room_code === focusRoomCode ? 1 : 0
        )
      : sessions;

    const activePeers = new Map<string, MapParticipant>();
    orderedSessions.forEach((s) => {
      const peerGh = s.inviter === profile.ghost_number ? s.invitee : s.inviter;
      const p = s.participants?.[peerGh];
      if (p && typeof p.lat === 'number' && typeof p.lng === 'number') {
        activePeers.set(p.ghost_number, p);
      }
    });

    const myFuzzyCoords = applyPrivacyOffset(myCoords);
    const boundsPoints: L.LatLngExpression[] = [];
    const myLatLng: [number, number] = [myFuzzyCoords.lat, myFuzzyCoords.lng];
    boundsPoints.push(myLatLng);

    const myHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
        <div style="width:28px;height:28px;border-radius:9999px;background:#2563EB;border:4px solid #ffffff;box-shadow:0 0 18px rgba(37,99,235,0.95);"></div>
        <span style="margin-top:6px;padding:3px 10px;border-radius:9999px;background:#1E3A8A;color:#FFFFFF;font-family:ui-monospace,monospace;font-size:12px;font-weight:900;white-space:nowrap;border:2px solid #FFFFFF;">
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

    activePeers.forEach((p) => {
      const latLng: [number, number] = [p.lat, p.lng];
      boundsPoints.push(latLng);

      const markerHtml = `
        <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
          <div style="width:24px;height:24px;border-radius:9999px;background:#A855F7;border:4px solid #ffffff;box-shadow:0 0 16px rgba(168,85,247,0.95);"></div>
          <span style="margin-top:6px;padding:3px 9px;border-radius:9999px;background:#581C87;color:#ffffff;font-family:ui-monospace,monospace;font-size:12px;font-weight:900;white-space:nowrap;border:2px solid #FFFFFF;">
            ${p.display_name} (${p.ghost_number})
          </span>
        </div>
      `;

      L.marker(latLng, {
        icon: L.divIcon({
          html: markerHtml,
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

    if (!hasCenteredOnceRef.current && boundsPoints.length > 0) {
      hasCenteredOnceRef.current = true;
      setHasCenteredOnce(true);
      setMapCenter(myFuzzyCoords);
      if (boundsPoints.length === 1) {
        map.setView(boundsPoints[0], 15);
      } else {
        map.fitBounds(L.latLngBounds(boundsPoints), { padding: [48, 48], maxZoom: 15 });
      }
    }
  }, [sessions, myCoords, locationConsent, focusRoomCode, profile.ghost_number]);

  const myFuzzyCoords = myCoords ? applyPrivacyOffset(myCoords) : null;

  const peerList: Array<{
    roomCode: string;
    peer: MapParticipant;
    distanceLabel: string;
  }> = [];

  if (locationConsent === 'granted' && myFuzzyCoords) {
    sessions.forEach((s) => {
      const peerGh = s.inviter === profile.ghost_number ? s.invitee : s.inviter;
      const p = s.participants?.[peerGh];
      if (p) {
        peerList.push({
          roomCode: s.room_code,
          peer: p,
          distanceLabel: getDistance(myFuzzyCoords.lat, myFuzzyCoords.lng, p.lat, p.lng),
        });
      }
    });
  }

  const handleStopSharingRoom = async (roomCode: string) => {
    await leaveMapSession(profile.ghost_number, roomCode);
    const updated = await loadSessions();
    if (updated.length === 0) {
      try {
        localStorage.setItem('ghosted_loc_stopped', 'true');
      } catch {}
      setMyCoords(null);
      setLocationConsent('stopped');
      await updateSoloLocationSharing({ me: profile, sharing: false, coords: null });
    }
  };

  const handleStopAllSharing = async () => {
    for (const s of sessions) {
      await leaveMapSession(profile.ghost_number, s.room_code);
    }
    try {
      localStorage.setItem('ghosted_loc_stopped', 'true');
    } catch {}
    setMyCoords(null);
    setLocationConsent('stopped');
    await updateSoloLocationSharing({ me: profile, sharing: false, coords: null });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-[#120D20] border border-purple-500/40 overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2 min-w-0">
            <MapPin className="w-5 h-5 text-purple-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-black text-white truncate">
                Friend Map ({locationConsent === 'granted' && myCoords ? peerList.length + 1 : 0} live)
              </h3>
              <p className="text-[11px] text-zinc-400">
                Mutual consent only · Accepted friends only
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 shrink-0">
            <button
              type="button"
              onClick={handleRequestLocation}
              disabled={refreshing}
              className="min-w-[44px] min-h-[44px] rounded-xl bg-white/5 hover:bg-white/10 text-zinc-200 flex items-center justify-center cursor-pointer"
              aria-label="Refresh Location"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            {locationConsent === 'granted' && (
              <button
                type="button"
                onClick={handleStopAllSharing}
                className="min-h-[44px] px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center space-x-1.5 cursor-pointer"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span>Stop Sharing</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] rounded-full bg-white/5 hover:bg-white/10 text-zinc-300 flex items-center justify-center cursor-pointer"
              aria-label="Close Map"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {stoppedFriendNotice && (
          <div className="px-4 py-2.5 bg-amber-950/70 border-b border-amber-400/50 text-xs font-bold text-amber-200 flex items-center justify-between">
            <span>{stoppedFriendNotice}</span>
            <button
              type="button"
              onClick={() => setStoppedFriendNotice(null)}
              className="text-amber-300 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="map-container relative w-full h-72 sm:h-80 bg-[#090710]">
          <div
            ref={mapContainerRef}
            data-follow-user={followUser ? 'true' : 'false'}
            data-map-center={mapCenter ? `${mapCenter.lat},${mapCenter.lng}` : ''}
            className="w-full h-full z-10"
          />
          {peerList[0] && (
            <div className="distance-badge absolute top-3 right-3 z-20 shadow-lg pointer-events-none">
              📍 {peerList[0].distanceLabel}
            </div>
          )}
          {locationConsent === 'granted' && (
            <button
              type="button"
              onClick={handleMyLocationClick}
              className="absolute bottom-3 left-3 z-20 min-h-[38px] px-3 rounded-xl bg-[#090716]/95 hover:bg-[#17112B] border border-cyan-400/70 text-xs font-black text-cyan-200 flex items-center space-x-1.5 shadow-lg cursor-pointer"
            >
              <Crosshair className="w-3.5 h-3.5 text-cyan-300" />
              <span>My Location</span>
            </button>
          )}
          {locationConsent !== 'granted' && (
            <div className="absolute inset-0 z-20 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="max-w-xs text-center space-y-3 bg-[#120D20] border border-purple-500/50 rounded-2xl p-4">
                <ShieldCheck className="w-7 h-7 text-purple-300 mx-auto" />
                <p className="text-sm font-black text-white">Allow location?</p>
                <p className="text-xs text-zinc-300">
                  {locationConsent === 'denied'
                    ? 'Location permission denied. Map stays empty.'
                    : 'Allow location to see your pin and mutually accepted friends.'}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        localStorage.setItem('ghosted_loc_stopped', 'true');
                      } catch {}
                      setLocationConsent('denied');
                    }}
                    className="flex-1 min-h-[40px] rounded-xl bg-white/10 text-xs font-bold text-zinc-200 cursor-pointer"
                  >
                    Deny
                  </button>
                  <button
                    type="button"
                    onClick={handleRequestLocation}
                    className="flex-1 min-h-[40px] rounded-xl bg-[#9333EA] text-xs font-black text-white cursor-pointer"
                  >
                    Allow
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 space-y-2.5 overflow-y-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="privacy-tag flex-1">
              🔒 Location is not exact due to user privacy
            </div>
            {peerList[0] && (
              <div className="distance-badge">
                📍 {peerList[0].distanceLabel}
              </div>
            )}
          </div>

          {!loading && peerList.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-2">
              No friends sharing right now. Both users must accept to see each other.
            </p>
          ) : (
            peerList.map((item) => (
              <div
                key={`${item.roomCode}-${item.peer.ghost_number}`}
                className="p-3 rounded-2xl bg-black/45 border border-purple-500/30 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">
                    {item.peer.display_name}{' '}
                    <span className="font-mono text-xs text-purple-300">
                      ({item.peer.ghost_number})
                    </span>
                  </p>
                  <p className="text-xs text-purple-300 font-mono tabular-nums mt-0.5">
                    {item.distanceLabel}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleStopSharingRoom(item.roomCode)}
                  className="min-h-[40px] px-3 rounded-xl bg-rose-600/20 hover:bg-rose-600/35 text-rose-300 text-xs font-bold cursor-pointer shrink-0"
                >
                  Stop Sharing
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
