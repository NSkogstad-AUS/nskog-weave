import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import './index.css';
import { applyTheme } from './hooks/use-theme';
import type { ThemeMode } from './hooks/use-theme';

// Apply theme synchronously before first paint to avoid flash
const _storedTheme = (localStorage.getItem('weave:theme:v1') as ThemeMode | null) ?? 'system';
applyTheme(_storedTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
