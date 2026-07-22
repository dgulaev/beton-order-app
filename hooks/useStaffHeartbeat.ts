'use client';

import { useEffect } from 'react';

/**
 * Пишет активность сотрудника в active_sessions (/api/adminCifra/heartbeat).
 * Нужен и в десктопной админке, и в /mobile — иначе со страницы «Кто в онлайн»
 * не видно тех, кто сидит только с телефона.
 *
 * Интервал 4 мин при окне «онлайн» 10 мин на API — с запасом на задержки сети.
 * При возврате во вкладку/приложение шлём сразу (мобильные браузеры часто
 * замораживают setInterval в фоне).
 */
export function useStaffHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const savedUserId = localStorage.getItem('userId');
    if (!savedUserId) return;

    const userId = parseInt(savedUserId, 10);
    if (!Number.isFinite(userId)) return;

    const sendHeartbeat = async () => {
      try {
        await fetch('/api/adminCifra/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
      } catch (e) {
        console.warn('Heartbeat failed:', e);
      }
    };

    sendHeartbeat();

    const interval = setInterval(sendHeartbeat, 4 * 60 * 1000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') sendHeartbeat();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [enabled]);
}
