'use client';

import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';
import { normalizePlanDateKey } from '@/lib/dailyLogisticsPlan';

export type SharedLogisticsPlanRecord = {
  delivery_date?: string;
  payload?: unknown;
  max_text?: string | null;
  revision?: number;
  updated_at?: string;
  updated_by_name?: string | null;
  updated_by_role?: string | null;
  updated_by_user_id?: number | null;
  editing_by_name?: string | null;
  editing_by_user_id?: number | null;
  editing_at?: string | null;
};

/**
 * Live-снимок общего плана дня (топик daily_logistics_plans:all).
 * Клиент фильтрует по dateKey.
 */
export function useRealtimeDailyLogisticsPlan(
  dateKey: string,
  onPlan: (record: SharedLogisticsPlanRecord) => void,
  options?: { enabled?: boolean },
) {
  const apiDate = normalizePlanDateKey(dateKey) || dateKey;

  const handle = (record: SharedLogisticsPlanRecord | null | undefined) => {
    if (!record) return;
    const d = String(record.delivery_date || '').substring(0, 10);
    if (d !== apiDate) return;
    onPlan(record);
  };

  return useRealtimeBroadcast({
    topic: 'daily_logistics_plans:all',
    enabled: options?.enabled !== false && Boolean(apiDate),
    onInsert: (record) => handle(record as SharedLogisticsPlanRecord),
    onUpdate: (record) => handle(record as SharedLogisticsPlanRecord),
    onDelete: (old) => {
      const d = String((old as SharedLogisticsPlanRecord)?.delivery_date || '').substring(
        0,
        10,
      );
      if (d !== apiDate) return;
      onPlan({
        delivery_date: d,
        payload: null,
        revision: 0,
        updated_at: undefined,
        updated_by_name: null,
      });
    },
  });
}
