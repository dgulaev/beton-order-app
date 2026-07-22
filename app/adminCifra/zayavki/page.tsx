'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Order } from '../hooks/useCalendarOrders';
import { useRealtimeOrders, useRealtimeOrderMixers } from '../../../hooks/useRealtimeOrders';
import NewOrderModal from '@/app/adminCifra/components/NewOrderModal';
import { useMapRouteLinks } from '@/lib/yandexRoute';
import { Package, Save, Trash2, Send, Share2, Copy, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { OrderHistoryTimeline } from '@/lib/orderHistoryDisplay';
import OrderRouteMap from '@/app/adminCifra/components/OrderRouteMap';
import ModalActionButton from '@/app/adminCifra/components/ModalActionButton';
import { findRecipeByGrade, getAdditiveDosage, ADDITIVE_NAMES } from '@/lib/recipeAdditives';
import { formatPhoneDisplay, formatPhoneInput } from '@/lib/phone';

// ==================== Подсказка "тут есть скрытый контент" (мерцающая стрелочка вниз) ====================
// Скроллбар у блока всегда скрыт (глобальный сброс в globals.css); вместо него —
// мягкий градиент + мерцающая стрелка снизу, видна только пока список не докручен до конца.
function ScrollMoreHint({ visible, background = 'rgba(37,51,74,0.95)' }: { visible: boolean; background?: string }) {
  if (!visible) return null;
  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: '26px',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      paddingBottom: '2px',
      background: `linear-gradient(to bottom, rgba(37,51,74,0), ${background})`,
      borderRadius: '0 0 12px 12px',
      pointerEvents: 'none',
    }}>
      <span style={{ color: '#94A3B8', fontSize: '13px', lineHeight: 1, animation: 'zayavkiScrollBounce 1.4s ease-in-out infinite' }}>
        ▼
      </span>
    </div>
  );
}

type WeekChartDay = {
  plan: number;
  shipped: number;
  prevPlan: number;
  orders: number;
  shippedOrders: number;
};

function localDayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** SVG-график недели. compact — одна линия плана; expanded — все серии в модалке. */
function WeekVolumeChartSvg({
  days,
  series,
  selectedDateStr,
  onSelectDay,
  hover,
  setHover,
  variant,
  idPrefix,
}: {
  days: Date[];
  series: WeekChartDay[];
  selectedDateStr: string;
  onSelectDay: (d: Date) => void;
  hover: number | null;
  setHover: (i: number | null) => void;
  variant: 'compact' | 'expanded';
  idPrefix: string;
}) {
  const expanded = variant === 'expanded';
  const W = expanded ? 720 : 300;
  const H = expanded ? 260 : 108;
  const padL = expanded ? 28 : 10;
  const padR = expanded ? 20 : 10;
  const padT = expanded ? 28 : 18;
  const padB = expanded ? 28 : 18;
  const chartH = H - padT - padB;
  const n = Math.max(days.length, 1);
  const step = n > 1 ? (W - padL - padR) / (n - 1) : 0;
  const barW = Math.min(expanded ? 28 : 12, Math.max(6, step * 0.38));

  const plans = series.map((s) => s.plan);
  const shipped = series.map((s) => s.shipped);
  const prevPlans = series.map((s) => s.prevPlan);
  // В превью шкала только по плану; в модалке — по всем сериям.
  const maxV = expanded
    ? Math.max(...plans, ...shipped, ...prevPlans, 0)
    : Math.max(...plans, 0);
  const avgPlan = plans.length ? plans.reduce((a, b) => a + b, 0) / plans.length : 0;
  const scaleMax = maxV > 0 ? maxV : 1;

  const yOf = (v: number) => padT + chartH - (v / scaleMax) * chartH;
  const xOf = (i: number) => padL + i * step;
  const isPeak = (v: number, i: number) => {
    if (v <= 0 || maxV <= 0) return false;
    const left = plans[i - 1] ?? 0;
    const right = plans[i + 1] ?? 0;
    return maxV >= avgPlan * 1.35 && v >= maxV * 0.92 && v >= left && v >= right;
  };
  const poly = (vals: number[]) => vals.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ');
  const gridYs = (expanded ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1]).map((t) => padT + chartH * (1 - t));
  const fillId = `${idPrefix}-fill`;
  const glowId = `${idPrefix}-glow`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block' }}
      role="img"
      aria-label={expanded ? 'Объём: план, отгрузка и прошлая неделя' : 'Объём по дням недели'}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60A5FA" stopOpacity={expanded ? 0.22 : 0.28} />
          <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.02" />
        </linearGradient>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {gridYs.map((y, i) => (
        <line key={i} x1={padL} y1={y} x2={W - padR} y2={y} stroke="#334155" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}

      {expanded && maxV > 0 && gridYs.map((y, i) => {
        const val = Math.round(scaleMax * (1 - i / (gridYs.length - 1)));
        return (
          <text key={`yl-${i}`} x={padL - 6} y={y + 3} textAnchor="end" fill="#475569" fontSize="10">
            {val}
          </text>
        );
      })}

      {/* Мини-бары и доп. линии — только в модалке */}
      {expanded && plans.map((v, i) => {
        if (v <= 0) return null;
        const x = xOf(i);
        const y = yOf(v);
        return (
          <rect
            key={`bar-${i}`}
            x={x - barW / 2}
            y={y}
            width={barW}
            height={Math.max(0, padT + chartH - y)}
            rx={2}
            fill={isPeak(v, i) ? 'rgba(16,185,129,0.22)' : 'rgba(96,165,250,0.16)'}
          />
        );
      })}

      {expanded && (
        <polyline
          points={poly(prevPlans)}
          fill="none"
          stroke="#94A3B8"
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.8}
          vectorEffect="non-scaling-stroke"
        />
      )}

      {plans.some((v) => v > 0) && (
        <path
          d={`M ${xOf(0)},${padT + chartH} L ${plans.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' L ')} L ${xOf(n - 1)},${padT + chartH} Z`}
          fill={`url(#${fillId})`}
        />
      )}
      <polyline
        points={poly(plans)}
        fill="none"
        stroke="#60A5FA"
        strokeWidth={expanded ? 2.75 : 2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />

      {expanded && (
        <polyline
          points={poly(shipped)}
          fill="none"
          stroke="#10B981"
          strokeWidth={2.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {days.map((day, i) => {
        const dateStr = localDayKey(day);
        const selected = dateStr === selectedDateStr;
        const peak = isPeak(plans[i], i);
        const x = xOf(i);
        const yPlan = yOf(plans[i]);
        const yShip = yOf(shipped[i]);
        const dayShort = day.toLocaleDateString('ru-RU', { weekday: 'short' });
        const active = hover === i || selected;
        // В превью подписи только у пиков и выбранного дня
        const showLabel = expanded ? true : (peak || selected);

        return (
          <g
            key={dateStr}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelectDay(day)}
            onMouseEnter={() => setHover(i)}
          >
            <rect
              x={Math.max(0, x - (step || 28) / 2)}
              y={0}
              width={Math.max(step || 28, 24)}
              height={H}
              fill={hover === i ? 'rgba(96,165,250,0.07)' : 'transparent'}
            />
            {selected && (
              <line
                x1={x} y1={padT} x2={x} y2={padT + chartH}
                stroke="#3B82F6" strokeWidth="1.25" strokeDasharray="3 3" opacity={0.5}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <circle
              cx={x} cy={yPlan}
              r={peak ? (expanded ? 6 : 5.5) : active ? 4 : 3.5}
              fill={peak ? '#10B981' : '#60A5FA'}
              stroke={peak ? '#34D399' : active ? '#fff' : 'none'}
              strokeWidth={peak || active ? 1.5 : 0}
              filter={peak ? `url(#${glowId})` : undefined}
              vectorEffect="non-scaling-stroke"
            />
            {expanded && shipped[i] > 0 && (
              <circle
                cx={x} cy={yShip} r={3.5}
                fill="#10B981" stroke="#064E3B" strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {showLabel && (
              <text
                x={x} y={Math.max(expanded ? 14 : 11, yPlan - (expanded ? 10 : 9))}
                textAnchor="middle"
                fill={peak ? '#34D399' : '#E2E8F0'}
                fontSize={expanded ? 12 : 10.5}
                fontWeight={700}
              >
                {Math.round(plans[i])}
              </text>
            )}
            <text
              x={x} y={H - (expanded ? 8 : 5)}
              textAnchor="middle"
              fill={selected || hover === i ? '#60A5FA' : '#64748B'}
              fontSize={expanded ? 12 : 10.5}
              fontWeight={selected || hover === i ? 700 : 500}
            >
              {expanded
                ? day.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric' })
                : dayShort}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function WeekChartLegend() {
  return (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '11px', color: '#64748B' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        <span style={{ width: 14, height: 2, background: '#60A5FA', borderRadius: 2, display: 'inline-block' }} />
        План
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        <span style={{ width: 14, height: 2, background: '#10B981', borderRadius: 2, display: 'inline-block' }} />
        Отгружено
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        <span style={{ width: 14, height: 0, borderTop: '2px dashed #94A3B8', display: 'inline-block' }} />
        Прошлая неделя
      </span>
    </div>
  );
}

/** Превью в боковой колонке + модалка с детальным графиком. */
function WeekVolumeChart({
  days,
  series,
  selectedDateStr,
  onSelectDay,
  onShiftWeek,
}: {
  days: Date[];
  series: WeekChartDay[];
  selectedDateStr: string;
  onSelectDay: (d: Date) => void;
  /** ±1 — сдвиг на неделю (синхронно с боковой колонкой) */
  onShiftWeek: (delta: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [modalHover, setModalHover] = useState<number | null>(null);

  const totalPlan = Math.round(series.reduce((s, d) => s + d.plan, 0));
  const totalShipped = Math.round(series.reduce((s, d) => s + d.shipped, 0));
  const totalOrders = series.reduce((s, d) => s + d.orders, 0);
  const totalPrev = Math.round(series.reduce((s, d) => s + d.prevPlan, 0));
  const deltaPrev = totalPlan - totalPrev;

  const focusIdx = modalHover ?? days.findIndex((d) => localDayKey(d) === selectedDateStr);
  const focus = focusIdx >= 0 ? series[focusIdx] : null;
  const focusDay = focusIdx >= 0 ? days[focusIdx] : null;

  const shiftWeek = (delta: number) => {
    setModalHover(null);
    onShiftWeek(delta);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        shiftWeek(-1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        shiftWeek(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onShiftWeek]);

  return (
    <>
      {/* ===== Компактное превью ===== */}
      <div
        style={{
          background: '#1E2937',
          borderRadius: '14px',
          padding: '8px 10px 6px',
          marginTop: '8px',
          marginBottom: '4px',
          width: '100%',
          boxSizing: 'border-box',
          flexShrink: 0,
          height: '148px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
          <div style={{ color: '#94A3B8', fontSize: '12px', fontWeight: 600 }}>Объём по дням</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ color: '#64748B', fontSize: '11px' }}>
              Σ <span style={{ color: '#CBD5E1', fontWeight: 600 }}>{totalPlan}</span> м³
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              title="Открыть подробный график"
              style={{
                padding: '3px 9px',
                background: 'rgba(96,165,250,0.12)',
                border: '1px solid rgba(96,165,250,0.35)',
                borderRadius: '8px',
                color: '#93C5FD',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Отобразить
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <WeekVolumeChartSvg
            days={days}
            series={series}
            selectedDateStr={selectedDateStr}
            onSelectDay={onSelectDay}
            hover={hover}
            setHover={setHover}
            variant="compact"
            idPrefix="week-compact"
          />
        </div>
      </div>

      {/* ===== Модалка с полным графиком ===== */}
      {open && (
        <div
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
            style={{
              background: '#1E2937',
              borderRadius: '20px',
              width: '100%',
              maxWidth: '1080px',
              // На 1920 места хватает — почти во весь экран, без внутреннего скролла
              height: 'min(920px, 96vh)',
              maxHeight: '96vh',
              overflow: 'hidden',
              border: '1px solid #334155',
              boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
              padding: '18px 22px 14px',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '10px', flexShrink: 0 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: '20px', color: '#fff', fontWeight: 700 }}>Объём по дням недели</h2>
                {/* Пагинация по неделям */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => shiftWeek(-1)}
                    title="Предыдущая неделя"
                    style={{
                      background: '#334155',
                      border: 'none',
                      color: '#E2E8F0',
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      cursor: 'pointer',
                      fontSize: 20,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    ←
                  </button>
                  <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                    <div style={{ color: '#E2E8F0', fontSize: '15px', fontWeight: 600 }}>
                      {days[0]?.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                      {' — '}
                      {days[6]?.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </div>
                    <div style={{ color: '#64748B', fontSize: '12px', marginTop: 2 }}>
                      стрелки ← → на клавиатуре
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => shiftWeek(1)}
                    title="Следующая неделя"
                    style={{
                      background: '#334155',
                      border: 'none',
                      color: '#E2E8F0',
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      cursor: 'pointer',
                      fontSize: 20,
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                  >
                    →
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  background: '#334155',
                  border: 'none',
                  color: '#E2E8F0',
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>

            {/* Сводка недели */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '10px', flexShrink: 0 }}>
              {[
                { label: 'Заявки', value: String(totalOrders), color: '#E2E8F0' },
                { label: 'План', value: `${totalPlan} м³`, color: '#93C5FD' },
                { label: 'Отгружено', value: `${totalShipped} м³`, color: '#34D399' },
                {
                  label: 'к прошлой нед.',
                  value: `${deltaPrev > 0 ? '+' : ''}${deltaPrev} м³`,
                  color: deltaPrev > 0 ? '#34D399' : deltaPrev < 0 ? '#F87171' : '#94A3B8',
                },
              ].map((c) => (
                <div key={c.label} style={{ background: '#0F172A', borderRadius: 12, padding: '8px 12px', border: '1px solid #334155' }}>
                  <div style={{ color: '#64748B', fontSize: 12, marginBottom: 2 }}>{c.label}</div>
                  <div style={{ color: c.color, fontSize: 17, fontWeight: 700 }}>{c.value}</div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: '6px', flexShrink: 0 }}>
              <WeekChartLegend />
            </div>

            <div style={{ flex: '1 1 300px', minHeight: 260, maxHeight: 340, background: '#0F172A', borderRadius: 14, padding: '8px 4px 4px', border: '1px solid #334155' }}>
              <WeekVolumeChartSvg
                days={days}
                series={series}
                selectedDateStr={selectedDateStr}
                onSelectDay={onSelectDay}
                hover={modalHover}
                setHover={setModalHover}
                variant="expanded"
                idPrefix="week-modal"
              />
            </div>

            {/* Детали дня — под графиком, не перекрывает */}
            <div
              style={{
                marginTop: 10,
                background: '#0F172A',
                borderRadius: 12,
                padding: '10px 14px',
                border: '1px solid #334155',
                flexShrink: 0,
              }}
            >
              {focus && focusDay ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(4, 1fr)', gap: 10, alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#64748B', fontSize: 12 }}>День</div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
                      {focusDay.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontSize: 12 }}>Заявки</div>
                    <div style={{ color: '#E2E8F0', fontWeight: 700, fontSize: 16 }}>
                      {focus.orders}
                      {focus.shippedOrders > 0 && (
                        <span style={{ color: '#64748B', fontWeight: 500, fontSize: 12 }}> · отгр. {focus.shippedOrders}</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontSize: 12 }}>План</div>
                    <div style={{ color: '#93C5FD', fontWeight: 700, fontSize: 16 }}>{Math.round(focus.plan)} м³</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontSize: 12 }}>Отгружено</div>
                    <div style={{ color: '#34D399', fontWeight: 700, fontSize: 16 }}>{Math.round(focus.shipped)} м³</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontSize: 12 }}>Прошл. нед.</div>
                    <div style={{ color: '#CBD5E1', fontWeight: 700, fontSize: 16 }}>{Math.round(focus.prevPlan)} м³</div>
                  </div>
                </div>
              ) : (
                <div style={{ color: '#64748B', fontSize: 13 }}>Наведи на день или выбери его на графике</div>
              )}
            </div>

            {/* Таблица по дням */}
            <div style={{ marginTop: 10, flexShrink: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: '#64748B', textAlign: 'left' }}>
                    <th style={{ padding: '6px 10px', fontWeight: 600 }}>День</th>
                    <th style={{ padding: '6px 10px', fontWeight: 600 }}>Заявки</th>
                    <th style={{ padding: '6px 10px', fontWeight: 600 }}>План, м³</th>
                    <th style={{ padding: '6px 10px', fontWeight: 600 }}>Отгр., м³</th>
                    <th style={{ padding: '6px 10px', fontWeight: 600 }}>Прошл., м³</th>
                    <th style={{ padding: '6px 10px', fontWeight: 600 }}>Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day, i) => {
                    const s = series[i];
                    const key = localDayKey(day);
                    const active = key === selectedDateStr || modalHover === i;
                    const dlt = Math.round(s.plan - s.prevPlan);
                    return (
                      <tr
                        key={key}
                        onClick={() => onSelectDay(day)}
                        onMouseEnter={() => setModalHover(i)}
                        style={{
                          background: active ? 'rgba(59,130,246,0.12)' : 'transparent',
                          cursor: 'pointer',
                          borderTop: '1px solid #334155',
                          color: '#E2E8F0',
                        }}
                      >
                        <td style={{ padding: '7px 10px', fontWeight: 600 }}>
                          {day.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })}
                        </td>
                        <td style={{ padding: '7px 10px' }}>{s.orders}</td>
                        <td style={{ padding: '7px 10px', color: '#93C5FD' }}>{Math.round(s.plan)}</td>
                        <td style={{ padding: '7px 10px', color: '#34D399' }}>{Math.round(s.shipped)}</td>
                        <td style={{ padding: '7px 10px', color: '#94A3B8' }}>{Math.round(s.prevPlan)}</td>
                        <td style={{ padding: '7px 10px', color: dlt > 0 ? '#34D399' : dlt < 0 ? '#F87171' : '#64748B', fontWeight: 600 }}>
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

export default function ZayavkiPage() {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const { yandexHref: yandexRouteHref, googleHref: googleRouteHref, twoGisHref: twoGisRouteHref } = useMapRouteLinks(selectedOrder?.address);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'processing' | 'completed' | 'cancelled'>('all');
  // Режим расширенного поиска по всему месяцу
  const [searchMode, setSearchMode] = useState(false);
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [newOrderInitialData, setNewOrderInitialData] = useState<any>(null);
  const [orderHistory, setOrderHistory] = useState<any[]>([]);
  const [orderMixers, setOrderMixers] = useState<any[]>([]);
  // Рейсы всех заявок выбранного дня — для KPI (факт по разгруженным м³)
  const [dayMixerAssignments, setDayMixerAssignments] = useState<any[]>([]);
  const [userFullName, setUserFullName] = useState<string>('');
  const [currentRole, setCurrentRole] = useState<string>('');
 
  
  const [notificationSent, setNotificationSent] = useState(false);
  const [isSendingNotification, setIsSendingNotification] = useState(false);

  const [recipes, setRecipes] = useState<any[]>([]);
  // Остатки добавок на складе (литры), подгружаются один раз
  const [warehouseAdditives, setWarehouseAdditives] = useState<{ pfm: number; linomix: number } | null>(null);
  const [showAdditivePopup, setShowAdditivePopup] = useState(false);

  // ==================== ПОИСК КЛИЕНТА В МОДАЛКЕ РЕДАКТИРОВАНИЯ ====================
  const [allClients, setAllClients] = useState<any[]>([]);
  const [clientQuery, setClientQuery] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);

  // ==================== "СПИСОК УШЁЛ ВНИЗ" — стрелки-подсказки для скроллящихся блоков модалки ====================
  const mixerListRef = useRef<HTMLDivElement>(null);
  const [mixerListHasMore, setMixerListHasMore] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  // Защита от гонки: один клик по «Под вопросом» иначе шлёт 3–4 параллельных PUT
  const questionableSavingRef = useRef(false);
  const [questionableSaving, setQuestionableSaving] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const [commentHasMore, setCommentHasMore] = useState(false);

  const recomputeOverflow = (el: HTMLElement | null, setter: (v: boolean) => void) => {
    if (!el) { setter(false); return; }
    setter(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };

  const handleMixerListScroll = () => recomputeOverflow(mixerListRef.current, setMixerListHasMore);
  const handleHistoryScroll = () => recomputeOverflow(historyRef.current, setHistoryHasMore);
  const handleCommentScroll = () => recomputeOverflow(commentRef.current, setCommentHasMore);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      recomputeOverflow(mixerListRef.current, setMixerListHasMore);
      recomputeOverflow(historyRef.current, setHistoryHasMore);
      recomputeOverflow(commentRef.current, setCommentHasMore);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder?.id, orderMixers.length, orderHistory.length]);

  // ==================== HELPER ДЛЯ СТАТУСОВ (getStatusConfig) ====================
const getStatusConfig = (status: string) => {
  switch (status) {
    case 'new':
      return { label: 'Новая', bg: '#FACC1520', color: '#FACC15', final: false };
    case 'processing':
      return { label: 'В работе', bg: '#3B82F620', color: '#3B82F6', final: false };
    case 'completed':
      return { label: 'Выполнена', bg: '#10B98120', color: '#10B981', final: true };
    case 'cancelled':
      return { label: 'Отменена', bg: '#EF444420', color: '#EF4444', final: true };
    default:
      return { label: status, bg: '#64748B20', color: '#64748B', final: false };
  }
};

    // ==================== HELPER ДЛЯ ПРОВЕРКИ ПРАВ ====================
  const hasManagerPermissions = (role: string): boolean => {
    if (!role) return false;
    const r = role.toLowerCase().trim();
    return r === 'admin' || r === 'manager' || r === 'dispatcher' || r === 'logist';
  };

  const isAdmin = (role: string): boolean => {
    return role?.toLowerCase().trim() === 'admin';
  };

  // ==================== ЗАГРУЗКА ИСТОРИИ ИЗМЕНЕНИЙ ====================
  const loadOrderHistory = useCallback(async (orderId: number) => {
    try {
      const res = await fetch(`/api/adminCifra/orders/${orderId}/history`);
      if (res.ok) {
        const data = await res.json();
        setOrderHistory(data);
      } else {
        setOrderHistory([]);
      }
    } catch (err) {
      console.error('Ошибка загрузки истории:', err);
      setOrderHistory([]);
    }
  }, []);

  // ==================== ЗАГРУЗКА НАЗНАЧЕННЫХ МИКСЕРОВ (для отображения простоя) ====================
  const loadOrderMixers = useCallback(async (orderId: number) => {
    try {
      const res = await fetch(`/api/adminCifra/order-mixers?orderId=${orderId}`);
      if (res.ok) {
        setOrderMixers(await res.json());
      } else {
        setOrderMixers([]);
      }
    } catch (err) {
      console.error('Ошибка загрузки миксеров заявки:', err);
      setOrderMixers([]);
    }
  }, []);

  // Правка объёма уже назначенного миксера — инструмент для исправления
  // ситуаций постфактум (напр. заявка #589: заявку закрыли по факту 7=7 м³,
  // а по факту реально привезли 8 м³). Разрешена и на уже "Выполненной"
  // заявке.
  const handleMixerVolumeChange = useCallback(async (mixerId: number, newVolume: number) => {
    const oldMixer = orderMixers.find((m: any) => m.id === mixerId);
    const oldVolume = oldMixer?.volume;

    setOrderMixers(prev => prev.map((m: any) => m.id === mixerId ? { ...m, volume: newVolume } : m));

    try {
      const res = await fetch('/api/adminCifra/order-mixers/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mixerId,
          volume: newVolume,
          userName: userFullName || 'Сотрудник',
          userRole: currentRole || 'admin',
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Не удалось изменить объём миксера');
      }

      if (selectedOrder?.id) {
        loadOrderHistory(selectedOrder.id);
        if (data.data?.orderCompleted) {
          setSelectedOrder((prev: any) => prev ? { ...prev, status: 'completed' } : prev);
        }
      }
    } catch (err) {
      console.error('Ошибка сохранения объёма миксера:', err);
      setOrderMixers(prev => prev.map((m: any) => m.id === mixerId ? { ...m, volume: oldVolume } : m));
      alert('Не удалось сохранить объём миксера: ' + (err instanceof Error ? err.message : ''));
    }
  }, [orderMixers, userFullName, currentRole, selectedOrder?.id, loadOrderHistory]);

  // ==================== ОТКРЫТИЕ ЗАЯВКИ С ИСТОРИЕЙ ====================
  const handleOpenOrder = useCallback((order: Order) => {
    setSelectedOrder(order);
    const orderId = order.id ? Number(order.id) : null;
    if (orderId) {
      loadOrderHistory(orderId);
      loadOrderMixers(orderId);
    } else {
      console.error('У заявки отсутствует id:', order);
    }
  }, [loadOrderHistory, loadOrderMixers]);

                  // ==================== ЗАГРУЗКА РОЛИ И РЕАЛЬНОГО ИМЕНИ ====================
useEffect(() => {
  const loadRoleAndName = async () => {
    const savedUserId = localStorage.getItem('userId');
    if (!savedUserId) {
      setCurrentRole('admin');
      setUserFullName('Сотрудник');
      return;
    }

    try {
      const res = await fetch('/api/user/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: savedUserId }),
        cache: 'no-store'
      });

      if (res.ok) {
        const data = await res.json();
        const role = (data.role || 'admin').toLowerCase();
        const name = data.full_name || data.username || data.name || 'Сотрудник';

        setCurrentRole(role);
        setUserFullName(name);

        localStorage.setItem('userRole', role);
        localStorage.setItem('userName', name);

        console.log(`✅ Загружено: ${name} (${role})`);
      } else {
        setCurrentRole('admin');
        setUserFullName('Сотрудник');
      }
    } catch (err) {
      console.error('❌ Ошибка загрузки роли/имени:', err);
      setCurrentRole('admin');
      setUserFullName('Сотрудник');
    }
  };

  loadRoleAndName();
}, []);

  // ==================== УДАЛЕНИЕ ЗАЯВКИ ====================
  const handleDeleteOrder = async (orderId: number) => {
    if (!confirm('Вы уверены, что хотите удалить эту заявку? Действие необратимо.')) return;

    try {
      const res = await fetch(`/api/adminCifra/orders/${orderId}`, { method: 'DELETE' });

      if (res.ok) {
        alert('✅ Заявка успешно удалена');
        setSelectedOrder(null);
        setAllOrders(prev => prev.filter(o => String(o.id) !== String(orderId)));
      } else {
        alert('Ошибка при удалении заявки');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения с сервером');
    }
  };

  // ==================== РЕДАКТИРОВАНИЕ ЗАЯВКИ ====================
  const handleEditOrder = (order: any) => {
    const newAddress = prompt('Новый адрес:', order.address);
    if (newAddress === null) return;

    const newVolume = prompt('Новый объём (м³):', order.volume);
    if (newVolume === null) return;

    const updatedOrder = {
      ...order,
      address: newAddress,
      volume: parseFloat(newVolume),
    };

    fetch('/api/adminCifra/orders/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedOrder),
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert('✅ Заявка обновлена!');
        setSelectedOrder(updatedOrder);
        setAllOrders(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
      } else {
        alert('Ошибка обновления');
      }
    })
    .catch(() => alert('Ошибка соединения'));
  };

  // ==================== РУЧНАЯ ОТПРАВКА УВЕДОМЛЕНИЯ В MAX ====================
  const sendNotification = async (orderId: number) => {
    if (!orderId) return alert('ID заявки не найден');

    if (!confirm('Отправить обновлённую заявку в Max?')) return;

    setIsSendingNotification(true);

    try {
      const res = await fetch('/api/order/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });

      if (res.ok) {
        setNotificationSent(true);
        alert('✅ Уведомление успешно отправлено в Max!');
      } else {
        alert('Не удалось отправить уведомление');
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка отправки уведомления');
    } finally {
      setIsSendingNotification(false);
    }
  };

  // ==================== ПОДЕЛИТЬСЯ ЗАЯВКОЙ (ЧИСТЫЙ ТЕКСТ) ====================
  const shareOrder = (order: any) => {
    const shareText = `Заявка №${order.id}

Марка: ${order.grade}
Объём: ${order.volume} м³
Дата: ${order.delivery_date}
Время: ${order.delivery_time}

Адрес: ${order.address}

Тип: ${order.customer_type}
${order.customer_type?.includes('Юридическое') 
  ? `Организация: ${order.organization_name || '-'}`
  : `ФИО: ${order.full_name || '-'}`}

Телефон: ${order.phone}

Комментарий: ${order.comment || '-'}`.trim();

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(shareText).then(() => {
        alert('✅ Информация скопирована!\nМожно отправить клиенту.');
      }).catch(() => {
        fallbackCopyText(shareText);
      });
    } else {
      fallbackCopyText(shareText);
    }
  };

  // Fallback для случаев, когда clipboard API недоступен
  const fallbackCopyText = (text: string) => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      document.execCommand('copy');
      alert('✅ Информация скопирована!\nМожно отправить клиенту.');
    } catch (err) {
      alert('Не удалось скопировать текст. Скопируйте вручную.');
      console.error('Fallback copy failed', err);
    }

    document.body.removeChild(textArea);
  };

  // ==================== КОПИРОВАТЬ ЗАЯВКУ ====================
  const copyOrder = (order: any) => {
    const copiedData = {
      grade: order.grade,
      volume: order.volume,
      deliveryDate: order.delivery_date,
      deliveryTime: order.delivery_time,
      address: order.address,
      customerType: order.customer_type?.includes('Юридическое') ? 'legal' : 'physical',
      organizationName: order.organization_name || '',
      fullName: order.full_name || '',
      phone: order.phone,
      inn: order.inn || '',
      comment: order.comment || '',
    };

    setSelectedOrder(null);
    setNewOrderInitialData(copiedData);
    setShowNewOrderModal(true);

    console.log('📋 Данные заявки успешно скопированы:', copiedData);
  };

  // ==================== REALTIME (начальная загрузка + live-обновления) ====================
  const { status: ordersRealtimeStatus } = useRealtimeOrders(setAllOrders);

  // Live-обновление рейсов для KPI-бара (фильтр по дню — в метриках)
  useRealtimeOrderMixers(setDayMixerAssignments, { orders: allOrders });

  // Локальные правки миксеров в открытой модалке сразу отражаем в KPI
  // (не ждём round-trip broadcast). Пустой массив пропускаем — иначе при
  // открытии модалки до ответа API затрём уже загруженные рейсы дня.
  useEffect(() => {
    if (!selectedOrder?.id || !orderMixers.length) return;
    const oid = String(selectedOrder.id);
    setDayMixerAssignments((prev) => {
      const others = prev.filter((m) => String(m.orderId ?? m.order_id) !== oid);
      return [...others, ...orderMixers];
    });
  }, [orderMixers, selectedOrder?.id]);

  // Заявку удалили (например, тестовую #604), пока её модалка была открыта —
  // realtime DELETE уже убрал заявку из allOrders, но selectedOrder — отдельный
  // стейт модалки, и без этой проверки она продолжала бы показывать
  // замороженные старые данные до перезагрузки страницы.
  useEffect(() => {
    if (!selectedOrder?.id) return;
    if (allOrders.length === 0) return;
    const stillExists = allOrders.some((o: any) => String(o.id) === String(selectedOrder.id));
    if (!stillExists) {
      setSelectedOrder(null);
    }
  }, [allOrders, selectedOrder?.id]);

  // Загружаем заказы за выбранный месяц + соседние, если неделя/прошлая неделя
  // захватывает границу месяца (нужно для графика «Прошл.» и списка ПН–ВС).
  const selYear = selectedDate.getFullYear();
  const selMonth = selectedDate.getMonth() + 1;
  const weekAnchorKey = useMemo(() => {
    const day = selectedDate.getDay();
    const monday = new Date(selectedDate);
    monday.setDate(selectedDate.getDate() - day + (day === 0 ? -6 : 1));
    return `${monday.getFullYear()}-${monday.getMonth() + 1}-${monday.getDate()}`;
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const [my, mm, md] = weekAnchorKey.split('-').map(Number);
    const monday = new Date(my, mm - 1, md);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const prevMonday = new Date(monday);
    prevMonday.setDate(monday.getDate() - 7);

    const monthKeys = new Set<string>([
      `${selYear}-${selMonth}`,
      `${monday.getFullYear()}-${monday.getMonth() + 1}`,
      `${sunday.getFullYear()}-${sunday.getMonth() + 1}`,
      `${prevMonday.getFullYear()}-${prevMonday.getMonth() + 1}`,
    ]);

    Promise.all(
      [...monthKeys].map((key) => {
        const [y, m] = key.split('-');
        return fetch(`/api/adminCifra/orders?year=${y}&month=${m}`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []);
      })
    )
      .then((chunks: any[][]) => {
        if (cancelled) return;
        const map = new Map<string, any>();
        chunks.flat().forEach((o) => {
          if (o?.id != null) map.set(String(o.id), o);
        });
        setAllOrders(Array.from(map.values()));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selYear, selMonth, weekAnchorKey]);

  // ==================== 1. РАБОТА С ДАТАМИ (ИСПРАВЛЕНО) ====================
  // Новая функция — надёжно получает дату в локальном часовом поясе
  const getLocalDateString = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const selectedDateStr = getLocalDateString(selectedDate);

  // ==================== 2. ФИЛЬТРАЦИЯ ЗАЯВОК НА ВЫБРАННЫЙ ДЕНЬ (с часовым поясом) ====================
  const dayOrders = allOrders
    .filter((o: Order) => {
      if (!o?.delivery_date) return false;

      let orderDate: Date;

      if (typeof o.delivery_date === 'string') {
        // Если приходит строка — парсим как local дату
        orderDate = new Date(o.delivery_date);
      } else {
        orderDate = new Date(o.delivery_date);
      }

      // Приводим к локальной дате (учитываем часовой пояс пользователя)
      const orderDateStr = orderDate.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('.').reverse().join('-'); // YYYY-MM-DD

      const selectedStr = selectedDate.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('.').reverse().join('-');

      return orderDateStr === selectedStr;
    })
    .sort((a, b) => (a.delivery_time || '00:00').localeCompare(b.delivery_time || '00:00'));

    // Заявки на день
    // console.log(`📅 Выбранная дата: ${selectedDateStr} | Найдено заявок: ${dayOrders.length}`);

  // ==================== KPI ====================
  // Исключаем отменённые заявки из всех расчётов
  const activeOrders = dayOrders.filter((o: Order) => o.status !== 'cancelled');

  const dayOrderIds = useMemo(
    () => new Set(dayOrders.map((o: Order) => String(o.id))),
    [dayOrders]
  );
  const dayOrderIdsKey = useMemo(
    () => dayOrders.map((o: Order) => o.id).join(','),
    [dayOrders]
  );

  // Подгрузка рейсов дня для KPI (отдельно от orderMixers открытой модалки).
  // Мержим с текущим стейтом: иначе поздний ответ fetch затирает свежий broadcast.
  useEffect(() => {
    let cancelled = false;
    if (!dayOrderIdsKey) {
      setDayMixerAssignments([]);
      return;
    }
    const idSet = new Set(dayOrderIdsKey.split(',').map(String));
    fetch(`/api/adminCifra/order-mixers?orderIds=${dayOrderIdsKey}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return;
        setDayMixerAssignments((prev) => {
          const byId = new Map<string, any>();
          for (const m of data) byId.set(String(m.id), m);
          for (const m of prev) {
            const oid = String(m.orderId ?? m.order_id);
            if (!idSet.has(oid)) continue;
            const id = String(m.id);
            const incoming = byId.get(id);
            if (!incoming) {
              byId.set(id, m);
              continue;
            }
            const tPrev = new Date(m.updated_at || 0).getTime();
            const tIn = new Date(incoming.updated_at || 0).getTime();
            if (tPrev > tIn) byId.set(id, m);
          }
          return Array.from(byId.values());
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dayOrderIdsKey]);

  const dayMixerTrips = useMemo(
    () => dayMixerAssignments.filter((m: any) =>
      dayOrderIds.has(String(m.orderId ?? m.order_id))
    ),
    [dayMixerAssignments, dayOrderIds]
  );

  const planVolume = activeOrders.reduce((sum: number, o: Order) =>
    sum + (Number(o.volume) || 0), 0);

  const unloadedVolume = useMemo(
    () => dayMixerTrips
      .filter((m: any) => m.status === 'Разгружен')
      .reduce((sum: number, m: any) => sum + Number(m.volume || 0), 0),
    [dayMixerTrips]
  );

  const unloadedByOrderId = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of dayMixerTrips) {
      if (m.status !== 'Разгружен') continue;
      const oid = String(m.orderId ?? m.order_id);
      map.set(oid, (map.get(oid) || 0) + Number(m.volume || 0));
    }
    return map;
  }, [dayMixerTrips]);

  const completionPct = planVolume > 0
    ? Math.min(100, Math.round((unloadedVolume / planVolume) * 100))
    : 0;

  const volumeByStatus = useMemo(() => {
    const FLOW = [
      { status: 'Загрузка', label: 'загрузка', color: '#FACC15', showCount: false },
      { status: 'В пути', label: 'в пути', color: '#60A5FA', showCount: false },
      { status: 'На объекте', label: 'на объекте', color: '#34D399', showCount: false },
      { status: 'Разгружен', label: 'разгружено', color: '#10B981', showCount: true },
    ] as const;
    const vols: Record<string, number> = {};
    const counts: Record<string, number> = {};
    for (const m of dayMixerTrips) {
      const s = String(m.status || '');
      vols[s] = (vols[s] || 0) + Number(m.volume || 0);
      counts[s] = (counts[s] || 0) + 1;
    }
    return FLOW
      .map((cfg) => ({
        ...cfg,
        volume: vols[cfg.status] || 0,
        count: counts[cfg.status] || 0,
      }))
      .filter((x) => x.volume > 0 || x.count > 0);
  }, [dayMixerTrips]);

  const orderStatusCounts = useMemo(() => ({
    new: dayOrders.filter((o) => o.status === 'new').length,
    processing: dayOrders.filter((o) => o.status === 'processing').length,
    completed: dayOrders.filter((o) => o.status === 'completed').length,
    cancelled: dayOrders.filter((o) => o.status === 'cancelled').length,
    active: activeOrders.length,
  }), [dayOrders, activeOrders.length]);

  const fmtM3 = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1));
  const completionColor =
    completionPct >= 90 ? '#10B981' :
    completionPct >= 50 ? '#FACC15' : '#E2E8F0';
  const completionBarBg =
    completionPct >= 90
      ? 'linear-gradient(90deg, #10B981, #34D399)'
      : completionPct >= 50
        ? 'linear-gradient(90deg, #F59E0B, #FACC15)'
        : 'linear-gradient(90deg, #3B82F6, #60A5FA)';

              // ==================== НЕДЕЛЯ (ПН - ВС) ====================
  const getWeekDays = () => {
    const days = [];
    const current = new Date(selectedDate);
    
    // Находим понедельник текущей недели
    const dayOfWeek = current.getDay(); // 0 = воскресенье, 1 = понедельник...
    const diff = current.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // сдвиг к понедельнику
    const monday = new Date(current);
    monday.setDate(diff);
    monday.setHours(12, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const weekDays = getWeekDays();

  // ==================== 4. ПОДСЧЁТ ЗАЯВОК НА ДЕНЬ ====================
  const getOrdersCountForDate = (date: Date) => {
    const dateStr = getLocalDateString(date);
    
    return allOrders.filter(o => {
      if (!o?.delivery_date) return false;
      
      let orderDateStr: string;
      if (typeof o.delivery_date === 'string') {
        orderDateStr = o.delivery_date.substring(0, 10);
      } else {
        orderDateStr = getLocalDateString(new Date(o.delivery_date));
      }
      return orderDateStr === dateStr;
    }).length;
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'new': return '#FACC15';
      case 'processing': return '#3B82F6';
      case 'completed': return '#10B981';
      case 'cancelled': return '#EF4444';
      default: return '#64748B';
    }
  };

  const filteredOrders = dayOrders.filter(order => {
    const searchLower = searchQuery.toLowerCase();

    const matchesSearch = 
      (order.organization_name || '').toLowerCase().includes(searchLower) ||
      (order.full_name || '').toLowerCase().includes(searchLower) ||
      String(order.id).includes(searchQuery) ||
      (order.inn || '').includes(searchQuery);

    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Результаты расширенного поиска — по всему загруженному месяцу
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return allOrders
      .filter((order: any) => {
        const matchesSearch =
          (order.organization_name || '').toLowerCase().includes(q) ||
          (order.full_name || '').toLowerCase().includes(q) ||
          String(order.id).includes(q) ||
          (order.inn || '').includes(q) ||
          (order.grade || '').toLowerCase().includes(q) ||
          (order.address || '').toLowerCase().includes(q);
        const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
        return matchesSearch && matchesStatus;
      })
      .sort((a: any, b: any) => {
        const dc = String(b.delivery_date || '').localeCompare(String(a.delivery_date || ''));
        if (dc !== 0) return dc;
        return String(a.delivery_time || '').localeCompare(String(b.delivery_time || ''));
      });
  }, [searchMode, searchQuery, allOrders, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = () => {
    if (!searchQuery.trim()) return;
    setSearchMode(true);
  };

  const clearSearch = () => {
    setSearchMode(false);
    setSearchQuery('');
  };
  

       // ==================== ЗАГРУЗКА РЕЦЕПТОВ ====================
  useEffect(() => {
    const fetchRecipes = async () => {
      try {
        const res = await fetch('/api/adminCifra/recipes');
        if (res.ok) {
          const data = await res.json();
         // console.log('✅ Загружено рецептов из adminCifra:', data.length, data);
          setRecipes(data);
        } else {
          console.error('❌ Ошибка загрузки рецептов, статус:', res.status);
        }
      } catch (err) {
        console.error('❌ Ошибка загрузки рецептов:', err);
      }
    };

    fetchRecipes();
  }, []);

  // ==================== ЗАГРУЗКА КЛИЕНТОВ ДЛЯ ПОИСКА ====================
  useEffect(() => {
    const userId = localStorage.getItem('userId');
    fetch('/api/adminCifra/clients', {
      headers: userId ? { 'x-user-id': userId } : {},
    })
      .then(r => r.ok ? r.json() : [])
      .then(data => setAllClients(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Закрытие dropdown при клике вне
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ==================== ЗАГРУЗКА ОСТАТКОВ СКЛАДА ====================
  useEffect(() => {
    const fetchWarehouse = async () => {
      try {
        const res = await fetch('/api/adminCifra/warehouse');
        if (!res.ok) return;
        const data = await res.json();
        const adds: any[] = data.additives || [];
        const pfm    = Number(adds.find((a: any) => Number(a.additive_id) === 1)?.current ?? 0);
        const linomix = Number(adds.find((a: any) => Number(a.additive_id) === 2)?.current ?? 0);
        setWarehouseAdditives({ pfm, linomix });
      } catch { /* тихо */ }
    };
    fetchWarehouse();
  }, []);

         // ==================== РАСЧЁТ ЦЕМЕНТА / ДОБАВОК ====================
  // effectiveVolume: 'plan' — полный объём заявки; 'unloaded' — по разгруженным м³
  // (для completed берём полный объём; иначе unloaded/plan × volume).
  const getOrderEffectiveVolume = (order: any, mode: 'plan' | 'unloaded') => {
    const planVol = Number(order.volume || 0);
    if (planVol <= 0) return 0;
    if (mode === 'plan') return planVol;
    if (order.status === 'completed') return planVol;
    const unloaded = unloadedByOrderId.get(String(order.id)) || 0;
    return Math.min(planVol, unloaded);
  };

  const findRecipeForOrder = (gradeRaw: string) => {
    const grade = String(gradeRaw || '').trim();
    if (!grade) return null;
    let recipe = recipes.find((r: any) => r.code === grade);
    if (!recipe) recipe = recipes.find((r: any) => r.code === grade.replace(/и$/, ''));
    if (!recipe) recipe = recipes.find((r: any) => r.name?.includes(grade));
    if (!recipe) recipe = recipes.find((r: any) => grade.includes(r.code));
    if (!recipe) recipe = recipes.find((r: any) => r.name?.toLowerCase().includes(grade.toLowerCase()));
    return recipe || null;
  };

  const calculateCementNeeded = (mode: 'plan' | 'unloaded') => {
    let totalKg = 0;
    activeOrders.forEach((order: any) => {
      const volume = getOrderEffectiveVolume(order, mode);
      if (volume <= 0) return;
      const recipe = findRecipeForOrder(order.grade);
      if (recipe && recipe.cement) {
        totalKg += volume * Number(recipe.cement);
      }
    });
    return (totalKg / 1000).toFixed(1);
  };

  // Добавки раздельно: 1 = ПФМ, 2 = Линомикс (кг)
  const calculateAdditiveByType = (mode: 'plan' | 'unloaded') => {
    let pfmKg = 0;
    let linomixKg = 0;
    activeOrders.forEach((order: any) => {
      const volume = getOrderEffectiveVolume(order, mode);
      if (volume <= 0) return;
      const dosage = getAdditiveDosage(findRecipeByGrade(recipes, order.grade));
      if (!dosage) return;
      const kg = volume * dosage.kgPerM3;
      if (dosage.additiveId === 1) pfmKg += kg;
      else linomixKg += kg;
    });
    return {
      pfm: Math.round(pfmKg * 10) / 10,
      linomix: Math.round(linomixKg * 10) / 10,
    };
  };

  // П5: weekOrderCounts — подсчёт заявок для каждого дня недели
  const weekOrderCounts = useMemo(() =>
    weekDays.map((d: Date) => getOrdersCountForDate(d))
  , [allOrders, weekDays]); // eslint-disable-line react-hooks/exhaustive-deps

  // Серии для бокового графика: план / отгрузка / прошлая неделя + счётчики заявок
  const weekChartSeries = useMemo((): WeekChartDay[] => {
    const orderDateStr = (o: any) => {
      if (!o?.delivery_date) return '';
      return typeof o.delivery_date === 'string'
        ? o.delivery_date.substring(0, 10)
        : getLocalDateString(new Date(o.delivery_date));
    };

    return weekDays.map((d: Date) => {
      const dateStr = getLocalDateString(d);
      const prev = new Date(d);
      prev.setDate(prev.getDate() - 7);
      const prevStr = getLocalDateString(prev);

      const dayActive = allOrders.filter((o) => orderDateStr(o) === dateStr && o.status !== 'cancelled');
      const prevActive = allOrders.filter((o) => orderDateStr(o) === prevStr && o.status !== 'cancelled');

      return {
        plan: dayActive.reduce((s, o) => s + Number(o.volume || 0), 0),
        shipped: dayActive
          .filter((o) => o.status === 'completed')
          .reduce((s, o) => s + Number(o.volume || 0), 0),
        prevPlan: prevActive.reduce((s, o) => s + Number(o.volume || 0), 0),
        orders: dayActive.length,
        shippedOrders: dayActive.filter((o) => o.status === 'completed').length,
      };
    });
  }, [allOrders, weekDays]); // eslint-disable-line react-hooks/exhaustive-deps

  // П5: memoизированные значения для рендера (факт — от разгруженного объёма)
  const cementCompletedMemo  = useMemo(() => calculateCementNeeded('unloaded'), [dayOrders, recipes, unloadedByOrderId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cementAllMemo        = useMemo(() => calculateCementNeeded('plan'),     [dayOrders, recipes]); // eslint-disable-line react-hooks/exhaustive-deps
  const additiveFactByType = useMemo(() => calculateAdditiveByType('unloaded'), [dayOrders, recipes, unloadedByOrderId]); // eslint-disable-line react-hooks/exhaustive-deps
  const additivePlanByType = useMemo(() => calculateAdditiveByType('plan'),     [dayOrders, recipes]); // eslint-disable-line react-hooks/exhaustive-deps

  const cementPct = Number(cementAllMemo) > 0
    ? Math.min(100, Math.round((Number(cementCompletedMemo) / Number(cementAllMemo)) * 100))
    : 0;
  const pfmPct = additivePlanByType.pfm > 0
    ? Math.min(100, Math.round((additiveFactByType.pfm / additivePlanByType.pfm) * 100))
    : 0;
  const linomixPct = additivePlanByType.linomix > 0
    ? Math.min(100, Math.round((additiveFactByType.linomix / additivePlanByType.linomix) * 100))
    : 0;

  const fmtKg = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1));

  // ==================== ПРОГНОЗ ДОБАВОК — скользящие 7 дней от selectedDate ====================
  // Не привязываемся к ПН-ВС: берём selectedDate + 6 следующих дней.
  const weekAdditiveForecast = useMemo(() => {
    if (!recipes.length) return null;

    // 7 дат начиная с selectedDate
    const forecastDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      forecastDates.push(`${y}-${m}-${day}`);
    }
    const forecastDateSet = new Set(forecastDates);
    const dateFrom = forecastDates[0];
    const dateTo   = forecastDates[6];

    // Активные заявки в диапазоне
    const forecastOrders = allOrders.filter((o: any) => {
      if (o.status === 'cancelled') return false;
      if (!o.delivery_date) return false;
      const ds = typeof o.delivery_date === 'string'
        ? o.delivery_date.substring(0, 10)
        : (() => { const d = new Date(o.delivery_date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
      return forecastDateSet.has(ds);
    });

    let pfmLiters = 0;
    let linomixLiters = 0;

    // Детали по каждой заявке для попапа
    const details: Array<{
      id: number; grade: string; volume: number; deliveryDate: string;
      additiveId: 1 | 2; additiveName: string; kg: number; liters: number;
    }> = [];

    forecastOrders.forEach((order: any) => {
      const recipe = findRecipeByGrade(recipes, order.grade);
      const dosage = getAdditiveDosage(recipe);
      if (!dosage) return;
      const volume = Number(order.volume || 0);
      if (volume <= 0) return;
      const kg = volume * dosage.kgPerM3;
      const liters = kg / dosage.densityKgPerLiter;
      if (dosage.additiveId === 1) pfmLiters += liters;
      else linomixLiters += liters;
      const ds = typeof order.delivery_date === 'string'
        ? order.delivery_date.substring(0, 10)
        : (() => { const d = new Date(order.delivery_date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
      details.push({ id: order.id, grade: order.grade || '—', volume, deliveryDate: ds, additiveId: dosage.additiveId, additiveName: dosage.name, kg: Math.round(kg * 10) / 10, liters: Math.round(liters * 10) / 10 });
    });

    const pfmStock     = warehouseAdditives?.pfm    ?? null;
    const linomixStock = warehouseAdditives?.linomix ?? null;

    return {
      dateFrom, dateTo,
      totalOrders: forecastOrders.length,
      totalVolume: Math.round(forecastOrders.reduce((s: number, o: any) => s + Number(o.volume || 0), 0)),
      pfm:     { needed: Math.round(pfmLiters),     stock: pfmStock,     shortage: pfmStock     !== null && pfmStock     < pfmLiters },
      linomix: { needed: Math.round(linomixLiters),  stock: linomixStock, shortage: linomixStock !== null && linomixStock < linomixLiters },
      hasAlert: (pfmStock !== null && pfmStock < pfmLiters) || (linomixStock !== null && linomixStock < linomixLiters),
      details,
    };
  }, [allOrders, selectedDate, recipes, warehouseAdditives]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ 
      color: '#fff',
      flex: 1,
      minHeight: 0,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxSizing: 'border-box'
    }}>
    
    {/* Header */}
    <div style={{ 
      background: '#1E2937', 
      padding: '14px 32px', 
      borderRadius: '20px 20px 0 0',
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'space-between',
      flexShrink: 0
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Package size={26} color="#94A3B8" />
          Заявки
        </h1>
        
        
      </div>
    </div>

                              {/* ==================== KPI БАР ==================== */}
      <div style={{ 
        padding: '12px 20px', 
        background: '#1E2937', 
        display: 'flex', 
        gap: '12px', 
        borderTop: '1px solid #334155',
        borderRadius: '0 0 20px 20px',
        alignItems: 'stretch',
        flexWrap: 'nowrap',
        flexShrink: 0,
        marginBottom: '16px',
      }}>
        
        {/* Выполнение плана */}
        <div style={{ flex: '1.2 1 0', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '6px', marginBottom: '6px' }}>
            <div style={{ color: '#E2E8F0', fontSize: '14px', fontWeight: 600, letterSpacing: '0.02em' }}>Выполнение плана</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: completionColor, flexShrink: 0 }}>{completionPct}%</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '8px' }}>
            <span style={{ fontSize: '26px', fontWeight: 700, color: completionColor, lineHeight: 1 }}>
              {fmtM3(unloadedVolume)}
            </span>
            <span style={{ fontSize: '14px', color: '#94A3B8', fontWeight: 600, whiteSpace: 'nowrap' }}>
              / {fmtM3(planVolume)} м³
            </span>
          </div>
          <div style={{ height: '10px', borderRadius: '9999px', background: '#334155', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{
              height: '100%',
              width: `${completionPct}%`,
              borderRadius: '9999px',
              background: completionBarBg,
              transition: 'width 0.4s ease',
            }} />
          </div>
          {volumeByStatus.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {volumeByStatus.map((item) => (
                <span
                  key={item.status}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'baseline',
                    gap: '3px',
                    padding: '2px 7px',
                    borderRadius: '9999px',
                    background: `${item.color}22`,
                    border: `1px solid ${item.color}55`,
                    color: item.color,
                    fontSize: '11px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.showCount ? (
                    <>
                      <span style={{ fontWeight: 700 }}>{item.count}</span>
                      <span style={{ opacity: 0.75 }}>·</span>
                      <span style={{ fontWeight: 700 }}>{fmtM3(item.volume)} м³</span>
                    </>
                  ) : (
                    <span style={{ fontWeight: 700 }}>{fmtM3(item.volume)} м³</span>
                  )}
                  <span style={{ opacity: 0.95, fontWeight: 600 }}>{item.label}</span>
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 500 }}>разгружено от плана дня</div>
          )}
        </div>

        {/* Цемент */}
        <div style={{ flex: '0.85 1 0', minWidth: 0 }}>
          <div style={{ color: '#E2E8F0', fontSize: '14px', fontWeight: 600, letterSpacing: '0.02em', marginBottom: '6px' }}>Цемент</div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#60A5FA', lineHeight: 1.1, marginBottom: '8px', whiteSpace: 'nowrap' }}>
            {cementCompletedMemo}
            <span style={{ color: '#94A3B8', fontSize: '14px', fontWeight: 600 }}>
              {' / '}{Number(cementAllMemo) % 1 === 0 ? Math.round(Number(cementAllMemo)) : Number(cementAllMemo).toFixed(1)} т
            </span>
          </div>
          <div style={{ height: '10px', borderRadius: '9999px', background: '#334155', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{
              height: '100%',
              width: `${cementPct}%`,
              borderRadius: '9999px',
              background: 'linear-gradient(90deg, #3B82F6, #60A5FA)',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 500 }}>от разгруженного объёма</div>
        </div>

        {/* ПФМ — отдельный блок */}
        <div style={{ flex: '0.85 1 0', minWidth: 0 }}>
          <div style={{ color: '#E2E8F0', fontSize: '14px', fontWeight: 600, letterSpacing: '0.02em', marginBottom: '6px' }}>
            ПФМ
            {weekAdditiveForecast?.pfm?.shortage && (
              <span style={{ marginLeft: '6px', fontSize: '11px', color: '#F87171', fontWeight: 700 }}>нехватка</span>
            )}
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#FACC15', lineHeight: 1.1, marginBottom: '8px', whiteSpace: 'nowrap' }}>
            {fmtKg(additiveFactByType.pfm)}
            <span style={{ color: '#94A3B8', fontSize: '14px', fontWeight: 600 }}>
              {' / '}{fmtKg(additivePlanByType.pfm)} кг
            </span>
          </div>
          <div style={{ height: '10px', borderRadius: '9999px', background: '#334155', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{
              height: '100%',
              width: `${pfmPct}%`,
              borderRadius: '9999px',
              background: 'linear-gradient(90deg, #F59E0B, #FACC15)',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ fontSize: '13px', color: '#CBD5E1', fontWeight: 600, whiteSpace: 'nowrap' }}>
            склад {warehouseAdditives ? `${Math.round(warehouseAdditives.pfm)} л` : '—'}
          </div>
        </div>

        {/* Линомикс — отдельный блок */}
        <div style={{ flex: '0.85 1 0', minWidth: 0 }}>
          <div style={{ color: '#E2E8F0', fontSize: '14px', fontWeight: 600, letterSpacing: '0.02em', marginBottom: '6px' }}>
            Линомикс
            {weekAdditiveForecast?.linomix?.shortage && (
              <span style={{ marginLeft: '6px', fontSize: '11px', color: '#F87171', fontWeight: 700 }}>нехватка</span>
            )}
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#A78BFA', lineHeight: 1.1, marginBottom: '8px', whiteSpace: 'nowrap' }}>
            {fmtKg(additiveFactByType.linomix)}
            <span style={{ color: '#94A3B8', fontSize: '14px', fontWeight: 600 }}>
              {' / '}{fmtKg(additivePlanByType.linomix)} кг
            </span>
          </div>
          <div style={{ height: '10px', borderRadius: '9999px', background: '#334155', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{
              height: '100%',
              width: `${linomixPct}%`,
              borderRadius: '9999px',
              background: 'linear-gradient(90deg, #8B5CF6, #A78BFA)',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ fontSize: '13px', color: '#CBD5E1', fontWeight: 600, whiteSpace: 'nowrap' }}>
            склад {warehouseAdditives ? `${Math.round(warehouseAdditives.linomix)} л` : '—'}
          </div>
        </div>

        {/* Заявки по статусам */}
        <div style={{ flex: '0.9 1 0', minWidth: 0 }}>
          <div style={{ color: '#E2E8F0', fontSize: '14px', fontWeight: 600, letterSpacing: '0.02em', marginBottom: '6px' }}>Заявки</div>
          <div style={{ fontSize: '26px', fontWeight: 700, lineHeight: 1.1, marginBottom: '8px', whiteSpace: 'nowrap' }}>
            {orderStatusCounts.active}
            <span style={{ fontSize: '13px', color: '#94A3B8', fontWeight: 600, marginLeft: '5px' }}>
              активных
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
              <span style={{ color: '#CBD5E1', fontWeight: 500 }}>Новые</span>
              <strong style={{ color: '#FACC15' }}>{orderStatusCounts.new}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
              <span style={{ color: '#CBD5E1', fontWeight: 500 }}>В работе</span>
              <strong style={{ color: '#60A5FA' }}>{orderStatusCounts.processing}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
              <span style={{ color: '#CBD5E1', fontWeight: 500 }}>Выполнены</span>
              <strong style={{ color: '#10B981' }}>{orderStatusCounts.completed}</strong>
            </div>
            {orderStatusCounts.cancelled > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                <span style={{ color: '#CBD5E1', fontWeight: 500 }}>Отменены</span>
                <strong style={{ color: '#EF4444' }}>{orderStatusCounts.cancelled}</strong>
              </div>
            )}
          </div>
        </div>

      </div>

      <div style={{ display: 'flex', gap: '24px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        
                {/* ==================== ЛЕВАЯ КОЛОНКА — ЗАЯВКИ НА НЕДЕЛЮ ==================== */}
        <div style={{ 
          width: '340px', 
          flexShrink: 0,
          height: '100%',
          minHeight: 0,
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}>
          <div style={{ 
            background: '#1E2937', 
            borderRadius: '20px', 
            padding: '20px',
            height: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            
            <h3 style={{ marginBottom: '10px', color: '#94A3B8', fontSize: '16px', flexShrink: 0 }}>
              ЗАЯВКИ НА НЕДЕЛЮ
            </h3>

            {/* ==================== НАВИГАЦИЯ ПО НЕДЕЛЯМ ==================== */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '10px',
              color: '#CBD5E1',
              flexShrink: 0,
              gap: '16px'
            }}>
              <button 
                onClick={() => {
                  const newDate = new Date(selectedDate);
                  newDate.setDate(newDate.getDate() - 7);
                  setSelectedDate(newDate);
                }}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#94A3B8', 
                  fontSize: '32px', 
                  cursor: 'pointer',
                  padding: '8px 16px',
                  flexShrink: 0,
                  userSelect: 'none'
                }}
              >
                ←
              </button>

              <div style={{ 
                fontWeight: '700', 
                fontSize: '18px', 
                textAlign: 'center',
                flex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {selectedDate.toLocaleDateString('ru-RU', { 
                  month: 'long', 
                  year: 'numeric' 
                })}
              </div>

              <button 
                onClick={() => {
                  const newDate = new Date(selectedDate);
                  newDate.setDate(newDate.getDate() + 7);
                  setSelectedDate(newDate);
                }}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#94A3B8', 
                  fontSize: '32px', 
                  cursor: 'pointer',
                  padding: '8px 16px',
                  flexShrink: 0,
                  userSelect: 'none'
                }}
              >
                →
              </button>
            </div>

            {/* ==================== СПИСОК ДНЕЙ НЕДЕЛИ (все 7 всегда видны, без скролла; на больших экранах не растягиваются выше меры) ==================== */}
<div style={{ 
  flex: 1, 
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  gap: '6px',
  overflow: 'hidden'
}}>
  {weekDays.map((d: Date, dIdx: number) => {
    const dateStr = d.toISOString().split('T')[0];
    const count = weekOrderCounts[dIdx];
    const isSelected = dateStr === selectedDateStr;
    const isToday = d.toDateString() === new Date().toDateString();

    // Количество отменённых заявок в этот день
    const cancelledCount = dayOrders.filter(o => {
      const orderDate = typeof o.delivery_date === 'string' 
        ? o.delivery_date.substring(0, 10) 
        : new Date(o.delivery_date).toISOString().substring(0, 10);
      return orderDate === dateStr && o.status === 'cancelled';
    }).length;

    return (
      <div
        key={dateStr}
        onClick={() => setSelectedDate(d)}
        style={{
          flex: 1,
          minHeight: 0,
          maxHeight: '58px',
          padding: '0 16px',
          background: isSelected ? '#3B82F620' : '#25334A',
          borderRadius: '10px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          border: isSelected ? '2px solid #3B82F6' : 'none',
          transition: 'all 0.2s ease',
          userSelect: 'none',
          overflow: 'hidden'
        }}
      >
        <div style={{ fontWeight: '600', fontSize: '14px', whiteSpace: 'nowrap' }}>
          {d.toLocaleDateString('ru-RU', { 
            weekday: 'short', 
            day: 'numeric', 
            month: 'short' 
          })}
          {isToday && <span style={{ color: '#60A5FA', marginLeft: '6px' }}>●</span>}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {/* Бейдж отменённых заявок — теперь СЛЕВА */}
          {cancelledCount > 0 && (
            <div style={{
              background: '#EF444420',
              color: '#EF4444',
              padding: '3px 9px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: '600',
              border: '1px solid #EF444440'
            }}>
              -{cancelledCount}
            </div>
          )}

          {/* Основной счётчик активных заявок */}
          <div style={{ 
            background: '#334155', 
            color: '#CBD5E1', 
            padding: '3px 11px', 
            borderRadius: '9999px',
            fontSize: '13px',
            fontWeight: '600',
            minWidth: '26px',
            textAlign: 'center'
          }}>
            {count}
          </div>
        </div>
      </div>
    );
  })}
</div>

{/* ==================== ГРАФИК ЗА НЕДЕЛЮ ==================== */}
            <WeekVolumeChart
              days={weekDays}
              series={weekChartSeries}
              selectedDateStr={selectedDateStr}
              onSelectDay={setSelectedDate}
              onShiftWeek={(delta) => {
                setSelectedDate((prev) => {
                  const next = new Date(prev);
                  next.setDate(next.getDate() + delta * 7);
                  return next;
                });
              }}
            />

                                    {/* ==================== РАЗДЕЛИТЕЛЬ + СВОДКА ЗА НЕДЕЛЮ ==================== */}
            <div style={{ marginTop: '8px', paddingTop: '10px', borderTop: '1px solid #334155', flexShrink: 0 }}>
              <div style={{ 
                background: '#25334A', 
                borderRadius: '16px', 
                padding: '12px 16px',
                fontSize: '15px'
              }}>
                <div style={{ color: '#94A3B8', marginBottom: '8px', fontWeight: '600' }}>Итого за неделю</div>
                
                {/* 1. Количество заявок */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '15px' }}>Всего заявок:</span>
                  <strong style={{ fontSize: '17px' }}>
                    {weekOrderCounts.reduce((sum, c) => sum + c, 0)}
                  </strong>
                </div>
                
                {/* 2. Запланировано */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '15px' }}>Запланировано:</span>
                  <strong style={{ fontSize: '17px' }}>
                    {Math.round(weekDays.reduce((sum, d) => {
                      const dateStr = getLocalDateString(d);
                      return sum + allOrders
                        .filter(o => {
                          if (!o?.delivery_date) return false;
                          const orderDate = typeof o.delivery_date === 'string' 
                            ? o.delivery_date.substring(0, 10) 
                            : getLocalDateString(new Date(o.delivery_date));
                          return orderDate === dateStr;
                        })
                        .reduce((v, o) => v + Number(o.volume || 0), 0);
                    }, 0))} м³
                  </strong>
                </div>

                {/* 3. Отгружено */}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '15px' }}>Отгружено:</span>
                  <strong style={{ fontSize: '17px', color: '#10B981' }}>
                    {Math.round(weekDays.reduce((sum, d) => {
                      const dateStr = getLocalDateString(d);
                      return sum + allOrders
                        .filter(o => {
                          if (!o?.delivery_date) return false;
                          const orderDate = typeof o.delivery_date === 'string' 
                            ? o.delivery_date.substring(0, 10) 
                            : getLocalDateString(new Date(o.delivery_date));
                          return orderDate === dateStr && o.status === 'completed';
                        })
                        .reduce((v, o) => v + Number(o.volume || 0), 0);
                    }, 0))} м³
                  </strong>
                </div>
              </div>

              <button 
                onClick={() => setShowNewOrderModal(true)}
                style={{
                  width: '100%',
                  marginTop: '8px',
                  padding: '12px',
                  background: '#10B981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                + Новая заявка
              </button>
              
            </div>

          </div>
        </div>

        {/* ==================== ПРАВАЯ КОЛОНКА — ОСНОВНОЙ СПИСОК ==================== */}
<div style={{ flex: 1, minHeight: 0, height: '100%', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

  {/* Заголовок + поиск + кнопки — всё в одну строку */}
  <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, flexWrap: 'wrap' }}>
    {/* Заголовок */}
    <h2 style={{ margin: 0, flexShrink: 0, fontSize: '18px' }}>
      {searchMode
        ? <><span style={{ color: '#3B82F6' }}>«{searchQuery}»</span> <span style={{ color: '#64748B', fontSize: '14px', fontWeight: 400 }}>{searchResults.length} заявок</span></>
        : selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
    </h2>

    {/* Разделитель */}
    <div style={{ width: '1px', height: '22px', background: '#334155', flexShrink: 0 }} />

    {/* Строка поиска */}
    <input
      type="text"
      placeholder="Поиск по клиенту, №, ИНН, адресу, марке..."
      value={searchQuery}
      onChange={(e) => { setSearchQuery(e.target.value); if (searchMode) setSearchMode(false); }}
      onKeyDown={(e) => e.key === 'Enter' && runSearch()}
      style={{
        padding: '8px 16px',
        background: searchMode ? 'rgba(59,130,246,0.12)' : '#25334A',
        border: searchMode ? '1.5px solid rgba(59,130,246,0.4)' : '1.5px solid transparent',
        borderRadius: '9999px',
        width: '300px',
        color: '#fff',
        fontSize: '14px',
        outline: 'none',
        transition: 'all 0.2s',
        flexShrink: 0,
      }}
    />

    <button
      onClick={runSearch}
      disabled={!searchQuery.trim()}
      style={{
        padding: '8px 18px',
        background: searchQuery.trim() ? '#3B82F6' : '#25334A',
        border: 'none',
        borderRadius: '9999px',
        color: searchQuery.trim() ? '#fff' : '#64748B',
        fontSize: '14px',
        fontWeight: 600,
        cursor: searchQuery.trim() ? 'pointer' : 'default',
        transition: 'all 0.2s',
        flexShrink: 0,
      }}
    >
      Найти
    </button>

    {searchMode && (
      <button
        onClick={clearSearch}
        style={{
          padding: '8px 14px',
          background: 'transparent',
          border: '1.5px solid #334155',
          borderRadius: '9999px',
          color: '#94A3B8',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        ✕ Сбросить
      </button>
    )}

    {/* Отступ вправо */}
    <div style={{ flex: 1 }} />

    {/* Пилюля нехватки добавок */}
    {weekAdditiveForecast?.hasAlert && (
      <button
        onClick={() => setShowAdditivePopup(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '8px 14px',
          background: 'rgba(239,68,68,0.10)',
          border: '1.5px solid rgba(239,68,68,0.40)',
          borderRadius: '9999px',
          color: '#FCA5A5',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'filter 0.15s',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
        onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.2)')}
        onMouseLeave={e => (e.currentTarget.style.filter = '')}
        title="Нехватка добавок — нажмите для деталей"
      >
        <AlertTriangle size={13} color="#EF4444" />
        Не хватает добавок
      </button>
    )}

    {/* Кнопка Новая заявка */}
    <button
      onClick={() => setShowNewOrderModal(true)}
      style={{
        padding: '8px 22px',
        background: '#10B981',
        color: 'white',
        border: 'none',
        borderRadius: '9999px',
        fontSize: '14px',
        fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: '6px',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      + Новая заявка
    </button>
  </div>

    {/* ==================== СПИСОК ЗАЯВОК СО СКРОЛЛОМ ==================== */}
<div style={{ 
  flex: 1,
  minHeight: 0,
  boxSizing: 'border-box',
  background: '#1E2937', 
  borderRadius: '24px', 
  padding: '24px 32px',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
}}>
  
  <div className="scroll-hidden" style={{ 
    flex: 1, 
    overflowY: 'auto', 
    display: 'flex', 
    flexDirection: 'column', 
    gap: '7px',
    paddingRight: '8px'
  }}>
    {loading ? (
      <div style={{ textAlign: 'center', padding: '100px', color: '#64748B' }}>Загрузка заявок...</div>
    ) : (searchMode ? searchResults : filteredOrders).length > 0 ? (searchMode ? searchResults : filteredOrders).map((order: Order, index: number) => (
      <div
  key={order.id}
  onClick={() => handleOpenOrder(order)}
  style={{
    background: '#25334A',
    borderRadius: '14px',
    padding: '9px 20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    transition: 'all 0.2s',
    flexShrink: 0
  }}
>
        {/* Порядковый номер */}
        <div style={{ 
          width: '38px', 
          textAlign: 'center',
          color: '#64748B',
          fontWeight: '700',
          fontSize: '15px',
          userSelect: 'none'
        }}>
          {index + 1}
        </div>

        {/* Дата — только в режиме поиска */}
        {searchMode && (
          <div style={{ width: '90px', flexShrink: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '13px', color: '#CBD5E1' }}>
              {order.delivery_date ? new Date(order.delivery_date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—'}
            </div>
            <div style={{ fontSize: '12px', color: '#64748B' }}>
              {(order as any).delivery_time ? String((order as any).delivery_time).slice(0, 5) : ''}
            </div>
          </div>
        )}

        {/* Время — только вне режима поиска */}
        {!searchMode && (
        <div style={{ width: '76px', fontWeight: '700', fontSize: '15px' }}>
          {order.delivery_time}
        </div>
        )}

        {/* Информация о заявке */}
        <div style={{ flex: 1, lineHeight: 1.25 }}>
          <div style={{ fontWeight: '600', fontSize: '15px' }}>
            #{order.id} — {order.organization_name || order.full_name || '—'}
          </div>
          <div style={{ color: '#94A3B8', fontSize: '13px' }}>
            {order.grade} • {order.volume} м³
          </div>
        </div>

        {/* БЕЙДЖ "ПОД ВОПРОСОМ" */}
{(order as any).is_questionable && (
  <div style={{
    padding: '4px 12px',
    background: '#EF4444',
    color: 'white',
    fontSize: '12px',
    fontWeight: '700',
    borderRadius: '9999px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    boxShadow: '0 2px 6px rgba(239, 68, 68, 0.3)'
  }}>
    ⚠️ Под вопросом
  </div>
)}

        {/* Статус */}
        <div style={{ 
          padding: '5px 16px', 
          borderRadius: '9999px', 
          background: getStatusColor(order.status) + '20', 
          color: getStatusColor(order.status),
          fontWeight: '600',
          fontSize: '13.5px'
        }}>
          {order.status === 'new' && 'Новая'}
          {order.status === 'processing' && 'В работе'}
          {order.status === 'completed' && 'Выполнена'}
          {order.status === 'cancelled' && 'Отменена'}
        </div>
      </div>
    )    ) : (
      <div style={{ textAlign: 'center', padding: '140px 0', color: '#64748B', fontSize: '18px' }}>
        {searchMode
          ? <>Ничего не найдено по запросу <strong style={{ color: '#94A3B8' }}>«{searchQuery}»</strong></>
          : 'По выбранным фильтрам ничего не найдено'}
      </div>
    )}
  </div>
</div>
</div>


      {/* МОДАЛЬНОЕ ОКНО ЗАКАЗА — БЕЗ IFRAME */}
{selectedOrder && (
  <div 
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.94)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
    
  >
    <div 
      className="w-full max-w-[1650px] max-h-[90vh] overflow-auto mx-auto my-10 scroll-hidden"
      style={{ 
        position: 'relative',
        background: '#1E2937', 
        borderRadius: '24px', 
        // Небольшой доп. отступ сверху — заголовок теперь встроен в шапки
        // колонок, а не в отдельную строку (см. комментарий в OrderDetailModal.tsx).
        padding: '38px 32px 32px 32px', 
        boxShadow: '0 30px 80px rgba(0,0,0,0.7)'
      }} 
      onClick={e => e.stopPropagation()}
    >
      <style>{`
        @keyframes zayavkiScrollBounce {
          0%, 100% { transform: translateY(0); opacity: 0.7; }
          50%      { transform: translateY(3px); opacity: 1; }
        }
      `}</style>

      {/* Плавающая кнопка закрытия — единая для всей модалки, колонки больше не несут свой заголовок/крестик */}
      <button
        onClick={() => setSelectedOrder(null)}
        title="Закрыть"
        style={{
          position: 'absolute',
          top: '26px',
          right: '26px',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(148, 163, 184, 0.1)',
          border: 'none',
          borderRadius: '9999px',
          color: '#94A3B8',
          cursor: 'pointer',
          zIndex: 1,
        }}
      >
        <X size={18} />
      </button>

      {/* ==================== ТЕЛО МОДАЛКИ: КАРТА СЛЕВА (НА ВСЮ ВЫСОТУ) + ОСТАЛЬНОЙ КОНТЕНТ ==================== */}
      <div style={{ display: 'flex', gap: '28px', alignItems: 'stretch' }}>

        <div style={{ width: '340px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <OrderRouteMap address={selectedOrder.address} routeHref={yandexRouteHref} />
          </div>
          {/* Запасные варианты — открывают карты приложений отдельной ссылкой,
              бесплатно (просто deep-link, без платного API маршрутов).
              Адрес/координаты те же нормализованные, что и у Яндекса
              (см. useMapRouteLinks) — город/область достраиваются одинаково
              для всех трёх сервисов. */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <a 
              href={twoGisRouteHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{ flex: 1, padding: '9px 8px', background: '#25334A', color: '#94A3B8', textAlign: 'center', borderRadius: '10px', textDecoration: 'none', fontWeight: '600', fontSize: '13px' }}
            >
              2ГИС
            </a>
            <a 
              href={googleRouteHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{ flex: 1, padding: '9px 8px', background: '#25334A', color: '#94A3B8', textAlign: 'center', borderRadius: '10px', textDecoration: 'none', fontWeight: '600', fontSize: '13px' }}
            >
              🗺️ Google
            </a>
          </div>
        </div>

      <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
        
        {/* Левая колонка — Информация (с возможностью редактирования, ПОЛНОСТЬЮ без обрезки/скролла).
            display:flex + height:100% — колонка растягивается по высоте сетки на уровень
            правой колонки (грид уже это делает по умолчанию), а Комментарий клиента
            (flex:1) дотягивается вниз до её нижнего края, на уровень с "Историей изменений". */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* ==================== ЗАГОЛОВОК ЗАЯВКИ + СТАТУС + "ПОД ВОПРОСОМ" (на месте бывшей "Информация о заказе") ==================== */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: '21px', color: '#F1F5F9', whiteSpace: 'nowrap' }}>
              Заявка #{selectedOrder.id}
            </h2>

            {/* Статус — компактный read-only бейдж, в одном стиле с кнопками действий
                (тонкая рамка + акцентный цвет, без сплошной "таблеточной" заливки) */}
            <div style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px', 
              borderRadius: '10px', 
              border: `1px solid ${getStatusColor(selectedOrder.status)}30`,
              fontWeight: '600',
              fontSize: '13px',
              whiteSpace: 'nowrap',
              color: getStatusColor(selectedOrder.status),
            }}>
              {selectedOrder.status === 'new' && '🟡 Новая'}
              {selectedOrder.status === 'processing' && '🔵 В работе'}
              {selectedOrder.status === 'completed' && '🟢 Выполнена'}
              {selectedOrder.status === 'cancelled' && '🔴 Отменена'}
            </div>

            {/* Чекбокс "Под вопросом" — тот же элегантный стиль, лёгкая подсветка фона когда отмечен.
                Без htmlFor: input внутри label — htmlFor давал двойную активацию в части браузеров. */}
            {hasManagerPermissions(currentRole) && (
              <label
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px', 
                  padding: '8px 14px', 
                  borderRadius: '10px',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  background: selectedOrder?.is_questionable ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                  fontSize: '13px',
                  cursor: questionableSaving ? 'wait' : 'pointer',
                  userSelect: 'none',
                  opacity: questionableSaving ? 0.7 : 1,
                }}
              >
                <input 
                  type="checkbox" 
                  checked={!!selectedOrder?.is_questionable}
                  disabled={questionableSaving}
                  onChange={async (e) => {
                    if (questionableSavingRef.current || !selectedOrder?.id) return;
                    questionableSavingRef.current = true;
                    setQuestionableSaving(true);

                    const newValue = e.target.checked;
                    const prevValue = !!selectedOrder.is_questionable;

                    // Оптимистично сразу — иначе controlled checkbox «отскакивает» и ловит повторные onChange
                    setSelectedOrder((prev: any) => ({ ...prev, is_questionable: newValue }));
                    setAllOrders((prev: any[]) => prev.map((o: any) =>
                      o.id === selectedOrder.id ? { ...o, is_questionable: newValue } : o
                    ));

                    try {
                      const res = await fetch('/api/adminCifra/orders/update', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          id: selectedOrder.id,
                          is_questionable: newValue,
                          userRole: currentRole || 'admin',
                          userName: userFullName || 'Сотрудник',
                        })
                      });

                      if (!res.ok) {
                        setSelectedOrder((prev: any) => ({ ...prev, is_questionable: prevValue }));
                        setAllOrders((prev: any[]) => prev.map((o: any) =>
                          o.id === selectedOrder.id ? { ...o, is_questionable: prevValue } : o
                        ));
                      } else if (typeof loadOrderHistory === 'function') {
                        loadOrderHistory(selectedOrder.id);
                      }
                    } catch {
                      setSelectedOrder((prev: any) => ({ ...prev, is_questionable: prevValue }));
                      setAllOrders((prev: any[]) => prev.map((o: any) =>
                        o.id === selectedOrder.id ? { ...o, is_questionable: prevValue } : o
                      ));
                    } finally {
                      questionableSavingRef.current = false;
                      setQuestionableSaving(false);
                    }
                  }}
                  style={{ width: '14px', height: '14px', accentColor: '#EF4444' }}
                />
                <span style={{ color: '#F87171', fontWeight: '600' }}>
                  Под вопросом
                </span>
              </label>
            )}
          </div>
          
          <div style={{ background: '#25334A', borderRadius: '16px', padding: '14px 18px', lineHeight: '1.3' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '7px', alignItems: 'center' }}>

              <div style={{ color: '#94A3B8' }}>Клиент</div>
              {/* ── Поиск клиента ── */}
              <div ref={clientDropdownRef} style={{ position: 'relative' }}>
                <input
                  value={clientQuery !== '' ? clientQuery : (selectedOrder.organization_name || selectedOrder.full_name || '')}
                  placeholder="Поиск по имени или организации…"
                  onChange={(e) => {
                    setClientQuery(e.target.value);
                    setShowClientDropdown(true);
                  }}
                  onFocus={() => {
                    setClientQuery('');
                    setShowClientDropdown(true);
                  }}
                  style={{ width: '100%', background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff', boxSizing: 'border-box' }}
                />
                {showClientDropdown && (() => {
                  const q = clientQuery.toLowerCase();
                  const filtered = allClients.filter((c: any) => {
                    const name = (c.organization_name || c.full_name || c.name || '').toLowerCase();
                    const phone = (c.phone || '').toLowerCase();
                    const inn = (c.inn || '').toLowerCase();
                    return !q || name.includes(q) || phone.includes(q) || inn.includes(q);
                  }).slice(0, 10);
                  if (!filtered.length) return null;
                  return (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                      background: '#1E2937', border: '1px solid #334155', borderRadius: '8px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: '220px', overflowY: 'auto',
                      marginTop: '4px',
                    }}>
                      {filtered.map((c: any, ci: number) => {
                        const displayName = c.organization_name || c.full_name || c.name || '—';
                        const isLegal = !!c.organization_name;
                        return (
                          <div
                            key={`${c.id ?? 'x'}-${ci}`}
                            onMouseDown={() => {
                              setSelectedOrder({
                                ...selectedOrder,
                                organization_name: c.organization_name || '',
                                full_name: c.full_name || '',
                                phone: c.phone || selectedOrder.phone,
                                inn: c.inn || selectedOrder.inn,
                                user_id: c.user_id ?? c.id,
                              });
                              setClientQuery('');
                              setShowClientDropdown(false);
                            }}
                            style={{
                              padding: '8px 12px', cursor: 'pointer',
                              borderBottom: '1px solid #334155',
                              display: 'flex', flexDirection: 'column', gap: '2px',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#25334A')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#E2E8F0' }}>
                              {isLegal ? '🏢 ' : '👤 '}{displayName}
                            </span>
                            <span style={{ fontSize: '11px', color: '#64748B' }}>
                              {[c.phone ? formatPhoneDisplay(c.phone) : null, c.inn ? `ИНН ${c.inn}` : null]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {selectedOrder.inn !== undefined && (
                <>
                  <div style={{ color: '#94A3B8' }}>ИНН</div>
                  <input 
                    value={selectedOrder.inn || ''} 
                    onChange={(e) => setSelectedOrder({ ...selectedOrder, inn: e.target.value })}
                    style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff' }}
                  />
                </>
              )}

              <div style={{ color: '#94A3B8' }}>Телефон</div>
              <input
                type="tel"
                value={selectedOrder.phone ? formatPhoneInput(selectedOrder.phone) : ''}
                onChange={(e) => setSelectedOrder({ ...selectedOrder, phone: formatPhoneInput(e.target.value) })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Марка бетона</div>
              <select
                value={selectedOrder.grade || ''}
                onChange={(e) => setSelectedOrder({ ...selectedOrder, grade: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: selectedOrder.grade ? '#fff' : '#64748B', width: '100%' }}
              >
                {!selectedOrder.grade && <option value="">— выберите марку —</option>}
                {recipes
                  .map((r: any) => r.code || r.name)
                  .filter((v: string, i: number, arr: string[]) => v && arr.indexOf(v) === i)
                  .sort()
                  .map((grade: string) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))
                }
              </select>

              <div style={{ color: '#94A3B8' }}>Объём</div>
              <input 
                type="number" 
                step="0.01"
                min="0.01"
                value={selectedOrder.volume || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, volume: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Дата доставки</div>
              <input 
                type="date" 
                value={selectedOrder.delivery_date ? selectedOrder.delivery_date.split('T')[0] : ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, delivery_date: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Время доставки</div>
              <input 
                type="time" 
                value={selectedOrder.delivery_time || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, delivery_time: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff' }}
              />

                                <div style={{ color: '#94A3B8' }}>Статус заявки</div>
                
                {getStatusConfig(selectedOrder.status).final ? (
                  // ==================== ФИНАЛЬНЫЕ СТАТУСЫ — ЗАЩИЩЕНЫ ====================
                  <div style={{ 
                    backgroundColor: getStatusConfig(selectedOrder.status).bg,
                    color: getStatusConfig(selectedOrder.status).color,
                    padding: '8px 16px',
                    borderRadius: '10px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: '600',
                    fontSize: '14px',
                    width: '88%'
                  }}>
                    {getStatusConfig(selectedOrder.status).label} — конечный статус
                  </div>
                ) : (
                  // Можно менять
                  <select 
                    value={selectedOrder.status || 'new'} 
                    onChange={(e) => {
                      const newStatus = e.target.value;
                      // Локально сразу снимаем метку — на сервере то же при Save / смене статуса
                      setSelectedOrder({
                        ...selectedOrder,
                        status: newStatus,
                        ...(newStatus === 'processing' && selectedOrder.status !== 'processing'
                          ? { is_questionable: false }
                          : {}),
                      });
                    }}
                    style={{ 
                      background: '#334155', 
                      border: 'none', 
                      borderRadius: '8px', 
                      padding: '6px 10px', 
                      color: '#fff',
                      fontSize: '14px',
                      width: '100%'
                    }}
                  >
                    <option value="new">🟡 Новая</option>
                    <option value="processing">🔵 В работе</option>
                    <option value="completed">🟢 Выполнена</option>
                    <option value="cancelled">🔴 Отменена</option>
                  </select>
                )}

              <div style={{ color: '#94A3B8' }}>Адрес доставки</div>
              <textarea 
                value={selectedOrder.address || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, address: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff', minHeight: '48px', gridColumn: '2' }}
              />

            </div>
          </div>

          {/* Комментарий — редактируемое поле. flex:1 растягивает его вниз до нижнего
              края правой колонки (на уровень с "Историей изменений"); скроллбар
              textarea скрыт, вместо него — мерцающая стрелка, если текст не влезает. */}
          {selectedOrder.comment && (
            <div style={{ marginTop: '10px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <h4 style={{ color: '#94A3B8', marginBottom: '6px', flexShrink: 0 }}>Комментарий клиента</h4>
              <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                <textarea 
                  ref={commentRef}
                  onScroll={handleCommentScroll}
                  value={selectedOrder.comment} 
                  onChange={(e) => setSelectedOrder({ ...selectedOrder, comment: e.target.value })}
                  style={{ width: '100%', height: '100%', boxSizing: 'border-box', resize: 'none', background: '#25334A', border: 'none', borderRadius: '16px', padding: '12px 16px', color: '#fff', minHeight: '72px' }}
                />
                <ScrollMoreHint visible={commentHasMore} />
              </div>
            </div>
          )}
        </div>          
              
                            {/* Правая колонка — Логистика + История (может скроллиться внутри своих блоков) */}
              <div>
                {/* ==================== НАЗНАЧЕННЫЕ МИКСЕРЫ + ПРОСТОЙ ==================== */}
                {orderMixers.length > 0 && (() => {
                  const totalDowntime = orderMixers.reduce((sum, m) => sum + Number(m.downtimeMinutes || 0), 0);
                  const formatOnSiteDuration = (m: any): string | null => {
                    if (!m.onSiteAt) return null;
                    const end = m.unloadedAt ? new Date(m.unloadedAt) : new Date();
                    const minutes = Math.round((end.getTime() - new Date(m.onSiteAt).getTime()) / 60000);
                    return minutes >= 0 ? `${minutes} мин` : null;
                  };

                  return (
                    <div style={{ marginBottom: '20px' }}>
                      <h3 style={{ marginBottom: '10px', color: '#94A3B8' }}>
                        Назначенные миксеры ({orderMixers.length})
                      </h3>

                      <div style={{ background: '#25334A', borderRadius: '16px', padding: '14px' }}>
                        <div style={{
                          marginBottom: '12px',
                          paddingBottom: '12px',
                          borderBottom: '1px solid #334155',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px'
                        }}>
                          <span style={{ color: '#94A3B8', fontSize: '13.5px' }}>Общий простой по заявке:</span>
                          <span style={{ color: totalDowntime > 0 ? '#F97316' : '#10B981', fontWeight: '700', fontSize: '16px' }}>{totalDowntime} мин</span>
                        </div>

                        {/* Список миксеров — своя внутренняя прокрутка. Скроллбар скрыт,
                            вместо него — мерцающая стрелка вниз, пока список не докручен. */}
                        <div style={{ position: 'relative' }}>
                        <div
                          ref={mixerListRef}
                          onScroll={handleMixerListScroll}
                          style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}
                        >
                          {orderMixers.map((mixer: any) => {
                            const duration = formatOnSiteDuration(mixer);
                            return (
                              <div
                                key={mixer.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  background: '#1E2937',
                                  borderRadius: '8px',
                                  padding: '7px 12px',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                }}
                              >
                                <span style={{ fontWeight: '700', fontSize: '13.5px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {mixer.mixerName || mixer.number}
                                </span>
                                <span style={{ color: '#64748B', fontSize: '13px' }}>· {mixer.time}</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                  <span style={{ color: '#64748B', fontSize: '13px' }}>·</span>
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0.1"
                                    defaultValue={Number(mixer.volume)}
                                    onBlur={(e) => {
                                      const next = Number(e.target.value);
                                      if (Number.isFinite(next) && next > 0 && Math.abs(next - Number(mixer.volume)) > 0.001) {
                                        handleMixerVolumeChange(mixer.id, next);
                                      } else {
                                        e.target.value = String(Number(mixer.volume));
                                      }
                                    }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                    title="Фактический объём этого миксера — можно исправить постфактум"
                                    style={{
                                      background: '#0F172A',
                                      color: '#94A3B8',
                                      border: '1px solid #475569',
                                      borderRadius: '6px',
                                      padding: '2px 3px',
                                      fontSize: '12.5px',
                                      width: '40px'
                                    }}
                                  />
                                  <span style={{ color: '#94A3B8', fontSize: '13px' }}>м³</span>
                                </span>

                                <span style={{ marginLeft: 'auto', fontSize: '13px', color: '#10B981', fontWeight: 600 }}>
                                  {mixer.status || 'Загрузка'}
                                </span>
                                <span style={{
                                  fontSize: '12px',
                                  color: Number(mixer.downtimeMinutes) > 0 ? '#F97316' : '#94A3B8'
                                }}>
                                  ⏱ {duration || '0 мин'}
                                  {mixer.status === 'Разгружен' && ` (простой ${Number(mixer.downtimeMinutes || 0)} мин)`}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <ScrollMoreHint visible={mixerListHasMore} />
                        </div>
                      </div>
                    </div>
                  );
                })()}

                                               {/* ==================== ИСТОРИЯ ИЗМЕНЕНИЙ ==================== */}
<div>
  <h3 style={{ marginBottom: '12px', color: '#94A3B8' }}>История изменений</h3>
  <div style={{ position: 'relative' }}>
  <div
    ref={historyRef}
    onScroll={handleHistoryScroll}
    style={{ 
    background: '#25334A', 
    borderRadius: '16px', 
    padding: '16px', 
    maxHeight: '260px', 
    overflowY: 'auto',
    fontSize: '14px',
    lineHeight: '1.6'
  }}>
    <OrderHistoryTimeline entries={orderHistory} />
  </div>
  <ScrollMoreHint visible={historyHasMore} />
  </div>
</div>
              </div>
            </div>
            {/* /grid 1fr 1fr */}
      </div>
      {/* /flex: 1, остальной контент */}

      </div>
      {/* /ТЕЛО МОДАЛКИ: карта + остальной контент */}

        {/* ==================== КНОПКИ ДЕЙСТВИЙ — компактные, элегантные, без "таблеточного" фона ==================== */}
    <div style={{ marginTop: '32px', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>

      { hasManagerPermissions(currentRole) && (
        <>
          {/* Сохранить изменения */}
          <ModalActionButton
            color="#10B981"
            icon={<Save size={15} />}
            label="Сохранить"
            onClick={async () => {
              console.log('🟡 Сохраняем. userFullName =', userFullName);   // ← Добавили

              const updatedOrder = { ...selectedOrder };

              try {
                const payload = {
                  id: selectedOrder.id,
                  ...selectedOrder,
                  userRole: currentRole || 'admin',
                  userName: userFullName || 'Сотрудник'
                };

                console.log('📤 Отправляем в API payload.userName =', payload.userName);   // ← Добавили

                const res = await fetch('/api/adminCifra/orders/update', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                });

                if (res.ok) {
                  alert('✅ Изменения успешно сохранены!');
                  setAllOrders(prev => prev.map(order => String(order.id) === String(selectedOrder.id) ? updatedOrder : order));
                  if (typeof loadOrderHistory === 'function') loadOrderHistory(selectedOrder.id);
                } else {
                  const errorData = await res.json().catch(() => ({}));
                  alert(errorData.message || 'Ошибка сохранения');
                }
              } catch (err) {
                console.error('Ошибка сохранения:', err);
                alert('Ошибка соединения с сервером');
              }
            }}
          />

          {/* Удалить заявку */}
          <ModalActionButton
            color="#EF4444"
            icon={<Trash2 size={15} />}
            label="Удалить"
            onClick={() => handleDeleteOrder(selectedOrder.id)}
          />

          {/* Отправить в Max */}
          <ModalActionButton
            color="#3B82F6"
            icon={<Send size={15} />}
            label="В Max"
            disabled={isSendingNotification}
            onClick={() => sendNotification(selectedOrder.id)}
          />

          {/* Поделиться */}
          <ModalActionButton
            color="#8B5CF6"
            icon={<Share2 size={15} />}
            label="Поделиться"
            onClick={() => shareOrder(selectedOrder)}
          />

          {/* Копировать заявку */}
          <ModalActionButton
            color="#6366F1"
            icon={<Copy size={15} />}
            label="Копировать заявку"
            onClick={() => copyOrder(selectedOrder)}
          />
        </>
      )}

      {/* Отмена */}
      <ModalActionButton
        color="#94A3B8"
        icon={<X size={15} />}
        label="Отмена"
        onClick={() => setSelectedOrder(null)}
      />

    </div>
    </div>
  </div>
)}




           {showNewOrderModal && (
  <NewOrderModal 
  isOpen={showNewOrderModal}
    onClose={() => {
      setShowNewOrderModal(false);
      setNewOrderInitialData(null);
    }} 
    onSuccess={(newOrder) => {
      if (newOrder) {
        // Защита от задвоения: realtime-подписка useRealtimeOrders (см. ниже)
        // может вставить эту же заявку раньше, чем вернётся ответ на создание.
        setAllOrders(prev => {
          if (prev.some(o => String(o.id) === String(newOrder.id))) return prev;
          return [newOrder, ...prev];
        });
      }
    }} 
    initialData={newOrderInitialData}
    defaultDeliveryDate={selectedDateStr}
    currentRole={currentRole}
    currentUserName={userFullName || 'Сотрудник'}   // ← Реальное имя
  />
)}

      {/* ==================== ПОПАП: ПРОГНОЗ ДОБАВОК ==================== */}
      {showAdditivePopup && weekAdditiveForecast && (
        <div
          onClick={() => setShowAdditivePopup(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="scroll-hidden"
            style={{
              background: '#1E2937', borderRadius: '20px', padding: '28px',
              width: '100%', maxWidth: '560px', maxHeight: '80vh',
              overflowY: 'auto', boxSizing: 'border-box',
              border: weekAdditiveForecast.hasAlert ? '1.5px solid rgba(239,68,68,0.4)' : '1.5px solid rgba(16,185,129,0.3)',
            }}
          >
            {/* Заголовок */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  {weekAdditiveForecast.hasAlert
                    ? <AlertTriangle size={18} color="#EF4444" />
                    : <CheckCircle2 size={18} color="#10B981" />}
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                    Прогноз добавок — 7 дней
                  </h2>
                </div>
                <div style={{ color: '#64748B', fontSize: '13px' }}>
                  {(() => {
                    const fmt = (ds: string) => {
                      const [y, m, d] = ds.split('-');
                      return `${d}.${m}.${y}`;
                    };
                    return `${fmt(weekAdditiveForecast.dateFrom)} — ${fmt(weekAdditiveForecast.dateTo)}`;
                  })()}
                  {' · '}
                  {weekAdditiveForecast.totalOrders} заявок, {weekAdditiveForecast.totalVolume} м³
                </div>
              </div>
              <button
                onClick={() => setShowAdditivePopup(false)}
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', padding: '4px', fontSize: '20px', lineHeight: 1 }}
              >✕</button>
            </div>

            {/* Блоки по каждой добавке */}
            {([
              { key: 'pfm' as const, id: 1 as const, name: ADDITIVE_NAMES[1] },
              { key: 'linomix' as const, id: 2 as const, name: ADDITIVE_NAMES[2] },
            ] as const).map(({ key, id, name }) => {
              const item = weekAdditiveForecast[key];
              if (item.needed === 0) return null;
              const pct = item.stock !== null && item.needed > 0
                ? Math.min(100, Math.round((item.stock / item.needed) * 100))
                : null;
              const orders = weekAdditiveForecast.details.filter(d => d.additiveId === id);
              return (
                <div key={key} style={{
                  background: '#25334A', borderRadius: '14px', padding: '16px', marginBottom: '14px',
                  border: item.shortage ? '1px solid rgba(239,68,68,0.3)' : '1px solid #334155',
                }}>
                  {/* Шапка добавки */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontWeight: 700, fontSize: '15px' }}>{name}</span>
                    {item.shortage && item.stock !== null && (
                      <span style={{ background: '#EF444425', color: '#F87171', fontSize: '12px', fontWeight: 700, borderRadius: '8px', padding: '3px 10px' }}>
                        Нехватка {item.needed - Math.round(item.stock)} л
                      </span>
                    )}
                    {!item.shortage && (
                      <span style={{ background: '#10B98120', color: '#34D399', fontSize: '12px', fontWeight: 700, borderRadius: '8px', padding: '3px 10px' }}>
                        Достаточно
                      </span>
                    )}
                  </div>
                  {/* Цифры */}
                  <div style={{ display: 'flex', gap: '24px', marginBottom: '10px' }}>
                    <div>
                      <div style={{ color: '#64748B', fontSize: '12px', marginBottom: '2px' }}>На складе</div>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: item.shortage ? '#EF4444' : '#10B981' }}>
                        {item.stock !== null ? `${Math.round(item.stock)} л` : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#64748B', fontSize: '12px', marginBottom: '2px' }}>Нужно</div>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: '#CBD5E1' }}>{item.needed} л</div>
                    </div>
                    {item.stock !== null && (
                      <div>
                        <div style={{ color: '#64748B', fontSize: '12px', marginBottom: '2px' }}>Обеспечение</div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: item.shortage ? '#FACC15' : '#10B981' }}>{pct}%</div>
                      </div>
                    )}
                  </div>
                  {/* Прогресс */}
                  {pct !== null && (
                    <div style={{ height: '6px', background: '#334155', borderRadius: '9999px', overflow: 'hidden', marginBottom: '14px' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: item.shortage ? 'linear-gradient(90deg,#EF4444,#F97316)' : '#10B981', borderRadius: '9999px', transition: 'width 0.4s ease' }} />
                    </div>
                  )}
                  {/* Таблица заявок */}
                  {orders.length > 0 && (
                    <>
                      <div style={{ color: '#475569', fontSize: '12px', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Заявки ({orders.length})
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 60px 60px 60px', gap: '4px 8px', color: '#64748B', fontSize: '11px', marginBottom: '4px' }}>
                        <div>№</div><div>Марка</div><div style={{ textAlign: 'right' }}>Объём</div><div style={{ textAlign: 'right' }}>кг</div><div style={{ textAlign: 'right' }}>л</div>
                      </div>
                      {orders.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)).map((o, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 60px 60px 60px', gap: '4px 8px', padding: '5px 0', borderTop: '1px solid #334155', fontSize: '13px', alignItems: 'center' }}>
                          <div style={{ color: '#60A5FA', fontWeight: 600 }}>#{o.id}</div>
                          <div style={{ color: '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {o.grade} <span style={{ color: '#475569', fontSize: '11px' }}>{o.deliveryDate.slice(5).replace('-', '.')}</span>
                          </div>
                          <div style={{ textAlign: 'right', color: '#CBD5E1' }}>{o.volume} м³</div>
                          <div style={{ textAlign: 'right', color: '#94A3B8' }}>{o.kg} кг</div>
                          <div style={{ textAlign: 'right', color: '#94A3B8' }}>{o.liters} л</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}

            {/* Кнопка закрытия */}
            <button
              onClick={() => setShowAdditivePopup(false)}
              style={{ width: '100%', padding: '12px', background: '#334155', borderRadius: '12px', color: '#94A3B8', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '14px', marginTop: '4px' }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

    </div>
    </div>
  );
}