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

interface BroadcastListener {
  onInsert?: (record: any) => void;
  onUpdate?: (record: any, old?: any) => void;
  onDelete?: (old: any) => void;
  onStatusChange?: (status: RealtimeStatus) => void;
}

interface BroadcastEntry {
  channel: RealtimeChannel;
  listeners: Set<BroadcastListener>;
  status: RealtimeStatus;
  keepalive?: ReturnType<typeof setInterval>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const registry = new Map<string, BroadcastEntry>();
let globalListenersAttached = false;

function notify(topic: string, status: RealtimeStatus) {
  const entry = registry.get(topic);
  if (!entry) return;
  entry.status = status;
  entry.listeners.forEach((l) => l.onStatusChange?.(status));
}

function dispatch(topic: string, kind: 'insert' | 'update' | 'delete', record: any, old?: any) {
  const entry = registry.get(topic);
  if (!entry) return;
  entry.listeners.forEach((l) => {
    if (kind === 'insert') l.onInsert?.(record);
    else if (kind === 'update') l.onUpdate?.(record, old);
    else l.onDelete?.(old);
  });
}

function connect(topic: string): BroadcastEntry {
  const existing = registry.get(topic);
  if (existing) return existing;

  console.log(`🟡 [Broadcast] Подключаюсь к каналу → ${topic}`);
  const channel = supabase.channel(topic);
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
    .subscribe((s) => {
      if (s === 'SUBSCRIBED') {
        console.log(`✅ [Broadcast] ПОДПИСКА АКТИВНА → ${topic}`);
        notify(topic, 'SUBSCRIBED');
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
        console.warn(`⚠️ [Broadcast] ОШИБКА ${s} → ${topic}`);
        notify(topic, 'ERROR');
      } else if (s === 'CLOSED') {
        notify(topic, 'CLOSED');
      }
    });

  return entry;
}

function reconnect(topic: string) {
  const entry = registry.get(topic);
  if (!entry) return;
  const state = (entry.channel as any)?.state;
  if (state === 'joined') return; // уже здоров

  console.warn(`🔁 [Broadcast] Переподключение → ${topic} (состояние: ${state})`);
  const listeners = entry.listeners;
  if (entry.keepalive) clearInterval(entry.keepalive);
  void supabase.removeChannel(entry.channel);
  registry.delete(topic);

  const fresh = connect(topic);
  listeners.forEach((l) => fresh.listeners.add(l));
  fresh.keepalive = setInterval(() => reconnect(topic), 20_000);
  // Сообщаем актуальный статус перенесённым слушателям
  fresh.listeners.forEach((l) => l.onStatusChange?.(fresh.status));
}

// Публичная функция — ручной реконнект всех broadcast-каналов (клик по индикатору)
export function reconnectAllBroadcastChannels() {
  registry.forEach((_e, topic) => reconnect(topic));
}

function attachGlobalListeners() {
  if (globalListenersAttached || typeof document === 'undefined') return;
  globalListenersAttached = true;

  const reconnectAll = () => {
    if (document.visibilityState !== 'visible') return;
    registry.forEach((_e, topic) => reconnect(topic));
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectAll();
  });
  window.addEventListener('online', reconnectAll);
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
    // Запускаем keepalive один раз на топик
    if (!entry.keepalive) {
      entry.keepalive = setInterval(() => reconnect(topic), 20_000);
    }

    const listener: BroadcastListener = {
      onInsert: (r) => cbRef.current.onInsert?.(r),
      onUpdate: (r, o) => cbRef.current.onUpdate?.(r, o),
      onDelete: (o) => cbRef.current.onDelete?.(o),
      onStatusChange: (s) => {
        cbRef.current.onStatusChange?.(s);
        setStatus(s);
      },
    };
    entry.listeners.add(listener);
    // Сообщаем текущий статус сразу
    listener.onStatusChange?.(entry.status);

    return () => {
      const current = registry.get(topic);
      if (!current) return;
      current.listeners.delete(listener);

      // Последний подписчик ушёл — откладываем закрытие (StrictMode делает
      // mount→unmount→mount; при мгновенном возврате не пересоздаём канал).
      if (current.listeners.size === 0) {
        current.cleanupTimer = setTimeout(() => {
          if (current.listeners.size > 0) return;
          if (current.keepalive) clearInterval(current.keepalive);
          void supabase.removeChannel(current.channel);
          if (registry.get(topic) === current) registry.delete(topic);
          console.log(`🔌 [Broadcast] Канал закрыт (нет подписчиков) → ${topic}`);
        }, 100);
      }
    };
  }, [topic, enabled]);

  return { status };
}
