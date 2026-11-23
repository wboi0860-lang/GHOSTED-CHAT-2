import { supabase } from '../supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { normalizeGhostNumber } from './ghostNumber';
import { apiUrl } from './api';

export interface WebRTCConnectionHandlers {
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onStatusChange?: (status: 'ringing' | 'active' | 'ended') => void;
}

async function fetchRtcConfig(): Promise<RTCConfiguration> {
  try {
    const res = await fetch(apiUrl('/api/turn-credentials'));
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        return {
          iceServers: data.iceServers,
          iceTransportPolicy: data.iceTransportPolicy || 'all',
        };
      }
    }
  } catch {}
  return {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };
}

export class WebRTCCallSession {
  public roomCode = '';
  public myGhostNumber = '';
  public peerGhostNumber = '';
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private channel: RealtimeChannel | null = null;
  private handlers: WebRTCConnectionHandlers;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private isCaller = false;
  private offerSdp = '';
  private muted = false;

  constructor(handlers: WebRTCConnectionHandlers = {}) {
    this.handlers = handlers;
  }

  private applyMuteToTracks(): void {
    const enabled = !this.muted;
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    this.pc?.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === 'audio') {
        sender.track.enabled = enabled;
      }
    });
  }

  private async ensureLocalAudio(): Promise<MediaStream> {
    if (this.localStream) {
      this.applyMuteToTracks();
      this.handlers.onLocalStream?.(this.localStream);
      return this.localStream;
    }
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      this.applyMuteToTracks();
      this.handlers.onLocalStream?.(this.localStream);
      return this.localStream;
    } catch {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const dst = ctx.createMediaStreamDestination();
      osc.connect(gain);
      gain.connect(dst);
      osc.start();
      this.localStream = dst.stream;
      this.applyMuteToTracks();
      this.handlers.onLocalStream?.(this.localStream);
      return this.localStream;
    }
  }

  private setupSignalChannel(roomCode: string): RealtimeChannel {
    const channel = supabase.channel(`ghost_rtc:${roomCode}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'rtc_signal' }, async ({ payload }) => {
      if (!payload || payload.from === this.myGhostNumber) return;

      if (payload.type === 'request_offer' && this.isCaller && this.offerSdp) {
        await channel.send({
          type: 'broadcast',
          event: 'rtc_signal',
          payload: {
            from: this.myGhostNumber,
            type: 'offer',
            sdp: this.offerSdp,
          },
        });
        return;
      }

      if (payload.type === 'offer' && !this.isCaller && this.pc && payload.sdp) {
        if (!this.pc.currentRemoteDescription) {
          await this.pc.setRemoteDescription(
            new RTCSessionDescription({ type: 'offer', sdp: payload.sdp })
          );
          await this.flushCandidates();
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          await channel.send({
            type: 'broadcast',
            event: 'rtc_signal',
            payload: {
              from: this.myGhostNumber,
              type: 'answer',
              sdp: answer.sdp || '',
            },
          });
          this.handlers.onStatusChange?.('active');
        }
        return;
      }

      if (payload.type === 'answer' && this.isCaller && this.pc && payload.sdp) {
        if (!this.pc.currentRemoteDescription) {
          await this.pc.setRemoteDescription(
            new RTCSessionDescription({ type: 'answer', sdp: payload.sdp })
          );
          await this.flushCandidates();
        }
        this.handlers.onStatusChange?.('active');
        return;
      }

      if (payload.type === 'ice' && payload.candidate && this.pc) {
        if (this.pc.remoteDescription) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch {}
        } else {
          this.pendingCandidates.push(payload.candidate);
        }
        return;
      }

      if (payload.type === 'hangup') {
        this.cleanup();
        this.handlers.onStatusChange?.('ended');
      }
    });

    channel.subscribe();
    return channel;
  }

  private async flushCandidates(): Promise<void> {
    if (!this.pc) return;
    while (this.pendingCandidates.length > 0) {
      const c = this.pendingCandidates.shift();
      if (c) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(c));
        } catch {}
      }
    }
  }

  private async createPeerConnection(roomCode: string): Promise<RTCPeerConnection> {
    await this.ensureLocalAudio();
    const rtcConfig = await fetchRtcConfig();
    const pc = new RTCPeerConnection(rtcConfig);
    this.remoteStream = new MediaStream();

    this.localStream?.getAudioTracks().forEach((track) => {
      pc.addTrack(track, this.localStream!);
    });

    pc.ontrack = (event) => {
      event.streams[0]?.getAudioTracks().forEach((track) => {
        this.remoteStream?.addTrack(track);
      });
      if (this.remoteStream && this.handlers.onRemoteStream) {
        this.handlers.onRemoteStream(this.remoteStream);
      }
    };

    pc.onicecandidate = async (event) => {
      if (!event.candidate || !this.channel) return;
      await this.channel.send({
        type: 'broadcast',
        event: 'rtc_signal',
        payload: {
          from: this.myGhostNumber,
          type: 'ice',
          candidate: event.candidate.toJSON(),
        },
      });
    };

    this.pc = pc;
    this.channel = this.setupSignalChannel(roomCode);
    return pc;
  }

  async startOutgoing(roomCode: string, myGh: string, peerGh: string): Promise<void> {
    this.cleanup();
    this.isCaller = true;
    this.roomCode = roomCode;
    this.myGhostNumber = normalizeGhostNumber(myGh);
    this.peerGhostNumber = normalizeGhostNumber(peerGh);

    const pc = await this.createPeerConnection(roomCode);
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    this.offerSdp = offer.sdp || '';

    // Send initial offer broadcast once subscribed
    setTimeout(() => {
      this.channel?.send({
        type: 'broadcast',
        event: 'rtc_signal',
        payload: {
          from: this.myGhostNumber,
          type: 'offer',
          sdp: this.offerSdp,
        },
      });
    }, 350);
  }

  async answerIncoming(roomCode: string, myGh: string, peerGh: string): Promise<void> {
    this.cleanup();
    this.isCaller = false;
    this.roomCode = roomCode;
    this.myGhostNumber = normalizeGhostNumber(myGh);
    this.peerGhostNumber = normalizeGhostNumber(peerGh);

    await this.createPeerConnection(roomCode);

    // Ask caller to resend offer SDP if we joined after initial broadcast
    setTimeout(() => {
      this.channel?.send({
        type: 'broadcast',
        event: 'rtc_signal',
        payload: {
          from: this.myGhostNumber,
          type: 'request_offer',
        },
      });
    }, 250);
  }

  async sendHangup(): Promise<void> {
    try {
      await this.channel?.send({
        type: 'broadcast',
        event: 'rtc_signal',
        payload: {
          from: this.myGhostNumber,
          type: 'hangup',
        },
      });
    } catch {}
    this.cleanup();
  }

  setMuted(muted: boolean): boolean {
    this.muted = muted;
    this.applyMuteToTracks();
    return this.muted;
  }

  toggleMute(): boolean {
    return this.setMuted(!this.muted);
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  cleanup(): void {
    this.pendingCandidates = [];
    this.offerSdp = '';
    this.muted = false;
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((t) => t.stop());
      this.remoteStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }
}
