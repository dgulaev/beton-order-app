'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeOrderMixers } from '@/hooks/useRealtimeOrders';

const INSERT_REFETCH_DEBOUNCE_MS = 400;

export const useTodayLoadingMixers = (options?: {
  onMixerDeleted?: (oldRecord: any) => void;
  onMixerUpdated?: (formattedRecord: any) => void;
}) => {
  const [allMixers, setAllMixers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMixers = useCallback(
    async (retryCount = 0, opts?: { background?: boolean }) => {
      const gen = ++fetchGenRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (!opts?.background) {
          setLoading(true);
          setError(null);
        }

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
        if (gen !== fetchGenRef.current) return;

        const mixersArray = Array.isArray(data) ? data : (data.mixers || data || []);
        setAllMixers(mixersArray);
        setError(null);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (gen !== fetchGenRef.current) return;

        console.warn(
          `[useTodayLoadingMixers] Попытка ${retryCount + 1} не удалась:`,
          err.message,
        );

        if (retryCount < 5) {
          const delay = 600 + retryCount * 400;
          setTimeout(() => fetchMixers(retryCount + 1, opts), delay);
        } else {
          console.error(
            '❌ Ошибка загрузки миксеров для оператора БСУ после всех попыток:',
            err,
          );
          setError('Не удалось загрузить миксеры');
          // Не очищаем список — пустой снапшот сбрасывал optimistic-hide
          // и возвращал уже отгруженные рейсы в очередь (#705).
        }
      } finally {
        if (gen === fetchGenRef.current && !opts?.background) {
          setLoading(false);
        }
      }
    },
    [],
  );

  /** Coalesce: apply N рейсов → один фоновый refetch, без мигания loading. */
  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void fetchMixers(0, { background: true });
    }, INSERT_REFETCH_DEBOUNCE_MS);
  }, [fetchMixers]);

  // Начальная загрузка (realtime не отдаёт уже существующие строки)
  useEffect(() => {
    const initialTimeout = setTimeout(() => {
      void fetchMixers();
    }, 300);

    return () => {
      clearTimeout(initialTimeout);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [fetchMixers]);

  // Live-обновления статусов миксеров.
  // onInsertRow: fallback, если per-row broadcast ещё не подавлен.
  // onReload: основной путь после apply (один RELOAD вместо N INSERT).
  useRealtimeOrderMixers(setAllMixers, {
    activeOnly: false,
    onInsertRow: () => scheduleRefetch(),
    onReload: () => scheduleRefetch(),
    onDeleteRow: options?.onMixerDeleted,
    onUpdateRow: options?.onMixerUpdated,
  });

  return { allMixers, loading, error, refetch: fetchMixers };
};
