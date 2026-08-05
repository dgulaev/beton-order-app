'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';
import type { RealtimeStatus } from '@/hooks/useRealtimeOrders';
import type { FleetTelemetrySnapshot } from '@/lib/fleetLifecycle';

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

/** Нормализация строки из broadcast (jsonb → числа/флаги). */
export function formatFleetTelemetrySnapshot(record: any): FleetTelemetrySnapshot | null {
  if (!record || record.mixer_id == null) return null;
  const mixerId = toNum(record.mixer_id);
  if (mixerId == null) return null;

  return {
    id: toNum(record.id) ?? 0,
    mixer_id: mixerId,
    scout_unit_id: toNum(record.scout_unit_id),
    lat: toNum(record.lat),
    lon: toNum(record.lon),
    speed_kmh: toNum(record.speed_kmh),
    address: record.address != null ? String(record.address) : null,
    last_message_at: record.last_message_at != null ? String(record.last_message_at) : null,
    is_online: toBool(record.is_online),
    raw: record.raw && typeof record.raw === 'object' ? record.raw : null,
    updated_at: record.updated_at != null ? String(record.updated_at) : new Date().toISOString(),
  };
}

/**
 * Broadcast-подписка на fleet_telemetry_snapshots:all.
 * После cron/sync СКАУТ маркеры на карте и GPS-бейджи обновляются без polling.
 */
export function useRealtimeFleetTelemetry(
  setTelemetryMap: Dispatch<SetStateAction<Map<number, FleetTelemetrySnapshot>>>,
  options?: {
    enabled?: boolean;
    onStatusChange?: (status: RealtimeStatus) => void;
  },
) {
  return useRealtimeBroadcast({
    topic: 'fleet_telemetry_snapshots:all',
    enabled: options?.enabled,
    onStatusChange: options?.onStatusChange,
    onInsert: (record) => {
      const row = formatFleetTelemetrySnapshot(record);
      if (!row) return;
      setTelemetryMap((prev) => {
        const next = new Map(prev);
        next.set(row.mixer_id, row);
        return next;
      });
    },
    onUpdate: (record) => {
      const row = formatFleetTelemetrySnapshot(record);
      if (!row) return;
      setTelemetryMap((prev) => {
        const next = new Map(prev);
        next.set(row.mixer_id, row);
        return next;
      });
    },
    onDelete: (old) => {
      const mixerId = toNum(old?.mixer_id);
      if (mixerId == null) return;
      setTelemetryMap((prev) => {
        if (!prev.has(mixerId)) return prev;
        const next = new Map(prev);
        next.delete(mixerId);
        return next;
      });
    },
  });
}
