// hooks/useRealtimeOrders.ts
'use client';

import { useEffect, useRef } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient'; // ← общий клиент, не создаём новый

type ChangeEvent = '*' | 'INSERT' | 'UPDATE' | 'DELETE';

type Listener = {
  onInsert?: (newRecord: any) => void;
  onUpdate?: (newRecord: any, oldRecord?: any) => void;
  onDelete?: (oldRecord: any) => void;
  onAny?: (payload: any) => void;
  onStatusChange?: (status: RealtimeStatus) => void;
};

export type RealtimeStatus = 'CONNECTING' | 'SUBSCRIBED' | 'ERROR' | 'CLOSED';

interface ChannelEntry {
  channel: RealtimeChannel;
  listeners: Set<Listener>;
  status: RealtimeStatus;
  retryCount: number;
  retryTimer?: ReturnType<typeof setTimeout>;
}

// Реестр: один физический канал на "table+event+filter", но много независимых
// подписчиков поверх него. Ключевой фикс: раньше здесь хранился один канал
// без списка слушателей, и второй/третий useRealtime() на ту же таблицу
// просто выходил по return, так и не подключив свой колбэк.
const channelRegistry = new Map<string, ChannelEntry>();

const MAX_RETRY_DELAY_MS = 30_000;

function buildChannelKey(table: string, event: ChangeEvent, filter?: string) {
  return `realtime:${table}:${event}:${filter ?? 'nofilter'}`;
}

function scheduleReconnect(channelKey: string, table: string, event: ChangeEvent, filter?: string) {
  const entry = channelRegistry.get(channelKey);
  if (!entry) return;

  const delay = Math.min(1000 * 2 ** entry.retryCount, MAX_RETRY_DELAY_MS);
  entry.retryCount += 1;

  console.warn(`⏳ [Realtime] Переподключение через ${delay}мс → ${table} (попытка ${entry.retryCount})`);

  entry.retryTimer = setTimeout(() => {
    // Полностью пересоздаём канал с нуля — самый надёжный способ
    // восстановиться после CHANNEL_ERROR / TIMED_OUT в supabase-js.
    try {
      supabase.removeChannel(entry.channel);
    } catch {
      // канал мог уже быть невалиден — игнорируем
    }
    channelRegistry.delete(channelKey);
    ensureChannel(channelKey, table, event, filter);
  }, delay);
}

function notifyStatus(channelKey: string, status: RealtimeStatus) {
  const entry = channelRegistry.get(channelKey);
  if (!entry) return;
  entry.status = status;
  entry.listeners.forEach((l) => l.onStatusChange?.(status));
}

function ensureChannel(channelKey: string, table: string, event: ChangeEvent, filter?: string): ChannelEntry {
  const existing = channelRegistry.get(channelKey);
  if (existing) return existing;

  const listeners = new Set<Listener>();

  const channel = supabase
    .channel(channelKey)
    .on(
      'postgres_changes',
      {
        event,
        schema: 'public',
        table,
        ...(filter ? { filter } : {}),
      },
      (payload: any) => {
        const recordId = payload.new?.id ?? payload.old?.id ?? '—';
        console.log(`🔴 [Realtime] ${table} → ${payload.eventType} (id: ${recordId})`);

        // Рассылаем ВСЕМ текущим подписчикам этого канала — это и есть
        // главный фикс: раньше колбэк был один и "запечён" в первом .subscribe().
        listeners.forEach((l) => {
          l.onAny?.(payload);
          if (payload.eventType === 'INSERT') l.onInsert?.(payload.new);
          if (payload.eventType === 'UPDATE') l.onUpdate?.(payload.new, payload.old);
          if (payload.eventType === 'DELETE') l.onDelete?.(payload.old);
        });
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log(`✅ [Realtime] Подписка активна → ${table}`);
        const e = channelRegistry.get(channelKey);
        if (e) e.retryCount = 0; // сбрасываем счётчик попыток после успеха
        notifyStatus(channelKey, 'SUBSCRIBED');
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(`❌ [Realtime] ${status} → ${table}`, err);
        notifyStatus(channelKey, 'ERROR');
        scheduleReconnect(channelKey, table, event, filter);
      }

      if (status === 'CLOSED') {
        console.warn(`⚠️ [Realtime] Канал закрыт → ${table}`);
        notifyStatus(channelKey, 'CLOSED');
      }
    });

  const entry: ChannelEntry = { channel, listeners, status: 'CONNECTING', retryCount: 0 };
  channelRegistry.set(channelKey, entry);
  console.log(`🟢 [Realtime] Создан канал → ${channelKey}`);
  return entry;
}

interface UseRealtimeOptions {
  table: string;
  event?: ChangeEvent;
  /** Supabase realtime filter, формат: "column=eq.value" */
  filter?: string;
  onInsert?: (newRecord: any) => void;
  onUpdate?: (newRecord: any, oldRecord?: any) => void;
  onDelete?: (oldRecord: any) => void;
  onAny?: (payload: any) => void;
  /** Вызывается при смене статуса соединения — удобно для индикатора в UI */
  onStatusChange?: (status: RealtimeStatus) => void;
  enabled?: boolean;
}

/**
 * Универсальный хук подписки на Supabase Realtime (postgres_changes).
 *
 * Особенности реализации:
 * - Один физический WebSocket-канал на комбинацию table+event+filter,
 *   независимо от того, сколько компонентов на него подписаны.
 * - Колбэки каждого вызова хука хранятся в ref и не входят в зависимости
 *   useEffect — это защищает от пересоздания подписки на каждый рендер,
 *   даже если onInsert/onUpdate передаются инлайн-функциями без useCallback.
 * - При CHANNEL_ERROR / TIMED_OUT канал автоматически пересоздаётся
 *   с экспоненциальной задержкой (до 30 сек).
 */
export function useRealtime({
  table,
  event = '*',
  filter,
  onInsert,
  onUpdate,
  onDelete,
  onAny,
  onStatusChange,
  enabled = true,
}: UseRealtimeOptions) {
  // Стабилизация колбэков: обновляем на каждый рендер, но БЕЗ зависимостей
  // во втором useEffect — значит переподписка не триггерится их изменением.
  const callbacksRef = useRef<Listener>({});
  callbacksRef.current = { onInsert, onUpdate, onDelete, onAny, onStatusChange };

  useEffect(() => {
    if (!enabled) return;

    const channelKey = buildChannelKey(table, event, filter);
    const entry = ensureChannel(channelKey, table, event, filter);

    // Листенер-обёртка: всегда читает актуальные колбэки из ref,
    // поэтому сам объект listener можно один раз положить в Set
    // и не пересоздавать при каждом рендере родителя.
    const listener: Listener = {
      onInsert: (r) => callbacksRef.current.onInsert?.(r),
      onUpdate: (n, o) => callbacksRef.current.onUpdate?.(n, o),
      onDelete: (r) => callbacksRef.current.onDelete?.(r),
      onAny: (p) => callbacksRef.current.onAny?.(p),
      onStatusChange: (s) => callbacksRef.current.onStatusChange?.(s),
    };

    entry.listeners.add(listener);

    // Сообщаем текущий статус сразу при подписке (на случай, если канал
    // уже был SUBSCRIBED до монтирования этого компонента)
    listener.onStatusChange?.(entry.status);

    return () => {
      entry.listeners.delete(listener);

      // Если это был последний подписчик — закрываем канал и чистим таймеры
      if (entry.listeners.size === 0) {
        if (entry.retryTimer) clearTimeout(entry.retryTimer);
        supabase.removeChannel(entry.channel);
        channelRegistry.delete(channelKey);
        console.log(`🔌 [Realtime] Канал закрыт (нет подписчиков) → ${channelKey}`);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, event, filter, enabled]);
}

/**
 * Обёртка для заказов: слушает INSERT/UPDATE/DELETE и синхронизирует
 * локальный state списка заказов. Раньше слушала только INSERT, из-за
 * чего изменения статуса/объёма/адреса приходилось опрашивать polling'ом.
 *
 * @param setOrders  сеттер состояния списка заказов
 * @param options    необязательные доп. настройки (фильтр, статус-колбэк)
 */
export function useRealtimeOrders(
  setOrders: React.Dispatch<React.SetStateAction<any[]>>,
  options?: { filter?: string; onStatusChange?: (status: RealtimeStatus) => void; enabled?: boolean }
) {
  return useRealtime({
    table: 'orders',
    event: '*',
    filter: options?.filter,
    enabled: options?.enabled,
    onStatusChange: options?.onStatusChange,
    onInsert: (newRecord) => {
      setOrders((prev) => {
        // защита от дублей, если INSERT прилетит одновременно с ручным fetch
        if (prev.some((o) => String(o.id) === String(newRecord.id))) return prev;
        return [newRecord, ...prev];
      });
    },
    onUpdate: (newRecord) => {
      setOrders((prev) =>
        prev.map((o) => (String(o.id) === String(newRecord.id) ? { ...o, ...newRecord } : o))
      );
    },
    onDelete: (oldRecord) => {
      setOrders((prev) => prev.filter((o) => String(o.id) !== String(oldRecord.id)));
    },
  });
}