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
//
// Восстановление после обрыва сокета:
// - один глобальный keepalive (не N интервалов на топик);
// - массовый сбой (≥2 больных канала) → сразу hard-reset сокета;
// - логи socket-blip / reconnect — одна строка на шторм, не по 5 топикам.

import { useEffect, useRef, useState } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimeStatus } from './useRealtimeOrders';
import { getWakeGapMs, SOCKET_STALE_GAP_MS } from './useWakeReload';

interface BroadcastListener {
  onInsert?: (record: any) => void;
  onUpdate?: (record: any, old?: any) => void;
  onDelete?: (old: any) => void;
  /** Один сигнал после пачки изменений (apply плана) — вместо N INSERT/DELETE */
  onReload?: () => void;
  onStatusChange?: (status: RealtimeStatus) => void;
  /** Выставлен при unmount — игнор после hardReset, если listener ещё в preserved set */
  dead?: boolean;
}

interface BroadcastEntry {
  channel: RealtimeChannel;
  listeners: Set<BroadcastListener>;
  status: RealtimeStatus;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  // Отложенное проставление статуса ERROR — чтобы индикатор не мигал красным
  // на короткие промежуточные сбои, из которых соединение само выходит.
  errorTimer?: ReturnType<typeof setTimeout>;
  /** Склеить пачку RELOAD за короткое окно в один проход колбэков */
  reloadTimer?: ReturnType<typeof setTimeout>;
}

/** Окно склейки RELOAD (мс) — два слушателя / двойной сигнал → один проход */
const RELOAD_DEBOUNCE_MS = 120;

const registry = new Map<string, BroadcastEntry>();
let globalListenersAttached = false;

// Защита от параллельных вызовов reconnect() для одного топика.
const reconnectingTopics = new Set<string>();

/** Антиспам: один warn на пачку socket-blip по всем топикам. */
let socketBlipLogUntil = 0;

/** Батч логов reconnect → одна строка. */
const pendingReconnectTopics = new Set<string>();
let reconnectLogTimer: ReturnType<typeof setTimeout> | undefined;

/** Отложенная проверка «массовый сбой → hard-reset». */
let stormCheckTimer: ReturnType<typeof setTimeout> | undefined;

/** Один keepalive на весь реестр (не на каждый топик). */
let globalKeepalive: ReturnType<typeof setInterval> | undefined;

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
// Если сбой держится дольше — жёстко пересоздаём WebSocket (раньше было 45с;
// при socket-blip хватает быстрее, иначе успевает волна TIMED_OUT).
const HARD_RESET_AFTER_MS = 15_000;
const GLOBAL_KEEPALIVE_MS = 20_000;
const STORM_HARD_RESET_DEBOUNCE_MS = 600;
/** Сколько «больных» каналов считаем массовым падением сокета.
 * Было 2 — с топиком daily_logistics_plans ложные hard-reset стали чаще. */
const STORM_SICK_THRESHOLD = 3;
const SOCKET_BLIP_LOG_WINDOW_MS = 20_000;

// Момент первого не восстановившегося сбоя (по любому каналу). null = всё здорово.
let firstErrorAt: number | null = null;
let hardResetInProgress = false;

function channelState(entry: BroadcastEntry): string {
  return String((entry.channel as any)?.state || '');
}

function isChannelHealthy(entry: BroadcastEntry): boolean {
  const st = channelState(entry);
  return st === 'joined' || st === 'joining';
}

function listSickTopics(): string[] {
  const sick: string[] = [];
  for (const [topic, entry] of registry) {
    if (!isChannelHealthy(entry)) sick.push(topic);
  }
  return sick;
}

/**
 * Обрыв уровня WebSocket (Phoenix heartbeat / 1006 / TIMED_OUT join).
 * Это НЕ HTTP /api/adminCifra/heartbeat.
 */
function isSocketBlip(status: string, detail: string): boolean {
  if (status === 'TIMED_OUT') return true;
  return /1006|socket closed|heartbeat timeout/i.test(detail);
}

function noteSocketBlipLog(status: string, detail: string) {
  const now = Date.now();
  if (now <= socketBlipLogUntil) return;
  socketBlipLogUntil = now + SOCKET_BLIP_LOG_WINDOW_MS;
  const reason = (detail || status || 'unknown').slice(0, 80);
  console.warn(`⚠️ [Broadcast] Сокет Realtime упал (${reason}) — чиним каналы…`);
}

function noteReconnectLog(topic: string, state: string) {
  pendingReconnectTopics.add(topic);
  if (reconnectLogTimer) return;
  const firstState = state;
  reconnectLogTimer = setTimeout(() => {
    reconnectLogTimer = undefined;
    const topics = [...pendingReconnectTopics];
    pendingReconnectTopics.clear();
    if (topics.length === 0) return;
    if (topics.length === 1) {
      console.warn(`🔁 [Broadcast] Переподключение → ${topics[0]} (состояние: ${firstState})`);
      return;
    }
    console.warn(`🔁 [Broadcast] Переподключение ${topics.length} каналов…`);
  }, 200);
}

function scheduleStormHardReset() {
  if (hardResetInProgress) return;
  if (stormCheckTimer) return;
  stormCheckTimer = setTimeout(() => {
    stormCheckTimer = undefined;
    if (hardResetInProgress) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const sick = listSickTopics();
    if (sick.length < STORM_SICK_THRESHOLD) return;
    console.warn(
      `🔌 [Broadcast] Массовый сбой (${sick.length} каналов) → hard-reset сокета`,
    );
    void hardResetSocket();
  }, STORM_HARD_RESET_DEBOUNCE_MS);
}

function ensureGlobalKeepalive() {
  if (globalKeepalive || typeof window === 'undefined') return;
  globalKeepalive = setInterval(() => {
    if (hardResetInProgress) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (registry.size === 0) return;

    const sick = listSickTopics();
    if (sick.length === 0) return;

    // Несколько больных на одном сокете — не чиним по одному (будет TIMED_OUT).
    if (sick.length >= STORM_SICK_THRESHOLD) {
      scheduleStormHardReset();
      return;
    }

    reconnect(sick[0]);
  }, GLOBAL_KEEPALIVE_MS);
}

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

function dispatch(
  topic: string,
  kind: 'insert' | 'update' | 'delete' | 'reload',
  record?: any,
  old?: any,
) {
  const entry = registry.get(topic);
  if (!entry) return;
  if (kind === 'reload') {
    // Несколько RELOAD подряд (или два хука на один топик) — один проход.
    if (entry.reloadTimer) clearTimeout(entry.reloadTimer);
    entry.reloadTimer = setTimeout(() => {
      entry.reloadTimer = undefined;
      const current = registry.get(topic);
      if (!current) return;
      current.listeners.forEach((l) => {
        if (l.dead) return;
        l.onReload?.();
      });
    }, RELOAD_DEBOUNCE_MS);
    return;
  }
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
  ensureGlobalKeepalive();

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
    .on('broadcast', { event: 'RELOAD' }, () => {
      dispatch(topic, 'reload');
    })
    .subscribe((s, err) => {
      const e = registry.get(topic);
      if (s === 'SUBSCRIBED') {
        console.log(`✅ [Broadcast] ПОДПИСКА АКТИВНА → ${topic}`);
        if (e?.errorTimer) {
          clearTimeout(e.errorTimer);
          e.errorTimer = undefined;
        }
        notify(topic, 'SUBSCRIBED');
        // Не сбрасываем firstErrorAt по одному топику: иначе 1 из 5
        // ожил — и watchdog больше не сделает hard-reset для остальных.
        clearFirstErrorIfHealthy();
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
        // heartbeat timeout / 1006 / TIMED_OUT — обычно один мёртвый WS на все топики.
        const detail = err ? String((err as any).message || err) : '';
        const blip = isSocketBlip(s, detail);
        if (blip) {
          noteSocketBlipLog(s, detail);
        } else {
          console.warn(`⚠️ [Broadcast] ОШИБКА ${s} → ${topic}`, detail);
        }
        if (firstErrorAt === null) firstErrorAt = Date.now();
        if (blip) scheduleStormHardReset();
        // Не мигаем индикатором сразу — вдруг восстановится за пару секунд.
        if (e && !e.errorTimer) {
          e.errorTimer = setTimeout(() => {
            e.errorTimer = undefined;
            if (registry.get(topic) === e && channelState(e) !== 'joined') {
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
  if (registry.size === 0) {
    firstErrorAt = null;
    return;
  }
  hardResetInProgress = true;
  if (stormCheckTimer) {
    clearTimeout(stormCheckTimer);
    stormCheckTimer = undefined;
  }
  console.warn('🔌 [Broadcast] Жёсткий сброс WebSocket-сокета (устойчивый сбой)');

  const preserved: { topic: string; listeners: Set<BroadcastListener> }[] = [];
  for (const [topic, entry] of registry) {
    preserved.push({ topic, listeners: entry.listeners });
    if (entry.errorTimer) clearTimeout(entry.errorTimer);
    // Fire-and-forget: не await — removeChannel на мёртвом WebSocket зависает
    // в ожидании серверного ack. Принудительно закроем сокет ниже через disconnect().
    try { void supabase.removeChannel(entry.channel); } catch { /* ignore */ }
  }
  registry.clear();
  reconnectingTopics.clear();

  try {
    supabase.realtime.disconnect();
  } catch {
    // ignore
  }

  // Небольшая пауза, чтобы сокет успел закрыться, затем поднимаем каналы заново
  // (channel.subscribe сам инициирует новое соединение сокета).
  setTimeout(() => {
    for (const { topic, listeners } of preserved) {
      listeners.forEach((l) => {
        if (l.dead) listeners.delete(l);
      });
      if (listeners.size === 0) continue;

      const fresh = connect(topic);
      listeners.forEach((l) => fresh.listeners.add(l));
      fresh.listeners.forEach((l) => {
        if (!l.dead) l.onStatusChange?.(fresh.status);
      });
    }
    ensureGlobalKeepalive();
    clearFirstErrorIfHealthy();
    hardResetInProgress = false;
  }, 800);
}

function reconnect(topic: string) {
  if (reconnectingTopics.has(topic)) return;
  if (hardResetInProgress) return;

  // Массовый сбой — не плодим per-topic reconnect на мёртвом сокете.
  const sick = listSickTopics();
  if (sick.length >= STORM_SICK_THRESHOLD) {
    scheduleStormHardReset();
    return;
  }

  const entry = registry.get(topic);
  if (!entry) return;
  const state = channelState(entry);
  // Не рвём канал, который уже joined или ещё joining — иначе keepalive
  // убивает подписку до SUBSCRIBED и в логе вечный CHANNEL_ERROR без ✅.
  if (state === 'joined' || state === 'joining') return;

  reconnectingTopics.add(topic);
  noteReconnectLog(topic, state || 'unknown');

  const listeners = entry.listeners;
  if (entry.errorTimer) clearTimeout(entry.errorTimer);
  void supabase.removeChannel(entry.channel);
  registry.delete(topic);

  const fresh = connect(topic);
  listeners.forEach((l) => fresh.listeners.add(l));
  fresh.listeners.forEach((l) => {
    if (!l.dead) l.onStatusChange?.(fresh.status);
  });
  pruneDeadListeners(fresh);

  setTimeout(() => reconnectingTopics.delete(topic), 5_000);
}

// Публичная функция — ручной реконнект всех broadcast-каналов (клик по индикатору)
export function reconnectAllBroadcastChannels() {
  const sick = listSickTopics();
  if (sick.length >= STORM_SICK_THRESHOLD) {
    void hardResetSocket();
    return;
  }
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
  ensureGlobalKeepalive();

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
        if (e.status !== 'SUBSCRIBED' || !isChannelHealthy(e)) {
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

    const sick = listSickTopics();
    if (sick.length >= STORM_SICK_THRESHOLD) {
      scheduleStormHardReset();
      return;
    }
    if (sick.length === 1) {
      setTimeout(() => reconnect(sick[0]), 500);
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // При уходе в фон сбрасываем счётчик ошибок. Без этого watchdog видит
      // firstErrorAt = "до сна" и немедленно запускает hardReset при пробуждении.
      firstErrorAt = null;
      if (stormCheckTimer) {
        clearTimeout(stormCheckTimer);
        stormCheckTimer = undefined;
      }
    } else {
      recoverAfterWake('visibility', { softOk: true });
    }
  });
  // online/focus: softOk — чиним только больные каналы даже при gap≈0
  // (сеть могла отвалиться без скрытия вкладки; на mobile так бывает часто).
  window.addEventListener('online', () => recoverAfterWake('online', { softOk: true }));
  window.addEventListener('pageshow', () => {
    recoverAfterWake('pageshow', { softOk: true });
  });
  document.addEventListener('resume', () => recoverAfterWake('resume', { softOk: true }));
  window.addEventListener('focus', () => recoverAfterWake('focus', { softOk: true }));

  // Watchdog: затянувшийся сбой → hard-reset. Только на видимой вкладке.
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (firstErrorAt === null) return;
    if (registry.size === 0) {
      firstErrorAt = null;
      return;
    }
    if (hardResetInProgress) return;
    const sick = listSickTopics();
    if (sick.length >= STORM_SICK_THRESHOLD) {
      scheduleStormHardReset();
      return;
    }
    if (Date.now() - firstErrorAt > HARD_RESET_AFTER_MS) {
      void hardResetSocket();
    }
  }, 5_000);
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
  onReload,
  onStatusChange,
}: BroadcastOptions) {
  const cbRef = useRef<BroadcastListener>({});
  cbRef.current = { onInsert, onUpdate, onDelete, onReload, onStatusChange };

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

    const listener: BroadcastListener = {
      onInsert: (r) => cbRef.current.onInsert?.(r),
      onUpdate: (r, o) => cbRef.current.onUpdate?.(r, o),
      onDelete: (o) => cbRef.current.onDelete?.(o),
      onReload: () => cbRef.current.onReload?.(),
      onStatusChange: (s) => {
        if (listener.dead) return;
        cbRef.current.onStatusChange?.(s);
        setStatus(s);
      },
    };
    entry.listeners.add(listener);
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
          if (current.errorTimer) clearTimeout(current.errorTimer);
          void supabase.removeChannel(current.channel);
          if (registry.get(topic) === current) {
            registry.delete(topic);
            notifyGlobal();
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
    setStatus(computeGlobalStatus());
    return () => { globalStatusListeners.delete(cb); };
  }, []);

  return status;
}
