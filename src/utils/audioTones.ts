// Web Audio API Utilities for Real Telephone Keypad Tones and Ringing
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// DTMF standard phone keypad frequencies
const DTMF_FREQS: Record<string, [number, number]> = {
  '1': [697, 1209],
  '2': [697, 1336],
  '3': [697, 1477],
  '4': [770, 1209],
  '5': [770, 1336],
  '6': [770, 1477],
  '7': [852, 1209],
  '8': [852, 1336],
  '9': [852, 1477],
  '*': [941, 1209],
  '0': [941, 1336],
  '#': [941, 1477],
  '+': [941, 1336],
};

/**
 * Play standard DTMF dual-tone when user taps a dial pad key
 */
export function playDtmfTone(key: string, durationMs = 120): void {
  try {
    const freqs = DTMF_FREQS[key] || [800, 1200];
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(freqs[0], now);
    osc2.frequency.setValueAtTime(freqs[1], now);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + durationMs / 1000);
    osc2.stop(now + durationMs / 1000);
  } catch {
    // AudioContext blocked or unsupported
  }
}

// Global tracker of all active ringtone players to guarantee 100% stop on cut call
const activeRingPlayers = new Set<PhoneRingTonePlayer>();

/**
 * Plays a telephone ring tone (440Hz + 480Hz) repeated in bursts
 */
export class PhoneRingTonePlayer {
  private isPlaying = false;
  private intervalId: NodeJS.Timeout | null = null;
  private activeOscillators: OscillatorNode[] = [];
  private activeGain: GainNode | null = null;
  private audioCtx: AudioContext | null = null;

  start(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    activeRingPlayers.add(this);
    this.playBurst();
    this.intervalId = setInterval(() => {
      if (this.isPlaying) {
        this.playBurst();
      } else {
        if (this.intervalId) {
          clearInterval(this.intervalId);
          this.intervalId = null;
        }
      }
    }, 4000);
  }

  private playBurst(): void {
    if (!this.isPlaying) return;
    try {
      const ctx = getAudioContext();
      this.audioCtx = ctx;
      const now = ctx.currentTime;
      const duration = 1.8; // 1.8 second ring pulse

      // Stop any previous oscillators before starting new burst
      this.stopCurrentOscillators();

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      this.activeGain = gain;
      this.activeOscillators = [osc1, osc2];

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(440, now);
      osc2.frequency.setValueAtTime(480, now);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.setValueAtTime(0.06, now + duration - 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + duration);
      osc2.stop(now + duration);
    } catch {
      // AudioContext blocked
    }
  }

  private stopCurrentOscillators(): void {
    if (this.activeGain && this.audioCtx) {
      try {
        this.activeGain.gain.cancelScheduledValues(this.audioCtx.currentTime);
        this.activeGain.gain.setValueAtTime(0, this.audioCtx.currentTime);
      } catch {}
      this.activeGain = null;
    }
    this.activeOscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {}
    });
    this.activeOscillators = [];
  }

  stop(): void {
    this.isPlaying = false;
    activeRingPlayers.delete(this);
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // Instantly terminate audio tracks
    this.stopCurrentOscillators();
  }
}

/**
 * Global failsafe to stop any ongoing ringtone audio immediately
 */
export function stopAllActiveRingtones(): void {
  activeRingPlayers.forEach((player) => {
    try {
      player.stop();
    } catch {}
  });
  activeRingPlayers.clear();
}

/**
 * Play connected chime when a call is answered
 */
export function playConnectedChime(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.setValueAtTime(659.25, now + 0.15); // E5
    osc.frequency.setValueAtTime(783.99, now + 0.3); // G5

    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.55);
  } catch {
    // ignore
  }
}

/**
 * Play hangup / busy tone when a call ends
 */
export function playHangupTone(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';
    osc1.frequency.setValueAtTime(480, now);
    osc2.frequency.setValueAtTime(620, now);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.35);
    osc2.stop(now + 0.35);
  } catch {
    // ignore
  }
}

/**
 * Play gentle meditative chime when a Ghost Vault key is unlocked
 */
export function playVaultUnlockChime(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(432, now); // 432 Hz calming frequency
    osc.frequency.setValueAtTime(540, now + 0.2);
    osc.frequency.setValueAtTime(648, now + 0.4);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.85);
  } catch {
    // ignore
  }
}
