import React, { useEffect, useState } from 'react';
import { Ghost, Sparkles, Shield } from 'lucide-react';

interface SplashScreenProps {
  onFinish: () => void;
  durationMs?: number;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onFinish,
  durationMs = 2500,
}) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / durationMs) * 100));
      setProgress(pct);
      if (pct >= 100) {
        clearInterval(interval);
        setTimeout(onFinish, 150);
      }
    }, 40);

    return () => clearInterval(interval);
  }, [durationMs, onFinish]);

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col items-center justify-between py-12 px-6 text-white font-sans select-none overflow-hidden animate-in fade-in duration-300">
      {/* Background ambient radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(157,0,255,0.18)_0%,rgba(0,0,0,0.95)_70%)] pointer-events-none" />

      {/* Top subtle privacy tag */}
      <div className="flex items-center space-x-1.5 text-xs text-purple-300/60 uppercase tracking-widest pt-4">
        <Shield className="w-3.5 h-3.5 text-[#9D00FF]" />
        <span>Zero-Knowledge Stealth Network</span>
      </div>

      {/* Center Icon & Pulsing Radar */}
      <div className="flex flex-col items-center space-y-6 relative">
        {/* Cartoon Ghost Silhouette with Neon Purple Glow */}
        <div className="relative flex items-center justify-center">
          {/* Pulsing neon purple outer rings */}
          <div className="absolute w-44 h-44 rounded-full border-2 border-[#9D00FF]/40 animate-ping opacity-50" />
          <div className="absolute w-36 h-36 rounded-full bg-[#9D00FF]/15 blur-xl animate-pulse" />

          {/* Cartoon Sheet Ghost Frame */}
          <div className="relative w-28 h-28 rounded-full bg-gradient-to-tr from-[#1b0836] to-[#2e0854] border-2 border-[#9D00FF] shadow-[0_0_35px_rgba(157,0,255,0.85)] flex items-center justify-center">
            {/* SVG Cartoon Ghost */}
            <svg
              className="w-16 h-16 text-white drop-shadow-[0_0_12px_rgba(157,0,255,0.9)]"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2C7.58 2 4 5.58 4 10v9.5c0 .64.77.96 1.22.51L7.5 17.73l2.28 2.28c.4.4 1.04.4 1.44 0L12 19.2l.78.78c.4.4 1.04.4 1.44 0l2.28-2.28 2.28 2.28c.45.45 1.22.13 1.22-.51V10c0-4.42-3.58-8-8-8zm-2 9c-.83 0-1.5-.67-1.5-1.5S9.17 8 10 8s1.5.67 1.5 1.5S10.83 11 10 11zm4 0c-.83 0-1.5-.67-1.5-1.5S13.17 8 14 8s1.5.67 1.5 1.5S14.83 11 14 11z" />
            </svg>

            {/* Glowing online dot */}
            <span className="absolute top-1 right-2 w-3 h-3 rounded-full bg-[#9D00FF] shadow-[0_0_8px_#9D00FF]" />
          </div>
        </div>

        {/* App Title */}
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white via-purple-200 to-[#9D00FF]">
            GHOSTED
          </h1>
          <p className="text-xs text-purple-300/80 tracking-widest uppercase font-medium">
            Live Location & Private Connect
          </p>
        </div>
      </div>

      {/* Bottom Loading Progress Animation */}
      <div className="w-full max-w-xs flex flex-col items-center space-y-3 pb-6">
        <div className="w-full h-1.5 bg-purple-950/80 rounded-full overflow-hidden border border-purple-800/40">
          <div
            className="h-full bg-gradient-to-r from-[#8A2BE2] via-[#9D00FF] to-[#00F5FF] rounded-full shadow-[0_0_12px_#9D00FF] transition-all duration-75 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-center justify-between w-full text-[10px] text-purple-300/60 font-mono">
          <span>INITIALIZING GHOST NET</span>
          <span>{progress}%</span>
        </div>

        <button
          type="button"
          onClick={onFinish}
          className="text-[11px] text-purple-400/50 hover:text-purple-300 pt-1 cursor-pointer transition"
        >
          Tap to enter
        </button>
      </div>
    </div>
  );
};
