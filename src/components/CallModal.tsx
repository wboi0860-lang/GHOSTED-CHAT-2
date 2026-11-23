import React, { useEffect, useRef } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX } from 'lucide-react';
import { ActiveCallState } from '../types';
import { GhostAvatarView } from './GhostAvatarView';

interface CallModalProps {
  call: ActiveCallState;
  remoteStream: MediaStream | null;
  onAccept: () => void;
  onDeclineOrEnd: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
}

function formatTimer(secs: number): string {
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export const CallModal: React.FC<CallModalProps> = ({
  call,
  remoteStream,
  onAccept,
  onDeclineOrEnd,
  onToggleMute,
  onToggleSpeaker,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current && remoteStream) {
      audioRef.current.srcObject = remoteStream;
      audioRef.current.volume = call.isSpeakerOn ? 1.0 : 0.45;
      audioRef.current.play().catch(() => {});
    }
  }, [remoteStream, call.isSpeakerOn]);

  const statusText =
    call.status === 'calling'
      ? 'Calling...'
      : call.status === 'ringing'
      ? call.direction === 'incoming'
        ? 'Ringing — Incoming Call'
        : 'Ringing...'
      : call.status === 'active'
      ? 'In Call'
      : 'Call Ended';

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
      <audio ref={audioRef} autoPlay playsInline className="hidden" />

      <div className="w-full max-w-sm rounded-3xl bg-[#120D20] border border-purple-500/40 p-7 flex flex-col items-center text-center space-y-6 shadow-2xl">
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">
            {statusText}
          </p>
          <p className="text-xs font-mono text-zinc-400">Room {call.roomCode}</p>
        </div>

        <div className="relative flex items-center justify-center py-2">
          {(call.status === 'ringing' || call.status === 'calling') && (
            <div className="absolute w-32 h-32 rounded-full border-2 border-cyan-400/50 animate-ping" />
          )}
          <GhostAvatarView
            config={call.peerPic}
            size={100}
            animate={call.status === 'ringing' || call.status === 'calling'}
          />
        </div>

        <div className="space-y-1">
          <h2 className="text-xl font-black text-white">{call.peerName || call.peerGhostNumber}</h2>
          <p className="text-sm font-mono font-bold text-purple-300">
            {call.status === 'ringing' && call.direction === 'incoming'
              ? `${call.peerGhostNumber} is calling you`
              : call.peerGhostNumber}
          </p>
          {call.status === 'active' && (
            <p className="text-lg font-mono font-bold text-emerald-400 tabular-nums pt-1">
              {formatTimer(call.durationSeconds)}
            </p>
          )}
        </div>

        {call.status === 'ringing' && call.direction === 'incoming' ? (
          <div className="grid grid-cols-2 gap-3 w-full pt-2">
            <button
              type="button"
              onClick={onDeclineOrEnd}
              className="min-h-[52px] rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm flex items-center justify-center space-x-2 cursor-pointer transition"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Decline</span>
            </button>
            <button
              type="button"
              onClick={onAccept}
              className="min-h-[52px] rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm flex items-center justify-center space-x-2 cursor-pointer transition"
            >
              <Phone className="w-4 h-4" />
              <span>Accept</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center space-x-3 pt-2">
            <button
              type="button"
              onClick={onToggleMute}
              className={`min-w-[68px] min-h-[54px] px-3 rounded-2xl flex flex-col items-center justify-center border transition cursor-pointer ${
                call.isMuted
                  ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                  : 'bg-white/10 border-white/15 text-white hover:bg-white/20'
              }`}
              aria-label={call.isMuted ? 'Unmute' : 'Mute'}
            >
              {call.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              <span className="text-[10px] font-bold mt-1">
                {call.isMuted ? '🔇 Unmute' : '🎤 Mute'}
              </span>
            </button>

            <button
              type="button"
              onClick={onToggleSpeaker}
              className={`min-w-[54px] min-h-[54px] px-3 rounded-2xl flex flex-col items-center justify-center border transition cursor-pointer ${
                call.isSpeakerOn
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                  : 'bg-white/10 border-white/15 text-white hover:bg-white/20'
              }`}
              aria-label="Toggle Speaker"
            >
              {call.isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              <span className="text-[10px] font-bold mt-1">Speaker</span>
            </button>

            <button
              type="button"
              onClick={onDeclineOrEnd}
              className="min-w-[72px] min-h-[54px] px-5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold flex flex-col items-center justify-center cursor-pointer transition"
              aria-label="End Call"
            >
              <PhoneOff className="w-5 h-5" />
              <span className="text-[10px] font-bold mt-1">End Call</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
