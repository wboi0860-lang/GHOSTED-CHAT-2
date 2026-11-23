export type ThemeId = 'white' | 'black' | 'ghost';

export interface AppTheme {
  id: ThemeId;
  name: string;
  description: string;
  icon: string;
  // Core theme color values
  background: string;       // Page background hex
  textOutside: string;      // Text on page bg (outside cards)
  textOutsideSub: string;   // Secondary text on page bg
  card: string;             // Card background hex
  cardText: string;         // Text inside card
  cardSubtext: string;      // Subtitles/secondary text inside card
  border: string;           // Border hex
  accent: string;           // Accent hex
  searchBg: string;         // Search bar bg (card color)
  searchText: string;       // Search bar text (card text color)
  searchBorder: string;     // Search bar border
  headerBg: string;         // Header background
  headerText: string;       // Header text
  headerBorder: string;     // Header border
  navBg: string;            // Bottom nav background
  navText: string;          // Bottom nav text
  navBorder: string;        // Bottom nav border
  btnPrimaryBg: string;     // Primary button bg
  btnPrimaryText: string;   // Primary button text
  btnPrimaryHover: string;
  // Utility class names
  pageClass: string;
  cardClass: string;
  cardSubtextClass: string;
  textOutsideClass: string;
  textOutsideSubClass: string;
  searchClass: string;
  headerClass: string;
  navClass: string;
  // Legacy compatibility fields
  isDark: boolean;
  isGhost?: boolean;
  bgGradient: string;
  cardBg: string;
  cardBorder: string;
  buttonGradient: string;
  accentText: string;
  accentBadge: string;
  accentGlow: string;
  activeTabBg: string;
  textColor: string;
  subtextColor: string;
  hoverBg: string;
}

export const APP_THEMES: Record<ThemeId, AppTheme> = {
  white: {
    id: 'white',
    name: 'White Theme (Light)',
    description: 'Page bg #FFFFFF white, #000000 black cards, #FFFFFF white text inside, #000000 black text outside',
    icon: '☀️',
    background: '#FFFFFF',
    textOutside: '#000000',
    textOutsideSub: '#4B5563',
    card: '#000000',
    cardText: '#FFFFFF',
    cardSubtext: '#B0B3B8',
    border: '#1A1A1A',
    accent: '#000000',
    searchBg: '#000000',
    searchText: '#FFFFFF',
    searchBorder: '#1A1A1A',
    headerBg: '#FFFFFF',
    headerText: '#000000',
    headerBorder: '#E5E7EB',
    navBg: '#FFFFFF',
    navText: '#000000',
    navBorder: '#E5E7EB',
    btnPrimaryBg: '#000000',
    btnPrimaryText: '#FFFFFF',
    btnPrimaryHover: 'hover:bg-neutral-800',
    pageClass: 'bg-white text-black',
    cardClass: 'bg-black text-white border border-[#1A1A1A]',
    cardSubtextClass: 'text-[#B0B3B8]',
    textOutsideClass: 'text-black',
    textOutsideSubClass: 'text-gray-600',
    searchClass: 'bg-black text-white border border-[#1A1A1A] placeholder-[#B0B3B8]',
    headerClass: 'bg-white text-black border-gray-200',
    navClass: 'bg-white text-black border-gray-200',
    // Compatibility fields
    isDark: false,
    bgGradient: 'from-white via-white to-gray-50',
    cardBg: 'bg-black text-white border border-[#1A1A1A]',
    cardBorder: 'border-[#1A1A1A]',
    buttonGradient: 'bg-black hover:bg-neutral-800 text-white font-bold',
    accentText: 'text-black',
    accentBadge: 'bg-black text-white border border-[#1A1A1A]',
    accentGlow: 'shadow-black/20',
    activeTabBg: 'text-black border-b-2 border-black',
    textColor: 'text-black',
    subtextColor: 'text-gray-600',
    hoverBg: 'hover:bg-black/5',
  },
  black: {
    id: 'black',
    name: 'Black Theme (Dark)',
    description: 'Page bg #000000 black, #FFFFFF white cards, #000000 black text inside, #FFFFFF white text outside',
    icon: '🌙',
    background: '#000000',
    textOutside: '#FFFFFF',
    textOutsideSub: '#9CA3AF',
    card: '#FFFFFF',
    cardText: '#000000',
    cardSubtext: '#65676B',
    border: '#E4E6EB',
    accent: '#FFFFFF',
    searchBg: '#FFFFFF',
    searchText: '#000000',
    searchBorder: '#E4E6EB',
    headerBg: '#000000',
    headerText: '#FFFFFF',
    headerBorder: '#1F2937',
    navBg: '#000000',
    navText: '#FFFFFF',
    navBorder: '#1F2937',
    btnPrimaryBg: '#FFFFFF',
    btnPrimaryText: '#000000',
    btnPrimaryHover: 'hover:bg-neutral-200',
    pageClass: 'bg-black text-white',
    cardClass: 'bg-white text-black border border-[#E4E6EB]',
    cardSubtextClass: 'text-[#65676B]',
    textOutsideClass: 'text-white',
    textOutsideSubClass: 'text-gray-400',
    searchClass: 'bg-white text-black border border-[#E4E6EB] placeholder-[#65676B]',
    headerClass: 'bg-black text-white border-zinc-800',
    navClass: 'bg-black text-white border-zinc-800',
    // Compatibility fields
    isDark: true,
    bgGradient: 'from-black via-black to-zinc-950',
    cardBg: 'bg-white text-black border border-[#E4E6EB]',
    cardBorder: 'border-[#E4E6EB]',
    buttonGradient: 'bg-white hover:bg-neutral-200 text-black font-bold',
    accentText: 'text-white',
    accentBadge: 'bg-white/10 text-white border border-white/20',
    accentGlow: 'shadow-white/20',
    activeTabBg: 'text-white border-b-2 border-white',
    textColor: 'text-white',
    subtextColor: 'text-gray-400',
    hoverBg: 'hover:bg-white/10',
  },
  ghost: {
    id: 'ghost',
    name: 'Ghost Theme',
    description: 'Page bg #5B21B6 deep purple, #000000 black cards, #FFFFFF white text & #00F5FF cyan glow',
    icon: '👻',
    background: '#5B21B6',
    textOutside: '#FFFFFF',
    textOutsideSub: '#DDD6FE',
    card: '#000000',
    cardText: '#FFFFFF',
    cardSubtext: '#B0B3B8',
    border: '#2A2A3F',
    accent: '#00F5FF',
    searchBg: '#000000',
    searchText: '#FFFFFF',
    searchBorder: '#2A2A3F',
    headerBg: '#000000',
    headerText: '#FFFFFF',
    headerBorder: '#2A2A3F',
    navBg: '#000000',
    navText: '#FFFFFF',
    navBorder: '#2A2A3F',
    btnPrimaryBg: '#00F5FF',
    btnPrimaryText: '#000000',
    btnPrimaryHover: 'hover:bg-[#00d8e6]',
    pageClass: 'bg-[#5B21B6] text-white',
    cardClass: 'bg-black text-white border border-[#2A2A3F] shadow-[0_0_15px_rgba(0,245,255,0.15)]',
    cardSubtextClass: 'text-[#B0B3B8]',
    textOutsideClass: 'text-white',
    textOutsideSubClass: 'text-purple-200',
    searchClass: 'bg-black text-white border border-[#2A2A3F] placeholder-[#B0B3B8]',
    headerClass: 'bg-black text-white border-[#2A2A3F]',
    navClass: 'bg-black text-white border-[#2A2A3F]',
    // Compatibility fields
    isDark: true,
    isGhost: true,
    bgGradient: 'from-[#5B21B6] via-[#6D28D9] to-[#7C3AED]',
    cardBg: 'bg-black text-white border border-[#2A2A3F]',
    cardBorder: 'border-[#2A2A3F]',
    buttonGradient: 'bg-[#00F5FF] hover:bg-[#00d8e6] text-black font-bold shadow-[0_0_15px_rgba(0,245,255,0.4)]',
    accentText: 'text-[#00F5FF]',
    accentBadge: 'bg-[#00F5FF]/15 text-[#00F5FF] border border-[#00F5FF]/30',
    accentGlow: 'shadow-[0_0_20px_rgba(0,245,255,0.35)]',
    activeTabBg: 'text-[#00F5FF] border-b-2 border-[#00F5FF]',
    textColor: 'text-white',
    subtextColor: 'text-purple-200',
    hoverBg: 'hover:bg-purple-900/30',
  },
};

export const COUNTRY_THEMES = APP_THEMES;

export function normalizeThemeId(_themeId?: string): ThemeId {
  return 'ghost';
}

export function detectDefaultTheme(_savedThemeOrCountry?: string): ThemeId {
  return 'ghost';
}

export function saveCountryTheme(_themeId?: string) {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('ghosted_theme_mode', 'ghost');
      localStorage.setItem('ghosted_theme', 'ghost');
      localStorage.setItem('ghosted_country_theme', 'ghost');
    } catch {}
  }
}

export const getActiveCountryTheme = (user?: { themeCountry?: string } | null): ThemeId => {
  return detectDefaultTheme(user?.themeCountry);
};

export function isUserFromNigeria(user?: { country?: string; stateCountry?: string; city?: string } | null): boolean {
  if (!user) return false;
  const combined = `${user.country || ''} ${user.stateCountry || ''} ${user.city || ''}`.toLowerCase();
  return (
    combined.includes('nigeria') ||
    combined.includes('lagos') ||
    combined.includes('abuja') ||
    combined.includes('enugu') ||
    combined.includes('port harcourt') ||
    combined.includes('ibadan') ||
    combined.includes('kano') ||
    combined.includes('benin city') ||
    combined.includes('calabar')
  );
}
