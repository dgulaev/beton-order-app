'use client';

import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Order } from '../hooks/useCalendarOrders';

interface Props {
  orders: Order[];
  mixerAssignments: any[];
  selectedDateStr: string;
  onOrderClick: (order: Order) => void;
}

const MIXER_COLORS: Record<string, string> = {
  'Загрузка':   '#FACC15',
  'В пути':     '#3B82F6',
  'На объекте': '#10B981',
  'Разгружен':  '#64748B',
  'Возврат':    '#94A3B8',
  'Проблема':   '#EF4444',
};

const ORDER_STATUS_COLORS: Record<string, string> = {
  new:        '#FACC15',
  processing: '#3B82F6',
  completed:  '#10B981',
  cancelled:  '#EF4444',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  new:        'Новая',
  processing: 'В работе',
  completed:  'Выполнена',
  cancelled:  'Отменена',
};

// Adaptive text inside mixer chip based on available width
function chipLabel(num: string, vol: number, w: number): string {
  const volStr = `${vol} м³`;
  if (w >= 88) return `${num} · ${volStr}`;
  if (w >= 54) return volStr;
  if (w >= 30) return `${Math.round(vol)}`;
  return '';
}

export default function VerticalTimelinePanel({
  orders,
  mixerAssignments,
  selectedDateStr,
  onOrderClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(900);
  const [nowTick, setNowTick] = useState(0);

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

  // Tick every minute to move "now" line
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const now = useMemo(() => new Date(), [nowTick]);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const curDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isToday = selectedDateStr === curDateStr;
  const nowTimeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  const toMins = (t: string) => {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return h * 60 + (m || 0);
  };

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

  // Group orders by identical delivery time (same as mobile)
  type OGroup = { time: number; orders: Order[] };
  const groups = useMemo<OGroup[]>(() => {
    const sorted = [...orders].sort((a, b) =>
      toMins(a.delivery_time || '00:00') - toMins(b.delivery_time || '00:00')
    );
    const result: OGroup[] = [];
    sorted.forEach(o => {
      const t = toMins(o.delivery_time || '00:00');
      if (result.length > 0 && result[result.length - 1].time === t) {
        result[result.length - 1].orders.push(o);
      } else {
        result.push({ time: t, orders: [o] });
      }
    });
    return result;
  }, [orders]);

  // Card height (single order row)
  const cardH = (order: Order) =>
    (tripsByOrder[String(order.id)]?.length ?? 0) > 0 ? 78 : 56;

  // Max height of all cards in a group (for gap calculation)
  const groupH = (g: OGroup) =>
    g.orders.reduce((sum, o, i) => sum + cardH(o) + (i > 0 ? 4 : 0), 0);

  // Logarithmic vertical positions (same formula as mobile dashboard)
  const MAX_GAP = 120;
  const TOP_PAD = 8;

  const gPos = useMemo<number[]>(() => {
    const positions: number[] = [];
    groups.forEach((g, i) => {
      if (i === 0) { positions.push(TOP_PAD); return; }
      const prevH  = groupH(groups[i - 1]);
      const dt     = g.time - groups[i - 1].time;
      const logAdd = Math.log(1 + dt / 5) * 12;
      const gap    = Math.min(prevH + 6 + logAdd, MAX_GAP);
      positions.push(positions[i - 1] + gap);
    });
    return positions;
  }, [groups, tripsByOrder]);

  // "Now" line Y position (identical logic to mobile)
  const nowVisualY = useMemo<number | null>(() => {
    if (!isToday || groups.length === 0) return null;
    const afterIdx = groups.findIndex(g => g.time > nowMins);
    const lastH    = groupH(groups[groups.length - 1]);
    const lastP    = gPos[gPos.length - 1] ?? TOP_PAD;
    if (afterIdx === -1) return lastP + lastH + 18;
    if (afterIdx === 0)  return Math.max(0, gPos[0] - Math.min((groups[0].time - nowMins) * 0.5, TOP_PAD));
    const r = (nowMins - groups[afterIdx - 1].time) / (groups[afterIdx].time - groups[afterIdx - 1].time);
    return gPos[afterIdx - 1] + r * (gPos[afterIdx] - gPos[afterIdx - 1]);
  }, [groups, gPos, nowMins, isToday]);

  const lastPos   = gPos[gPos.length - 1] ?? TOP_PAD;
  const lastH     = groups.length > 0 ? groupH(groups[groups.length - 1]) : 56;
  const totalH    = Math.max(
    lastPos + lastH + 24,
    nowVisualY !== null ? nowVisualY + 32 : 0
  );

  // Layout constants
  const TIME_W      = 54;  // time label column width
  const RAIL_X      = 38;  // centre of vertical rail
  const ORDER_W     = 256; // order info card width
  const CHIP_GAP    = 6;
  const LEFT_TOTAL  = TIME_W + 8 + ORDER_W + 12; // 334px
  const CHIPS_AREA  = Math.max(160, containerW - LEFT_TOTAL - 8);

  // Calculate chip pixel widths for an order (relative/proportional, compressed if overflow)
  const getChips = (orderId: string | number) => {
    const trips = tripsByOrder[String(orderId)] || [];
    if (trips.length === 0) return [];
    const vols     = trips.map(m => Math.max(0.5, Number(m.volume || 0)));
    const totalVol = vols.reduce((s, v) => s + v, 0);
    const avail    = CHIPS_AREA - CHIP_GAP * (trips.length - 1);
    const MIN_W    = 34;
    const natural  = vols.map(v => Math.max(MIN_W, (v / totalVol) * avail));
    const totalNat = natural.reduce((s, w) => s + w, 0) + CHIP_GAP * (trips.length - 1);
    const scale    = totalNat > CHIPS_AREA ? CHIPS_AREA / totalNat : 1;
    return trips.map((m, i) => ({ ...m, chipW: Math.max(24, natural[i] * scale) }));
  };

  if (groups.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 40px', color: '#64748B', fontSize: '17px' }}>
        На выбранный день заказов нет
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', minHeight: `${totalH}px` }}>

      {/* Vertical rail */}
      <div style={{
        position: 'absolute',
        left:       `${RAIL_X}px`,
        top:        `${gPos[0] + 14}px`,
        width:      '1px',
        height:     `${Math.max(0, lastPos - gPos[0])}px`,
        background: '#2D3F55',
        zIndex:     1,
      }} />

      {/* "Now" line */}
      {nowVisualY !== null && (
        <div style={{
          position: 'absolute',
          left:       0,
          right:      0,
          top:        `${nowVisualY}px`,
          height:     '2px',
          background: 'linear-gradient(90deg, #4ADE80, rgba(74,222,128,0.15))',
          boxShadow:  '0 0 8px rgba(74,222,128,0.45)',
          zIndex:     20,
          pointerEvents: 'none',
        }}>
          {/* Time badge */}
          <span style={{
            position:   'absolute',
            left:        '2px',
            top:         '-9px',
            fontSize:    '11px',
            fontWeight:  700,
            color:       '#4ADE80',
            background:  '#111C2E',
            padding:     '0 5px',
            borderRadius:'4px',
            lineHeight:  '18px',
            userSelect:  'none',
          }}>
            {nowTimeStr}
          </span>
          {/* Dot on rail */}
          <div style={{
            position:   'absolute',
            left:       `${RAIL_X}px`,
            top:        '-4px',
            width:       '8px',
            height:      '8px',
            borderRadius:'50%',
            background:  '#4ADE80',
            transform:   'translateX(-50%)',
            boxShadow:   '0 0 8px rgba(74,222,128,0.9)',
          }} />
        </div>
      )}

      {/* Order groups */}
      {groups.map((group, gi) => {
        const hiddenByNow = isToday && nowVisualY !== null && Math.abs(nowVisualY - gPos[gi]) < 8;
        const timeStr     = (group.orders[0].delivery_time || '').slice(0, 5);
        const isPastGroup = isToday && group.time < nowMins;

        return (
          <React.Fragment key={gi}>
            {/* Rail dot */}
            <div style={{
              position:   'absolute',
              left:       `${RAIL_X}px`,
              top:        `${gPos[gi] + 14}px`,
              width:       '8px',
              height:      '8px',
              borderRadius:'50%',
              background:  isPastGroup ? '#253448' : '#374E65',
              transform:   'translateX(-50%)',
              zIndex:      3,
            }} />

            {/* Time label */}
            <span style={{
              position:    'absolute',
              left:         0,
              top:          `${gPos[gi] + 11}px`,
              width:        `${RAIL_X - 6}px`,
              textAlign:    'right',
              fontSize:     '11px',
              fontWeight:   700,
              lineHeight:   1,
              color:        isPastGroup ? '#253448' : '#607A93',
              opacity:      hiddenByNow ? 0 : 1,
              transition:   'opacity 0.2s',
              pointerEvents:'none',
              userSelect:   'none',
              zIndex:       4,
            }}>
              {timeStr}
            </span>

            {/* Pre-compute cumulative Y offsets for same-time stacked orders */}
            {(() => {
              const cumOffsets = group.orders.reduce<number[]>((acc, o, i) => {
                if (i === 0) return [0];
                return [...acc, acc[i - 1] + cardH(group.orders[i - 1]) + 4];
              }, []);

              return group.orders.map((order, oi) => {
              const h      = cardH(order);
              const chips  = getChips(order.id);
              const isPast = isToday && order.status !== 'completed' && order.status !== 'cancelled' && group.time < nowMins;
              const sColor = ORDER_STATUS_COLORS[order.status] || '#64748B';
              const sLabel = ORDER_STATUS_LABELS[order.status] || '—';
              const client = (order as any).organization_name || (order as any).full_name || '—';
              const vol    = Number((order as any).volume || 0);
              const assignedVol = chips.reduce((s, m) => s + Number(m.volume || 0), 0);
              const covPct      = vol > 0 ? Math.min(100, Math.round((assignedVol / vol) * 100)) : 0;
              const covColor    = covPct >= 100 ? '#10B981' : covPct > 0 ? '#FACC15' : '#EF444480';

              return (
                <div
                  key={order.id}
                  onClick={() => onOrderClick(order)}
                  style={{
                    position:  'absolute',
                    left:      `${TIME_W + 8}px`,
                    right:      0,
                    top:       `${gPos[gi] + cumOffsets[oi]}px`,
                    height:    `${h}px`,
                    display:   'flex',
                    gap:       '10px',
                    cursor:    'pointer',
                    opacity:    isPast ? 0.5 : 1,
                    transition:'opacity 0.2s',
                  }}
                >
                  {/* Order info card */}
                  <div style={{
                    width:       `${ORDER_W}px`,
                    flexShrink:  0,
                    background:  '#162035',
                    borderRadius:'8px',
                    borderLeft:  `3px solid ${sColor}`,
                    padding:     '8px 10px 6px',
                    display:     'flex',
                    flexDirection:'column',
                    justifyContent:'space-between',
                    overflow:    'hidden',
                  }}>
                    {/* Top: id + client */}
                    <div style={{ display:'flex', alignItems:'center', gap:'6px', minWidth: 0 }}>
                      <span style={{ fontWeight:700, fontSize:'13px', color:'#E2E8F0', flexShrink:0 }}>
                        #{order.id}
                      </span>
                      <span style={{
                        fontSize:'12px', color:'#94A3B8',
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                      }}>
                        {client}
                      </span>
                    </div>
                    {/* Middle: grade + volume + status pill */}
                    <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'11px', color:'#64748B' }}>
                      <span>{(order as any).grade || '—'} · {vol} м³</span>
                      <span style={{
                        marginLeft:'auto', flexShrink:0,
                        fontSize:'10px', fontWeight:600,
                        color: sColor, background:`${sColor}18`,
                        padding:'1px 6px', borderRadius:'999px',
                      }}>
                        {sLabel}
                      </span>
                    </div>
                    {/* Coverage bar */}
                    <div style={{ height:'3px', borderRadius:'2px', background:'#253448', overflow:'hidden' }}>
                      <div style={{
                        width:`${covPct}%`, height:'100%',
                        background: covColor,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                  </div>

                  {/* Mixer chips area */}
                  <div style={{
                    flex:       1,
                    display:    'flex',
                    alignItems: 'center',
                    gap:        `${CHIP_GAP}px`,
                    overflow:   'hidden',
                    minWidth:   0,
                  }}>
                    {chips.length > 0
                      ? chips.map((m, ci) => {
                          const col = MIXER_COLORS[m.status] || '#64748B';
                          const w   = m.chipW;
                          const lbl = chipLabel(m.number || m.mixer_name || '', Number(m.volume || 0), w);
                          return (
                            <div
                              key={ci}
                              title={`${m.number || m.mixer_name} · ${m.volume} м³ · ${m.status || '—'}`}
                              style={{
                                flexShrink:   0,
                                width:        `${w}px`,
                                height:       '28px',
                                borderRadius: '6px',
                                background:   `${col}22`,
                                border:       `1.5px solid ${col}70`,
                                display:      'flex',
                                alignItems:   'center',
                                justifyContent:'center',
                                fontSize:     '11px',
                                fontWeight:   600,
                                color:         col,
                                overflow:     'hidden',
                                whiteSpace:   'nowrap',
                                padding:      '0 5px',
                                transition:   'opacity 0.2s',
                              }}
                            >
                              {lbl}
                            </div>
                          );
                        })
                      : (
                        <div style={{
                          flex:          1,
                          height:        '28px',
                          borderRadius:  '6px',
                          border:        '1.5px dashed #2D3F55',
                          display:       'flex',
                          alignItems:    'center',
                          justifyContent:'center',
                          fontSize:      '12px',
                          color:         '#374E65',
                          userSelect:    'none',
                        }}>
                          Миксеры не назначены
                        </div>
                      )
                    }
                  </div>
                </div>
              );
              }); // end group.orders.map
            })()} {/* end IIFE */}
          </React.Fragment>
        );
      })}
    </div>
  );
}
