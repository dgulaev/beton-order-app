'use client';

import { supabase } from '@/lib/supabaseClient';

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
//
// Пульс пишется в sessionStorage: после сна ноутбука Next/HMR часто ремаунтит
// хук и обнуляет in-memory lastBeat — без persistence детектор «съедает» день
// сна и не делает reload, а страница минутами крутит мёртвый WebSocket.

import { useEffect, useRef } from 'react';

const HEARTBEAT_MS = 30_000;
// Разрыв больше порога = вкладку заморозили / оставили надолго. Активная
// вкладка на переднем плане такого разрыва не даёт; обычное переключение между
// приложениями на несколько минут — тоже (порог заведомо выше троттлинга
// скрытой вкладки ~1 тик/мин), поэтому менеджеров при коротких переключениях
// это не трогает.
const FROZEN_GAP_MS = 10 * 60_000;
/** После такого простоя сокет почти всегда мёртв — нужен hard-reset, не «мягкий» reconnect. */
export const SOCKET_STALE_GAP_MS = 2 * 60_000;
// Не перезагружаемся повторно чаще, чем раз в минуту (защита от циклов).
const RELOAD_GUARD_MS = 60_000;
const RELOAD_GUARD_KEY = 'wakeReloadAt';
export const WAKE_LAST_BEAT_KEY = 'wakeLastBeatAt';
const WAKE_HIDDEN_AT_KEY = 'wakeHiddenAt';

function readTs(key: string): number | null {
  try {
    const n = Number(sessionStorage.getItem(key) || 0);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeTs(key: string, value: number) {
  try {
    sessionStorage.setItem(key, String(value));
  } catch {
    // sessionStorage может быть недоступен — не критично.
  }
}

function clearTs(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Сколько мс прошло с последнего «пульса» вкладки (0 = неизвестно). */
export function getWakeGapMs(): number {
  const t = readTs(WAKE_LAST_BEAT_KEY);
  if (!t) return 0;
  return Math.max(0, Date.now() - t);
}

export function touchWakeBeat(now = Date.now()) {
  writeTs(WAKE_LAST_BEAT_KEY, now);
}

export function useWakeReload(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const reloadedRecently = () => {
      const t = readTs(RELOAD_GUARD_KEY);
      return t != null && Date.now() - t < RELOAD_GUARD_MS;
    };

    const reloadOnce = (reason: string) => {
      // Будим только видимую вкладку — перезагружать скрытую бессмысленно и
      // может зациклиться.
      if (document.visibilityState !== 'visible') return;
      if (reloadedRecently()) return;
      writeTs(RELOAD_GUARD_KEY, Date.now());
      // Сбрасываем пульс ДО reload, иначе после перезагрузки gap снова огромный
      // и страница уйдёт в цикл перезагрузок.
      touchWakeBeat();
      clearTs(WAKE_HIDDEN_AT_KEY);
      console.warn(`♻️ [WakeReload] Перезагрузка страницы: ${reason}`);
      // Принудительно закрываем WebSocket ПЕРЕД перезагрузкой.
      // Без этого React unmount пытается graceful-завершить каналы через
      // removeChannel() на мёртвом сокете — ждёт ack, который не придёт,
      // и браузер показывает диалог «Страница не отвечает».
      try { supabase.realtime.disconnect(); } catch { /* ignore */ }
      // Небольшая пауза: даём disconnect() закрыть сокет до reload.
      setTimeout(() => window.location.reload(), 150);
    };

    const checkGapAndReload = (reasonPrefix: string) => {
      const gap = getWakeGapMs();
      if (gap > FROZEN_GAP_MS) {
        reloadOnce(`${reasonPrefix} ${Math.round(gap / 60000)} мин`);
        return true;
      }
      const hiddenAt = readTs(WAKE_HIDDEN_AT_KEY);
      if (hiddenAt && Date.now() - hiddenAt > FROZEN_GAP_MS) {
        reloadOnce(
          `${reasonPrefix} (скрыта) ${Math.round((Date.now() - hiddenAt) / 60000)} мин`,
        );
        return true;
      }
      return false;
    };

    // При маунте (в т.ч. HMR после сна) — сразу проверяем сохранённый пульс.
    if (document.visibilityState === 'visible') {
      checkGapAndReload('разрыв пульса при старте');
    }
    touchWakeBeat();

    // Тик heartbeat: ловит замороженную вкладку, которая наконец получила
    // процессорное время (экран включили / окно развернули). Работает даже
    // если visibilitychange не пришёл (напр. Mac sleep при visible-вкладке).
    const beat = setInterval(() => {
      const now = Date.now();
      const prev = readTs(WAKE_LAST_BEAT_KEY) ?? now;
      const gap = now - prev;
      touchWakeBeat(now);
      if (gap > FROZEN_GAP_MS) {
        reloadOnce(`разрыв пульса ${Math.round(gap / 60000)} мин`);
      }
    }, HEARTBEAT_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        writeTs(WAKE_HIDDEN_AT_KEY, Date.now());
        touchWakeBeat();
      } else {
        checkGapAndReload('вкладка была скрыта');
        clearTs(WAKE_HIDDEN_AT_KEY);
        touchWakeBeat();
      }
    };

    // Mac sleep часто НЕ шлёт visibilitychange=hidden — ловим pageshow/focus/online.
    const onPageShow = (e: Event) => {
      if ((e as PageTransitionEvent).persisted || document.visibilityState === 'visible') {
        checkGapAndReload('pageshow после простоя');
        touchWakeBeat();
      }
    };
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      checkGapAndReload('focus после простоя');
      touchWakeBeat();
    };
    const onOnline = () => {
      if (document.visibilityState !== 'visible') return;
      checkGapAndReload('online после простоя');
      touchWakeBeat();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled]);
}

// useWakeRefresh — мягкое восстановление при пробуждении вкладки БЕЗ перезагрузки.
// Для мобильных (водитель, мобильная админка): принудительный reload на Android
// (особенно Samsung Internet) сам подвисает на белом экране, поэтому вместо него
// при возврате на передний план просто переподключаем соединение и обновляем
// данные на месте. Страница остаётся отрисованной.
//
// Триггеры пробуждения на мобильном надёжнее ловятся комбинацией:
//   visibilitychange → visible  (обычный возврат на вкладку)
//   pageshow (persisted)        (восстановление из bfcache)
//   resume                      (Page Lifecycle API — выход из «заморозки»)
export function useWakeRefresh(onWake: () => void, enabled = true) {
  const cbRef = useRef(onWake);
  cbRef.current = onWake;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let lastFire = 0;
    // Дебаунс: visibilitychange и pageshow нередко приходят почти одновременно —
    // не дёргаем onWake дважды подряд.
    const fire = () => {
      const now = Date.now();
      if (now - lastFire < 3000) return;
      lastFire = now;
      try {
        cbRef.current();
      } catch (e) {
        // Не console.error(Error) — Next.js Dev Overlay рисует белый экран.
        console.warn('[WakeRefresh] onWake error:', e instanceof Error ? e.message : e);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') fire();
    };
    const onPageShow = (e: Event) => {
      if ((e as PageTransitionEvent).persisted) fire();
    };
    const onResume = () => fire();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('resume', onResume);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('resume', onResume);
    };
  }, [enabled]);
}
