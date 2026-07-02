'use client';

import { useEffect } from 'react';

/** Înregistrează service worker-ul PWA (cache offline pentru shell). */
export function RegisterSW(): null {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}
