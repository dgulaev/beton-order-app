/**
 * Логистика заявок: бетон vs bulk, фильтры таймлайнов по виду техники.
 */

import type { VehicleKind } from '@/lib/fleetCatalog';
import { VEHICLE_KINDS, isVehicleKind } from '@/lib/fleetCatalog';

export type OrderType = 'concrete' | 'bulk';

export const ORDER_TYPES: { key: OrderType; label: string }[] = [
  { key: 'concrete', label: 'Бетон' },
  { key: 'bulk', label: 'Отгрузка (щебень / песок / цемент)' },
];

/** Виды техники для bulk-отгрузок (не миксеры). */
export const BULK_VEHICLE_KINDS: VehicleKind[] = ['dump_truck', 'tonar', 'cement_truck'];

export function bulkVehicleKindOptions() {
  return VEHICLE_KINDS.filter((k) => BULK_VEHICLE_KINDS.includes(k.key));
}

/** Единица объёма bulk-заявки / отгрузки: цемент — тонны, остальное — м³. */
export function bulkVolumeUnit(kind?: string | null): 'm3' | 't' {
  return kind === 'cement_truck' ? 't' : 'm3';
}

export function bulkVolumeUnitLabel(kind?: string | null): string {
  return bulkVolumeUnit(kind) === 't' ? 'т' : 'м³';
}

export function normalizeOrderType(v: unknown): OrderType {
  return v === 'bulk' ? 'bulk' : 'concrete';
}

export function orderFleetKind(order: {
  order_type?: string | null;
  fleet_vehicle_kind?: string | null;
}): VehicleKind {
  const type = normalizeOrderType(order.order_type);
  if (type === 'bulk' && isVehicleKind(order.fleet_vehicle_kind)) {
    return order.fleet_vehicle_kind;
  }
  return 'mixer';
}

/** Подпись вкладки таймлайна. */
export function fleetOpsTabLabel(kind: VehicleKind): string {
  return VEHICLE_KINDS.find((k) => k.key === kind)?.label || kind;
}

export function fleetInWorkLabel(kind: VehicleKind): string {
  const meta = VEHICLE_KINDS.find((k) => k.key === kind);
  if (!meta) return 'В работе';
  if (kind === 'mixer') return 'Миксеры в работе';
  if (kind === 'dump_truck') return 'Самосвалы в работе';
  if (kind === 'tonar') return 'Тоннары в работе';
  if (kind === 'cement_truck') return 'Цементовозы в работе';
  return `${meta.label} в работе`;
}

/** Заявка относится к вкладке вида техники. */
export function orderMatchesFleetTab(
  order: { order_type?: string | null; fleet_vehicle_kind?: string | null },
  tab: VehicleKind
): boolean {
  return orderFleetKind(order) === tab;
}

/** Рейс order_mixers: матч по родительской заявке. */
export function tripMatchesFleetTab(
  trip: { order_id?: number | null },
  ordersById: Map<number, { order_type?: string | null; fleet_vehicle_kind?: string | null }>,
  tab: VehicleKind
): boolean {
  const oid = Number(trip.order_id);
  if (!Number.isFinite(oid)) return tab === 'mixer';
  const order = ordersById.get(oid);
  if (!order) return tab === 'mixer';
  return orderMatchesFleetTab(order, tab);
}
