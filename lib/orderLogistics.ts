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

export type BulkVolumeUnit = 'm3' | 't' | 'pcs';

type BulkProductHint = {
  item_type?: string | null;
  code?: string | null;
  name?: string | null;
  grade?: string | null;
} | null | undefined;

function isFbsProduct(product?: BulkProductHint): boolean {
  if (!product) return false;
  if (product.item_type === 'fbs') return true;
  const code = String(product.code || product.grade || '');
  if (code.startsWith('24-')) return true;
  if (/фбс/i.test(code) || /фбс/i.test(String(product.name || ''))) return true;
  return false;
}

/**
 * Единица количества bulk-заявки:
 * • ФБС — штуки;
 * • цементовоз — тонны;
 * • остальное — м³.
 */
export function bulkVolumeUnit(
  kind?: string | null,
  product?: BulkProductHint,
): BulkVolumeUnit {
  if (isFbsProduct(product)) return 'pcs';
  return kind === 'cement_truck' ? 't' : 'm3';
}

export function bulkVolumeUnitLabel(
  kind?: string | null,
  product?: BulkProductHint,
): string {
  const u = bulkVolumeUnit(kind, product);
  if (u === 'pcs') return 'шт';
  if (u === 't') return 'т';
  return 'м³';
}

/** Плейсхолдер поля количества в форме заявки. */
export function bulkQuantityFieldLabel(
  kind?: string | null,
  product?: BulkProductHint,
): string {
  const u = bulkVolumeUnit(kind, product);
  if (u === 'pcs') return 'Количество, шт';
  if (u === 't') return 'Объём, т';
  return 'Объём, м³';
}

export function normalizeOrderType(v: unknown): OrderType {
  return v === 'bulk' ? 'bulk' : 'concrete';
}

export function orderFleetKind(order: {
  order_type?: string | null;
  fleet_vehicle_kind?: string | null;
}): VehicleKind {
  const type = normalizeOrderType(order.order_type);
  const kind = order.fleet_vehicle_kind;
  if (
    type === 'bulk' &&
    isVehicleKind(kind) &&
    (BULK_VEHICLE_KINDS as readonly string[]).includes(kind)
  ) {
    return kind;
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
  if (kind === 'tractor_unit') return 'Головы в работе';
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
  if (!Number.isFinite(oid)) return false;
  const order = ordersById.get(oid);
  if (!order) return false;
  return orderMatchesFleetTab(order, tab);
}

/** Статусы «машина в рейсе» — совпадают с ACTIVE_MIXER_STATUSES / active-mixers. */
export const FLEET_ON_TRIP_STATUSES = [
  'Загрузка',
  'В пути',
  'На объекте',
  'Проблема',
] as const;

type FleetOrderRow = {
  id?: unknown;
  status?: string | null;
  order_type?: string | null;
  fleet_vehicle_kind?: string | null;
};

type FleetTripRow = {
  id?: unknown;
  order_id?: unknown;
  orderId?: unknown;
  status?: string | null;
};

/** Как в API order-mixers: пустой статус = «Загрузка». */
export function normalizeMixerTripStatus(status?: string | null): string {
  const s = String(status || '').trim();
  return s || 'Загрузка';
}

function tripUpdatedAtMs(row: { updated_at?: unknown }): number {
  const t = new Date(String(row.updated_at || 0)).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Слияние ответа fetch с локальным стейтом: строки вне orderIds не трогаем;
 * внутри — id из incoming (удалённые из БД пропадают), но более свежий
 * broadcast (больший updated_at) не затираем ответом API без updated_at.
 */
export function mergeFetchedOrderMixers(
  prev: any[],
  incoming: any[],
  orderIds: Iterable<string | number>,
): any[] {
  const orderIdSet = new Set([...orderIds].map(String));
  const others = prev.filter(
    (m) => !orderIdSet.has(String(m.orderId ?? m.order_id)),
  );
  const byId = new Map<string, any>();
  for (const m of incoming) byId.set(String(m.id), m);
  for (const m of prev) {
    const oid = String(m.orderId ?? m.order_id);
    if (!orderIdSet.has(oid)) continue;
    const id = String(m.id);
    const row = byId.get(id);
    if (!row) continue;
    if (tripUpdatedAtMs(m) > tripUpdatedAtMs(row)) byId.set(id, m);
  }
  return [...others, ...byId.values()];
}

/**
 * Точечный upsert рейсов одной заявки (локальные правки модалки → KPI).
 * Объём/время из модалки применяем всегда (оптимистика); статус не откатываем,
 * если в prev уже более свежий broadcast. Чужие INSERT по заявке не удаляем.
 */
export function upsertOrderMixersForOrder(
  prev: any[],
  orderId: string | number,
  rows: any[],
): any[] {
  const oid = String(orderId);
  const others = prev.filter((m) => String(m.orderId ?? m.order_id) !== oid);
  const byId = new Map<string, any>();
  for (const m of prev) {
    if (String(m.orderId ?? m.order_id) === oid) byId.set(String(m.id), m);
  }
  for (const m of rows) {
    const id = String(m.id);
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, m);
      continue;
    }
    const broadcastNewer = tripUpdatedAtMs(existing) > tripUpdatedAtMs(m);
    byId.set(id, {
      ...existing,
      ...m,
      status: broadcastNewer ? existing.status : (m.status ?? existing.status),
      orderId: m.orderId ?? m.order_id ?? existing.orderId ?? existing.order_id,
      order_id: m.order_id ?? m.orderId ?? existing.order_id ?? existing.orderId,
      updated_at: broadcastNewer
        ? existing.updated_at
        : (m.updated_at ?? existing.updated_at ?? null),
    });
  }
  return [...others, ...byId.values()];
}

/**
 * Счётчики машин в рейсе по вкладкам таймлайна.
 * Источник trips должен обновляться через broadcast (`order_mixers:all`),
 * иначе у других сотрудников цифры не появятся без перезагрузки.
 */
export function countFleetTripsOnTabs(
  trips: FleetTripRow[],
  dayOrders: FleetOrderRow[],
  tabs: readonly VehicleKind[],
  options?: { skipCancelledOrders?: boolean },
): Partial<Record<VehicleKind, number>> {
  const onTrip = new Set<string>(FLEET_ON_TRIP_STATUSES);
  const ordersById = new Map<number, FleetOrderRow>();
  for (const o of dayOrders) {
    if (options?.skipCancelledOrders && o.status === 'cancelled') continue;
    const id = Number(o.id);
    if (Number.isFinite(id)) ordersById.set(id, o);
  }
  const counts: Partial<Record<VehicleKind, number>> = {};
  for (const kind of tabs) counts[kind] = 0;

  // Дедуп по id: fetch+broadcast иногда оставляют две копии одной строки.
  const seen = new Set<string>();
  for (const m of trips) {
    const id = m.id != null ? String(m.id) : '';
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    if (!onTrip.has(normalizeMixerTripStatus(m.status))) continue;
    const oid = Number(m.orderId ?? m.order_id);
    const order = ordersById.get(oid);
    if (!order) continue;
    const kind = orderFleetKind(order);
    if (!tabs.includes(kind)) continue;
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}
