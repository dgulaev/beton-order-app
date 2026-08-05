/**
 * Фаза 3 — запись тарифа non-mixer в order_mixers при закрытии рейса.
 * Миксеры бетона не трогаем (у них delivery_settings).
 */

import { unitHasFleetTariffs, unitShiftOrTripTotal } from '@/lib/fleetTariffs';
import { isVehicleKind } from '@/lib/fleetCatalog';
import { normalizePlate } from '@/lib/fleetLifecycle';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * Если рейс только что стал «Разгружен» и ТС не миксер — записать превью тарифа.
 * Ошибки колонок/отсутствия ТС глотаем (не ломаем закрытие рейса).
 */
export async function applyFleetTariffOnUnload(opts: {
  orderMixerId: number;
  mixerName: string | null | undefined;
  previousStatus: string | null | undefined;
  newStatus: string | null | undefined;
}): Promise<void> {
  if (opts.newStatus !== 'Разгружен' || opts.previousStatus === 'Разгружен') return;
  const plate = String(opts.mixerName || '').trim();
  if (!plate) return;

  try {
    // Точное совпадение, иначе нормализованный поиск (пробелы/латиница)
    let unit: { id: number; vehicle_kind: string | null; specs: unknown } | null = null;
    const { data: exact } = await supabaseAdmin
      .from('mixers')
      .select('id, vehicle_kind, specs')
      .eq('number', plate)
      .maybeSingle();
    unit = exact ?? null;

    if (!unit) {
      const key = normalizePlate(plate);
      if (!key) return;
      const { data: candidates } = await supabaseAdmin
        .from('mixers')
        .select('id, number, vehicle_kind, specs')
        .neq('vehicle_kind', 'mixer')
        .limit(200);
      unit =
        (candidates || []).find((m) => normalizePlate(String(m.number || '')) === key) ?? null;
    }

    if (!unit) return;
    const kind = isVehicleKind(unit.vehicle_kind) ? unit.vehicle_kind : null;
    if (!kind || !unitHasFleetTariffs(kind)) return;

    const total = unitShiftOrTripTotal(kind, (unit.specs as Record<string, unknown>) || {});
    if (!total) return;

    const patch = {
      fleet_tariff_cash: total.cash?.amount ?? null,
      fleet_tariff_noncash: total.noncash?.amount ?? null,
      fleet_tariff_label: total.label,
      fleet_tariff_detail: total.detail,
    };

    const { error } = await supabaseAdmin
      .from('order_mixers')
      .update(patch)
      .eq('id', opts.orderMixerId);

    if (error) {
      // Колонок ещё нет — пока SQL не применён
      if (/fleet_tariff_/i.test(error.message) || /schema cache/i.test(error.message)) {
        console.warn('[fleetTripTariff] колонки не найдены — выполните scripts/fleet-fuel-expenses.sql');
        return;
      }
      console.warn('[fleetTripTariff]', error.message);
    }
  } catch (e) {
    console.warn('[fleetTripTariff]', e instanceof Error ? e.message : e);
  }
}
