import React, { createContext, useContext, useEffect } from 'react';
import { ThemeId, AppTheme, APP_THEMES, saveCountryTheme } from '../utils/theme';

interface ThemeContextType {
  theme: ThemeId;
  currentTheme: AppTheme;
  setTheme: (theme: ThemeId | string) => void;
  cycleTheme: () => void;
  isWhite: boolean;
  isBlack: boolean;
  isGhost: boolean;
  // Aliases for compatibility
  isLight: boolean;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode; initialTheme?: string }> = ({
  children,
}) => {
  // Permanently locked to Ghosted theme
  const theme: ThemeId = 'ghost';

  const setTheme = (_nextTheme: ThemeId | string) => {
    // Locked to ghosted theme - no more switching to black or white
    saveCountryTheme('ghost');
  };

  const cycleTheme = () => {
    // Locked to ghosted theme - no more switching to black or white
    saveCountryTheme('ghost');
  };

  // Sync with document element and body for global styling
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.setAttribute('data-theme', 'ghost');
      document.body.setAttribute('data-theme', 'ghost');
      root.classList.add('dark');
      document.body.classList.add('dark');
      saveCountryTheme('ghost');
    }
  }, []);

  const currentTheme = APP_THEMES.ghost;
  const isWhite = false;
  const isBlack = false;
  const isGhost = true;
  const isLight = false;
  const isDark = true;

  return (
    <ThemeContext.Provider
      value={{
        theme,
        currentTheme,
        setTheme,
        cycleTheme,
        isWhite,
        isBlack,
        isGhost,
        isLight,
        isDark,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
