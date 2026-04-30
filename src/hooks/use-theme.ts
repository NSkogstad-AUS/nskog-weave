import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'weave:theme:v1';
const CHANGE_EVENT = 'weave:theme-change';

function getStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {}
  return 'system';
}

export function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(getStoredTheme);

  const setTheme = useCallback((next: ThemeMode) => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    applyTheme(next);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
    setThemeState(next);
  }, []);

  useEffect(() => {
    applyTheme(getStoredTheme());

    const onThemeChange = (e: Event) => {
      setThemeState((e as CustomEvent<ThemeMode>).detail);
    };
    window.addEventListener(CHANGE_EVENT, onThemeChange);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      if (getStoredTheme() === 'system') applyTheme('system');
    };
    mq.addEventListener('change', onSystemChange);

    return () => {
      window.removeEventListener(CHANGE_EVENT, onThemeChange);
      mq.removeEventListener('change', onSystemChange);
    };
  }, []);

  return { theme, setTheme };
}
