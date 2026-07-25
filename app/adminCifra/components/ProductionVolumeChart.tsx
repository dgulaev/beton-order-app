'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  modalCloseButtonStyle,
  volumeCardSoftStyle,
  volumeCardStyle,
  volumeModalStyle,
} from '../cardStyles';

export type VolumeGrain = 'day' | 'month';
export type VolumeChartStyle = 'bar' | 'line';

export type ProductionVolumePoint = {
  /** Подпись оси X */
  label: string;
  /** Текущий период, м³ */
  value: number;
  /** Сравнение с прошлым периодом, м³ */
  prevValue: number;
  /** YYYY-MM-DD (день) или YYYY-MM (месяц) */
  key: string;
  fullDate?: string;
};

type ChartEaseFn = (t: number) => number;

const CHART_INITIAL_DIMENSION = { width: 400, height: 300 };
const BAR_GROW_MS = 780;
const BAR_GROW_EASE: ChartEaseFn = (t) => 1 - (1 - t) ** 4;

function niceAxisMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / pow) * pow;
}

function useChartGrowProgress(dataKey: string, durationMs: number, ease: ChartEaseFn): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!dataKey) {
      setProgress(0);
      return;
    }
    let rafId = 0;
    const startedAt = performance.now();
    setProgress(0);
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      setProgress(ease(t));
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [dataKey, durationMs, ease]);
  return progress;
}

function fmtM3(n: number): string {
  const r = Math.round(Number(n) || 0);
  return r.toLocaleString('ru-RU');
}

function deltaColor(d: number): string {
  if (d > 0) return '#34D399';
  if (d < 0) return '#F87171';
  return '#94A3B8';
}

function VolumeTooltip({
  active,
  payload,
  showPrev,
}: {
  active?: boolean;
  payload?: any[];
  showPrev: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const cur = Number(row.targetValue ?? row.value) || 0;
  const prev = Number(row.targetPrev ?? row.prevValue) || 0;
  const dlt = cur - prev;
  return (
    <div
      style={{
        background: '#1E2937',
        padding: '12px 16px',
        borderRadius: 12,
        border: '1px solid #475569',
        color: '#fff',
        fontSize: 14,
        minWidth: 180,
        boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ marginBottom: 8, color: '#94A3B8', fontWeight: 600 }}>
        {row.label}
        {row.fullDate ? ` · ${row.fullDate}` : ''}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: '#34D399', fontWeight: 700 }}>
        <span>Период</span>
        <span>{fmtM3(cur)} м³</span>
      </div>
      {showPrev && (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              color: '#94A3B8',
              fontWeight: 600,
              marginTop: 4,
            }}
          >
            <span>Прошлый</span>
            <span>{fmtM3(prev)} м³</span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              color: deltaColor(dlt),
              fontWeight: 700,
              marginTop: 6,
              paddingTop: 6,
              borderTop: '1px solid #334155',
            }}
          >
            <span>Δ</span>
            <span>
              {dlt > 0 ? '+' : ''}
              {fmtM3(dlt)} м³
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        backgroundColor: '#25334A',
        borderRadius: 9999,
        padding: 3,
        border: '1px solid #334155',
        flexShrink: 0,
      }}
    >
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            style={{
              padding: '4px 11px',
              borderRadius: 9999,
              backgroundColor: on ? '#3D6B5A' : 'transparent',
              color: on ? '#E2E8F0' : '#94A3B8',
              border: 'none',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ChartLegend({ showPrev }: { showPrev: boolean }) {
  const items = [
    { color: '#10B981', label: 'Текущий период', dash: false },
    ...(showPrev
      ? [{ color: '#94A3B8', label: 'Прошлый период', dash: true as const }]
      : []),
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center' }}>
      {items.map((it) => (
        <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94A3B8' }}>
          <span
            style={{
              width: it.dash ? 18 : 10,
              height: it.dash ? 0 : 10,
              borderRadius: it.dash ? 0 : 3,
              background: it.dash ? 'transparent' : it.color,
              borderTop: it.dash ? `2px dashed ${it.color}` : undefined,
            }}
          />
          {it.label}
        </div>
      ))}
    </div>
  );
}

function VolumeRecharts({
  data,
  grain,
  chartStyle,
  showPrev,
  height = '100%',
}: {
  data: ProductionVolumePoint[];
  grain: VolumeGrain;
  chartStyle: VolumeChartStyle;
  showPrev: boolean;
  height?: number | `${number}%`;
}) {
  const dataKey = `${grain}|${chartStyle}|${showPrev}|${data.map((d) => `${d.key}:${d.value}:${d.prevValue}`).join('|')}`;
  const progress = useChartGrowProgress(dataKey, BAR_GROW_MS, BAR_GROW_EASE);
  const yMax = useMemo(() => {
    const vals = data.flatMap((d) => [d.value, showPrev ? d.prevValue : 0]);
    return niceAxisMax(Math.max(0, ...vals));
  }, [data, showPrev]);

  const animData = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        targetValue: d.value,
        targetPrev: d.prevValue,
        value: d.value * progress,
        prevValue: d.prevValue * progress,
      })),
    [data, progress]
  );

  const commonAxis = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
      <XAxis
        dataKey="label"
        stroke="#94A3B8"
        tickLine={false}
        axisLine={false}
        interval="preserveStartEnd"
        minTickGap={grain === 'day' ? 12 : 8}
        tick={{ fontSize: 11 }}
      />
      <YAxis
        stroke="#94A3B8"
        tickLine={false}
        axisLine={false}
        width={48}
        domain={[0, yMax]}
        allowDataOverflow={false}
        tickCount={5}
        tick={{ fontSize: 11 }}
      />
      <Tooltip content={<VolumeTooltip showPrev={showPrev} />} cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }} />
    </>
  );

  if (chartStyle === 'line') {
    return (
      <ResponsiveContainer width="100%" height={height} initialDimension={CHART_INITIAL_DIMENSION}>
        <ComposedChart data={animData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          {commonAxis}
          {showPrev && (
            <Line
              type="monotone"
              dataKey="prevValue"
              name="Прошлый"
              stroke="#94A3B8"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            name="Текущий"
            stroke="#10B981"
            strokeWidth={2.5}
            dot={{ r: 3, fill: '#10B981', strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#34D399' }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  // Столбцы + пунктирная линия прошлого периода (как на заявках: бары + сравнение)
  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={CHART_INITIAL_DIMENSION}>
      <ComposedChart
        data={animData}
        barCategoryGap={grain === 'month' ? '40%' : '18%'}
        margin={{ top: 8, right: 8, left: 4, bottom: 0 }}
      >
        {commonAxis}
        <Bar
          dataKey="value"
          name="Текущий"
          fill="#10B981"
          radius={[6, 6, 0, 0]}
          isAnimationActive={false}
          activeBar={{ fill: '#34D399', stroke: 'none' }}
        />
        {showPrev && (
          <Line
            type="monotone"
            dataKey="prevValue"
            name="Прошлый"
            stroke="#94A3B8"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

type Props = {
  data: ProductionVolumePoint[];
  grain: VolumeGrain;
  periodLabel: string;
  /** Подпись сравнения: «к прошлым 7 дням», «к прошлому году»… */
  compareLabel: string;
  cardStyle?: CSSProperties;
};

export default function ProductionVolumeChart({
  data,
  grain,
  periodLabel,
  compareLabel,
  cardStyle,
}: Props) {
  const [chartStyle, setChartStyle] = useState<VolumeChartStyle>('bar');
  const [showPrev, setShowPrev] = useState(true);
  const [open, setOpen] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);
  const totalPrev = useMemo(() => data.reduce((s, d) => s + d.prevValue, 0), [data]);
  const avg = data.length ? total / data.length : 0;
  const delta = total - totalPrev;
  const peak = useMemo(
    () => data.reduce<ProductionVolumePoint | null>((best, d) => (!best || d.value > best.value ? d : best), null),
    [data]
  );

  const focus = focusKey ? data.find((d) => d.key === focusKey) : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const controls = (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <SegmentedControl
        value={chartStyle}
        onChange={(k) => setChartStyle(k as VolumeChartStyle)}
        options={[
          { key: 'bar', label: 'Столбцы' },
          { key: 'line', label: 'Линия' },
        ]}
      />
      <button
        type="button"
        onClick={() => setShowPrev((v) => !v)}
        title={showPrev ? 'Скрыть сравнение' : 'Показать сравнение'}
        style={{
          padding: '4px 11px',
          borderRadius: 9999,
          background: showPrev ? 'rgba(148,163,184,0.18)' : 'transparent',
          border: `1px solid ${showPrev ? 'rgba(148,163,184,0.45)' : '#334155'}`,
          color: showPrev ? '#E2E8F0' : '#64748B',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Сравнение
      </button>
    </div>
  );

  return (
    <>
      <div
        style={volumeCardStyle({
          padding: 'clamp(10px, 1.4vh, 18px)',
          borderRadius: 16,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
          ...cardStyle,
        })}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
            flexShrink: 0,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3 style={{ color: '#E2E8F0', margin: 0, fontSize: 'clamp(13px, 1vw, 16px)' }}>
              Объём производства
            </h3>
            <div style={{ color: '#64748B', fontSize: 11, marginTop: 2 }}>
              {grain === 'day' ? 'по дням' : 'по месяцам'}
              {' · '}
              Σ {fmtM3(total)} м³
              {showPrev && (
                <span style={{ color: deltaColor(delta), marginLeft: 6, fontWeight: 600 }}>
                  {delta > 0 ? '+' : ''}
                  {fmtM3(delta)}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {controls}
            <button
              type="button"
              onClick={() => setOpen(true)}
              title="Подробный график"
              style={{
                padding: '4px 11px',
                background: 'rgba(16,185,129,0.12)',
                border: '1px solid rgba(16,185,129,0.35)',
                borderRadius: 9999,
                color: '#6EE7B7',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Отобразить
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
          {data.length === 0 ? (
            <div
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#64748B',
                fontSize: 13,
              }}
            >
              Нет данных за выбранный период
            </div>
          ) : (
            <VolumeRecharts data={data} grain={grain} chartStyle={chartStyle} showPrev={showPrev} />
          )}
        </div>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Объём производства"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.82)',
            zIndex: 10050,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px 24px',
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="scroll-hidden"
            style={volumeModalStyle({
              borderRadius: 20,
              width: '100%',
              maxWidth: 1100,
              height: 'min(920px, 96vh)',
              maxHeight: '96vh',
              overflow: 'hidden',
              padding: '18px 22px 14px',
              display: 'flex',
              flexDirection: 'column',
            })}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
                marginBottom: 12,
                flexShrink: 0,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: 20, color: '#fff', fontWeight: 700 }}>
                  Объём производства
                </h2>
                <div style={{ color: '#94A3B8', fontSize: 13, marginTop: 4 }}>
                  {periodLabel}
                  {' · '}
                  {grain === 'day' ? 'по дням' : 'по месяцам'}
                  {showPrev ? ` · сравнение: ${compareLabel}` : ''}
                </div>
                <div style={{ marginTop: 10 }}>{controls}</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={modalCloseButtonStyle({ color: '#E2E8F0', fontSize: 18 })}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 10,
                marginBottom: 10,
                flexShrink: 0,
              }}
            >
              {[
                { label: 'Сумма', value: `${fmtM3(total)} м³`, color: '#34D399' },
                { label: 'Среднее', value: `${fmtM3(avg)} м³`, color: '#E2E8F0' },
                {
                  label: 'Пик',
                  value: peak ? `${fmtM3(peak.value)} · ${peak.label}` : '—',
                  color: '#93C5FD',
                },
                {
                  label: compareLabel,
                  value: `${delta > 0 ? '+' : ''}${fmtM3(delta)} м³`,
                  color: deltaColor(delta),
                },
              ].map((c) => (
                <div key={c.label} style={volumeCardSoftStyle({ borderRadius: 12, padding: '8px 12px' })}>
                  <div style={{ color: '#64748B', fontSize: 12, marginBottom: 2 }}>{c.label}</div>
                  <div style={{ color: c.color, fontSize: 16, fontWeight: 700 }}>{c.value}</div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 8, flexShrink: 0 }}>
              <ChartLegend showPrev={showPrev} />
            </div>

            <div
              style={volumeCardSoftStyle({
                flex: '1 1 280px',
                minHeight: 240,
                maxHeight: 360,
                borderRadius: 14,
                padding: '10px 8px 6px',
              })}
            >
              {data.length === 0 ? (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}>
                  Нет данных
                </div>
              ) : (
                <VolumeRecharts data={data} grain={grain} chartStyle={chartStyle} showPrev={showPrev} />
              )}
            </div>

            <div
              style={volumeCardSoftStyle({
                marginTop: 10,
                borderRadius: 12,
                padding: '10px 14px',
                flexShrink: 0,
              })}
            >
              {focus ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(3, 1fr)', gap: 10, alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#64748B', fontSize: 12 }}>{grain === 'day' ? 'День' : 'Месяц'}</div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
                      {focus.fullDate || focus.label}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontSize: 12 }}>Период</div>
                    <div style={{ color: '#34D399', fontWeight: 700, fontSize: 16 }}>{fmtM3(focus.value)} м³</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontSize: 12 }}>Прошлый</div>
                    <div style={{ color: '#CBD5E1', fontWeight: 700, fontSize: 16 }}>{fmtM3(focus.prevValue)} м³</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontSize: 12 }}>Δ</div>
                    <div
                      style={{
                        color: deltaColor(focus.value - focus.prevValue),
                        fontWeight: 700,
                        fontSize: 16,
                      }}
                    >
                      {focus.value - focus.prevValue > 0 ? '+' : ''}
                      {fmtM3(focus.value - focus.prevValue)} м³
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ color: '#64748B', fontSize: 13 }}>
                  Выбери строку в таблице ниже — здесь появятся детали точки
                </div>
              )}
            </div>

            <div className="scroll-hidden" style={{ marginTop: 10, flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: '#64748B', textAlign: 'left' }}>
                    <th style={{ padding: '6px 10px', fontWeight: 600 }}>{grain === 'day' ? 'День' : 'Месяц'}</th>
                    <th style={{ padding: '6px 10px', fontWeight: 600 }}>Период, м³</th>
                    <th style={{ padding: '6px 10px', fontWeight: 600 }}>Прошлый, м³</th>
                    <th style={{ padding: '6px 10px', fontWeight: 600 }}>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data].reverse().map((row) => {
                    const dlt = Math.round(row.value - row.prevValue);
                    const active = focusKey === row.key;
                    return (
                      <tr
                        key={row.key}
                        onClick={() => setFocusKey(row.key)}
                        style={{
                          background: active ? 'rgba(16,185,129,0.12)' : 'transparent',
                          cursor: 'pointer',
                          borderTop: '1px solid #334155',
                          color: '#E2E8F0',
                        }}
                      >
                        <td style={{ padding: '7px 10px', fontWeight: 600 }}>
                          {row.fullDate || row.label}
                        </td>
                        <td style={{ padding: '7px 10px', color: '#34D399' }}>{fmtM3(row.value)}</td>
                        <td style={{ padding: '7px 10px', color: '#94A3B8' }}>{fmtM3(row.prevValue)}</td>
                        <td style={{ padding: '7px 10px', color: deltaColor(dlt), fontWeight: 600 }}>
                          {dlt > 0 ? `+${dlt}` : dlt}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
