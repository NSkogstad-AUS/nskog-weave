import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'weave:font:v1';
const CHANGE_EVENT = 'weave:font-change';

export const APP_FONTS: { label: string; value: string }[] = [
  { label: 'Geist', value: '"Geist Variable", sans-serif' },
  { label: 'System UI', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { label: 'Helvetica Neue', value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'Gill Sans', value: '"Gill Sans", "Gill Sans MT", Calibri, sans-serif' },
  { label: 'Optima', value: '"Optima", "Optima Nova LT", Candara, sans-serif' },
  { label: 'Baskerville', value: '"Baskerville", "Baskerville Old Face", serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Palatino', value: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
];

export const DEFAULT_FONT = APP_FONTS[0].value;

function getStoredFont(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_FONT;
  } catch {
    return DEFAULT_FONT;
  }
}

function applyFont(value: string) {
  document.documentElement.style.setProperty('--font-sans', value);
  document.body.style.fontFamily = value;
}

export function useAppFont() {
  const [font, setFontState] = useState<string>(getStoredFont);

  const setFont = useCallback((next: string) => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    applyFont(next);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
    setFontState(next);
  }, []);

  useEffect(() => {
    applyFont(getStoredFont());

    const onFontChange = (e: Event) => {
      setFontState((e as CustomEvent<string>).detail);
    };
    window.addEventListener(CHANGE_EVENT, onFontChange);
    return () => window.removeEventListener(CHANGE_EVENT, onFontChange);
  }, []);

  return { font, setFont };
}
