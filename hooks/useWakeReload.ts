'use client';

// useWakeReload — восстановление «замороженной» вкладки после долгого простоя.
//
// Проблема: если оставить вкладку в фоне (свёрнутый браузер) или с выключенным
// экраном на много часов, браузер уходит в глубокий троттлинг. Иногда страница
// возвращается в «зомби»-состояние: часть таймеров ещё тикает и пишет в консоль,
// но React больше не перерисовывает UI (индикатор врёт «зелёный», дата застыла
// на вчера), а WebSocket мёртв и переподключение крутится по кругу. Изнутри
// такую страницу надёжно оживить нельзя — единственное честное лечение это
// однократная перезагрузка.
//
// Детектор НЕ зависит от React-рендера и от статуса сокета (они в этот момент
// врут). Он опирается только на разрыв во времени между тиками локального
// heartbeat — это простое сравнение Date.now() в памяти, БЕЗ каких-либо запросов
// к серверу (в отличие от старого полинга): ноль трафика, ноль нагрузки.

import { useEffect } from 'react';

const HEARTBEAT_MS = 30_000;
// Разрыв больше порога = вкладку заморозили / оставили надолго. Активная
// вкладка на переднем плане такого разрыва не даёт; обычное переключение между
// приложениями на несколько минут — тоже (порог заведомо выше троттлинга
// скрытой вкладки ~1 тик/мин), поэтому менеджеров при коротких переключениях
// это не трогает.
const FROZEN_GAP_MS = 10 * 60_000;
// Не перезагружаемся повторно чаще, чем раз в минуту (защита от циклов).
const RELOAD_GUARD_MS = 60_000;
const RELOAD_GUARD_KEY = 'wakeReloadAt';

export function useWakeReload(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let lastBeat = Date.now();
    let hiddenAt: number | null = null;

    const reloadedRecently = () => {
      try {
        const t = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
        return Date.now() - t < RELOAD_GUARD_MS;
      } catch {
        return false;
      }
    };

    const reloadOnce = (reason: string) => {
      // Будим только видимую вкладку — перезагружать скрытую бессмысленно и
      // может зациклиться.
      if (document.visibilityState !== 'visible') return;
      if (reloadedRecently()) return;
      try {
        sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
      } catch {
        // sessionStorage может быть недоступен — не критично.
      }
      console.warn(`♻️ [WakeReload] Перезагрузка страницы: ${reason}`);
      window.location.reload();
    };

    // Тик heartbeat: ловит замороженную вкладку, которая наконец получила
    // процессорное время (экран включили / окно развернули). Работает даже
    // если visibilitychange не пришёл (напр. экран выключался, а вкладка
    // формально оставалась visible).
    const beat = setInterval(() => {
      const now = Date.now();
      const gap = now - lastBeat;
      lastBeat = now;
      if (gap > FROZEN_GAP_MS) {
        reloadOnce(`разрыв пульса ${Math.round(gap / 60000)} мин`);
      }
    }, HEARTBEAT_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else {
        lastBeat = Date.now();
        if (hiddenAt && Date.now() - hiddenAt > FROZEN_GAP_MS) {
          reloadOnce(`вкладка была скрыта ${Math.round((Date.now() - hiddenAt) / 60000)} мин`);
        }
        hiddenAt = null;
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
