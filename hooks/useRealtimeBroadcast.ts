// hooks/useRealtimeBroadcast.ts
'use client';

// Broadcast-подписка (Broadcast from Database).
// В отличие от postgres_changes, здесь клиент слушает лёгкий broadcast-канал,
// а сообщения шлёт триггер БД через realtime.send(..., private => false).
// Хендшейк подписки лёгкий (нет регистрации в WAL и построчной RLS-проверки),
// поэтому подписка устанавливается стабильнее и не зависает в CONNECTING.
//
// ⚠️ Один канал на топик: Supabase не допускает двух каналов с одинаковым
// именем на одном клиенте (второй зависает в CONNECTING). Поэтому подписчики
// одного топика (например, дашборд подписывается на order_mixers:all дважды)
// шэрят ОДИН канал через реестр, каждый со своим набором колбэков.

import { useEffect, useRef, useState } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimeStatus } from './useRealtimeOrders';
import { getWakeGapMs, SOCKET_STALE_GAP_MS } from './useWakeReload';

interface BroadcastListener {
  onInsert?: (record: any) => void;
  onUpdate?: (record: any, old?: any) => void;
  onDelete?: (old: any) => void;
  onStatusChange?: (status: RealtimeStatus) => void;
  /** Выставлен при unmount — игнор после hardReset, если listener ещё в preserved set */
  dead?: boolean;
}

interface BroadcastEntry {
  channel: RealtimeChannel;
  listeners: Set<BroadcastListener>;
  status: RealtimeStatus;
  keepalive?: ReturnType<typeof setInterval>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  // Отложенное проставление статуса ERROR — чтобы индикатор не мигал красным
  // на короткие промежуточные сбои, из которых соединение само выходит.
  errorTimer?: ReturnType<typeof setTimeout>;
}

const registry = new Map<string, BroadcastEntry>();
let globalListenersAttached = false;

// Защита от параллельных вызовов reconnect() для одного топика.
// Без этого visibilitychange + keepalive-timer могут одновременно инициировать
// reconnect одного канала → двойное removeChannel + двойной connect → конфликт топиков.
const reconnectingTopics = new Set<string>();

/** Антиспам: один warn на пачку CHANNEL_ERROR 1006 по всем топикам. */
let socket1006LogUntil = 0;

// ── Глобальный агрегированный статус (наихудший из всех каналов) ──────────────
const globalStatusListeners = new Set<(s: RealtimeStatus) => void>();

function computeGlobalStatus(): RealtimeStatus {
  const statuses = Array.from(registry.values()).map((e) => e.status);
  if (statuses.length === 0) return 'CONNECTING';
  if (statuses.includes('ERROR')) return 'ERROR';
  if (statuses.includes('CLOSED')) return 'CLOSED';
  if (statuses.every((s) => s === 'SUBSCRIBED')) return 'SUBSCRIBED';
  return 'CONNECTING';
}

function notifyGlobal() {
  const s = computeGlobalStatus();
  globalStatusListeners.forEach((cb) => cb(s));
}

// Задержка перед тем, как показать ERROR в UI (дебаунс индикатора).
const ERROR_DEBOUNCE_MS = 6_000;
// Если сбой держится дольше этого времени — жёстко пересоздаём сам WebSocket-сокет
// (а не только каналы): признак «мёртвого» сокета, который сам не воскресает.
const HARD_RESET_AFTER_MS = 45_000;

// Момент первого не восстановившегося сбоя (по любому каналу). null = всё здорово.
let firstErrorAt: number | null = null;
let hardResetInProgress = false;

function notify(topic: string, status: RealtimeStatus) {
  const entry = registry.get(topic);
  if (!entry) return;
  entry.status = status;
  entry.listeners.forEach((l) => {
    if (l.dead) return;
    l.onStatusChange?.(status);
  });
  notifyGlobal();
}

function dispatch(topic: string, kind: 'insert' | 'update' | 'delete', record: any, old?: any) {
  const entry = registry.get(topic);
  if (!entry) return;
  entry.listeners.forEach((l) => {
    if (l.dead) return;
    if (kind === 'insert') l.onInsert?.(record);
    else if (kind === 'update') l.onUpdate?.(record, old);
    else l.onDelete?.(old);
  });
}

function pruneDeadListeners(entry: BroadcastEntry) {
  entry.listeners.forEach((l) => {
    if (l.dead) entry.listeners.delete(l);
  });
}

/** Сбросить firstErrorAt только когда все живые каналы снова SUBSCRIBED */
function clearFirstErrorIfHealthy() {
  if (registry.size === 0) {
    firstErrorAt = null;
    return;
  }
  for (const e of registry.values()) {
    if (e.status !== 'SUBSCRIBED') return;
  }
  firstErrorAt = null;
}

function connect(topic: string): BroadcastEntry {
  const existing = registry.get(topic);
  if (existing) return existing;

  console.log(`🟡 [Broadcast] Подключаюсь к каналу → ${topic}`);
  // ⚠️ private: false обязателен: триггеры шлют realtime.send(..., false)
  // (публичный broadcast). Если Realtime Authorization включён в проекте,
  // канал по умолчанию private → join падает с CHANNEL_ERROR и SUBSCRIBED
  // никогда не приходит.
  const channel = supabase.channel(topic, {
    config: {
      private: false,
      broadcast: { self: false, ack: false },
    },
  });
  const entry: BroadcastEntry = { channel, listeners: new Set(), status: 'CONNECTING' };
  registry.set(topic, entry);

  channel
    .on('broadcast', { event: 'INSERT' }, (msg: any) => {
      dispatch(topic, 'insert', msg.payload?.record ?? msg.payload, msg.payload?.old);
    })
    .on('broadcast', { event: 'UPDATE' }, (msg: any) => {
      dispatch(topic, 'update', msg.payload?.record ?? msg.payload, msg.payload?.old);
    })
    .on('broadcast', { event: 'DELETE' }, (msg: any) => {
      dispatch(topic, 'delete', msg.payload?.record ?? msg.payload, msg.payload?.old);
    })
    .subscribe((s, err) => {
      const e = registry.get(topic);
      if (s === 'SUBSCRIBED') {
        console.log(`✅ [Broadcast] ПОДПИСКА АКТИВНА → ${topic}`);
        // Соединение живо — снимаем отложенный ERROR.
        if (e?.errorTimer) {
          clearTimeout(e.errorTimer);
          e.errorTimer = undefined;
        }
        notify(topic, 'SUBSCRIBED');
        // Не сбрасываем firstErrorAt по одному топику: иначе 1 из 5
        // ожил — и watchdog больше не сделает hard-reset для остальных.
        clearFirstErrorIfHealthy();
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
        // 1006 = abnormal WebSocket close (Wi‑Fi, сон, idle) — штатно, keepalive
        // переподключит. Не спамим по 5 топиков одной и той же причиной.
        const detail = err ? String((err as any).message || err) : '';
        const isSocketBlip = /1006|socket closed/i.test(detail);
        const now = Date.now();
        if (!isSocketBlip) {
          console.warn(`⚠️ [Broadcast] ОШИБКА ${s} → ${topic}`, detail);
        } else if (now > socket1006LogUntil) {
          socket1006LogUntil = now + 15_000;
          console.warn(
            '⚠️ [Broadcast] Сокет закрыт (1006) — переподключение каналов…',
          );
        }
        if (firstErrorAt === null) firstErrorAt = Date.now();
        // Не мигаем индикатором сразу — вдруг восстановится за пару секунд.
        if (e && !e.errorTimer) {
          e.errorTimer = setTimeout(() => {
            e.errorTimer = undefined;
            if (registry.get(topic) === e && (e.channel as any)?.state !== 'joined') {
              notify(topic, 'ERROR');
            }
          }, ERROR_DEBOUNCE_MS);
        }
      } else if (s === 'CLOSED') {
        notify(topic, 'CLOSED');
      }
    });

  return entry;
}

// Жёсткий сброс: пересоздаём сам WebSocket-сокет и все каналы поверх свежего
// соединения. Нужно, когда сокет «умер» (idle-таймаут за ночь, длинный обрыв
// сети) — пересоздание одних каналов на мёртвом сокете даёт вечный CHANNEL_ERROR.
//
// ⚠️ КРИТИЧНО: НЕ используем await для supabase.removeChannel()!
// Если WebSocket мёртв, removeChannel пытается отправить "leave" на сервер
// и ждёт ack, который никогда не придёт. С await это замораживает функцию
// на таймаут (десятки секунд) для КАЖДОГО канала — именно это вызывает
// зависание страницы после пробуждения ноутбука от спящего режима.
function hardResetSocket() {
  if (hardResetInProgress) return;
  // Нечего сбрасывать — каналов нет. Просто обнуляем счётчик ошибок.
  if (registry.size === 0) { firstErrorAt = null; return; }
  hardResetInProgress = true;
  console.warn('🔌 [Broadcast] Жёсткий сброс WebSocket-сокета (устойчивый сбой)');

  const preserved: { topic: string; listeners: Set<BroadcastListener> }[] = [];
  for (const [topic, entry] of registry) {
    preserved.push({ topic, listeners: entry.listeners });
    if (entry.keepalive) clearInterval(entry.keepalive);
    if (entry.errorTimer) clearTimeout(entry.errorTimer);
    // Fire-and-forget: не await — removeChannel на мёртвом WebSocket зависает
    // в ожидании серверного ack. Принудительно закроем сокет ниже через disconnect().
    try { void supabase.removeChannel(entry.channel); } catch {}
  }
  registry.clear();

  try {
    supabase.realtime.disconnect();
  } catch {
    // ignore
  }

  // Небольшая пауза, чтобы сокет успел закрыться, затем поднимаем каналы заново
  // (channel.subscribe сам инициирует новое соединение сокета).
  setTimeout(() => {
    for (const { topic, listeners } of preserved) {
      // Выкидываем listeners от уже размонтированных компонентов
      listeners.forEach((l) => {
        if (l.dead) listeners.delete(l);
      });
      if (listeners.size === 0) continue;

      const fresh = connect(topic);
      listeners.forEach((l) => fresh.listeners.add(l));
      // Гарантируем единственный keepalive на топик — старый уже очищен выше.
      if (!fresh.keepalive) {
        fresh.keepalive = setInterval(() => reconnect(topic), 20_000);
      }
      fresh.listeners.forEach((l) => {
        if (!l.dead) l.onStatusChange?.(fresh.status);
      });
    }
    clearFirstErrorIfHealthy();
    hardResetInProgress = false;
  }, 800);
}

function reconnect(topic: string) {
  // Защита от параллельных reconnect() одного топика:
  // visibilitychange + keepalive-timer могут сработать одновременно.
  if (reconnectingTopics.has(topic)) return;
  if (hardResetInProgress) return;

  const entry = registry.get(topic);
  if (!entry) return;
  const state = (entry.channel as any)?.state;
  // Не рвём канал, который уже joined или ещё joining — иначе keepalive
  // убивает подписку до SUBSCRIBED и в логе вечный CHANNEL_ERROR без ✅.
  if (state === 'joined' || state === 'joining') return;

  reconnectingTopics.add(topic);
  // При массовом 1006 уже есть одна сводка — не дублируем по каждому топику.
  if (Date.now() > socket1006LogUntil) {
    console.warn(`🔁 [Broadcast] Переподключение → ${topic} (состояние: ${state})`);
  }
  const listeners = entry.listeners;
  if (entry.keepalive) clearInterval(entry.keepalive);
  if (entry.errorTimer) clearTimeout(entry.errorTimer);
  void supabase.removeChannel(entry.channel);
  registry.delete(topic);

  const fresh = connect(topic);
  listeners.forEach((l) => fresh.listeners.add(l));
  // Не создаём лишний setInterval если connect() уже поднял keepalive
  if (!fresh.keepalive) {
    fresh.keepalive = setInterval(() => reconnect(topic), 20_000);
  }
  // Сообщаем актуальный статус перенесённым слушателям
  fresh.listeners.forEach((l) => {
    if (!l.dead) l.onStatusChange?.(fresh.status);
  });
  pruneDeadListeners(fresh);

  // Снимаем блокировку после того, как новый канал начал подключаться
  setTimeout(() => reconnectingTopics.delete(topic), 5_000);
}

// Публичная функция — ручной реконнект всех broadcast-каналов (клик по индикатору)
export function reconnectAllBroadcastChannels() {
  registry.forEach((_e, topic) => reconnect(topic));
}

// Публичная функция — принудительный жёсткий сброс сокета (для мягкого
// восстановления на мобильном при пробуждении: пересоздаём соединение целиком,
// т.к. после фоновой заморозки сокет часто «зомби»).
export function hardResetBroadcastSocket() {
  void hardResetSocket();
}

function attachGlobalListeners() {
  if (globalListenersAttached || typeof document === 'undefined') return;
  globalListenersAttached = true;

  // После долгого сна/заморозки сокет мёртв: мягкий reconnect даёт минуты
  // TIMED_OUT → CHANNEL_ERROR. Сразу hard-reset (если WakeReload не сделал reload).
  let lastRecoverAt = 0;
  const recoverAfterWake = (source: string, opts?: { softOk?: boolean }) => {
    if (document.visibilityState !== 'visible') return;
    if (registry.size === 0) return;
    if (hardResetInProgress) return;

    const now = Date.now();
    if (now - lastRecoverAt < 3000) return;

    const gap = getWakeGapMs();
    const stale = gap >= SOCKET_STALE_GAP_MS;

    // focus/online/pageshow без bfcache — только если простой длинный,
    // иначе каждый клик в окно срывал бы живые каналы.
    if (!stale && !opts?.softOk) return;

    // Короткое переключение вкладки: ничего не трогаем, если все каналы живы.
    if (!stale && opts?.softOk) {
      let needsRepair = false;
      for (const e of registry.values()) {
        const st = (e.channel as any)?.state;
        if (e.status !== 'SUBSCRIBED' || (st && st !== 'joined' && st !== 'joining')) {
          needsRepair = true;
          break;
        }
      }
      if (!needsRepair) return;
    }

    lastRecoverAt = now;

    if (stale) {
      // 700ms: даём useWakeReload шанс сделать location.reload при gap > 10 мин
      // (reload сбросит всё сам). Если reload не нужен — поднимаем свежий сокет.
      console.warn(
        `🔌 [Broadcast] Пробуждение (${source}): простой ~${Math.round(gap / 60000)} мин → hard-reset`,
      );
      firstErrorAt = null;
      setTimeout(() => {
        if (document.visibilityState !== 'visible') return;
        void hardResetSocket();
      }, 700);
      return;
    }

    // Короткое переключение вкладки — шахматное переподключение только «больных».
    let i = 0;
    registry.forEach((e, topic) => {
      const st = (e.channel as any)?.state;
      if (st === 'joined' || st === 'joining') return;
      setTimeout(() => reconnect(topic), 500 + i * 200);
      i += 1;
    });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // При уходе в фон сбрасываем счётчик ошибок. Без этого watchdog видит
      // firstErrorAt = "до сна" и немедленно запускает hardReset при пробуждении
      // (даже если ошибка исчезла до начала сна и есть только из-за кратковременного
      // обрыва сети, который давно восстановился).
      firstErrorAt = null;
    } else {
      recoverAfterWake('visibility', { softOk: true });
    }
  });
  window.addEventListener('online', () => recoverAfterWake('online'));
  // Мобильные / Mac sleep: возврат из bfcache и выход из «заморозки»
  window.addEventListener('pageshow', (e) => {
    const persisted = (e as PageTransitionEvent).persisted;
    recoverAfterWake('pageshow', { softOk: persisted });
  });
  document.addEventListener('resume', () => recoverAfterWake('resume', { softOk: true }));
  window.addEventListener('focus', () => recoverAfterWake('focus'));

  // Watchdog: если сбой держится дольше HARD_RESET_AFTER_MS — сокет считается
  // «мёртвым», делаем жёсткий сброс всего соединения. Проверяем только на
  // видимой вкладке (в фоне браузер всё равно троттлит; пробуждение поднимет
  // страницу через useWakeReload/recoverAfterWake).
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (firstErrorAt === null) return;
    // Нет активных каналов — ошибка устарела, сбрасываем без сброса сокета.
    if (registry.size === 0) { firstErrorAt = null; return; }
    if (Date.now() - firstErrorAt > HARD_RESET_AFTER_MS) {
      void hardResetSocket();
    }
  }, 15_000);
}

interface BroadcastOptions extends BroadcastListener {
  /** Имя топика, должно совпадать с topic в триггере БД, напр. `order_mixers:all` */
  topic: string;
  enabled?: boolean;
}

export function useRealtimeBroadcast({
  topic,
  enabled = true,
  onInsert,
  onUpdate,
  onDelete,
  onStatusChange,
}: BroadcastOptions) {
  const cbRef = useRef<BroadcastListener>({});
  cbRef.current = { onInsert, onUpdate, onDelete, onStatusChange };

  const [status, setStatus] = useState<RealtimeStatus>('CONNECTING');

  useEffect(() => {
    if (!enabled || !topic) return;

    attachGlobalListeners();

    const entry = connect(topic);

    // Отменяем отложенное закрытие, если подписчик вернулся
    if (entry.cleanupTimer) {
      clearTimeout(entry.cleanupTimer);
      entry.cleanupTimer = undefined;
    }
    // Запускаем keepalive один раз на топик (защита: не создаём дубли)
    if (!entry.keepalive) {
      entry.keepalive = setInterval(() => reconnect(topic), 20_000);
    }

    const listener: BroadcastListener = {
      onInsert: (r) => cbRef.current.onInsert?.(r),
      onUpdate: (r, o) => cbRef.current.onUpdate?.(r, o),
      onDelete: (o) => cbRef.current.onDelete?.(o),
      onStatusChange: (s) => {
        if (listener.dead) return;
        cbRef.current.onStatusChange?.(s);
        setStatus(s);
      },
    };
    entry.listeners.add(listener);
    // Сообщаем текущий статус сразу
    listener.onStatusChange?.(entry.status);

    return () => {
      listener.dead = true;
      const current = registry.get(topic);
      if (!current) return;
      current.listeners.delete(listener);
      pruneDeadListeners(current);

      // Последний подписчик ушёл — откладываем закрытие (StrictMode делает
      // mount→unmount→mount; при мгновенном возврате не пересоздаём канал).
      if (current.listeners.size === 0) {
        current.cleanupTimer = setTimeout(() => {
          if (current.listeners.size > 0) return;
          if (current.keepalive) clearInterval(current.keepalive);
          if (current.errorTimer) clearTimeout(current.errorTimer);
          void supabase.removeChannel(current.channel);
          if (registry.get(topic) === current) {
            registry.delete(topic);
            // Уведомляем глобальный индикатор: канал ушёл из реестра.
            // Без этого вызова точка застревает в CLOSED/ERROR при переходе
            // на страницу без собственных broadcast-каналов.
            notifyGlobal();
            // Реестр стал пустым — сбрасываем счётчик ошибок, иначе watchdog
            // запустит hardResetSocket() по устаревшему firstErrorAt уже после
            // ухода пользователя на страницу без каналов.
            if (registry.size === 0) firstErrorAt = null;
          }
          console.log(`🔌 [Broadcast] Канал закрыт (нет подписчиков) → ${topic}`);
        }, 100);
      }
    };
  }, [topic, enabled]);

  return { status };
}

/**
 * Возвращает агрегированный статус всех broadcast-каналов.
 * 'SUBSCRIBED' — все каналы живы.
 * 'CONNECTING' — идёт подключение.
 * 'ERROR' / 'CLOSED' — хотя бы один канал упал.
 * Нажатие на индикатор → reconnectAllBroadcastChannels().
 */
export function useGlobalBroadcastStatus(): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>(computeGlobalStatus());

  useEffect(() => {
    const cb = (s: RealtimeStatus) => setStatus(s);
    globalStatusListeners.add(cb);
    // Синхронизируем сразу, если уже что-то есть в registry
    setStatus(computeGlobalStatus());
    return () => { globalStatusListeners.delete(cb); };
  }, []);

  return status;
}
