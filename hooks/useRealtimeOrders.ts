// hooks/useRealtimeOrders.ts
'use client';
 
import { useEffect, useRef, useState } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient'; // ← общий клиент, не создаём новый
import { useRealtimeBroadcast } from './useRealtimeBroadcast';
 
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
  // Отложенное закрытие канала при потере последнего подписчика (см. cleanup в useRealtime) —
  // отменяется, если подписчик появляется снова до срабатывания таймера.
  pendingCleanupTimer?: ReturnType<typeof setTimeout>;
  // Храним параметры подписки в самой записи, чтобы можно было форсировать
  // переподключение снаружи (по visibilitychange/online), не имея их под рукой.
  table: string;
  event: ChangeEvent;
  filter?: string;
}
 
 
const channelRegistry = new Map<string, ChannelEntry>();
 
const MAX_RETRY_DELAY_MS = 30_000;

// ⚠️ КЛЮЧЕВОЙ ФИКС: supabase.removeChannel() сам провоцирует статус CLOSED на
// callback'е этого канала (это часть его штатной обработки leave). Без этой
// пометки наш обработчик CLOSED не мог отличить «канал закрылся сам по себе»
// от «мы сами только что попросили его закрыться перед пересозданием» —
// и планировал ещё один реконнект НА КАНАЛ, который мы САМИ закрываем.
// Это давало самоподдерживающийся бесконечный цикл: reconnect → сам вызывает
// removeChannel → тот триггерит CLOSED → обработчик планирует новый reconnect → ...
const intentionallyClosingChannels = new WeakSet<RealtimeChannel>();

function getChannelTopic(channelKey: string): string {
  return `realtime:${channelKey}`;
}

/**
 * Вычищает «зомби»-каналы Supabase с тем же topic, которые остались
 * подписанными после неудачного teardown (типичный сценарий — быстрый
 * переход между страницами, когда наш channelRegistry уже пуст, а клиент
 * Supabase всё ещё держит старый канал → .on() после subscribe() бросает
 * "cannot add postgres_changes callbacks ... after subscribe()").
 */
function purgeOrphanSupabaseChannels(channelKey: string): void {
  const targetTopic = getChannelTopic(channelKey);

  for (const ch of supabase.getChannels()) {
    if (ch.topic !== targetTopic) continue;

    intentionallyClosingChannels.add(ch);
    try {
      ch.unsubscribe();
    } catch {
      // канал мог уже быть мёртвым
    }
    try {
      ch.teardown();
    } catch {
      // ignore
    }
    try {
      void supabase.removeChannel(ch);
    } catch {
      // ignore
    }
  }
}

async function removeChannelIntentionally(channel: RealtimeChannel) {
  intentionallyClosingChannels.add(channel);
  // Сначала синхронно снимаем bindings — иначе removeChannel может
  // не вызвать teardown (unsubscribe → timed out) и канал останется зомби.
  try {
    channel.teardown();
  } catch {
    // ignore
  }
  try {
    await supabase.removeChannel(channel);
  } catch {
    // канал мог уже быть невалиден — игнорируем
  }
}
 
function buildChannelKey(table: string, event: ChangeEvent, filter?: string) {
  // Кодируем все не-ASCII символы (например, кириллица в filter-значении миксера)
  // чтобы имя Phoenix-канала оставалось ASCII-safe и не отвергалось Supabase Realtime.
  const safeFilter = filter
    ? filter.replace(/[^\x20-\x7E]/g, (ch) => encodeURIComponent(ch))
    : 'nofilter';
  return `rt:${table}:${event}:${safeFilter}`;
}
 
function scheduleReconnect(channelKey: string, table: string, event: ChangeEvent, filter?: string) {
  const entry = channelRegistry.get(channelKey);
  if (!entry) return;
 
  const delay = Math.min(1000 * 2 ** entry.retryCount, MAX_RETRY_DELAY_MS);
  entry.retryCount += 1;
 
  console.warn(`⏳ [Realtime] Переподключение через ${delay}мс → ${table} (попытка ${entry.retryCount})`);
 
  entry.retryTimer = setTimeout(() => {
    reconnectChannel(channelKey, table, event, filter);
  }, delay);
}
 
// Флаг на запись, чтобы не запустить два параллельных реконнекта одного канала
// (например, из scheduleReconnect и из forceReconnectAll одновременно).
const reconnectingKeys = new Set<string>();

async function reconnectChannel(channelKey: string, table: string, event: ChangeEvent, filter?: string) {
  if (reconnectingKeys.has(channelKey)) return;
  reconnectingKeys.add(channelKey);

  try {
    const entry = channelRegistry.get(channelKey);
    if (entry?.retryTimer) clearTimeout(entry.retryTimer);

    // ⚠️ Критично: сохраняем подписчиков (React-компоненты) старого канала —
    // ensureChannel() создаёт новую пустую коллекцию listeners, и без переноса
    // все они «отвалятся» навсегда после реконнекта (компоненты не пересоздают
    // подписку сами, у них нет для этого триггера в useEffect).
    const preservedListeners = entry?.listeners;
    // ⚠️ Также переносим счётчик попыток — иначе backoff всегда стартует с нуля
    // и получается бесконечный цикл реконнекта раз в 1000мс без реального роста задержки.
    const preservedRetryCount = entry?.retryCount ?? 0;

    if (entry) {
      // Ждём подтверждения отписки от сервера ПЕРЕД тем, как открыть новый канал
      // с тем же именем топика. Если не ждать — join нового канала может прилететь
      // раньше, чем сервер обработает leave старого, и сервер тут же закроет новый
      // (конфликт по топику). Помечаем канал как «закрываем намеренно», чтобы
      // сам этот removeChannel не спровоцировал ещё один реконнект по CLOSED.
      await removeChannelIntentionally(entry.channel);
    }

    channelRegistry.delete(channelKey);
    purgeOrphanSupabaseChannels(channelKey);
    const newEntry = ensureChannel(channelKey, table, event, filter);
    newEntry.retryCount = preservedRetryCount;

    if (preservedListeners && preservedListeners.size > 0) {
      preservedListeners.forEach((l) => newEntry.listeners.add(l));
      // Сообщаем всем перенесённым подписчикам актуальный статус нового канала.
      newEntry.listeners.forEach((l) => l.onStatusChange?.(newEntry.status));
    }
  } finally {
    reconnectingKeys.delete(channelKey);
  }
}
 
// ==================== ФОРСИРОВАННЫЙ РЕКОННЕКТ ПРИ ВОЗВРАТЕ НА ВКЛАДКУ / ВОССТАНОВЛЕНИИ СЕТИ ====================
// Фоновые вкладки (особенно на мобильных) браузер сильно троттлит — обычные setTimeout
// с экспоненциальной задержкой могут не сработать вовремя, пока вкладка не активна.
// Поэтому при visibilitychange/online принудительно и немедленно пересоздаём все каналы,
// которые сейчас в статусе ERROR/CLOSED, минуя оставшуюся задержку backoff.
let forceReconnectListenerAttached = false;

// Публичная функция — вызывается из UI (индикатор в sidebar) при клике
export function triggerForceReconnect() {
  channelRegistry.forEach((entry, channelKey) => {
    if (entry.status !== 'SUBSCRIBED') {
      console.log(`🔁 [Realtime] Ручной реконнект → ${entry.table} (статус: ${entry.status})`);
      entry.retryCount = 0;
      reconnectChannel(channelKey, entry.table, entry.event, entry.filter);
    }
  });
}

function attachForceReconnectListeners() {
  if (forceReconnectListenerAttached || typeof document === 'undefined') return;
  forceReconnectListenerAttached = true;

  const forceReconnectAll = (reason: string) => {
    channelRegistry.forEach((entry, channelKey) => {
      if (entry.status !== 'SUBSCRIBED') {
        console.log(`🔁 [Realtime] Форс-переподключение (${reason}) → ${entry.table} (статус: ${entry.status})`);
        entry.retryCount = 0;
        reconnectChannel(channelKey, entry.table, entry.event, entry.filter);
      }
    });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Шахматное переподключение: 500ms начальная задержка синхронизирована
      // с аналогичной задержкой в useRealtimeBroadcast, чтобы оба потока
      // реконнекта не конкурировали за ресурсы в один момент времени.
      let i = 0;
      channelRegistry.forEach((entry, channelKey) => {
        if (entry.status !== 'SUBSCRIBED') {
          setTimeout(() => {
            const current = channelRegistry.get(channelKey);
            if (!current || current.status === 'SUBSCRIBED') return;
            console.log(`🔁 [Realtime] Форс-переподключение (вкладка снова активна) → ${current.table}`);
            current.retryCount = 0;
            reconnectChannel(channelKey, current.table, current.event, current.filter);
          }, 500 + i * 200);
          i++;
        }
      });
    }
  });

  window.addEventListener('online', () => forceReconnectAll('сеть восстановлена'));

  // ==================== ПЕРИОДИЧЕСКИЙ KEEPALIVE ====================
  // Supabase WebSocket может тихо умереть без отправки CLOSED/ERROR —
  // тогда наш backoff-реконнект не срабатывает вообще. Проверяем каждые
  // 30 секунд: любой канал не в SUBSCRIBED → переподключаем сразу.
  // Нагрузка минимальна: проверка — просто итерация по Map, реальный
  // сетевой запрос только если канал реально сломан.
  setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    let unhealthy = 0;
    channelRegistry.forEach((entry, channelKey) => {
      // CONNECTING — не трогаем: подписка могла ещё не завершиться (Supabase отвечает до 25с).
      // Прерывание CONNECTING создаёт вечный цикл реконнекта.
      // ERROR/CLOSED — переподключаем сразу.
      if (entry.status === 'ERROR' || entry.status === 'CLOSED') {
        unhealthy++;
        entry.retryCount = 0;
        reconnectChannel(channelKey, entry.table, entry.event, entry.filter);
      }
    });

    if (unhealthy > 0) {
      console.warn(`⏰ [Realtime] Keepalive: обнаружено ${unhealthy} нездоровых каналов, переподключаемся`);
    }
  }, 20_000);
}
 
function notifyStatus(channelKey: string, status: RealtimeStatus) {
  const entry = channelRegistry.get(channelKey);
  if (!entry) return;
  entry.status = status;
  entry.listeners.forEach((l) => l.onStatusChange?.(status));
}
 
function ensureChannel(channelKey: string, table: string, event: ChangeEvent, filter?: string): ChannelEntry {
  attachForceReconnectListeners();

  const existing = channelRegistry.get(channelKey);
  if (existing) return existing;

  // Реестр пуст, но в Supabase-клиенте мог остаться подписанный канал
  // с тем же topic после предыдущего unmount/reconnect.
  purgeOrphanSupabaseChannels(channelKey);

  // Пока чистили — другой вызов ensureChannel мог успеть создать канал.
  const raced = channelRegistry.get(channelKey);
  if (raced) return raced;

  const listeners = new Set<Listener>();
  const channel = supabase.channel(channelKey);

  const entry: ChannelEntry = {
    channel,
    listeners,
    status: 'CONNECTING',
    retryCount: 0,
    table,
    event,
    filter,
  };
  channelRegistry.set(channelKey, entry);

  channel
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
        if (e) e.retryCount = 0;
        notifyStatus(channelKey, 'SUBSCRIBED');
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`⚠️ [Realtime] ${status} → ${table}`, err);
        notifyStatus(channelKey, 'ERROR');
        scheduleReconnect(channelKey, table, event, filter);
      }

      if (status === 'CLOSED') {
        if (intentionallyClosingChannels.has(channel)) {
          return;
        }

        const e = channelRegistry.get(channelKey);
        if (e) {
          console.warn(`⚠️ [Realtime] Канал неожиданно закрыт → ${table}, планируем переподключение`);
          notifyStatus(channelKey, 'CLOSED');
          scheduleReconnect(channelKey, table, event, filter);
        }
      }
    });

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

    // Если канал был запланирован к закрытию (отложенный cleanup предыдущего
    // подписчика, см. ниже) — отменяем закрытие, раз у канала снова есть подписчик.
    // Актуально для React StrictMode в dev: mount → cleanup → mount происходят
    // почти мгновенно, и без этой отмены канал бы закрывался и пересоздавался
    // с тем же именем топика при каждом рендере.
    if (entry.pendingCleanupTimer) {
      clearTimeout(entry.pendingCleanupTimer);
      entry.pendingCleanupTimer = undefined;
    }

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
      // Берём АКТУАЛЬНУЮ запись из реестра, а не захваченную по замыканию —
      // если между подпиской и unmount произошёл реконнект, entry из замыкания
      // уже заменён на новый объект, и отписка от старого ничего не удалит.
      const currentEntry = channelRegistry.get(channelKey) ?? entry;
      currentEntry.listeners.delete(listener);

      // Если это был последний подписчик — НЕ закрываем канал синхронно.
      // React StrictMode в dev делает mount → cleanup → mount почти мгновенно;
      // если закрыть канал прямо здесь, повторный mount попытается открыть новый
      // канал с тем же именем топика ДО того, как сервер обработает leave старого,
      // и получит немедленный CLOSED → бесконечный цикл реконнекта.
      // Поэтому откладываем реальное закрытие на следующий тик: если к этому
      // моменту подписчик появился снова (см. отмену выше при mount) — не закрываем.
      if (currentEntry.listeners.size === 0) {
        currentEntry.pendingCleanupTimer = setTimeout(async () => {
          if (currentEntry.listeners.size > 0) return; // подписчик успел вернуться

          if (currentEntry.retryTimer) clearTimeout(currentEntry.retryTimer);
          // Помечаем как намеренное закрытие — иначе CLOSED от этого removeChannel
          // сам спровоцирует ещё один ненужный реконнект уже удалённого канала.
          await removeChannelIntentionally(currentEntry.channel);
          if (channelRegistry.get(channelKey) === currentEntry) {
            channelRegistry.delete(channelKey);
          }
          purgeOrphanSupabaseChannels(channelKey);
          console.log(`🔌 [Realtime] Канал закрыт (нет подписчиков) → ${channelKey}`);
        }, 50);
      }
    };
   
  }, [table, event, filter, enabled]);
 
  return { status };
}
 
 
export function useRealtimeOrders(
  setOrders: React.Dispatch<React.SetStateAction<any[]>>,
  options?: {
    /** Клиентский фильтр: вернуть false — запись игнорируется при INSERT */
    clientFilter?: (record: any) => boolean;
    onStatusChange?: (status: RealtimeStatus) => void;
    enabled?: boolean;
  }
) {
  const clientFilter = options?.clientFilter;

  const { status } = useRealtimeBroadcast({
    topic: 'orders:all',
    enabled: options?.enabled,
    onStatusChange: options?.onStatusChange,
    onInsert: (newRecord) => {
      if (!newRecord) return;
      if (clientFilter && !clientFilter(newRecord)) return;
      setOrders((prev) => {
        // защита от дублей, если INSERT прилетит одновременно с ручным fetch
        if (prev.some((o) => String(o.id) === String(newRecord.id))) return prev;
        return [newRecord, ...prev];
      });
    },
    onUpdate: (newRecord) => {
      if (!newRecord) return;
      setOrders((prev) =>
        prev.map((o) => (String(o.id) === String(newRecord.id) ? { ...o, ...newRecord } : o))
      );
    },
    onDelete: (oldRecord) => {
      if (!oldRecord) return;
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
    onSiteAt: record.on_site_at ?? record.onSiteAt ?? null,
    unloadedAt: record.unloaded_at ?? record.unloadedAt ?? null,
    downtimeMinutes: record.downtime_minutes ?? record.downtimeMinutes ?? null,
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
    /**
     * Вызывается при INSERT нового order_mixers. order_mixers сам по себе не
     * хранит organization_name/delivery_date/concrete_grade — если вызывающий
     * код не передаёт `orders` для обогащения (как, например, страница
     * оператора БСУ), у только что вставленной строки эти поля будут пустыми.
     * Используйте этот callback, чтобы подтянуть полные данные (например,
     * полным рефетчем) сразу после того, как строка появилась локально.
     */
    onInsertRow?: (newRecord: any) => void;
    /**
     * Вызывается при DELETE строки order_mixers (id и остальные поля — какими
     * они были до удаления). Нужен вызывающему коду для точечной чистки
     * производных клиентских состояний, которые ссылаются на этот миксер, но
     * сами не являются простым отражением `mixers` (например, синтетические
     * "осиротевшие" записи на странице оператора — см. operator/page.tsx).
     * Заметьте: полагаться на "миксера больше нет в текущем списке `mixers`"
     * недостаточно — этот список (см. activeOnly/active-mixers) изначально не
     * содержит миксеры в статусах "Разгружен"/"Возврат", поэтому их отсутствие
     * в `mixers` ничего не говорит о том, удалены они из БД или просто никогда
     * не входили в этот отфильтрованный снапшот.
     */
    onDeleteRow?: (oldRecord: any) => void;
    /**
     * Вызывается при UPDATE строки order_mixers с уже отформатированной
     * записью (formatOrderMixer). В отличие от `mixers`, это сырое событие "как
     * есть", без фильтрации `activeOnly` — полезно, когда вызывающему коду
     * нужен именно факт "статус этого миксера сейчас — X", а не выводить его из
     * (потенциально урезанного) списка `mixers`.
     */
    onUpdateRow?: (formattedRecord: any) => void;
  }
) {
  const orders = options?.orders;

  const { status } = useRealtimeBroadcast({
    topic: 'order_mixers:all',
    enabled: options?.enabled,
    onStatusChange: options?.onStatusChange,
    onInsert: (newRecord) => {
      const formatted = formatOrderMixer(newRecord, orders);
      if (options?.activeOnly && !isActiveMixerStatus(formatted.status)) return;

      setMixers((prev) => {
        if (prev.some((m) => String(m.id) === String(formatted.id))) return prev;
        return [formatted, ...prev];
      });

      options?.onInsertRow?.(newRecord);
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

        return prev.map((m) => {
          if (String(m.id) !== String(formatted.id)) return m;

          // ⚠️ order_mixers не хранит organization_name/delivery_date/
          // concrete_grade — это поля таблицы orders. Если `orders` не был
          // передан (или заказ ещё не подгружен на момент события),
          // formatOrderMixer вернёт по ним null. Без явного fallback такое
          // обновление затирало бы уже известное обогащение (клиент, марка,
          // дата), полученное при первой загрузке — строка "теряла" данные
          // после каждого статус-обновления по realtime.
          return {
            ...m,
            ...formatted,
            delivery_date: formatted.delivery_date ?? m.delivery_date ?? null,
            delivery_time: formatted.delivery_time ?? m.delivery_time ?? null,
            organization_name: formatted.organization_name ?? m.organization_name ?? null,
            client_name: formatted.client_name ?? m.client_name ?? null,
            concrete_grade: formatted.concrete_grade ?? m.concrete_grade ?? null,
            client: formatted.client && formatted.client !== '—' ? formatted.client : (m.client ?? '—'),
          };
        });
      });

      options?.onUpdateRow?.(formatted);
    },
    onDelete: (oldRecord) => {
      setMixers((prev) => prev.filter((m) => String(m.id) !== String(oldRecord.id)));
      options?.onDeleteRow?.(oldRecord);
    },
  });

  return { status };
}

/**
 * Live-обновление ленты отгрузок (production_logs). В основном пишется
 * только INSERT (кнопка оператора "Загружен"), но UPDATE тоже возможен —
 * когда диспетчер правит объём уже отгруженного рейса (см.
 * lib/orderMixers.ts::updateOrderMixerVolume), объём синхронизируется и в
 * этой таблице, чтобы лента "Отгружено сегодня" сразу показывала верное
 * число без перезагрузки страницы.
 */
export function useRealtimeProductionLogs(
  setLogs: React.Dispatch<React.SetStateAction<any[]>>,
  options?: { enabled?: boolean; onStatusChange?: (status: RealtimeStatus) => void }
) {
  return useRealtimeBroadcast({
    topic: 'production_logs:all',
    enabled: options?.enabled,
    onStatusChange: options?.onStatusChange,
    onInsert: (newRecord) => {
      setLogs((prev) => {
        if (prev.some((l) => String(l.id) === String(newRecord.id))) return prev;

        // Если уже есть строка (в т.ч. оптимистичный плейсхолдер с временным
        // отрицательным id) для того же рейса order_mixer_id — не добавляем
        // вторую. Актуально для оператора БСУ: строка "Загружен" переносится
        // в ленту мгновенно на клиенте, а это INSERT по realtime — то же
        // самое событие, просто с настоящим id.
        if (
          newRecord.order_mixer_id != null &&
          prev.some((l) => String(l.order_mixer_id) === String(newRecord.order_mixer_id))
        ) {
          return prev;
        }

        return [newRecord, ...prev];
      });
    },
    onUpdate: (newRecord) => {
      if (!newRecord) return;
      setLogs((prev) => prev.map((l) => (String(l.id) === String(newRecord.id) ? { ...l, ...newRecord } : l)));
    },
    // Удаление рейса (например, чистка тестовой/ошибочной заявки админом) —
    // без этого строка оставалась бы висеть в уже открытой вкладке оператора
    // до перезагрузки страницы, хотя в базе её давно нет.
    onDelete: (oldRecord) => {
      if (!oldRecord) return;
      setLogs((prev) => prev.filter((l) => String(l.id) !== String(oldRecord.id)));
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
  return useRealtimeBroadcast({
    topic: 'orders:all',
    enabled: options.enabled,
    onInsert: (newRecord) => newRecord && options.onNewOrder?.(newRecord),
    onUpdate: (newRecord, oldRecord) => {
      if (!oldRecord || !newRecord) return;
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