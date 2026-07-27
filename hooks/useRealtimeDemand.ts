'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';

export type DemandItemRow = {
  id: number;
  source: string;
  title: string;
  body: string | null;
  region: string | null;
  volume_m3: number | null;
  grades: string[] | null;
  fit_score: number | null;
  status: string;
  external_url: string | null;
  lead_id: number | null;
  published_at: string | null;
};

export function useRealtimeDemand(
  setItems: Dispatch<SetStateAction<DemandItemRow[]>>,
  options?: {
    enabled?: boolean;
    statusFilter?: string;
    minScore?: number;
  },
) {
  const statusFilter = options?.statusFilter;
  const minScore = options?.minScore ?? 0;

  const matches = (item: DemandItemRow) => {
    if (statusFilter && item.status !== statusFilter) return false;
    if (minScore > 0 && (item.fit_score ?? 0) < minScore) return false;
    return true;
  };

  return useRealtimeBroadcast({
    topic: 'demand_items:all',
    enabled: options?.enabled,
    onInsert: (record) => {
      const item = record as DemandItemRow;
      if (!matches(item)) return;
      setItems((prev) => {
        if (prev.some((i) => i.id === item.id)) return prev;
        return [item, ...prev];
      });
    },
    onUpdate: (record) => {
      const item = record as DemandItemRow;
      setItems((prev) => {
        if (!matches(item)) return prev.filter((i) => i.id !== item.id);
        if (prev.some((i) => i.id === item.id)) {
          return prev.map((i) => (i.id === item.id ? { ...i, ...item } : i));
        }
        return [item, ...prev];
      });
    },
    onDelete: (old) => {
      setItems((prev) => prev.filter((i) => i.id !== old?.id));
    },
  });
}
