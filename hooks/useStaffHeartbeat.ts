'use client';

import { useEffect } from 'react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';

/** Кастомное событие: проверить force-logout без синтетического visibilitychange. */
export const FORCE_LOGOUT_CHECK_EVENT = 'admincifra:force-logout-check';

/**
 * Пишет активность сотрудника в active_sessions (/api/adminCifra/heartbeat).
 * Нужен и в десктопной админке, и в /mobile — иначе со страницы «Кто в онлайн»
 * не видно тех, кто сидит только с телефона.
 *
 * Интервал 4 мин при окне «онлайн» 10 мин на API — с запасом на задержки сети.
 * При возврате во вкладку/приложение шлём сразу (мобильные браузеры часто
 * замораживают setInterval в фоне).
 *
 * Первый запрос чуть откладываем: на холодном старте Turbopack роут ещё
 * компилируется, и мгновенный fetch даёт ложный «Failed to fetch» в консоли.
 */
export function useStaffHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const savedUserId = localStorage.getItem('userId');
    if (!savedUserId) return;

    const userId = parseInt(savedUserId, 10);
    if (!Number.isFinite(userId) || userId <= 0) return;

    let cancelled = false;
    let controller: AbortController | null = null;
    let retryTimer: number | undefined;
    let forcedLogoutNotified = false;

    const notifyForceLogoutCheck = () => {
      // Не visibilitychange: иначе heartbeat/Broadcast/Role ловят его все сразу
      // и при 403 получается цикл heartbeat → event → heartbeat → …
      if (forcedLogoutNotified) return;
      forcedLogoutNotified = true;
      try {
        window.dispatchEvent(new Event(FORCE_LOGOUT_CHECK_EVENT));
      } catch { /* ignore */ }
    };

    const sendHeartbeat = async (isRetry = false) => {
      if (cancelled) return;
      // Уже выкинуты — не долбим API и не крутим цикл
      if (forcedLogoutNotified) return;

      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;

      try {
        // Сервер выключен / перезапуск — не долбим и не шумим в консоль
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

        const res = await fetch('/api/adminCifra/heartbeat', {
          method: 'POST',
          headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ userId }),
          signal,
        });
        if (res.status === 403) {
          notifyForceLogoutCheck();
          return;
        }
      } catch (e) {
        if (cancelled || signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        const isNet =
          msg.includes('Failed to fetch') ||
          msg.includes('NetworkError') ||
          msg.includes('Load failed') ||
          msg.includes('network');
        // Перезапуск Next/Turbopack, HMR, краткий оффлайн — ожидаемо, без warn в консоль
        if (isNet) {
          if (!isRetry) {
            retryTimer = window.setTimeout(() => {
              void sendHeartbeat(true);
            }, 2500);
          }
          return;
        }
        console.warn('Heartbeat failed:', e);
      }
    };

    // Даём Next/Turbopack поднять API-роут после Ready (+ компиляция роута)
    const startTimer = window.setTimeout(() => {
      void sendHeartbeat();
    }, 1500);

    const interval = window.setInterval(() => {
      void sendHeartbeat();
    }, 4 * 60 * 1000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void sendHeartbeat();
    };
    const onOnline = () => {
      void sendHeartbeat();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      window.clearInterval(interval);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled]);
}
