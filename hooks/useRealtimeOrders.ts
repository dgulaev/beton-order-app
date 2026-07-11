// hooks/useRealtimeOrders.ts
'use client';
 
import { useEffect, useRef, useState } from 'react';
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
  
  const callbacksRef = useRef<Listener>({});
  callbacksRef.current = { onInsert, onUpdate, onDelete, onAny, onStatusChange };
 
  // 🔥 Без этого стейта хук ничего не возвращал — { status } на месте вызова
  // всегда было undefined, хотя onStatusChange исправно дёргался.
  const [status, setStatus] = useState<RealtimeStatus>('CONNECTING');
 
  useEffect(() => {
    if (!enabled) return;
 
    const channelKey = buildChannelKey(table, event, filter);
    const entry = ensureChannel(channelKey, table, event, filter);
 
    
    const listener: Listener = {
      onInsert: (r) => callbacksRef.current.onInsert?.(r),
      onUpdate: (n, o) => callbacksRef.current.onUpdate?.(n, o),
      onDelete: (r) => callbacksRef.current.onDelete?.(r),
      onAny: (p) => callbacksRef.current.onAny?.(p),
      onStatusChange: (s) => {
        callbacksRef.current.onStatusChange?.(s);
        setStatus(s);
      },
    };
 
    entry.listeners.add(listener);
 
    
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
   
  }, [table, event, filter, enabled]);
 
  return { status };
}
 
 
export function useRealtimeOrders(
  setOrders: React.Dispatch<React.SetStateAction<any[]>>,
  options?: { filter?: string; onStatusChange?: (status: RealtimeStatus) => void; enabled?: boolean }
) {
  const { status } = useRealtime({
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

  return { status };
}

/** Статусы миксеров, которые считаются «активными» на дашборде */
export const ACTIVE_MIXER_STATUSES = ['Загрузка', 'В пути', 'На объекте', 'Проблема'] as const;

/** Приводит сырую строку order_mixers к формату API active-mixers / order-mixers */
export function formatOrderMixer(record: any, orders?: any[]) {
  const order = orders?.find((o) => String(o.id) === String(record.order_id ?? record.orderId));
  const orderId = record.order_id ?? record.orderId;

  return {
    id: record.id,
    number: record.mixer_name ?? record.number,
    orderId,
    order_id: orderId,
    volume: record.volume,
    time: record.time,
    status: record.status,
    sortOrder: record.sort_order ?? record.sortOrder ?? 0,
    sort_order: record.sort_order ?? record.sortOrder ?? 0,
    created_at: record.created_at,
    updated_at: record.updated_at,
    loading_started_at: record.loading_started_at ?? record.loadingStartedAt ?? null,
    podvizhnost: record.podvizhnost,
    delivery_date: order?.delivery_date ?? record.delivery_date ?? null,
    delivery_time: order?.delivery_time ?? record.delivery_time ?? null,
    organization_name: order?.organization_name ?? record.organization_name ?? null,
    client_name: order?.client_name ?? order?.full_name ?? record.client_name ?? null,
    concrete_grade: order?.grade ?? record.concrete_grade ?? record.grade ?? null,
    client:
      order?.organization_name ||
      order?.full_name ||
      order?.client_name ||
      record.client ||
      '—',
  };
}

export function isActiveMixerStatus(status?: string) {
  return !!status && ACTIVE_MIXER_STATUSES.includes(status as (typeof ACTIVE_MIXER_STATUSES)[number]);
}

export function useRealtimeOrderMixers(
  setMixers: React.Dispatch<React.SetStateAction<any[]>>,
  options?: {
    filter?: string;
    enabled?: boolean;
    onStatusChange?: (status: RealtimeStatus) => void;
    /** Для обогащения delivery_date / client из таблицы orders */
    orders?: any[];
    /** true — хранить только активные статусы (active-mixers) */
    activeOnly?: boolean;
  }
) {
  const orders = options?.orders;

  const { status } = useRealtime({
    table: 'order_mixers',
    event: '*',
    filter: options?.filter,
    enabled: options?.enabled,
    onStatusChange: options?.onStatusChange,
    onInsert: (newRecord) => {
      const formatted = formatOrderMixer(newRecord, orders);
      if (options?.activeOnly && !isActiveMixerStatus(formatted.status)) return;

      setMixers((prev) => {
        if (prev.some((m) => String(m.id) === String(formatted.id))) return prev;
        return [formatted, ...prev];
      });
    },
    onUpdate: (newRecord) => {
      const formatted = formatOrderMixer(newRecord, orders);

      setMixers((prev) => {
        const exists = prev.some((m) => String(m.id) === String(formatted.id));

        if (options?.activeOnly) {
          if (!isActiveMixerStatus(formatted.status)) {
            return prev.filter((m) => String(m.id) !== String(formatted.id));
          }
          if (!exists) return [formatted, ...prev];
        }

        return prev.map((m) => (String(m.id) === String(formatted.id) ? { ...m, ...formatted } : m));
      });
    },
    onDelete: (oldRecord) => {
      setMixers((prev) => prev.filter((m) => String(m.id) !== String(oldRecord.id)));
    },
  });

  return { status };
}

/** Live-обновление ленты отгрузок (production_logs) — только INSERT, записи не редактируются */
export function useRealtimeProductionLogs(
  setLogs: React.Dispatch<React.SetStateAction<any[]>>,
  options?: { enabled?: boolean; onStatusChange?: (status: RealtimeStatus) => void }
) {
  return useRealtime({
    table: 'production_logs',
    event: 'INSERT',
    enabled: options?.enabled,
    onStatusChange: options?.onStatusChange,
    onInsert: (newRecord) => {
      setLogs((prev) => {
        if (prev.some((l) => String(l.id) === String(newRecord.id))) return prev;
        return [newRecord, ...prev];
      });
    },
  });
}

/** Уведомления о новых/изменённых заявках — для layout админки */
export function useOrderChangeNotifications(options: {
  enabled?: boolean;
  onNewOrder?: (order: any) => void;
  onStatusChange?: (order: any) => void;
  onVolumeChange?: (order: any, oldOrder: any) => void;
  onDateTimeChange?: (order: any) => void;
}) {
  return useRealtime({
    table: 'orders',
    enabled: options.enabled,
    onInsert: (newRecord) => options.onNewOrder?.(newRecord),
    onUpdate: (newRecord, oldRecord) => {
      if (!oldRecord) return;
      if (oldRecord.status !== newRecord.status) options.onStatusChange?.(newRecord);
      if (oldRecord.volume !== newRecord.volume) options.onVolumeChange?.(newRecord, oldRecord);
      if (
        oldRecord.delivery_date !== newRecord.delivery_date ||
        oldRecord.delivery_time !== newRecord.delivery_time
      ) {
        options.onDateTimeChange?.(newRecord);
      }
    },
  });
}