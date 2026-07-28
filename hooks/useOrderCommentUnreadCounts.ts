'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';

/**
 * Карта непрочитанных комментариев по заявкам для текущего пользователя.
 * orderIds — опционально ограничить набор (день/месяц на списке).
 */
export function useOrderCommentUnreadCounts(orderIds: Array<number | string>, enabled = true) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);

  const fetchCounts = useCallback(async () => {
    if (!enabled) return;
    const ids = orderIds
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) {
      setCounts({});
      setTotal(0);
      return;
    }
    try {
      const res = await fetch(
        `/api/adminCifra/order-comments/unread?orderIds=${ids.join(',')}`,
        { headers: adminCifraAuthHeaders(), cache: 'no-store' }
      );
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) {
        setCounts(json.counts || {});
        setTotal(json.total || 0);
      }
    } catch (e) {
      console.error('unread comments:', e);
    }
  }, [enabled, orderIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  // При новом комментарии — обновляем счётчики
  useRealtimeBroadcast({
    topic: 'order_comments:all',
    enabled,
    onInsert: () => {
      void fetchCounts();
    },
  });

  const setOrderUnread = useCallback((orderId: number | string, count: number) => {
    const key = String(orderId);
    setCounts((prev) => {
      const next = { ...prev };
      if (count <= 0) delete next[key];
      else next[key] = count;
      setTotal(Object.values(next).reduce((s, n) => s + n, 0));
      return next;
    });
  }, []);

  return { counts, total, refresh: fetchCounts, setOrderUnread };
}
