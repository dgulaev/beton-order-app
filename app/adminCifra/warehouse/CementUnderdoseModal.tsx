'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertTriangle, RefreshCw, Scale, X } from 'lucide-react';
import { SILO_SPEC } from '@/lib/siloConfig';
import type { UnderdoseOrderRow, UnderdoseSummary } from '@/lib/cementUnderdose';
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
  return (kg / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
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
  fontSize: 12,
  fontWeight: 600,
  color: '#94A3B8',
};

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
  const [loadingRefills, setLoadingRefills] = useState(true);
  const [loadingCalc, setLoadingCalc] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setSummary(null);
    setRows([]);
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
  }, [siloId, applyRefill]);

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
      const res = await fetch(`/api/adminCifra/warehouse/cement-underdose?${qs}`, {
        headers: adminAuthHeaders(),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Не удалось посчитать');
        setSummary(null);
        setRows([]);
        return;
      }
      if (Array.isArray(data.refills)) setRefills(data.refills);
      setSummary(data.summary || null);
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (err) {
      console.error(err);
      setError('Не удалось посчитать');
      setSummary(null);
      setRows([]);
    } finally {
      setLoadingCalc(false);
    }
  }, [siloId, sinceLocal, untilLocal, actualTons]);

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
          width: 'min(1100px, 100%)',
          maxHeight: 'min(90vh, 920px)',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        })}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            padding: '18px 20px 14px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Scale size={18} color="#F87171" />
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#F1F5F9' }}>
                Недосып цемента
              </h2>
            </div>
            <div style={{ fontSize: 12.5, color: '#94A3B8', maxWidth: 720, lineHeight: 1.4 }}>
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
                  <div style={{ fontSize: 11.5, color: '#94A3B8', fontWeight: 600, marginBottom: 4 }}>
                    {card.label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: card.accent, lineHeight: 1.15 }}>
                    {card.value}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>{card.sub}</div>
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

          {rows.length > 0 ? (
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
                  fontSize: 12.5,
                  color: '#E2E8F0',
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
                          textAlign: h === 'Клиент' || h === 'Марка заявки' || h === 'Оценка факта' ? 'left' : 'right',
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
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                      <td style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: '#94A3B8' }}>
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
          ) : summary && !loadingCalc ? (
            <div style={{ color: '#94A3B8', fontSize: 13 }}>
              За период нет списаний цемента с этого силоса.
            </div>
          ) : null}

          <div style={{ fontSize: 11.5, color: '#64748B', lineHeight: 1.4 }}>
            Оценка марки — только по кг цемента на м³ из рецептов, не лабораторная прочность.
            Модель: равномерный недосып на все рейсы периода.
          </div>
        </div>
      </div>
    </div>
  );
}
