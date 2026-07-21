'use client';

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { Order } from '../hooks/useCalendarOrders';

interface Props {
  orders: Order[];
  mixerAssignments: any[];
  selectedDateStr: string;
  onOrderClick: (order: Order) => void;
}

// ── Colors ─────────────────────────────────────────────────────────────────

const MIXER_COLORS: Record<string, string> = {
  'Загрузка':   '#FACC15',
  'В пути':     '#3B82F6',
  'На объекте': '#34D399',
  'Разгружен':  '#64748B',
  'Возврат':    '#94A3B8',
  'Проблема':   '#EF4444',
};

const ORDER_COLORS: Record<string, string> = {
  new:        '#FACC15',
  processing: '#60A5FA',
  completed:  '#34D399',
  cancelled:  '#F87171',
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(900);
  const [nowTick, setNowTick]       = useState(0);
  const [tooltip, setTooltip]       = useState<ChipTooltip | null>(null);

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

  // ── Order / group heights ─────────────────────────────────────────────────
  const cardH = useCallback((order: Order) =>
    (tripsByOrder[String(order.id)]?.length ?? 0) > 0
      ? RULER_H + CHIP_H + 12
      : 56
  , [tripsByOrder]);

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
      const logAdd = Math.log(1 + dt / 5) * 12;
      pos.push(pos[i - 1] + Math.min(prevH + 6 + logAdd, MAX_GAP));
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

      {/* ── Sticky top time ruler (0–24h) ── */}
      <div style={{
        position:    'sticky',
        top:          0,
        zIndex:       30,
        display:     'flex',
        height:      '28px',
        background:  '#0F1826',
        borderBottom:'1px solid #243245',
        marginBottom:'4px',
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
                  bottom:'4px',
                  transform:'translateX(-50%)',
                  fontSize:'10px', fontWeight:700, color:'#4A6080',
                  userSelect:'none', whiteSpace:'nowrap',
                }}>
                  {String(h).padStart(2,'0')}:00
                </span>
              </React.Fragment>
            );
          })}
          {/* current-time tick on ruler */}
          {isToday && (
            <div style={{
              position:'absolute', top:0, bottom:0,
              left:`${(nowMins/1440)*100}%`,
              width:'2px', background:'#4ADE80',
              boxShadow:'0 0 6px rgba(74,222,128,0.7)',
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

        {/* Horizontal "now" line across full width */}
        {nowVisualY !== null && (
          <div style={{
            position:'absolute', left:0, right:0,
            top:`${nowVisualY}px`,
            height:'2px',
            background:'linear-gradient(90deg,#4ADE80,rgba(74,222,128,0.08))',
            boxShadow:'0 0 8px rgba(74,222,128,0.35)',
            zIndex:20, pointerEvents:'none',
          }}>
            <span style={{
              position:'absolute', left:'2px', top:'-9px',
              fontSize:'11px', fontWeight:700, color:'#4ADE80',
              background:'#0F1826', padding:'0 5px',
              borderRadius:'4px', lineHeight:'18px', userSelect:'none',
            }}>{nowStr}</span>
            <div style={{
              position:'absolute', left:`${RAIL_X}px`, top:'-4px',
              width:'8px', height:'8px', borderRadius:'50%',
              background:'#4ADE80', transform:'translateX(-50%)',
              boxShadow:'0 0 8px rgba(74,222,128,0.9)',
            }} />
          </div>
        )}

        {/* Vertical "now" cursor in chips column */}
        {isToday && (
          <div style={{
            position:'absolute',
            left:`${LEFT_TOTAL + (nowMins/1440)*CHIPS_W}px`,
            top:0, bottom:0, width:'1.5px',
            background:'rgba(74,222,128,0.18)',
            zIndex:6, pointerEvents:'none',
          }} />
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
                      gap:`${RIGHT_PAD}px`,
                      cursor:'pointer',
                      opacity: isPast ? 0.5 : 1,
                      transition:'opacity 0.2s',
                    }}
                  >
                    {/* ── Order info card ── */}
                    <div style={{
                      width:`${ORDER_W}px`,
                      flexShrink:0,
                      background:`${sColor}1A`,
                      border:`1px solid ${sColor}38`,
                      borderLeft:`3px solid ${sColor}`,
                      borderRadius:'8px',
                      padding:'8px 10px 6px',
                      display:'flex',
                      flexDirection:'column',
                      justifyContent:'space-between',
                      overflow:'hidden',
                    }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'6px', minWidth:0 }}>
                        <span style={{ fontWeight:700, fontSize:'13px', color:'#F1F5F9', flexShrink:0 }}>
                          #{order.id}
                        </span>
                        <span style={{
                          fontSize:'12px', color:'#CBD5E1',
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                        }}>{client}</span>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'11px', color:'#7A99B8' }}>
                        <span>{(order as any).grade||'—'} · {vol} м³</span>
                        <span style={{
                          marginLeft:'auto', flexShrink:0,
                          fontSize:'10px', fontWeight:600,
                          color: sColor, background:`${sColor}20`,
                          padding:'1px 6px', borderRadius:'999px',
                        }}>{sLabel}</span>
                      </div>
                      {/* Coverage bar */}
                      <div style={{ height:'3px', borderRadius:'2px', background:'#1D2E40', overflow:'hidden' }}>
                        <div style={{
                          width:`${covPct}%`, height:'100%',
                          background:covColor, transition:'width 0.4s ease',
                        }} />
                      </div>
                    </div>

                    {/* ── Chips area ── */}
                    <div style={{ flex:1, position:'relative', overflow:'hidden', minWidth:0 }}>
                      {hasChips ? (
                        <>
                          {/* Mini time ruler at top of chips row */}
                          <div style={{
                            position:'absolute', top:0, left:0, right:0,
                            height:`${RULER_H}px`,
                            borderBottom:'1px solid #1D2E40',
                          }}>
                            {RULER_HOURS.map(rh => (
                              <React.Fragment key={rh}>
                                <div style={{
                                  position:'absolute',
                                  left:`${(rh/24)*100}%`,
                                  top:0, height:`${RULER_H}px`,
                                  width:'1px',
                                  background:'#1D2E40',
                                }} />
                                <span style={{
                                  position:'absolute',
                                  left:`${(rh/24)*100}%`,
                                  bottom:'2px',
                                  transform:'translateX(-50%)',
                                  fontSize:'8px', fontWeight:600,
                                  color:'#2E4055',
                                  userSelect:'none', whiteSpace:'nowrap',
                                }}>
                                  {String(rh).padStart(2,'0')}
                                </span>
                              </React.Fragment>
                            ))}
                            {/* "Now" tick on mini ruler */}
                            {isToday && (
                              <div style={{
                                position:'absolute',
                                left:`${(nowMins/1440)*100}%`,
                                top:0, bottom:0, width:'1.5px',
                                background:'rgba(74,222,128,0.45)',
                              }} />
                            )}
                          </div>

                          {/* Mixer chips */}
                          {chipLayout.map((chip, ci) => {
                            const col  = MIXER_COLORS[chip.status] || '#64748B';
                            const cW   = chip.chipW;
                            const bigText = cW >= 80;
                            return (
                              <div
                                key={ci}
                                style={{
                                  position:'absolute',
                                  left:`${chip.chipX}px`,
                                  top:`${RULER_H + 4}px`,
                                  width:`${cW}px`,
                                  height:`${CHIP_H}px`,
                                  borderRadius:'7px',
                                  background:`${col}28`,
                                  border:`1.5px solid ${col}`,
                                  display:'flex',
                                  flexDirection:'column',
                                  alignItems:'center',
                                  justifyContent:'center',
                                  gap:'2px',
                                  overflow:'hidden',
                                  padding:'3px 5px',
                                  boxSizing:'border-box',
                                  cursor:'default',
                                  transition:'filter 0.15s',
                                  boxShadow:`0 2px 8px ${col}30`,
                                }}
                                onMouseEnter={e => {
                                  e.currentTarget.style.filter = 'brightness(1.3)';
                                  const r = e.currentTarget.getBoundingClientRect();
                                  setTooltip({ screenX: r.left + r.width/2, screenY: r.top, data: chip });
                                }}
                                onMouseLeave={e => {
                                  e.currentTarget.style.filter = '';
                                  setTooltip(null);
                                }}
                              >
                                <span style={{
                                  fontSize: bigText ? '11px' : '9px',
                                  fontWeight:700, color:'#F1F5F9',
                                  lineHeight:1.2, textAlign:'center',
                                  whiteSpace:'nowrap', overflow:'hidden',
                                  textOverflow:'ellipsis', maxWidth:'100%',
                                }}>
                                  {chip.number || chip.mixer_name || '—'}
                                </span>
                                <span style={{
                                  fontSize: bigText ? '10px' : '9px',
                                  fontWeight:600, color: col,
                                  lineHeight:1.2, textAlign:'center',
                                  whiteSpace:'nowrap',
                                }}>
                                  {Number(chip.volume||0)} м³
                                </span>
                              </div>
                            );
                          })}
                        </>
                      ) : (
                        <div style={{
                          position:'absolute', left:0, right:0,
                          top:`${RULER_H + 4}px`, height:`${CHIP_H}px`,
                          border:'1.5px dashed #1D2E40', borderRadius:'8px',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:'12px', color:'#263448', userSelect:'none',
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
            borderBottom:'none',
          }} />
        </div>
      )}
    </div>
  );
}
