import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

interface FocusContextType {
  activeScreen: string;
  isWindowVisible: boolean;
  setActiveScreen: (screen: string) => void;
}

const FocusContext = createContext<FocusContextType>({
  activeScreen: 'home',
  isWindowVisible: true,
  setActiveScreen: () => {},
});

export const FocusProvider: React.FC<{ activeScreen: string; children: React.ReactNode }> = ({
  activeScreen,
  children,
}) => {
  const [isWindowVisible, setIsWindowVisible] = useState<boolean>(() => {
    return typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
  });

  useEffect(() => {
    const handleVisibility = () => {
      setIsWindowVisible(document.visibilityState === 'visible');
    };
    const handleFocus = () => setIsWindowVisible(true);
    const handleBlur = () => setIsWindowVisible(false);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  return (
    <FocusContext.Provider value={{ activeScreen, isWindowVisible, setActiveScreen: () => {} }}>
      {children}
    </FocusContext.Provider>
  );
};

export function useIsFocused(screenName: string = 'home'): boolean {
  const context = useContext(FocusContext);
  const [isStandaloneVisible, setIsStandaloneVisible] = useState(() => {
    return typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
  });

  useEffect(() => {
    const handleVisibility = () => {
      setIsStandaloneVisible(document.visibilityState === 'visible');
    };
    const handleFocus = () => setIsStandaloneVisible(true);
    const handleBlur = () => setIsStandaloneVisible(false);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  if (context && context.activeScreen) {
    return (context.activeScreen === screenName || !screenName) && context.isWindowVisible;
  }
  return isStandaloneVisible;
}

export function useFocusEffect(
  effect: () => (() => void) | void,
  deps: React.DependencyList = [],
  screenName: string = 'home'
) {
  const isFocused = useIsFocused(screenName);
  const cleanupRef = useRef<(() => void) | void>(undefined);

  useEffect(() => {
    if (isFocused) {
      cleanupRef.current = effect();
    } else {
      if (cleanupRef.current && typeof cleanupRef.current === 'function') {
        cleanupRef.current();
        cleanupRef.current = undefined;
      }
    }

    return () => {
      if (cleanupRef.current && typeof cleanupRef.current === 'function') {
        cleanupRef.current();
        cleanupRef.current = undefined;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, ...deps]);
}
