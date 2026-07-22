'use client';

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Order } from '../hooks/useCalendarOrders';

interface DelayInfo { id: string|number; delayMinutes: number; delayText: string; }

interface Props {
  orders: Order[];
  mixerAssignments: any[];
  selectedDateStr: string;
  onOrderClick: (order: Order) => void;
  delayedOrders?: DelayInfo[];
}

// ── Colors ─────────────────────────────────────────────────────────────────

// ── Colours exactly matching the horizontal dashboard timeline ─────────────
// Horizontal pill: background = statusColor + 'CC' alpha, text = #fff, fontWeight 600
// We use same accent colours so both timelines look identical.

const MIXER_COLORS: Record<string, string> = {
  'Загрузка':   '#FACC15',
  'В пути':     '#3B82F6',   // kept intentionally darker than horizontal's #60A5FA (user pref)
  'На объекте': '#10B981',
  'Разгружен':  '#10B981',   // same as completed order cards
  'Возврат':    '#94A3B8',
  'Проблема':   '#EF4444',
};

// Left bracket — semi-transparent black, visible on all bright backgrounds
const MIXER_BG: Record<string, string> = {
  'Загрузка':   'rgba(0,0,0,0.32)',
  'В пути':     'rgba(0,0,0,0.32)',
  'На объекте': 'rgba(0,0,0,0.32)',
  'Разгружен':  'rgba(0,0,0,0.32)',
  'Возврат':    'rgba(0,0,0,0.32)',
  'Проблема':   'rgba(0,0,0,0.32)',
};

// Text: yellow → black for contrast; all others (including #10B981) → white
const MIXER_TEXT: Record<string, string> = {
  'Загрузка':   '#000000',
  'В пути':     '#ffffff',
  'На объекте': '#ffffff',
  'Разгружен':  '#ffffff',  // white on #10B981 (same as order card text)
  'Возврат':    '#ffffff',
  'Проблема':   '#ffffff',
};

const ORDER_COLORS: Record<string, string> = {
  new:        '#FACC15',
  processing: '#3B82F6',
  completed:  '#10B981',  // exact match with horizontal timeline "Выполнена"
  cancelled:  '#F43F5E',
};

const ORDER_BG: Record<string, string> = {
  new:        'rgba(0,0,0,0.32)',
  processing: 'rgba(0,0,0,0.32)',
  completed:  'rgba(0,0,0,0.32)',
  cancelled:  'rgba(0,0,0,0.32)',
};

// Yellow (#FACC15) → black text; all others → white (fully opaque, not muted)
const ORDER_TEXT: Record<string, string> = {
  new:        '#000000',
  processing: '#ffffff',
  completed:  '#ffffff',
  cancelled:  '#ffffff',
};

const ORDER_LABELS: Record<string, string> = {
  new:        'Новая',
  processing: 'В работе',
  completed:  'Выполнена',
  cancelled:  'Отменена',
};

// ── Layout constants (declare as module-level so they're stable) ───────────

const TIME_W       = 54;   // time-label column
const ORDER_W      = 256;  // order-info card width
const LEFT_PAD     = 8;    // gap between time col and order card
const RIGHT_PAD    = 10;   // gap between order card and chips area
const LEFT_TOTAL   = TIME_W + LEFT_PAD + ORDER_W + RIGHT_PAD; // ≈ 328px
const RULER_H      = 22;   // height of the per-row chips time ruler
const CHIP_W       = 100;  // base (uncompressed) chip width
const CHIP_H       = 52;   // chip height (two-line)
const CHIP_MIN_GAP = 6;    // minimum gap between chips
const RAIL_X       = 38;   // x-centre of the vertical rail
const MAX_GAP      = 120;  // max logarithmic gap between order groups
const TOP_PAD      = 8;

// Ruler hour marks shown on the sticky top scale
const RULER_HOURS  = [0, 6, 12, 18, 24];

// ── Helpers ─────────────────────────────────────────────────────────────────

function toMins(t: string): number {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ── Component ───────────────────────────────────────────────────────────────

interface ChipTooltip {
  screenX: number;
  screenY: number;
  data: any;
}

export default function VerticalTimelinePanel({
  orders,
  mixerAssignments,
  selectedDateStr,
  onOrderClick,
  delayedOrders = [],
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(900);
  const [nowTick, setNowTick]       = useState(0);
  const [tooltip, setTooltip]       = useState<ChipTooltip | null>(null);
  const [orderTooltip, setOrderTooltip] = useState<ChipTooltip | null>(null);

  // Fast lookup: orderId → delay info
  const delayMap = useMemo(() =>
    Object.fromEntries(delayedOrders.map(d => [String(d.id), d]))
  , [delayedOrders]);

  // Track container width for chip layout
  useEffect(() => {
    const update = () => {
      if (containerRef.current) setContainerW(containerRef.current.offsetWidth);
    };
    update();
    const obs = new ResizeObserver(update);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Tick every minute for the "now" line
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const now        = useMemo(() => new Date(), [nowTick]);
  const nowMins    = now.getHours() * 60 + now.getMinutes();
  const curDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const isToday    = selectedDateStr === curDateStr;
  const nowStr     = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  // Derived chip area width
  const CHIPS_W = Math.max(200, containerW - LEFT_TOTAL - 16);

  // Precompute trips per order
  const tripsByOrder = useMemo(() => {
    const map: Record<string, any[]> = {};
    orders.forEach(o => {
      map[String(o.id)] = mixerAssignments.filter(
        m => String(m.orderId) === String(o.id) || String(m.order_id) === String(o.id)
      );
    });
    return map;
  }, [orders, mixerAssignments]);

  // ── Chip layout: positions by departure time, compressed if needed ────────
  const getChipLayout = useCallback((orderId: string | number) => {
    const raw = (tripsByOrder[String(orderId)] || []).slice();
    if (!raw.length) return [];

    // Sort by departure time (mixer.time field)
    const sorted = raw.sort((a, b) => toMins(a.time || '00:00') - toMins(b.time || '00:00'));

    // Natural X positions (departure time → pixel position on 0-24h axis)
    const natX = sorted.map(t => (toMins(t.time || '00:00') / 1440) * CHIPS_W);

    // Resolve overlaps: nudge later chips right so they don't overlap
    const positions = [...natX];
    for (let i = 1; i < positions.length; i++) {
      const minNext = positions[i - 1] + CHIP_W + CHIP_MIN_GAP;
      if (positions[i] < minNext) positions[i] = minNext;
    }

    // Compress everything to fit within CHIPS_W
    const needed = positions[positions.length - 1] + CHIP_W;
    const scale  = needed > CHIPS_W ? CHIPS_W / needed : 1;
    const cW     = Math.max(60, Math.floor(CHIP_W * scale));

    return sorted.map((t, i) => ({
      ...t,
      chipX: Math.round(positions[i] * scale),
      chipW: cW,
    }));
  }, [tripsByOrder, CHIPS_W]);

  // ── Order / group heights — always the same so all rows are uniform ─────
  const CARD_H = CHIP_H + 16; // 68px for every card (no per-row ruler anymore)
  const cardH = useCallback((_order: Order) => CARD_H, [CARD_H]);

  const groupH = useCallback((g: { orders: Order[] }) =>
    g.orders.reduce((sum, o, i) => sum + cardH(o) + (i > 0 ? 4 : 0), 0)
  , [cardH]);

  // ── Group orders by same delivery time ───────────────────────────────────
  type OGroup = { time: number; orders: Order[] };
  const groups = useMemo<OGroup[]>(() => {
    const sorted = [...orders].sort((a, b) =>
      toMins(a.delivery_time || '00:00') - toMins(b.delivery_time || '00:00')
    );
    const result: OGroup[] = [];
    sorted.forEach(o => {
      const t = toMins(o.delivery_time || '00:00');
      if (result.length && result[result.length - 1].time === t) {
        result[result.length - 1].orders.push(o);
      } else {
        result.push({ time: t, orders: [o] });
      }
    });
    return result;
  }, [orders]);

  // ── Logarithmic Y positions ───────────────────────────────────────────────
  const gPos = useMemo<number[]>(() => {
    const pos: number[] = [];
    groups.forEach((g, i) => {
      if (i === 0) { pos.push(TOP_PAD); return; }
      const prevH  = groupH(groups[i - 1]);
      const dt     = g.time - groups[i - 1].time;
      // logAdd capped at 60px so groups never spread too far apart for big time gaps
      const logAdd = Math.min(Math.log(1 + dt / 5) * 14, 60);
      // Minimum gap is always prevH + 8 to guarantee no overlap
      pos.push(pos[i - 1] + prevH + 8 + logAdd);
    });
    return pos;
  }, [groups, groupH]);

  // ── "Now" horizontal line Y ───────────────────────────────────────────────
  const nowVisualY = useMemo<number | null>(() => {
    if (!isToday || !groups.length) return null;
    const afterIdx = groups.findIndex(g => g.time > nowMins);
    const lastH    = groupH(groups[groups.length - 1]);
    const lastP    = gPos[gPos.length - 1] ?? TOP_PAD;
    if (afterIdx === -1)  return lastP + lastH + 18;
    if (afterIdx === 0)   return Math.max(0, gPos[0] - Math.min((groups[0].time - nowMins) * 0.5, TOP_PAD));
    const r = (nowMins - groups[afterIdx - 1].time) / (groups[afterIdx].time - groups[afterIdx - 1].time);
    return gPos[afterIdx - 1] + r * (gPos[afterIdx] - gPos[afterIdx - 1]);
  }, [groups, gPos, nowMins, isToday, groupH]);

  const lastPos  = gPos[gPos.length - 1] ?? TOP_PAD;
  const lastH    = groups.length > 0 ? groupH(groups[groups.length - 1]) : 56;
  const totalH   = Math.max(lastPos + lastH + 24, nowVisualY !== null ? nowVisualY + 32 : 0);

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!groups.length) {
    return (
      <div style={{ textAlign:'center', padding:'80px 40px', color:'#64748B', fontSize:'17px' }}>
        На выбранный день заказов нет
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} style={{ position:'relative', width:'100%' }}>

      {/* ── Sticky top time ruler (0–24h) — no background, transparent ── */}
      <div style={{
        position:    'sticky',
        top:          0,
        zIndex:       30,
        display:     'flex',
        height:      '26px',
        borderBottom:'1px solid #1D2E3F',
        marginBottom:'4px',
        backdropFilter: 'blur(8px)',
      }}>
        {/* spacer matching the time-label + order-card columns */}
        <div style={{ width: `${LEFT_TOTAL}px`, flexShrink: 0 }} />
        {/* ruler ticks */}
        <div style={{ flex:1, position:'relative' }}>
          {RULER_HOURS.map(h => {
            const pct = `${(h / 24) * 100}%`;
            return (
              <React.Fragment key={h}>
                <div style={{
                  position:'absolute', left:pct,
                  top:0, bottom:0, width:'1px',
                  background: h === 0 || h === 24 ? '#2D3F55' : '#1D2E3F',
                }} />
                <span style={{
                  position:'absolute', left:pct,
                  bottom:'3px',
                  transform:'translateX(-50%)',
                  fontSize:'10px', fontWeight:700, color:'#4A6080',
                  userSelect:'none', whiteSpace:'nowrap',
                }}>
                  {String(h).padStart(2,'0')}:00
                </span>
              </React.Fragment>
            );
          })}
          {/* current-time: green dot instead of vertical line */}
          {isToday && (
            <div style={{
              position:'absolute',
              left:`${(nowMins/1440)*100}%`,
              top:'50%',
              transform:'translate(-50%, -50%)',
              width:'8px', height:'8px',
              borderRadius:'50%',
              background:'#4ADE80',
              boxShadow:'0 0 8px rgba(74,222,128,0.8)',
              zIndex:5,
            }} />
          )}
        </div>
      </div>

      {/* ── Main timeline (absolute-positioned groups) ── */}
      <div style={{ position:'relative', width:'100%', minHeight:`${totalH}px` }}>

        {/* Vertical rail */}
        <div style={{
          position:'absolute', left:`${RAIL_X}px`,
          top:`${gPos[0] + 14}px`,
          width:'1px',
          height:`${Math.max(0, lastPos - gPos[0])}px`,
          background:'#3D5570',
          zIndex:1,
        }} />

        {/* ── Now-line: mobile style
              Layout: [text (RAIL_X-6 px, right-align) | 3px gap | dot 7px centred on RAIL_X | line →]
              Maths: text_right = RAIL_X-6+3 = RAIL_X-3; dot_left = RAIL_X-3; dot_centre = RAIL_X-3+3.5 ≈ RAIL_X ✓ ── */}
        {nowVisualY !== null && (
          <div style={{
            position:'absolute',
            top:`${nowVisualY + 11}px`,   // same offset as time labels (gPos+11)
            left:0, right:0,
            display:'flex', alignItems:'center',
            zIndex:20, pointerEvents:'none',
          }}>
            {/* Time text — same size & position as time labels, covers label underneath */}
            <span style={{
              width:`${RAIL_X - 6}px`, textAlign:'right', flexShrink:0,
              fontSize:'11px', fontWeight:800, color:'#10B981',
              lineHeight:1,
              background:'linear-gradient(to right, transparent 0, #0D1B2B 6px)',
              userSelect:'none',
            }}>{nowStr}</span>
            {/* 3 px gap → dot left edge at RAIL_X - 3 → dot centre at RAIL_X + 0.5 ≈ RAIL_X */}
            <div style={{ width:'3px', flexShrink:0 }} />
            {/* Green dot — sits exactly on the vertical rail */}
            <div style={{
              width:'7px', height:'7px', borderRadius:'50%', flexShrink:0,
              background:'#10B981', boxShadow:'0 0 7px #10B981',
            }} />
            {/* Gradient line going right */}
            <div style={{
              flex:1, height:'1.5px',
              background:'linear-gradient(90deg, #10B981, rgba(16,185,129,0.10))',
            }} />
          </div>
        )}

        {/* ── Order groups ── */}
        {groups.map((group, gi) => {
          const hiddenByNow  = isToday && nowVisualY !== null && Math.abs(nowVisualY - gPos[gi]) < 8;
          const timeStr      = (group.orders[0].delivery_time || '').slice(0, 5);
          const isPastGroup  = isToday && group.time < nowMins;

          // Cumulative Y offsets for stacked same-time orders
          const cumOffsets = group.orders.reduce<number[]>((acc, o, i) => {
            if (i === 0) return [0];
            return [...acc, acc[i - 1] + cardH(group.orders[i - 1]) + 4];
          }, []);

          return (
            <React.Fragment key={gi}>
              {/* Dot on rail */}
              <div style={{
                position:'absolute', left:`${RAIL_X}px`, top:`${gPos[gi]+14}px`,
                width:'8px', height:'8px', borderRadius:'50%',
                background: isPastGroup ? '#263448' : '#4A6070',
                transform:'translateX(-50%)', zIndex:3,
              }} />

              {/* Time label */}
              <span style={{
                position:'absolute', left:0, top:`${gPos[gi]+11}px`,
                width:`${RAIL_X-6}px`, textAlign:'right',
                fontSize:'11px', fontWeight:700, lineHeight:1,
                color: isPastGroup ? '#2C3E52' : '#6B8BA4',
                opacity: hiddenByNow ? 0 : 1, transition:'opacity 0.2s',
                pointerEvents:'none', userSelect:'none', zIndex:4,
              }}>{timeStr}</span>

              {/* Order cards */}
              {group.orders.map((order, oi) => {
                const h          = cardH(order);
                const chipLayout = getChipLayout(order.id);
                const hasChips   = chipLayout.length > 0;
                // No dimming for completed — show the full vivid green, same as horizontal timeline
                const isCompleted = false;
                const delay      = delayMap[String(order.id)];
                // Only dim "new" past orders — completed/processing stay full opacity
                const isPast     = isToday
                  && order.status !== 'completed'
                  && order.status !== 'processing'
                  && group.time < nowMins;
                const sColor     = ORDER_COLORS[order.status] || '#64748B';
                const sLabel     = ORDER_LABELS[order.status] || '—';
                const client     = (order as any).organization_name || (order as any).full_name || '—';
                const vol        = Number((order as any).volume || 0);
                const assignedVol= chipLayout.reduce((s: number, m: any) => s + Number(m.volume||0), 0);
                const covPct     = vol > 0 ? Math.min(100, Math.round((assignedVol/vol)*100)) : 0;
                const covColor   = covPct>=100 ? '#34D399' : covPct>0 ? '#FACC15' : '#EF444450';

                return (
                  <div
                    key={order.id}
                    onClick={() => onOrderClick(order)}
                    style={{
                      position:'absolute',
                      left:`${TIME_W + LEFT_PAD}px`,
                      right:0,
                      top:`${gPos[gi] + cumOffsets[oi]}px`,
                      height:`${h}px`,
                      display:'flex',
                      alignItems:'stretch',
                      gap:`${RIGHT_PAD}px`,
                      cursor:'pointer',
                      opacity: isPast ? 0.5 : 1,
                      transition:'opacity 0.2s',
                      borderBottom:'1px solid #304F6E',
                    }}
                  >
                    {/* ── Order info card — bright bg = accent, bracket = dark tint ── */}
                    <div
                      onMouseEnter={e => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setOrderTooltip({ screenX: r.left + r.width / 2, screenY: r.top, data: { order, chipLayout, assignedVol, covPct, vol } });
                      }}
                      onMouseLeave={() => setOrderTooltip(null)}
                      style={{
                      width:`${ORDER_W}px`,
                      height:`${CHIP_H + 8}px`,
                      marginTop:'4px',
                      alignSelf:'flex-start',
                      flexShrink:0,
                      background: sColor,
                      border: delay ? '1.5px solid #EF4444' : `1px solid ${sColor}`,
                      borderLeft:`6px solid ${ORDER_BG[order.status] || '#0D1B2A'}`,
                      borderRadius:'8px',
                      padding:'6px 10px',
                      display:'flex',
                      flexDirection:'column',
                      justifyContent:'space-between',
                      overflow:'visible',
                      boxSizing:'border-box',
                      opacity: isCompleted ? 0.5 : 1,
                      cursor:'pointer',
                      boxShadow: delay ? '0 0 14px rgba(239,68,68,0.55), 0 2px 8px rgba(0,0,0,0.3)' : undefined,
                      position:'relative',
                    }}>
                      {(() => {
                        const tc = ORDER_TEXT[order.status] || '#fff';
                        // Yellow cards → black; all else → white (fully opaque, matching horizontal pill style)
                        const tcSub = tc === '#000000' ? 'rgba(0,0,0,0.68)' : 'rgba(255,255,255,0.88)';
                        return (<>
                          <div style={{ display:'flex', alignItems:'center', gap:'5px', minWidth:0 }}>
                            {/* ID — slightly bolder as key identifier */}
                            <span style={{ fontWeight:700, fontSize:'12px', color: tc, flexShrink:0 }}>
                              #{order.id}
                            </span>
                            <span style={{
                              fontSize:'11px', fontWeight:600, color: tcSub,
                              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                            }}>{client}</span>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'11px', color: tcSub }}>
                            <span style={{ fontWeight:600 }}>{(order as any).grade||'—'} · {vol} м³</span>
                            <span style={{
                              marginLeft:'auto', flexShrink:0,
                              display:'inline-flex', alignItems:'center', gap:'4px',
                              fontSize:'10px', fontWeight:600,
                              color: tc, background:'rgba(0,0,0,0.18)',
                              padding:'1px 6px', borderRadius:'999px',
                            }}>
                              {sLabel}
                              {(order as any).is_questionable && (
                                <span
                                  title="Под вопросом"
                                  style={{
                                    height:'14px', padding:'0 5px', borderRadius:'999px',
                                    display:'inline-flex', alignItems:'center', justifyContent:'center',
                                    background:'#EF4444', color:'#fff',
                                    fontSize:'10px', fontWeight:800, lineHeight:1,
                                    boxShadow:'0 0 0 1px rgba(255,255,255,0.3), 0 0 6px rgba(239,68,68,0.5)',
                                  }}
                                >?</span>
                              )}
                            </span>
                          </div>
                        </>);
                      })()}
                      {/* Coverage bar */}
                      <div style={{ height:'3px', borderRadius:'2px', background:'rgba(0,0,0,0.2)', overflow:'hidden' }}>
                        <div style={{
                          width:`${covPct}%`, height:'100%',
                          background: delay ? '#EF4444' : covColor,
                          transition:'width 0.4s ease',
                        }} />
                      </div>

                      {/* Delay badge — top-right corner, outside card */}
                      {delay && (
                        <div style={{
                          position:'absolute',
                          top:'-9px', right:'-4px',
                          display:'flex', alignItems:'center', gap:'3px',
                          background:'#EF4444',
                          color:'#fff',
                          fontSize:'9px', fontWeight:800,
                          padding:'2px 6px 2px 5px',
                          borderRadius:'999px',
                          boxShadow:'0 2px 8px rgba(239,68,68,0.6)',
                          whiteSpace:'nowrap',
                          letterSpacing:'0.3px',
                          zIndex:5,
                        }}>
                          <span style={{ fontSize:'9px', lineHeight:1 }}>⏱</span>
                          {delay.delayText}
                        </div>
                      )}
                    </div>

                    {/* ── Chips area ── */}
                    <div style={{ flex:1, position:'relative', overflow:'hidden', minWidth:0 }}>
                      {/* Vertical grid lines aligned with top ruler (no per-row text labels) */}
                      {RULER_HOURS.map(rh => (
                        <div key={rh} style={{
                          position:'absolute',
                          left:`${(rh/24)*100}%`,
                          top:0, bottom:0, width:'1px',
                          background:'#1A2D40',
                          pointerEvents:'none',
                        }} />
                      ))}

                      {/* Mixer chips (only when assigned) */}
                      {hasChips && (
                        <>
                          {chipLayout.map((chip, ci) => {
                            const col      = MIXER_COLORS[chip.status] || '#64748B';
                            const darkBg   = MIXER_BG[chip.status]    || 'rgba(0,0,0,0.35)';
                            const chipTc   = MIXER_TEXT[chip.status]  || '#fff';
                            const chipTcSub = chipTc === '#000000' ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)';
                            const cW       = chip.chipW;
                            // Only dim "Возврат" (grey anyway); "Разгружен" stays full opacity to match completed order cards
                            const chipDone = chip.status === 'Возврат';
                            return (
                              <div
                                key={ci}
                                style={{
                                  position:'absolute',
                                  left:`${chip.chipX}px`,
                                  top:'4px',
                                  width:`${cW}px`,
                                  height:`${CHIP_H}px`,
                                  borderRadius:'7px',
                                  background: col,
                                  border:`1px solid ${col}`,
                                  borderLeft:`6px solid ${darkBg}`,
                                  display:'flex',
                                  flexDirection:'column',
                                  alignItems:'flex-start',
                                  justifyContent:'center',
                                  gap:'3px',
                                  overflow:'hidden',
                                  padding:'4px 6px',
                                  boxSizing:'border-box',
                                  cursor:'default',
                                  transition:'filter 0.15s',
                                  opacity: chipDone ? 0.65 : 1,
                                }}
                                onMouseEnter={e => {
                                  (e.currentTarget as HTMLElement).style.filter = 'brightness(1.15)';
                                  const r = e.currentTarget.getBoundingClientRect();
                                  setTooltip({ screenX: r.left + r.width/2, screenY: r.top, data: chip });
                                }}
                                onMouseLeave={e => {
                                  (e.currentTarget as HTMLElement).style.filter = '';
                                  setTooltip(null);
                                }}
                              >
                                {/* Mixer number — bold identifier, matching horizontal pill style */}
                                <span style={{
                                  fontSize:'11px', fontWeight:700, color: chipTc,
                                  lineHeight:1.2,
                                  whiteSpace:'nowrap', overflow:'hidden',
                                  textOverflow:'ellipsis', maxWidth:'100%',
                                }}>
                                  {chip.number || chip.mixer_name || '—'}
                                </span>
                                <span style={{
                                  fontSize:'10px', fontWeight:600, color: chipTcSub,
                                  lineHeight:1.2,
                                  whiteSpace:'nowrap',
                                }}>
                                  {Number(chip.volume||0)} м³
                                </span>
                              </div>
                            );
                          })}
                        </>
                      )}
                      {!hasChips && (
                        <div style={{
                          position:'absolute', left:0, right:0,
                          top:'4px', height:`${CHIP_H}px`,
                          border:'1px dashed #2A4060', borderRadius:'8px',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:'12px', color:'#4A6585', userSelect:'none',
                        }}>
                          Миксеры не назначены
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── Chip hover tooltip (portal-like, fixed) ── */}
      {tooltip && (
        <div style={{
          position:'fixed',
          left:`${tooltip.screenX}px`,
          top:`${tooltip.screenY - 10}px`,
          transform:'translateX(-50%) translateY(-100%)',
          background:'#1A2B3E',
          border:'1px solid #334E65',
          borderRadius:'10px',
          padding:'10px 14px',
          fontSize:'12px',
          color:'#E2E8F0',
          zIndex:9999,
          pointerEvents:'none',
          whiteSpace:'nowrap',
          boxShadow:'0 6px 20px rgba(0,0,0,0.5)',
          minWidth:'150px',
        }}>
          <div style={{ fontWeight:700, color:'#fff', fontSize:'13px', marginBottom:'6px' }}>
            {tooltip.data.number || tooltip.data.mixer_name || '—'}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
            <div style={{ color:'#7A99B8' }}>
              Объём: <span style={{ color:'#E2E8F0', fontWeight:600 }}>{tooltip.data.volume} м³</span>
            </div>
            <div style={{ color:'#7A99B8' }}>
              Статус: <span style={{
                color: MIXER_COLORS[tooltip.data.status] || '#94A3B8',
                fontWeight:600,
              }}>{tooltip.data.status || '—'}</span>
            </div>
            {tooltip.data.time && (
              <div style={{ color:'#7A99B8' }}>
                Отправка: <span style={{ color:'#E2E8F0', fontWeight:600 }}>
                  {String(tooltip.data.time).slice(0, 5)}
                </span>
              </div>
            )}
            {tooltip.data.loading_started_at && (
              <div style={{ color:'#7A99B8' }}>
                Погрузка: <span style={{ color:'#E2E8F0', fontWeight:600 }}>
                  {new Date(tooltip.data.loading_started_at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}
                </span>
              </div>
            )}
          </div>
          {/* Arrow */}
          <div style={{
            position:'absolute', left:'50%', bottom:'-6px',
            transform:'translateX(-50%)',
            width:'10px', height:'6px',
            background:'#1A2B3E',
            clipPath:'polygon(0 0, 100% 0, 50% 100%)',
          }} />
        </div>
      )}

      {/* ── Order card hover tooltip ── */}
      {orderTooltip && (() => {
        const { order: o, chipLayout: cl, assignedVol: av, covPct: cp, vol: v } = orderTooltip.data;
        const sc = ORDER_COLORS[o.status] || '#64748B';
        const label = ORDER_LABELS[o.status] || '—';
        const client = (o as any).organization_name || (o as any).full_name || '—';
        const address = (o as any).address || '—';
        const grade = (o as any).grade || '—';
        const tooltipDelay = delayMap[String(o.id)];
        const covColor = cp >= 100 ? '#34D399' : cp > 0 ? '#FACC15' : '#EF4444';
        const activeMixers = cl.filter((m: any) => m.status !== 'Разгружен' && m.status !== 'Возврат');
        const doneMixers   = cl.filter((m: any) => m.status === 'Разгружен' || m.status === 'Возврат');
        return (
          <div style={{
            position:'fixed',
            left:`${orderTooltip.screenX}px`,
            top:`${orderTooltip.screenY - 12}px`,
            transform:'translateX(-50%) translateY(-100%)',
            background:'#111E2D',
            border:`1px solid ${sc}60`,
            borderTop:`3px solid ${sc}`,
            borderRadius:'12px',
            padding:'12px 16px',
            fontSize:'12px',
            color:'#CBD5E1',
            zIndex:9999,
            pointerEvents:'none',
            whiteSpace:'nowrap',
            boxShadow:'0 8px 32px rgba(0,0,0,0.6)',
            minWidth:'220px',
            maxWidth:'320px',
          }}>
            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
              <span style={{ fontWeight:800, color:'#fff', fontSize:'14px' }}>#{o.id}</span>
              <span style={{
                fontSize:'10px', fontWeight:700, color: sc,
                background:`${sc}22`, padding:'2px 8px', borderRadius:'999px',
              }}>{label}</span>
              {tooltipDelay && (
                <span style={{
                  fontSize:'10px', fontWeight:800, color:'#EF4444',
                  background:'rgba(239,68,68,0.15)', padding:'2px 8px', borderRadius:'999px',
                  border:'1px solid rgba(239,68,68,0.4)',
                }}>⏱ {tooltipDelay.delayText}</span>
              )}
            </div>

            {/* Client & address */}
            <div style={{ color:'#94A3B8', fontSize:'11px', marginBottom:'2px', maxWidth:'280px', overflow:'hidden', textOverflow:'ellipsis' }}>{client}</div>
            {address !== '—' && (
              <div style={{ color:'#6B8BA4', fontSize:'10px', marginBottom:'8px', maxWidth:'280px', overflow:'hidden', textOverflow:'ellipsis' }}>📍 {address}</div>
            )}

            <div style={{ borderTop:'1px solid #1D2E40', margin:'6px 0' }} />

            {/* Grade + volume + time */}
            <div style={{ display:'flex', gap:'16px', marginBottom:'8px' }}>
              <div><span style={{ color:'#4A6080' }}>Марка</span><br/><strong style={{ color:'#E2E8F0' }}>{grade}</strong></div>
              <div><span style={{ color:'#4A6080' }}>Объём</span><br/><strong style={{ color:'#E2E8F0' }}>{v} м³</strong></div>
              <div><span style={{ color:'#4A6080' }}>Время</span><br/><strong style={{ color:'#E2E8F0' }}>{(o.delivery_time||'').slice(0,5)}</strong></div>
            </div>

            {/* Logistics progress */}
            <div style={{ marginBottom:'8px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                <span style={{ color:'#4A6080', fontSize:'11px' }}>Логистика</span>
                <span style={{ color: covColor, fontWeight:700, fontSize:'11px' }}>{av.toFixed(1)} / {v} м³ ({cp}%)</span>
              </div>
              <div style={{ height:'5px', borderRadius:'3px', background:'#1D2E40', overflow:'hidden' }}>
                <div style={{ width:`${cp}%`, height:'100%', background: covColor, transition:'width 0.3s', borderRadius:'3px' }} />
              </div>
            </div>

            {/* Mixers list */}
            {cl.length > 0 && (
              <>
                <div style={{ color:'#4A6080', fontSize:'10px', marginBottom:'4px' }}>
                  Миксеры: {cl.length} шт · активных {activeMixers.length} · завершили {doneMixers.length}
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                  {cl.map((m: any, i: number) => {
                    const mc = MIXER_COLORS[m.status] || '#64748B';
                    return (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                        <div style={{ width:'6px', height:'6px', borderRadius:'50%', background: mc, flexShrink:0 }} />
                        <span style={{ color:'#CBD5E1', fontWeight:600, minWidth:'72px' }}>{m.number || m.mixer_name || '—'}</span>
                        <span style={{ color: mc, fontSize:'10px' }}>{m.status}</span>
                        <span style={{ color:'#4A6080', marginLeft:'auto' }}>{Number(m.volume||0)} м³</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {cl.length === 0 && (
              <div style={{ color:'#3D5570', fontSize:'11px', fontStyle:'italic' }}>Миксеры не назначены</div>
            )}

            {/* Arrow */}
            <div style={{
              position:'absolute', left:'50%', bottom:'-6px',
              transform:'translateX(-50%)',
              width:'10px', height:'6px',
              background:'#111E2D',
              clipPath:'polygon(0 0, 100% 0, 50% 100%)',
            }} />
          </div>
        );
      })()}
    </div>
  );
}
