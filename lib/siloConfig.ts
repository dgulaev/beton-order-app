/** Три силоса БСУ: ёмкости в тоннах. */
export const SILO_SPEC = [
  { silo_id: 1, name: 'Силос 1', max: 85 },
  { silo_id: 2, name: 'Силос 2', max: 85 },
  { silo_id: 3, name: 'Силос 3', max: 170 },
] as const;

export type SiloSpecId = (typeof SILO_SPEC)[number]['silo_id'];

export function siloNameById(siloId: number | null | undefined): string {
  const spec = SILO_SPEC.find((s) => s.silo_id === Number(siloId));
  return spec?.name || (siloId ? `Силос №${siloId}` : 'Силос');
}

/** Порог «глубокого минуса» (т): силос 1/2 → 5 т, силос 3 → 10 т. */
export function siloLowRateThresholdTons(siloId: number | null | undefined): number {
  return Number(siloId) === 3 ? 10 : 5;
}

export type LowRateAlertInfo = {
  siloId: number;
  siloName: string;
  currentTons: number;
  thresholdTons: number;
  fired: boolean;
  pending: boolean;
  /** ISO-время эпизода — чтобы UI не блокировал повторный алерт после сброса */
  alertAt: string | null;
};

/** Синхронизация алерта низкого расхода после изменения остатка силоса. */
export async function syncSiloLowRateAlert(
  supabase: { rpc: (...args: any[]) => any },
  siloId: number,
): Promise<LowRateAlertInfo | null> {
  if (![1, 2, 3].includes(Number(siloId))) return null;
  try {
    const { data, error } = await supabase.rpc('warehouse_silo_sync_low_rate_alert', {
      p_silo_id: siloId,
    });
    if (error) {
      // Функция ещё не применена — тихо пропускаем
      if (String(error.message || '').includes('warehouse_silo_sync_low_rate_alert')) {
        return null;
      }
      console.error('syncSiloLowRateAlert:', error);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      siloId: Number(row.silo_id),
      siloName: siloNameById(Number(row.silo_id)),
      currentTons: Number(row.current_tons ?? 0),
      thresholdTons: Number(row.threshold_tons ?? siloLowRateThresholdTons(siloId)),
      fired: Boolean(row.fired),
      pending: Boolean(row.pending),
      alertAt: row.alert_at ? String(row.alert_at) : null,
    };
  } catch (err) {
    console.error('syncSiloLowRateAlert:', err);
    return null;
  }
}

export async function syncAllSiloLowRateAlerts(
  supabase: { rpc: (...args: any[]) => any },
): Promise<LowRateAlertInfo[]> {
  const out: LowRateAlertInfo[] = [];
  for (const spec of SILO_SPEC) {
    const info = await syncSiloLowRateAlert(supabase, spec.silo_id);
    if (info?.pending) out.push(info);
  }
  return out;
}

export function siloIdFromItemType(itemType: string | null | undefined): number | null {
  const t = String(itemType || '');
  const m = t.match(/силос\s*№?\s*([123])\b/i);
  if (!m) return null;
  const id = Number(m[1]);
  return [1, 2, 3].includes(id) ? id : null;
}

export type SiloCementJournalKind =
  | 'auto_writeoff'
  | 'silo_switch'
  | 'backfill'
  | 'rollback'
  | 'delete_return'
  | 'transfer';

/** Подпись в журнале силосов: автосписание / возврат / корректировка с заявкой. */
export function formatSiloCementJournalActor(opts: {
  kind: SiloCementJournalKind;
  orderId: number;
  /** Имя с пульта смены (Максим / Семён) */
  operatorName?: string | null;
  /** Кто инициировал действие (админ / диспетчер) */
  actorName?: string | null;
  /** Для kind=transfer: откуда → куда */
  fromSiloId?: number | null;
  toSiloId?: number | null;
  /** Объём сегмента (м³) — для mid_load при смене силоса */
  volumeM3?: number | null;
}): string {
  const orderPart = `заявка #${opts.orderId}`;
  const shiftName = (opts.operatorName || '').trim();
  const actor = (opts.actorName || '').trim();
  const who = shiftName
    ? `смена ${shiftName}`
    : actor || 'оператор';

  switch (opts.kind) {
    case 'auto_writeoff':
      return `Автосписание · ${orderPart} · ${who}`;
    case 'silo_switch': {
      const vol = Number(opts.volumeM3);
      const volPart = Number.isFinite(vol) && vol > 0
        ? ` · ${String(vol).replace(/\.?0+$/, '')} м³`
        : '';
      return `Автосписание (смена силоса)${volPart} · ${orderPart} · ${who}`;
    }
    case 'backfill':
      return `Автосписание · ${orderPart} · ${who} (задним числом)`;
    case 'rollback':
      return `Возврат · ${orderPart} · ${who}`;
    case 'delete_return':
      return `Возврат · ${orderPart} · ${actor || who}`;
    case 'transfer': {
      const fromName = siloNameById(opts.fromSiloId);
      const toName = siloNameById(opts.toSiloId);
      return `Корректировка · ${orderPart} · ${fromName} → ${toName} · ${actor || who}`;
    }
    default:
      return `${orderPart} · ${who}`;
  }
}
