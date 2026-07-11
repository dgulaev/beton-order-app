'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRealtimeOrderMixers } from '@/hooks/useRealtimeOrders';

export const useTodayLoadingMixers = () => {
  const [allMixers, setAllMixers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMixers = useCallback(async (retryCount = 0) => {
    try {
      setLoading(true);
      setError(null);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const res = await fetch('/api/adminCifra/active-mixers?withOrders=true', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const mixersArray = Array.isArray(data) ? data : (data.mixers || data || []);

      setAllMixers(mixersArray);
      setError(null);
    } catch (err: any) {
      console.warn(`[useTodayLoadingMixers] Попытка ${retryCount + 1} не удалась:`, err.message);

      if (retryCount < 5) {
        const delay = 600 + retryCount * 400;
        setTimeout(() => fetchMixers(retryCount + 1), delay);
      } else {
        console.error('❌ Ошибка загрузки миксеров для оператора БСУ после всех попыток:', err);
        setError('Не удалось загрузить миксеры');
        setAllMixers([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Начальная загрузка (realtime не отдаёт уже существующие строки)
  useEffect(() => {
    const initialTimeout = setTimeout(() => {
      fetchMixers();
    }, 300);

    return () => clearTimeout(initialTimeout);
  }, [fetchMixers]);

  // Live-обновления статусов миксеров
  useRealtimeOrderMixers(setAllMixers, { activeOnly: false });

  return { allMixers, loading, error, refetch: fetchMixers };
};
