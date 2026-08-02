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
/** Долгий фон (≥10 мин): вкладка часто «зомби» — на mobile делаем controlled reload. */
export const FROZEN_GAP_MS = 10 * 60_000;
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

/** Сколько мс вкладка была скрыта (по метке visibility=hidden). */
export function getWakeHiddenGapMs(): number {
  const t = readTs(WAKE_HIDDEN_AT_KEY);
  if (!t) return 0;
  return Math.max(0, Date.now() - t);
}

/**
 * Реальный простой: max(разрыв пульса, время в hidden).
 * Нужен, когда фоновые таймеры иногда тикают и «съедают» gap пульса,
 * но hiddenAt всё равно показывает час в свёрнутом браузере.
 */
export function getEffectiveWakeGapMs(): number {
  return Math.max(getWakeGapMs(), getWakeHiddenGapMs());
}

export function touchWakeBeat(now = Date.now()) {
  writeTs(WAKE_LAST_BEAT_KEY, now);
}

/** Уже запланирован controlled reload — не стартовать fetch/hardReset на зомби-вкладке. */
export function isWakeReloadScheduled(): boolean {
  const t = readTs(RELOAD_GUARD_KEY);
  return t != null && Date.now() - t < 15_000;
}

/**
 * Долгий фон → будет reload: страницам/broadcast нельзя параллельно
 * долбить сеть (Samsung держит TCP до 60–70 с даже после abort).
 */
export function shouldDeferWakeNetworkWork(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    return true;
  }
  if (isWakeReloadScheduled()) return true;
  return getEffectiveWakeGapMs() >= FROZEN_GAP_MS;
}

/**
 * Перезагрузка для mobile после долгого фона.
 * Сначала рвём realtime (иначе Samsung/Android может зависнуть на «Страница не отвечает»),
 * затем location.replace — чуть мягче голого reload на части WebView.
 *
 * Важно: флаг RELOAD_GUARD пишем ДО любых других wake-обработчиков, чтобы
 * дашборд не успел запустить 3 fetch, а broadcast — hardReset на полумёртвой сети.
 */
export function controlledMobileReload(reason: string) {
  if (typeof window === 'undefined') return;
  if (document.visibilityState !== 'visible') return;
  const t = readTs(RELOAD_GUARD_KEY);
  if (t != null && Date.now() - t < RELOAD_GUARD_MS) return;
  // Сразу: остальные listeners на visibility/focus увидят «reload идёт»
  writeTs(RELOAD_GUARD_KEY, Date.now());
  touchWakeBeat();
  clearTs(WAKE_HIDDEN_AT_KEY);
  console.warn(`♻️ [MobileWake] Controlled reload: ${reason}`);
  try {
    supabase.realtime.disconnect();
  } catch {
    /* ignore */
  }
  // Без паузы 150ms: иначе page useWakeRefresh успевает открыть hung-fetch'и
  // и забить пул соединений Samsung на минуту после reload.
  try {
    window.location.replace(window.location.href);
  } catch {
    window.location.reload();
  }
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
      const gap = getEffectiveWakeGapMs();
      if (gap > FROZEN_GAP_MS) {
        reloadOnce(`${reasonPrefix} ${Math.round(gap / 60000)} мин`);
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

// useWakeRefresh — мягкое восстановление при пробуждении вкладки БЕЗ перезагрузки
// (короткий app-switch / сон до FROZEN_GAP). На mobile layout при gap ≥ FROZEN_GAP
// сам вызывает controlledMobileReload — иначе «зомби» с зелёным индикатором.
//
// Пишет wake-beat в sessionStorage (как useWakeReload), чтобы broadcast видел
// реальный gap после сна и мог делать stale hard-reset.
//
// Триггеры:
//   visibilitychange → visible
//   pageshow (persisted / visible)
//   resume / focus / online
//   interval gap-check — если Samsung не прислал visibility после часа в фоне
export function useWakeRefresh(onWake: () => void, enabled = true) {
  const cbRef = useRef(onWake);
  cbRef.current = onWake;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let lastFire = 0;
    // Дебаунс: visibilitychange и pageshow нередко приходят почти одновременно —
    // не дёргаем onWake дважды подряд.
    const fire = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastFire < 3000) return;
      lastFire = now;
      try {
        // onWake может прочитать getWakeGapMs() ДО обновления пульса.
        cbRef.current();
      } catch (e) {
        // Не console.error(Error) — Next.js Dev Overlay рисует белый экран.
        console.warn('[WakeRefresh] onWake error:', e instanceof Error ? e.message : e);
      } finally {
        touchWakeBeat(now);
        clearTs(WAKE_HIDDEN_AT_KEY);
      }
    };

    // Пульс, пока вкладка видима — иначе getWakeGapMs() на mobile ≈ 0
    // и broadcast не отличает короткий app-switch от долгого сна.
    // ВАЖНО: сначала проверяем gap, иначе «холостой» touch съедает evidence сна.
    if (document.visibilityState === 'visible') {
      if (getEffectiveWakeGapMs() >= SOCKET_STALE_GAP_MS) {
        fire();
      } else {
        touchWakeBeat();
        // Иначе старый hiddenAt раздувает effective gap, пока вкладка уже открыта.
        clearTs(WAKE_HIDDEN_AT_KEY);
      }
    }

    const beat = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (getEffectiveWakeGapMs() >= SOCKET_STALE_GAP_MS) {
        fire();
        return;
      }
      touchWakeBeat(now);
      clearTs(WAKE_HIDDEN_AT_KEY);
    }, HEARTBEAT_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        writeTs(WAKE_HIDDEN_AT_KEY, Date.now());
        touchWakeBeat();
        return;
      }
      fire();
    };
    const onPageShow = (e: Event) => {
      if ((e as PageTransitionEvent).persisted || document.visibilityState === 'visible') {
        fire();
      }
    };
    const onResume = () => fire();
    const onFocus = () => fire();
    const onOnline = () => fire();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('resume', onResume);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      window.clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('resume', onResume);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled]);
}
