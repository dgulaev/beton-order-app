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

export function siloIdFromItemType(itemType: string | null | undefined): number | null {
  const t = String(itemType || '');
  const m = t.match(/силос\s*№?\s*([123])\b/i);
  if (!m) return null;
  const id = Number(m[1]);
  return [1, 2, 3].includes(id) ? id : null;
}

export type SiloCementJournalKind =
  | 'auto_writeoff'
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
