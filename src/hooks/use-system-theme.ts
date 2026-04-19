import { useEffect } from 'react';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function useSystemTheme() {
  useEffect(() => {
    const mediaQuery = window.matchMedia(DARK_MEDIA_QUERY);

    const applyTheme = () => {
      const isDark = mediaQuery.matches;

      document.documentElement.classList.toggle('dark', isDark);
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    };

    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);

    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, []);
}
