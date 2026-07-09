// hooks/useRealtimeOrders.ts
import { useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const globalChannels = new Map();

export function useRealtime({
  table,
  event = '*',
  filter,
  onInsert,
  onUpdate,
  onDelete,
  onAny,
  enabled = true,
}: {
  table: string;
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  filter?: string;
  onInsert?: (newRecord: any) => void;
  onUpdate?: (newRecord: any, oldRecord?: any) => void;
  onDelete?: (oldRecord: any) => void;
  onAny?: (payload: any) => void;
  enabled?: boolean;
}) {
  
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!enabled || mountedRef.current) return;

    mountedRef.current = true;
    const channelKey = `global-${table}`;

    if (globalChannels.has(channelKey)) {
      console.log(`⚡ [Realtime] Используем существующую подписку → ${table}`);
      return;
    }

    const channel = supabase
      .channel(channelKey)
      .on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          ...(filter && { filter }),
        },
       (payload: any) => {
          const recordId = payload.new?.id || payload.old?.id || '—';
          console.log(`🔴 [Realtime] ${table} → ${payload.eventType} (id: ${recordId})`);

          if (onAny) onAny(payload);

          if (payload.eventType === 'INSERT' && onInsert) onInsert(payload.new);
          if (payload.eventType === 'UPDATE' && onUpdate) onUpdate(payload.new, payload.old);
          if (payload.eventType === 'DELETE' && onDelete) onDelete(payload.old);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`✅ [Realtime] АКТИВНАЯ ПОДПИСКА → ${table}`);
        }
      });

    globalChannels.set(channelKey, channel);
    console.log(`🟢 [Realtime] Создана новая глобальная подписка → ${table}`);

    return () => {
      mountedRef.current = false;
      console.log(`🔄 [Realtime] Компонент отмонтирован → ${table} (канал сохранён)`);
    };
  }, [table, event, filter, enabled]);
}

// Для старого использования
export function useRealtimeOrders(setOrders: any) {
  return useRealtime({ table: 'orders', event: 'INSERT', onInsert: (n) => setOrders((p: any[]) => [n, ...p]) });
}