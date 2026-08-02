'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertTriangle, RefreshCw, Scale, X } from 'lucide-react';
import { expectedSiloSavingTons, SILO_SPEC } from '@/lib/siloConfig';
import type {
  RefillContext,
  RiskOrderRow,
  RiskOrdersSummary,
  TimelineEvent,
  UnderdoseOrderRow,
  UnderdoseSummary,
} from '@/lib/cementUnderdose';
import DarkHoverTip from '../components/DarkHoverTip';
import {
  CARD_BORDER,
  modalCloseButtonStyle,
  modalFieldStyle,
  modalSelectStyle,
  volumeCardSoftStyle,
  volumeModalStyle,
} from '../cardStyles';

type Refill = {
  id: number;
  createdAt: string;
  amountKg: number;
  userName: string | null;
  oldValue?: number | null;
  newValue?: number | null;
};

type Props = {
  onClose: () => void;
  /** Стартовый силос (рабочий смены), если есть */
  initialSiloId?: number | null;
};

function adminAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window !== 'undefined') {
    const userId = localStorage.getItem('userId');
    if (userId) headers['x-user-id'] = userId;
  }
  return headers;
}

/** ISO → значение datetime-local в МСК */
function toMoscowLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || '';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/** datetime-local (МСК) → ISO UTC */
function fromMoscowLocalInput(local: string): string | null {
  const v = String(local || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const ms = Date.parse(`${v}:00+03:00`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function formatKg(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

function formatTons(kg: number): string {
  return (kg / 1000).toLocaleString('ru-RU', {
    maximumFractionDigits: 3,
    signDisplay: 'auto',
  });
}

function formatTonsSigned(kg: number): string {
  const t = kg / 1000;
  const s = t.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  return t > 0 ? `+${s}` : s;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatTimeOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatRefillLabel(r: Refill): string {
  const when = new Date(r.createdAt).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const who = r.userName ? ` · ${r.userName}` : '';
  return `${when} · ${formatTons(r.amountKg)} т${who}`;
}

const fieldLabel: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13.5,
  fontWeight: 600,
  color: '#94A3B8',
};

const tableFont: CSSProperties = {
  fontSize: 13.5,
  color: '#E2E8F0',
};

function OrdersMiniTable({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: Array<{
    orderId: number;
    client: string;
    grade: string;
    volumeM3: number;
    recipeCementKg: number;
    trips: number;
  }>;
  emptyText?: string;
}) {
  if (rows.length === 0) {
    return emptyText ? (
      <div style={{ color: '#94A3B8', fontSize: 13 }}>{emptyText}</div>
    ) : null;
  }
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#E2E8F0', marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ borderRadius: 12, border: CARD_BORDER, overflow: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            ...tableFont,
          }}
        >
          <thead>
            <tr style={{ background: 'rgba(15, 23, 42, 0.85)', color: '#94A3B8' }}>
              {['#', 'Клиент', 'Марка', 'м³', 'Цемент рецепт', 'Рейсы'].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: h === 'Клиент' || h === 'Марка' ? 'left' : 'right',
                    padding: '8px 10px',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    borderBottom: '1px solid rgba(148,163,184,0.18)',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.orderId} style={{ borderBottom: '1px solid rgba(148,163,184,0.10)' }}>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>
                  {r.orderId}
                </td>
                <td style={{ padding: '7px 10px', maxWidth: 220 }}>
                  <span
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.client}
                  </span>
                </td>
                <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{r.grade}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right' }}>{formatKg(r.volumeM3)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                  {formatKg(r.recipeCementKg)}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right' }}>{r.trips}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function CementUnderdoseModal({ onClose, initialSiloId }: Props) {
  const startSilo =
    initialSiloId && [1, 2, 3].includes(Number(initialSiloId))
      ? Number(initialSiloId)
      : 3;

  const [siloId, setSiloId] = useState(startSilo);
  const [refills, setRefills] = useState<Refill[]>([]);
  const [selectedRefillId, setSelectedRefillId] = useState<number | 'manual'>('manual');
  const [sinceLocal, setSinceLocal] = useState('');
  const [untilLocal, setUntilLocal] = useState(() => toMoscowLocalInput(new Date().toISOString()));
  const [actualTons, setActualTons] = useState('');
  const [summary, setSummary] = useState<UnderdoseSummary | null>(null);
  const [rows, setRows] = useState<UnderdoseOrderRow[]>([]);
  const [refillContext, setRefillContext] = useState<RefillContext | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [riskOrders, setRiskOrders] = useState<RiskOrderRow[]>([]);
  const [riskSummary, setRiskSummary] = useState<RiskOrdersSummary | null>(null);
  const [expectedSavingTons, setExpectedSavingTons] = useState(() => expectedSiloSavingTons(startSilo));
  const [loadingRefills, setLoadingRefills] = useState(true);
  const [loadingCalc, setLoadingCalc] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearResults = useCallback(() => {
    setSummary(null);
    setRows([]);
    setRefillContext(null);
    setTimeline([]);
    setRiskOrders([]);
    setRiskSummary(null);
  }, []);

  const applyRefill = useCallback((r: Refill | null) => {
    if (!r) {
      setSelectedRefillId('manual');
      return;
    }
    setSelectedRefillId(r.id);
    setSinceLocal(toMoscowLocalInput(r.createdAt));
    setUntilLocal(toMoscowLocalInput(new Date().toISOString()));
    setActualTons(String(Math.round((r.amountKg / 1000) * 1000) / 1000));
  }, []);

  const loadRefills = useCallback(async () => {
    setLoadingRefills(true);
    setError(null);
    clearResults();
    try {
      const qs = new URLSearchParams({ siloId: String(siloId) });
      const res = await fetch(`/api/adminCifra/warehouse/cement-underdose?${qs}`, {
        headers: adminAuthHeaders(),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Не удалось загрузить загрузки');
        setRefills([]);
        return;
      }
      if (data.expectedSavingTons != null) {
        setExpectedSavingTons(Number(data.expectedSavingTons));
      } else {
        setExpectedSavingTons(expectedSiloSavingTons(siloId));
      }
      const list: Refill[] = Array.isArray(data.refills) ? data.refills : [];
      setRefills(list);
      if (list[0]) applyRefill(list[0]);
      else {
        setSelectedRefillId('manual');
        setActualTons('');
        setSinceLocal('');
        setUntilLocal(toMoscowLocalInput(new Date().toISOString()));
      }
    } catch (err) {
      console.error(err);
      setError('Не удалось загрузить загрузки');
      setRefills([]);
    } finally {
      setLoadingRefills(false);
    }
  }, [siloId, applyRefill, clearResults]);

  useEffect(() => {
    void loadRefills();
  }, [loadRefills]);

  const runCalc = useCallback(async () => {
    const since = fromMoscowLocalInput(sinceLocal);
    const until = fromMoscowLocalInput(untilLocal);
    const tons = Number(String(actualTons).replace(',', '.'));
    if (!since || !until) {
      setError('Укажи период «С» и «По»');
      return;
    }
    if (!Number.isFinite(tons) || tons < 0) {
      setError('Укажи, сколько цемента было (тонн)');
      return;
    }

    setLoadingCalc(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        siloId: String(siloId),
        since,
        until,
        actualKg: String(Math.round(tons * 1000 * 10) / 10),
      });
      if (typeof selectedRefillId === 'number') {
        qs.set('refillId', String(selectedRefillId));
      }
      const res = await fetch(`/api/adminCifra/warehouse/cement-underdose?${qs}`, {
        headers: adminAuthHeaders(),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Не удалось посчитать');
        clearResults();
        return;
      }
      if (Array.isArray(data.refills)) setRefills(data.refills);
      if (data.expectedSavingTons != null) {
        setExpectedSavingTons(Number(data.expectedSavingTons));
      }
      setSummary(data.summary || null);
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setRefillContext(data.refillContext || null);
      setTimeline(Array.isArray(data.timeline) ? data.timeline : []);
      setRiskOrders(Array.isArray(data.riskOrders) ? data.riskOrders : []);
      setRiskSummary(data.riskSummary || null);
    } catch (err) {
      console.error(err);
      setError('Не удалось посчитать');
      clearResults();
    } finally {
      setLoadingCalc(false);
    }
  }, [siloId, sinceLocal, untilLocal, actualTons, selectedRefillId, clearResults]);

  // Автопересчёт после подстановки загрузки / смены силоса
  useEffect(() => {
    if (loadingRefills) return;
    if (!sinceLocal || !untilLocal || actualTons === '') return;
    void runCalc();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только когда поля заполнены после loadRefills
  }, [loadingRefills, siloId, selectedRefillId]);

  const onPickRefill = (value: string) => {
    if (value === 'manual') {
      setSelectedRefillId('manual');
      return;
    }
    const id = Number(value);
    const r = refills.find((x) => x.id === id) || null;
    applyRefill(r);
  };

  const kpi = useMemo(() => {
    if (!summary) return null;
    return [
      {
        label: 'Было в силосе',
        value: `${formatTons(summary.actualKg)} т`,
        sub: `${formatKg(summary.actualKg)} кг`,
        accent: '#94A3B8',
      },
      {
        label: 'По рецептам',
        value: `${formatTons(summary.recipeKg)} т`,
        sub: `${formatKg(summary.recipeKg)} кг · ${formatKg(summary.volumeM3)} м³`,
        accent: '#60A5FA',
      },
      {
        label: summary.hasUnderdose ? 'Недосып' : 'Запас / норма',
        value: summary.hasUnderdose
          ? `${formatTons(summary.shortfallKg)} т`
          : 'нет',
        sub: summary.hasUnderdose
          ? `${formatKg(summary.underdosePct)}% · дали ${formatKg(summary.factor * 100)}% нормы`
          : summary.recipeKg > 0
            ? 'цемента хватило на рецепт'
            : 'нет списаний за период',
        accent: summary.hasUnderdose ? '#F87171' : '#34D399',
      },
      {
        label: 'Средний недосып',
        value:
          summary.avgShortfallKgPerM3 != null
            ? `${formatKg(summary.avgShortfallKgPerM3)} кг/м³`
            : '—',
        sub: `${summary.orderCount} заявок · ${summary.tripCount} рейсов`,
        accent: '#FBBF24',
      },
    ];
  }, [summary]);

  const beforeCard = useMemo(() => {
    if (!refillContext) return null;
    const before = refillContext.beforeKg;
    const deficit = refillContext.deficitBeforeKg;
    const who = refillContext.userName || 'оператор';
    const assess = refillContext.savingAssessment;
    return {
      beforeKg: before,
      afterKg: refillContext.afterKg,
      amountKg: refillContext.amountKg,
      who,
      deficitKg: deficit,
      deficitSource: refillContext.deficitSource,
      assess,
      createdAt: refillContext.createdAt,
    };
  }, [refillContext]);

  const alertThresholdHint =
    siloId === 3
      ? 'алерт оператору при минусе глубже −10 т'
      : 'алерт оператору при минусе глубже −5 т';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.72)',
        backdropFilter: 'blur(4px)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={volumeModalStyle({
          width: 'min(1240px, 100%)',
          maxHeight: 'min(96vh, 1100px)',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          marginTop: '-2vh',
        })}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            padding: '20px 22px 16px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Scale size={20} color="#F87171" />
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#F1F5F9' }}>
                Недосып цемента
              </h2>
            </div>
            <div style={{ fontSize: 14, color: '#94A3B8', maxWidth: 780, lineHeight: 1.45 }}>
              Сравниваем цемент по рецептам на отгрузки с этого силоса с тем, сколько реально
              было в силосе. Если по рецептам больше — считаем равномерный недосып и оценку марки.
            </div>
          </div>
          <button type="button" onClick={onClose} style={modalCloseButtonStyle()} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
            <label style={{ ...fieldLabel, flexDirection: 'column', alignItems: 'stretch' }}>
              Силос
              <select
                value={siloId}
                onChange={(e) => setSiloId(Number(e.target.value))}
                style={modalSelectStyle({
                  width: 140,
                  padding: '8px 28px 8px 10px',
                  fontSize: 13,
                })}
              >
                {SILO_SPEC.map((s) => (
                  <option key={s.silo_id} value={s.silo_id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label
              style={{
                ...fieldLabel,
                flexDirection: 'column',
                alignItems: 'stretch',
                flex: '1 1 280px',
                minWidth: 220,
              }}
            >
              Загрузка (из журнала)
              <select
                value={selectedRefillId === 'manual' ? 'manual' : String(selectedRefillId)}
                onChange={(e) => onPickRefill(e.target.value)}
                disabled={loadingRefills || refills.length === 0}
                style={modalSelectStyle({
                  width: '100%',
                  padding: '8px 28px 8px 10px',
                  fontSize: 13,
                })}
              >
                {refills.length === 0 ? (
                  <option value="manual">Нет загрузок</option>
                ) : null}
                {refills.map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatRefillLabel(r)}
                  </option>
                ))}
                <option value="manual">Вручную…</option>
              </select>
            </label>

            <label style={{ ...fieldLabel, flexDirection: 'column', alignItems: 'stretch' }}>
              Цемента было, т
              <input
                type="number"
                min={0}
                step={0.001}
                value={actualTons}
                onChange={(e) => {
                  setSelectedRefillId('manual');
                  setActualTons(e.target.value);
                }}
                style={modalFieldStyle({
                  width: 120,
                  padding: '8px 10px',
                  fontSize: 13,
                })}
              />
            </label>

            <label style={{ ...fieldLabel, flexDirection: 'column', alignItems: 'stretch' }}>
              С (МСК)
              <input
                type="datetime-local"
                value={sinceLocal}
                onChange={(e) => {
                  setSelectedRefillId('manual');
                  setSinceLocal(e.target.value);
                }}
                style={modalFieldStyle({
                  width: 210,
                  padding: '8px 10px',
                  fontSize: 13,
                })}
              />
            </label>

            <label style={{ ...fieldLabel, flexDirection: 'column', alignItems: 'stretch' }}>
              По (МСК)
              <input
                type="datetime-local"
                value={untilLocal}
                onChange={(e) => {
                  setSelectedRefillId('manual');
                  setUntilLocal(e.target.value);
                }}
                style={modalFieldStyle({
                  width: 210,
                  padding: '8px 10px',
                  fontSize: 13,
                })}
              />
            </label>

            <button
              type="button"
              onClick={() => void runCalc()}
              disabled={loadingCalc || loadingRefills}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 14px',
                borderRadius: 10,
                border: '1px solid rgba(248, 113, 113, 0.45)',
                background: 'rgba(248, 113, 113, 0.14)',
                color: '#FCA5A5',
                fontSize: 13,
                fontWeight: 700,
                cursor: loadingCalc ? 'wait' : 'pointer',
                opacity: loadingCalc ? 0.7 : 1,
                height: 38,
              }}
            >
              <RefreshCw size={14} />
              {loadingCalc ? 'Считаю…' : 'Пересчитать'}
            </button>
          </div>

          {error ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: '#FCA5A5',
                fontWeight: 600,
              }}
            >
              <AlertTriangle size={14} />
              {error}
            </div>
          ) : null}
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '14px 20px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {beforeCard ? (
            <div
              style={volumeCardSoftStyle({
                borderRadius: 12,
                padding: '14px 16px',
                border:
                  beforeCard.assess === 'anomaly'
                    ? '1px solid rgba(248, 113, 113, 0.45)'
                    : CARD_BORDER,
                background:
                  beforeCard.assess === 'anomaly'
                    ? 'rgba(248, 113, 113, 0.08)'
                    : undefined,
              })}
            >
              <div style={{ fontSize: 13.5, color: '#94A3B8', fontWeight: 600, marginBottom: 6 }}>
                До внесения
                {beforeCard.createdAt ? ` · ${formatWhen(beforeCard.createdAt)}` : ''}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '10px 18px',
                  alignItems: 'baseline',
                }}
              >
                <div>
                  <span
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color:
                        beforeCard.beforeKg != null && beforeCard.beforeKg < 0
                          ? '#F87171'
                          : '#E2E8F0',
                    }}
                  >
                    {beforeCard.beforeKg != null
                      ? `${formatTons(beforeCard.beforeKg)} т`
                      : '—'}
                  </span>
                  <span style={{ fontSize: 13.5, color: '#64748B', marginLeft: 6 }}>было</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#34D399' }}>
                  {formatTonsSigned(beforeCard.amountKg)} т
                  <span style={{ fontSize: 13.5, color: '#94A3B8', fontWeight: 600, marginLeft: 6 }}>
                    внёс {beforeCard.who}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#94A3B8' }}>
                    {beforeCard.afterKg != null
                      ? `${formatTons(beforeCard.afterKg)} т`
                      : '—'}
                  </span>
                  <span style={{ fontSize: 13.5, color: '#64748B', marginLeft: 6 }}>стало</span>
                </div>
              </div>
              {beforeCard.deficitKg != null && beforeCard.deficitKg > 0 ? (
                <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.45 }}>
                  {beforeCard.deficitSource === 'reset' || beforeCard.deficitSource === 'savings' ? (
                    <span style={{ color: '#FCA5A5', fontWeight: 600 }}>
                      Перед обнулением/внесением силос уже был в минусе на{' '}
                      {formatTons(beforeCard.deficitKg)} т
                      {beforeCard.assess === 'normal'
                        ? ` — в пределах нормы экономии (~${expectedSavingTons} т)`
                        : beforeCard.assess === 'anomaly'
                          ? ` — аномалия (норма ~${expectedSavingTons} т), проверьте оборудование`
                          : ''}
                      .
                    </span>
                  ) : (
                    <span style={{ color: '#FCA5A5', fontWeight: 600 }}>
                      Остаток до внесения отрицательный:{' '}
                      −{formatTons(beforeCard.deficitKg)} т
                      {beforeCard.assess === 'normal'
                        ? ` (ожидаемая экономия ~${expectedSavingTons} т)`
                        : beforeCard.assess === 'anomaly'
                          ? ` — аномалия при норме ~${expectedSavingTons} т`
                          : ''}
                      .
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 13.5, color: '#64748B' }}>
                  Норма экономии на полном цикле ~{expectedSavingTons} т (~2%).
                </div>
              )}
            </div>
          ) : null}

          {kpi ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 10,
              }}
            >
              {kpi.map((card) => (
                <div
                  key={card.label}
                  style={volumeCardSoftStyle({
                    borderRadius: 12,
                    padding: '12px 14px',
                    border: CARD_BORDER,
                  })}
                >
                  <div style={{ fontSize: 13, color: '#94A3B8', fontWeight: 600, marginBottom: 4 }}>
                    {card.label}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: card.accent, lineHeight: 1.15 }}>
                    {card.value}
                  </div>
                  <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>{card.sub}</div>
                </div>
              ))}
            </div>
          ) : loadingRefills || loadingCalc ? (
            <div style={{ color: '#94A3B8', fontSize: 13 }}>Загрузка…</div>
          ) : (
            <div style={{ color: '#94A3B8', fontSize: 13 }}>
              Выбери загрузку или заполни поля и нажми «Пересчитать».
            </div>
          )}

          {riskSummary?.firstNegativeAt ? (
            <div
              style={volumeCardSoftStyle({
                borderRadius: 12,
                padding: '12px 14px',
                border: '1px solid rgba(251, 191, 36, 0.35)',
              })}
            >
              <div style={{ fontSize: 15, fontWeight: 700, color: '#FDE047', marginBottom: 4 }}>
                Когда начались проблемы
              </div>
              <div style={{ fontSize: 14, color: '#E2E8F0', lineHeight: 1.45 }}>
                Первый уход в минус:{' '}
                <strong>{formatWhen(riskSummary.firstNegativeAt)}</strong>
                {riskSummary.firstNegativeOrderId
                  ? ` · заявка #${riskSummary.firstNegativeOrderId}`
                  : ''}
                . Риск-заявки от аномалии / выбранной загрузки до конца периода —{' '}
                {riskSummary.orderCount} заявок / {riskSummary.tripCount} рейсов, по рецептам{' '}
                {formatTons(riskSummary.recipeKg)} т.
              </div>
            </div>
          ) : null}

          {timeline.length > 0 ? (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#E2E8F0', marginBottom: 8 }}>
                Цепочка событий силоса
              </div>
              <div
                style={{
                  borderRadius: 12,
                  border: CARD_BORDER,
                  overflow: 'auto',
                  maxHeight: 340,
                }}
              >
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    ...tableFont,
                  }}
                >
                  <thead>
                    <tr style={{ background: 'rgba(15, 23, 42, 0.85)', color: '#94A3B8' }}>
                      {['Время (МСК)', 'Операция', 'Кто', 'Кол-во', 'Остаток', 'Заявка'].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: 'left',
                            padding: '9px 12px',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            borderBottom: '1px solid rgba(148,163,184,0.18)',
                            fontSize: 13,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.map((ev) => {
                      const muted = ev.ignoredInCalc || ev.cancelPair;
                      const rowColor = ev.isSelectedRefill
                        ? 'rgba(52, 211, 153, 0.10)'
                        : ev.isNegativeCrossing
                          ? 'rgba(248, 113, 113, 0.12)'
                          : ev.inDeficit
                            ? 'rgba(248, 113, 113, 0.06)'
                            : undefined;
                      return (
                        <tr
                          key={ev.id}
                          style={{
                            borderBottom: '1px solid rgba(148,163,184,0.08)',
                            background: rowColor,
                            opacity: muted ? 0.55 : 1,
                          }}
                        >
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                            {formatTimeOnly(ev.createdAt)}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            {ev.label}
                            {ev.cancelPair ? (
                              <span style={{ color: '#94A3B8', marginLeft: 6 }}>
                                · не учитывается
                              </span>
                            ) : null}
                            {ev.isNegativeCrossing ? (
                              <span style={{ color: '#F87171', marginLeft: 6, fontWeight: 700 }}>
                                · уход в минус
                              </span>
                            ) : null}
                            {ev.isSelectedRefill ? (
                              <span style={{ color: '#34D399', marginLeft: 6, fontWeight: 700 }}>
                                · выбранная загрузка
                              </span>
                            ) : null}
                          </td>
                          <td
                            style={{
                              padding: '8px 12px',
                              whiteSpace: 'nowrap',
                              fontWeight: 600,
                              color: '#CBD5E1',
                            }}
                          >
                            {ev.operatorName || '—'}
                          </td>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                            {ev.amountKg > 0
                              ? `${formatKg(ev.amountKg)} кг (${formatTons(ev.amountKg)} т)`
                              : '—'}
                          </td>
                          <td
                            style={{
                              padding: '8px 12px',
                              whiteSpace: 'nowrap',
                              color:
                                ev.newKg != null && ev.newKg < 0 ? '#F87171' : '#94A3B8',
                            }}
                          >
                            {ev.oldKg != null || ev.newKg != null
                              ? `${ev.oldKg != null ? formatTons(ev.oldKg) : '—'} → ${
                                  ev.newKg != null ? formatTons(ev.newKg) : '—'
                                } т`
                              : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                            {ev.orderId ? `#${ev.orderId}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {riskOrders.length > 0 ? (
            <OrdersMiniTable
              title="Заявки с риском (от аномалии / загрузки до конца периода)"
              rows={riskOrders}
            />
          ) : null}

          {rows.length > 0 ? (
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#E2E8F0', marginBottom: 8 }}>
                После внесения — недосып по заявкам
              </div>
              <div
                style={{
                  borderRadius: 12,
                  border: CARD_BORDER,
                  overflow: 'auto',
                }}
              >
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    ...tableFont,
                  }}
                >
                  <thead>
                    <tr style={{ background: 'rgba(15, 23, 42, 0.85)', color: '#94A3B8' }}>
                      {[
                        '#',
                        'Клиент',
                        'Марка заявки',
                        'Оценка факта',
                        'м³',
                        'Цемент рецепт',
                        'Цемент факт',
                        'Недосып',
                        'кг/м³',
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign:
                              h === 'Клиент' || h === 'Марка заявки' || h === 'Оценка факта'
                                ? 'left'
                                : 'right',
                            padding: '8px 10px',
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                            borderBottom: '1px solid rgba(148,163,184,0.18)',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.orderId}
                        style={{ borderBottom: '1px solid rgba(148,163,184,0.10)' }}
                      >
                        <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>
                          {r.orderId}
                        </td>
                        <td style={{ padding: '7px 10px', maxWidth: 220 }}>
                          <span
                            style={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {r.client}
                          </span>
                        </td>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{r.grade}</td>
                        <td
                          style={{
                            padding: '7px 10px',
                            whiteSpace: 'nowrap',
                            color: summary?.hasUnderdose ? '#FBBF24' : '#6EE7B7',
                            fontWeight: 700,
                          }}
                        >
                          {r.estimatedGrade || '—'}
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                          {formatKg(r.volumeM3)}
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                          {formatKg(r.recipeCementKg)}
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>
                          {formatKg(r.actualCementKg)}
                        </td>
                        <td
                          style={{
                            padding: '7px 10px',
                            textAlign: 'right',
                            color: r.shortfallKg > 0 ? '#F87171' : '#64748B',
                            fontWeight: 600,
                          }}
                        >
                          {r.shortfallKg > 0 ? formatKg(r.shortfallKg) : '—'}
                        </td>
                        <td
                          style={{
                            padding: '7px 10px',
                            textAlign: 'right',
                            whiteSpace: 'nowrap',
                            color: '#94A3B8',
                          }}
                        >
                          {r.recipeKgPerM3 != null && r.actualKgPerM3 != null
                            ? `${formatKg(r.recipeKgPerM3)} → ${formatKg(r.actualKgPerM3)}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {summary ? (
                    <tfoot>
                      <tr style={{ background: 'rgba(15, 23, 42, 0.65)', fontWeight: 800 }}>
                        <td colSpan={3} style={{ padding: '8px 10px' }}>
                          Итого
                        </td>
                        <td style={{ padding: '8px 10px' }} />
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          {formatKg(summary.volumeM3)}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          {formatKg(summary.recipeKg)}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          {formatKg(summary.actualKg)}
                        </td>
                        <td
                          style={{
                            padding: '8px 10px',
                            textAlign: 'right',
                            color: summary.hasUnderdose ? '#F87171' : '#64748B',
                          }}
                        >
                          {summary.hasUnderdose ? formatKg(summary.shortfallKg) : '—'}
                        </td>
                        <td style={{ padding: '8px 10px' }} />
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>
            </div>
          ) : summary && !loadingCalc ? (
            <div style={{ color: '#94A3B8', fontSize: 13 }}>
              За период после внесения нет списаний цемента с этого силоса.
            </div>
          ) : null}

          <DarkHoverTip
            tip={
              `Оценка марки — только по кг цемента на м³ из рецептов, не лабораторная прочность. `
              + `Модель: равномерный недосып на рейсы после выбранной загрузки. `
              + `Ручные списания, MEKA-копейки и пары «+X/−X» в загрузки не входят. `
              + `Норма экономии ~2% (${expectedSavingTons} т). ${alertThresholdHint}.`
            }
            maxWidth={420}
            display="block"
          >
            <div style={{ fontSize: 13.5, color: '#64748B', lineHeight: 1.45, cursor: 'help' }}>
              Оценка марки — по кг/м³ из рецептов · равномерный недосып после загрузки ·
              норма экономии ~{expectedSavingTons} т (~2%) · {alertThresholdHint}
              {' '}
              <span style={{ color: '#94A3B8', textDecoration: 'underline dotted' }}>подробнее</span>
            </div>
          </DarkHoverTip>
        </div>
      </div>
    </div>
  );
}
