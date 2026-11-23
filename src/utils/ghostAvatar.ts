export type GhostColor = 'white' | 'purple' | 'pink' | 'blue' | 'green' | 'black' | 'orange';
export type GhostEyes = 'happy' | 'sleepy' | 'wink' | 'angry' | 'star' | 'heart';
export type GhostMouth = 'smile' | 'laugh' | 'tongue' | 'sad' | 'cool';
export type GhostAccessory = 'none' | 'cap' | 'crown' | 'sunglasses' | 'headphones' | 'hoodie' | 'bow';

export interface GhostAvatarConfig {
  color: GhostColor;
  eyes: GhostEyes;
  mouth: GhostMouth;
  accessory: GhostAccessory;
  emoji?: string; // Optional emoji avatar mode (e.g. "🦊")
  photoUrl?: string; // Optional uploaded photo URL / compressed data URL
}

export const AVATAR_EMOJIS: string[] = [
  '👻', '🦊', '🐱', '🐺', '🦁', '🐼',
  '🐸', '👾', '🤖', '🎭', '🦄', '🐉',
];

export const GHOST_COLORS: { id: GhostColor; label: string; hex: string; secondaryHex: string }[] = [
  { id: 'purple', label: 'Purple', hex: '#8B5CF6', secondaryHex: '#6D28D9' },
  { id: 'white', label: 'White', hex: '#F8FAFC', secondaryHex: '#CBD5E1' },
  { id: 'pink', label: 'Pink', hex: '#EC4899', secondaryHex: '#BE185D' },
  { id: 'blue', label: 'Blue', hex: '#0EA5E9', secondaryHex: '#0369A1' },
  { id: 'green', label: 'Green', hex: '#10B981', secondaryHex: '#047857' },
  { id: 'black', label: 'Black', hex: '#27272A', secondaryHex: '#18181B' },
  { id: 'orange', label: 'Orange', hex: '#F97316', secondaryHex: '#C2410C' },
];

export const GHOST_EYES: { id: GhostEyes; label: string; icon: string }[] = [
  { id: 'happy', label: 'Happy', icon: '^ ^' },
  { id: 'sleepy', label: 'Sleepy', icon: '- -' },
  { id: 'wink', label: 'Wink', icon: '• ^' },
  { id: 'angry', label: 'Angry', icon: '> <' },
  { id: 'star', label: 'Star', icon: '★ ★' },
  { id: 'heart', label: 'Heart', icon: '♥ ♥' },
];

export const GHOST_MOUTHS: { id: GhostMouth; label: string; icon: string }[] = [
  { id: 'smile', label: 'Smile', icon: '‿' },
  { id: 'laugh', label: 'Laugh', icon: 'D' },
  { id: 'tongue', label: 'Tongue', icon: 'P' },
  { id: 'sad', label: 'Sad', icon: '︵' },
  { id: 'cool', label: 'Cool', icon: '—' },
];

export const GHOST_ACCESSORIES: { id: GhostAccessory; label: string; icon: string }[] = [
  { id: 'none', label: 'None', icon: '🚫' },
  { id: 'cap', label: 'Cap', icon: '🧢' },
  { id: 'crown', label: 'Crown', icon: '👑' },
  { id: 'sunglasses', label: 'Sunglasses', icon: '🕶️' },
  { id: 'headphones', label: 'Headphones', icon: '🎧' },
  { id: 'hoodie', label: 'Hoodie', icon: '🧥' },
  { id: 'bow', label: 'Bow', icon: '🎀' },
];

export const DEFAULT_GHOST_AVATAR: GhostAvatarConfig = {
  color: 'purple',
  eyes: 'happy',
  mouth: 'smile',
  accessory: 'none',
};

export function parseGhostAvatar(raw: any): GhostAvatarConfig {
  if (!raw) return { ...DEFAULT_GHOST_AVATAR };

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('EMOJI:')) {
      return {
        ...DEFAULT_GHOST_AVATAR,
        emoji: trimmed.slice(6).trim() || '👻',
      };
    }
    if (
      trimmed.startsWith('data:image/') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://')
    ) {
      return {
        ...DEFAULT_GHOST_AVATAR,
        photoUrl: trimmed,
      };
    }
  }

  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_GHOST_AVATAR };
    }
  }

  if (typeof obj !== 'object' || obj === null) {
    return { ...DEFAULT_GHOST_AVATAR };
  }

  const validColors: GhostColor[] = ['white', 'purple', 'pink', 'blue', 'green', 'black', 'orange'];
  const validEyes: GhostEyes[] = ['happy', 'sleepy', 'wink', 'angry', 'star', 'heart'];
  const validMouths: GhostMouth[] = ['smile', 'laugh', 'tongue', 'sad', 'cool'];
  const validAccessories: GhostAccessory[] = ['none', 'cap', 'crown', 'sunglasses', 'headphones', 'hoodie', 'bow'];

  return {
    color: validColors.includes(obj.color) ? obj.color : 'purple',
    eyes: validEyes.includes(obj.eyes) ? obj.eyes : 'happy',
    mouth: validMouths.includes(obj.mouth) ? obj.mouth : 'smile',
    accessory: validAccessories.includes(obj.accessory) ? obj.accessory : 'none',
    ...(typeof obj.emoji === 'string' && obj.emoji.trim() ? { emoji: obj.emoji.trim() } : {}),
    ...(typeof obj.photoUrl === 'string' && obj.photoUrl.trim() ? { photoUrl: obj.photoUrl.trim() } : {}),
  };
}

export function serializeGhostAvatar(config: GhostAvatarConfig): string {
  if (config.photoUrl) {
    return JSON.stringify({
      color: config.color,
      eyes: config.eyes,
      mouth: config.mouth,
      accessory: config.accessory,
      photoUrl: config.photoUrl,
    });
  }
  if (config.emoji) {
    return JSON.stringify({
      color: config.color,
      eyes: config.eyes,
      mouth: config.mouth,
      accessory: config.accessory,
      emoji: config.emoji,
    });
  }
  return JSON.stringify({
    color: config.color,
    eyes: config.eyes,
    mouth: config.mouth,
    accessory: config.accessory,
  });
}

export function generateRandomGhostAvatar(): GhostAvatarConfig {
  return {
    color: GHOST_COLORS[Math.floor(Math.random() * GHOST_COLORS.length)].id,
    eyes: GHOST_EYES[Math.floor(Math.random() * GHOST_EYES.length)].id,
    mouth: GHOST_MOUTHS[Math.floor(Math.random() * GHOST_MOUTHS.length)].id,
    accessory: GHOST_ACCESSORIES[Math.floor(Math.random() * GHOST_ACCESSORIES.length)].id,
  };
}
