import React from 'react';
import {
  GhostAvatarConfig,
  GhostColor,
  GhostEyes,
  GhostMouth,
  GhostAccessory,
  GHOST_COLORS,
  parseGhostAvatar,
} from '../utils/ghostAvatar';

interface GhostAvatarViewProps {
  config?: GhostAvatarConfig | string | null;
  size?: number; // width in px, default 48
  className?: string;
  animate?: boolean;
}

export const GhostAvatarView: React.FC<GhostAvatarViewProps> = ({
  config,
  size = 48,
  className = '',
  animate = false,
}) => {
  const avatar = parseGhostAvatar(config);

  const colorMeta =
    GHOST_COLORS.find((c) => c.id === avatar.color) || GHOST_COLORS[0];

  if (avatar.photoUrl) {
    return (
      <div
        className={`inline-flex items-center justify-center shrink-0 relative select-none rounded-full overflow-hidden border-2 border-cyan-400/50 bg-black ${animate ? 'animate-pulse' : ''} ${className}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
        }}
      >
        <img
          src={avatar.photoUrl}
          alt="User Avatar"
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  if (avatar.emoji) {
    return (
      <div
        className={`inline-flex items-center justify-center shrink-0 relative select-none rounded-full border-2 border-white/25 shadow-md ${animate ? 'animate-bounce' : ''} ${className}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          background: `linear-gradient(135deg, ${colorMeta.hex}, ${colorMeta.secondaryHex})`,
          fontSize: `${Math.round(size * 0.56)}px`,
        }}
      >
        <span className="leading-none">{avatar.emoji}</span>
      </div>
    );
  }

  const strokeColor =
    avatar.color === 'white'
      ? '#94A3B8'
      : avatar.color === 'black'
      ? '#52525B'
      : '#FFFFFF';

  // Eye color: dark charcoal unless ghost is black, then glowing soft cyan/white
  const eyeFill = avatar.color === 'black' ? '#E0F2FE' : '#18181B';
  const blushFill = avatar.color === 'black' ? '#7C3AED' : '#F43F5E';

  return (
    <div
      className={`inline-flex items-center justify-center shrink-0 relative select-none ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <svg
        viewBox="0 0 100 100"
        className={`w-full h-full overflow-visible drop-shadow-md ${animate ? 'animate-bounce' : ''}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Gradient Shading for Ghost Body */}
          <linearGradient id={`ghost-grad-${avatar.color}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={colorMeta.hex} />
            <stop offset="100%" stopColor={colorMeta.secondaryHex} />
          </linearGradient>

          {/* Ethereal Glow Filter */}
          <filter id="soft-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={colorMeta.hex} floodOpacity="0.35" />
          </filter>
        </defs>

        {/* ========================================================
            1. GHOST BODY (Classic dome head with 3 wavy rippling tails)
            ======================================================== */}
        <path
          d="M 20 50
             C 20 20, 80 20, 80 50
             L 80 78
             C 74 74, 68 84, 62 78
             C 56 74, 50 84, 44 78
             C 38 74, 32 84, 26 78
             C 23 75, 20 76, 20 78
             Z"
          fill={`url(#ghost-grad-${avatar.color})`}
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeLinejoin="round"
          filter="url(#soft-glow)"
        />

        {/* Ethereal floating shadow at bottom */}
        <ellipse cx="50" cy="88" rx="22" ry="4" fill="rgba(0,0,0,0.25)" />

        {/* Subtle cute ghost arms */}
        <path
          d="M 21 54 Q 13 58 17 64"
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M 79 54 Q 87 58 83 64"
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Cheek Blush */}
        <circle cx="28" cy="51" r="3.5" fill={blushFill} opacity="0.4" />
        <circle cx="72" cy="51" r="3.5" fill={blushFill} opacity="0.4" />

        {/* ========================================================
            2. EYES LAYER
            happy | sleepy | wink | angry | star | heart
            ======================================================== */}
        <g id="ghost-eyes">
          {avatar.eyes === 'happy' && (
            <>
              <path
                d="M 32 46 Q 38 39 44 46"
                fill="none"
                stroke={eyeFill}
                strokeWidth="3.2"
                strokeLinecap="round"
              />
              <path
                d="M 56 46 Q 62 39 68 46"
                fill="none"
                stroke={eyeFill}
                strokeWidth="3.2"
                strokeLinecap="round"
              />
            </>
          )}

          {avatar.eyes === 'sleepy' && (
            <>
              <line x1="32" y1="45" x2="44" y2="45" stroke={eyeFill} strokeWidth="3" strokeLinecap="round" />
              <line x1="56" y1="45" x2="68" y2="45" stroke={eyeFill} strokeWidth="3" strokeLinecap="round" />
            </>
          )}

          {avatar.eyes === 'wink' && (
            <>
              <circle cx="38" cy="45" r="4.2" fill={eyeFill} />
              <circle cx="39.5" cy="43.5" r="1.3" fill="#FFFFFF" />
              <path
                d="M 56 46 Q 62 39 68 46"
                fill="none"
                stroke={eyeFill}
                strokeWidth="3.2"
                strokeLinecap="round"
              />
            </>
          )}

          {avatar.eyes === 'angry' && (
            <>
              <line x1="30" y1="39" x2="44" y2="44" stroke={eyeFill} strokeWidth="2.8" strokeLinecap="round" />
              <circle cx="37" cy="46" r="3.8" fill={eyeFill} />
              <line x1="70" y1="39" x2="56" y2="44" stroke={eyeFill} strokeWidth="2.8" strokeLinecap="round" />
              <circle cx="63" cy="46" r="3.8" fill={eyeFill} />
            </>
          )}

          {avatar.eyes === 'star' && (
            <>
              {/* Star Left */}
              <polygon
                points="38,39 40,43 44,44 41,47 42,51 38,48 34,51 35,47 32,44 36,43"
                fill="#FBBF24"
                stroke="#D97706"
                strokeWidth="0.8"
              />
              {/* Star Right */}
              <polygon
                points="62,39 64,43 68,44 65,47 66,51 62,48 58,51 59,47 56,44 60,43"
                fill="#FBBF24"
                stroke="#D97706"
                strokeWidth="0.8"
              />
            </>
          )}

          {avatar.eyes === 'heart' && (
            <>
              {/* Heart Left */}
              <path
                d="M 38 42 A 3 3 0 0 0 32 45 C 32 49 38 53 38 53 C 38 53 44 49 44 45 A 3 3 0 0 0 38 42 Z"
                fill="#EF4444"
              />
              {/* Heart Right */}
              <path
                d="M 62 42 A 3 3 0 0 0 56 45 C 56 49 62 53 62 53 C 62 53 68 49 68 45 A 3 3 0 0 0 62 42 Z"
                fill="#EF4444"
              />
            </>
          )}
        </g>

        {/* ========================================================
            3. MOUTH LAYER
            smile | laugh | tongue | sad | cool
            ======================================================== */}
        <g id="ghost-mouth">
          {avatar.mouth === 'smile' && (
            <path
              d="M 43 55 Q 50 63 57 55"
              fill="none"
              stroke={eyeFill}
              strokeWidth="2.6"
              strokeLinecap="round"
            />
          )}

          {avatar.mouth === 'laugh' && (
            <>
              <path
                d="M 42 54 Q 50 66 58 54 Z"
                fill={eyeFill}
              />
              <path
                d="M 45 59 Q 50 65 55 59"
                fill="#F43F5E"
              />
            </>
          )}

          {avatar.mouth === 'tongue' && (
            <>
              <path
                d="M 43 55 Q 50 61 57 55"
                fill="none"
                stroke={eyeFill}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <path
                d="M 47 57 C 47 64, 53 64, 53 57 Z"
                fill="#F43F5E"
                stroke={eyeFill}
                strokeWidth="1"
              />
            </>
          )}

          {avatar.mouth === 'sad' && (
            <path
              d="M 43 60 Q 50 54 57 60"
              fill="none"
              stroke={eyeFill}
              strokeWidth="2.6"
              strokeLinecap="round"
            />
          )}

          {avatar.mouth === 'cool' && (
            <line
              x1="45"
              y1="57"
              x2="56"
              y2="55"
              stroke={eyeFill}
              strokeWidth="2.6"
              strokeLinecap="round"
            />
          )}
        </g>

        {/* ========================================================
            4. ACCESSORY LAYER
            none | cap | crown | sunglasses | headphones | hoodie | bow
            ======================================================== */}
        <g id="ghost-accessory">
          {/* CAP */}
          {avatar.accessory === 'cap' && (
            <g id="acc-cap">
              <path
                d="M 28 32 C 28 17, 72 17, 72 32 Z"
                fill="#EF4444"
                stroke="#B91C1C"
                strokeWidth="1.8"
              />
              {/* Cap Brim */}
              <path
                d="M 25 32 Q 50 36 78 30 Q 86 32 82 36 Q 50 40 25 32 Z"
                fill="#DC2626"
                stroke="#991B1B"
                strokeWidth="1.5"
              />
              <circle cx="50" cy="20" r="2" fill="#FBBF24" />
            </g>
          )}

          {/* CROWN */}
          {avatar.accessory === 'crown' && (
            <g id="acc-crown">
              <polygon
                points="30,28 32,15 42,23 50,11 58,23 68,15 70,28"
                fill="#FBBF24"
                stroke="#D97706"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <circle cx="50" cy="12" r="2" fill="#EF4444" />
              <circle cx="32" cy="16" r="1.5" fill="#3B82F6" />
              <circle cx="68" cy="16" r="1.5" fill="#10B981" />
            </g>
          )}

          {/* SUNGLASSES */}
          {avatar.accessory === 'sunglasses' && (
            <g id="acc-sunglasses">
              {/* Left Lens */}
              <rect x="28" y="40" width="18" height="11" rx="2" fill="#18181B" stroke="#000000" strokeWidth="1.5" />
              <line x1="30" y1="43" x2="42" y2="43" stroke="#FFFFFF" strokeWidth="1.2" opacity="0.6" />
              {/* Bridge */}
              <line x1="46" y1="44" x2="54" y2="44" stroke="#18181B" strokeWidth="2.5" />
              {/* Right Lens */}
              <rect x="54" y="40" width="18" height="11" rx="2" fill="#18181B" stroke="#000000" strokeWidth="1.5" />
              <line x1="56" y1="43" x2="68" y2="43" stroke="#FFFFFF" strokeWidth="1.2" opacity="0.6" />
            </g>
          )}

          {/* HEADPHONES */}
          {avatar.accessory === 'headphones' && (
            <g id="acc-headphones">
              {/* Headband */}
              <path
                d="M 20 48 A 30 30 0 0 1 80 48"
                fill="none"
                stroke="#18181B"
                strokeWidth="4"
                strokeLinecap="round"
              />
              {/* Ear Cups */}
              <rect x="15" y="42" width="7" height="16" rx="3.5" fill="#06B6D4" stroke="#0891B2" strokeWidth="1.5" />
              <rect x="78" y="42" width="7" height="16" rx="3.5" fill="#06B6D4" stroke="#0891B2" strokeWidth="1.5" />
            </g>
          )}

          {/* HOODIE */}
          {avatar.accessory === 'hoodie' && (
            <g id="acc-hoodie">
              {/* Snug hoodie collar / lining */}
              <path
                d="M 23 58 C 30 70, 70 70, 77 58 C 82 72, 18 72, 23 58 Z"
                fill="#4C1D95"
                stroke="#A78BFA"
                strokeWidth="1.8"
              />
              {/* Drawstrings */}
              <line x1="44" y1="67" x2="44" y2="76" stroke="#E9D5FF" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="44" cy="77" r="1.5" fill="#FBBF24" />
              <line x1="56" y1="67" x2="56" y2="76" stroke="#E9D5FF" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="56" cy="77" r="1.5" fill="#FBBF24" />
            </g>
          )}

          {/* BOW */}
          {avatar.accessory === 'bow' && (
            <g id="acc-bow" transform="translate(62, 18)">
              <path d="M 0 6 L 10 0 L 10 12 Z" fill="#F43F5E" />
              <path d="M 0 6 L -10 0 L -10 12 Z" fill="#F43F5E" />
              <circle cx="0" cy="6" r="3" fill="#FB7185" stroke="#E11D48" strokeWidth="1" />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
};
