'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { COLORS, inputStyle, ghostButton, primaryButton, pillStyle } from '../labStyles';
import PassportModal from './PassportModal';

type StatusKey = 'all' | 'new' | 'processing' | 'completed' | 'cancelled';

interface Props {
  orders: any[];
  loading: boolean;
  /** идёт подгрузка месяца при переключении недель */
  monthLoading: boolean;
  /** id заявок, пришедших по realtime и ещё не просмотренных лаборантом */
  newOrderIds: Set<string>;
  /** id заказов, для которых уже есть паспорт */
  passportOrderIds: Set<string>;
  /** orderId → { '7': result, '28': result } */
  testSummary?: Map<string, Record<string, string>>;
  /** гарантировать загрузку заявок за нужный месяц (year, month 1-based) */
  onEnsureMonth: (year: number, month: number) => void;
  onAcknowledge: (id: string) => void;
  onAcknowledgeAll: () => void;
  /** паспорт по заказу сохранён — отметить заказ как «с паспортом» */
  onPassportSaved: (orderId: number | null) => void;
  /** перейти на вкладку «Испытания» */
  onOpenTests?: () => void;
}

const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  new: { label: 'Новая', bg: '#FACC1520', color: '#FACC15' },
  processing: { label: 'В работе', bg: '#3B82F620', color: '#3B82F6' },
  completed: { label: 'Выполнена', bg: '#10B98120', color: '#10B981' },
  cancelled: { label: 'Отменена', bg: '#EF444420', color: '#EF4444' },
};

const STATUS_FILTERS: { key: StatusKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'new', label: 'Новые' },
  { key: 'processing', label: 'В работе' },
  { key: 'completed', label: 'Выполнены' },
  { key: 'cancelled', label: 'Отменены' },
];

function localDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function orderDateStr(o: any): string {
  if (!o?.delivery_date) return '';
  return String(o.delivery_date).substring(0, 10);
}

function fmtTime(t?: string) {
  return t ? String(t).slice(0, 5) : '';
}

/** Элегантная пилюля испытания: «7 сут» / «28 сут» */
function TestBadge({ days, result, onClick }: { days: '7' | '28'; result: string; onClick?: () => void }) {
  const cfg = {
    pass:    { bg: days === '7' ? 'rgba(250,204,21,0.15)'  : 'rgba(16,185,129,0.15)',  border: days === '7' ? 'rgba(250,204,21,0.5)'  : 'rgba(16,185,129,0.5)',  color: days === '7' ? '#FDE047' : '#34D399' },
    fail:    { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.45)',  color: '#F87171' },
    pending: { bg: 'rgba(100,116,139,0.15)', border: 'rgba(100,116,139,0.4)', color: '#94A3B8' },
  }[result] || { bg: 'rgba(100,116,139,0.15)', border: 'rgba(100,116,139,0.4)', color: '#94A3B8' };

  const icon = result === 'pass' ? '✓' : result === 'fail' ? '✕' : '◎';

  return (
    <button
      onClick={onClick}
      title={`Испытание ${days} суток — ${result === 'pass' ? 'соответствует' : result === 'fail' ? 'не соответствует' : 'ожидает'}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '3px 9px',
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: '9999px',
        color: cfg.color,
        fontSize: '12px',
        fontWeight: 700,
        cursor: onClick ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
        transition: 'filter 0.15s',
      }}
      onMouseEnter={e => onClick && (e.currentTarget.style.filter = 'brightness(1.2)')}
      onMouseLeave={e => (e.currentTarget.style.filter = '')}
    >
      <span style={{ fontSize: '10px' }}>{icon}</span>
      {days} сут
    </button>
  );
}

export default function OrdersTab({
  orders,
  loading,
  monthLoading,
  newOrderIds,
  passportOrderIds,
  testSummary,
  onEnsureMonth,
  onAcknowledge,
  onAcknowledgeAll,
  onPassportSaved,
  onOpenTests,
}: Props) {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [statusFilter, setStatusFilter] = useState<StatusKey>('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [passportOrder, setPassportOrder] = useState<any>(null);

  const selectedStr = localDateStr(selectedDate);
  const todayStr = localDateStr(new Date());

  // ==================== НЕДЕЛЯ (ПН–ВС) ====================
  const weekDays = useMemo(() => {
    const current = new Date(selectedDate);
    const dow = current.getDay(); // 0=вс
    const diff = current.getDate() - dow + (dow === 0 ? -6 : 1);
    const monday = new Date(current);
    monday.setDate(diff);
    monday.setHours(12, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }, [selectedDate]);

  // Подгружаем месяцы, попавшие в видимую неделю (неделя может пересекать 2 месяца).
  useEffect(() => {
    const months = new Set<string>();
    weekDays.forEach((d) => months.add(`${d.getFullYear()}-${d.getMonth() + 1}`));
    months.forEach((key) => {
      const [y, m] = key.split('-').map(Number);
      onEnsureMonth(y, m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekDays]);

  const countForDate = (d: Date) => {
    const ds = localDateStr(d);
    return orders.filter((o) => orderDateStr(o) === ds && o.status !== 'cancelled').length;
  };
  const cancelledForDate = (d: Date) => {
    const ds = localDateStr(d);
    return orders.filter((o) => orderDateStr(o) === ds && o.status === 'cancelled').length;
  };

  // Заявки выбранного дня + фильтры.
  const dayOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders
      .filter((o) => orderDateStr(o) === selectedStr)
      .filter((o) => statusFilter === 'all' || o.status === statusFilter)
      .filter((o) => {
        if (!q) return true;
        const client = `${o.organization_name || ''} ${o.full_name || ''}`.toLowerCase();
        return (
          client.includes(q) ||
          String(o.id).includes(q) ||
          String(o.grade || '').toLowerCase().includes(q) ||
          String(o.inn || '').includes(q)
        );
      })
      .sort((a, b) => {
        const aNew = newOrderIds.has(String(a.id)) ? 1 : 0;
        const bNew = newOrderIds.has(String(b.id)) ? 1 : 0;
        if (aNew !== bNew) return bNew - aNew;
        return (a.delivery_time || '00:00').localeCompare(b.delivery_time || '00:00');
      });
  }, [orders, selectedStr, statusFilter, search, newOrderIds]);

  // KPI выбранного дня
  const activeDay = dayOrders.filter((o) => o.status !== 'cancelled');
  const totalVolume = activeDay.reduce((s, o) => s + (Number(o.volume) || 0), 0);
  const doneVolume = activeDay.filter((o) => o.status === 'completed').reduce((s, o) => s + (Number(o.volume) || 0), 0);

  // ==================== ЛАБОРАТОРНАЯ СТАТИСТИКА ЗА НЕДЕЛЮ ====================
  // Считаем по активным (не отменённым) заявкам недели: контроль паспортов —
  // основная задача лаборанта, объём бетона и разбивка по маркам — что именно
  // предстоит контролировать/испытывать.
  const weekStats = useMemo(() => {
    const dayset = new Set(weekDays.map(localDateStr));
    const active = orders.filter((o) => dayset.has(orderDateStr(o)) && o.status !== 'cancelled');
    const totalVol = active.reduce((s, o) => s + (Number(o.volume) || 0), 0);
    const withPassport = active.filter((o) => passportOrderIds.has(String(o.id))).length;
    const completed = active.filter((o) => o.status === 'completed').length;

    const gradeMap = new Map<string, { count: number; vol: number }>();
    active.forEach((o) => {
      const g = String(o.grade || '—').trim() || '—';
      const cur = gradeMap.get(g) || { count: 0, vol: 0 };
      cur.count += 1;
      cur.vol += Number(o.volume) || 0;
      gradeMap.set(g, cur);
    });
    const grades = [...gradeMap.entries()].sort((a, b) => b[1].count - a[1].count);

    return {
      total: active.length,
      totalVol,
      withPassport,
      pendingPassport: active.length - withPassport,
      completed,
      grades,
      passportPct: active.length > 0 ? Math.round((withPassport / active.length) * 100) : 0,
    };
  }, [orders, weekDays, passportOrderIds]);

  const openPassport = (order: any) => {
    onAcknowledge(String(order.id));
    setPassportOrder(order);
  };

  const goWeek = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta * 7);
    setSelectedDate(d);
  };

  // ==================== АДАПТИВНАЯ ВЫСОТА КОЛОНКИ ====================
  // Каркас админки масштабируется через transform: scale(0.80–0.84) (см. layout.tsx),
  // поэтому CSS-px (height, 100vh, clientHeight) и визуальные px (getBoundingClientRect,
  // innerHeight) РАЗЛИЧАЮТСЯ. Чтобы колонка ровно доставала до низа экрана с
  // небольшим отступом на любом разрешении (4K/1920/ниже) — считаем всё в CSS-px:
  //  scale выводим из отношения rect.width/offsetWidth, доступную высоту берём из
  //  clientHeight скролл-контейнера (это CSS-px, уже «до» масштабирования).
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowMinH, setRowMinH] = useState<number | undefined>(undefined);
  const [colMaxH, setColMaxH] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const recompute = () => {
      let sc: HTMLElement | null = el.parentElement;
      while (sc && sc !== document.body) {
        const oy = getComputedStyle(sc).overflowY;
        if (oy === 'auto' || oy === 'scroll') break;
        sc = sc.parentElement;
      }
      if (!sc) return;
      const rect = el.getBoundingClientRect();
      const scale = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
      if (!scale || !isFinite(scale)) return;
      // Позиция верха строки внутри скролл-контейнера, в CSS-px.
      const topCss = (rect.top - sc.getBoundingClientRect().top) / scale + sc.scrollTop;
      const availCss = sc.clientHeight; // CSS-px (до масштабирования)
      // Зазор снизу учитывает нижний паддинг страницы (24px) + небольшой запас,
      // чтобы не появлялся лишний скролл из-за округлений.
      const gapCss = 44; // визуально ≈ gapCss * scale
      setRowMinH(Math.max(360, Math.round(availCss - topCss - gapCss)));
      setColMaxH(Math.max(360, Math.round(availCss - 40)));
    };
    recompute();
    window.addEventListener('resize', recompute);
    const t = setTimeout(recompute, 200);
    return () => {
      window.removeEventListener('resize', recompute);
      clearTimeout(t);
    };
  }, []);

  return (
    <div style={{ color: '#fff' }}>
      <style>{`
        @keyframes labNewPulse {
          0%   { box-shadow: 0 0 0 0 rgba(74,222,128,0.5); }
          70%  { box-shadow: 0 0 0 8px rgba(74,222,128,0); }
          100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); }
        }
        @keyframes labDotBlink { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        .lab-new-card { animation: labNewPulse 2s infinite; }
        .lab-new-dot  { animation: labDotBlink 1s infinite; }
        .lab-clamp1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      `}</style>

      <div ref={rowRef} style={{ display: 'flex', gap: '20px', alignItems: 'stretch' }}>
        {/* ==================== ЛЕВАЯ КОЛОНКА — НЕДЕЛЯ + СТАТИСТИКА ====================
            Sticky-колонка: растягивается по высоте строки (alignSelf: stretch),
            но НЕ выше вьюпорта — maxHeight ограничивает её, чтобы на любом
            разрешении (4K/1920/ниже) она не вылезала за нижний край экрана и не
            создавала лишний скролл страницы. Отступ снизу 16px. Дни+статистика
            прокручиваются внутри, если не помещаются. */}
        <div style={{ width: '320px', flexShrink: 0, position: 'sticky', top: '16px', height: rowMinH ? `${rowMinH}px` : 'calc(100vh - 118px)', maxHeight: colMaxH ? `${colMaxH}px` : 'calc(100vh - 32px)', background: COLORS.card, borderRadius: '18px', padding: '18px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <h3 style={{ margin: '0 0 12px', color: COLORS.muted, fontSize: '14px', letterSpacing: '0.03em' }}>ЗАЯВКИ НА НЕДЕЛЮ</h3>

          {/* Навигация по неделям */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '10px' }}>
            <button onClick={() => goWeek(-1)} style={{ background: 'none', border: 'none', color: COLORS.muted, fontSize: '26px', cursor: 'pointer', padding: '2px 10px', userSelect: 'none' }}>←</button>
            <div style={{ fontWeight: 700, fontSize: '16px', textAlign: 'center', flex: 1, whiteSpace: 'nowrap' }}>
              {selectedDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
            </div>
            <button onClick={() => goWeek(1)} style={{ background: 'none', border: 'none', color: COLORS.muted, fontSize: '26px', cursor: 'pointer', padding: '2px 10px', userSelect: 'none' }}>→</button>
          </div>

          {/* Прокручиваемая область: дни + статистика (адаптив по высоте) */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', marginRight: '-8px', paddingRight: '8px', display: 'flex', flexDirection: 'column' }}>
          {/* Дни недели */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {weekDays.map((d) => {
              const ds = localDateStr(d);
              const isSelected = ds === selectedStr;
              const isToday = ds === todayStr;
              const count = countForDate(d);
              const cancelled = cancelledForDate(d);
              return (
                <div
                  key={ds}
                  onClick={() => setSelectedDate(new Date(d))}
                  style={{
                    padding: '11px 14px',
                    background: isSelected ? 'rgba(59,130,246,0.15)' : COLORS.input,
                    borderRadius: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: isSelected ? '2px solid #3B82F6' : '2px solid transparent',
                    transition: 'all 0.15s ease',
                    userSelect: 'none',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap' }}>
                    {d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {isToday && <span style={{ color: COLORS.blue, marginLeft: '6px' }}>●</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {cancelled > 0 && (
                      <span style={{ background: '#EF444420', color: '#EF4444', padding: '2px 8px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600 }}>-{cancelled}</span>
                    )}
                    <span style={{ background: '#334155', color: '#CBD5E1', padding: '2px 10px', borderRadius: '9999px', fontSize: '13px', fontWeight: 600, minWidth: '24px', textAlign: 'center' }}>{count}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ==================== СТАТИСТИКА ЛАБОРАТОРИИ ЗА НЕДЕЛЮ ==================== */}
          <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: `1px solid ${COLORS.border}`, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ color: COLORS.muted, fontWeight: 700, fontSize: '13px', letterSpacing: '0.03em' }}>СТАТИСТИКА ЗА НЕДЕЛЮ</div>

            {/* Контроль паспортов — основная задача лаборанта */}
            <div style={{ background: COLORS.input, borderRadius: '12px', padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                <span style={{ color: COLORS.muted, fontSize: '13px', fontWeight: 600 }}>Паспорта качества</span>
                <span style={{ fontSize: '13px', fontWeight: 700, color: weekStats.passportPct === 100 ? COLORS.accent : '#FACC15' }}>{weekStats.passportPct}%</span>
              </div>
              <div style={{ height: '8px', background: '#0F172A', borderRadius: '9999px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{ width: `${weekStats.passportPct}%`, height: '100%', background: weekStats.passportPct === 100 ? COLORS.accent : '#FACC15', borderRadius: '9999px', transition: 'width 0.3s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: '#CBD5E1' }}>
                <span>Оформлено: <strong style={{ color: '#fff' }}>{weekStats.withPassport}</strong></span>
                <span>Осталось: <strong style={{ color: weekStats.pendingPassport > 0 ? '#FACC15' : COLORS.accent }}>{weekStats.pendingPassport}</strong></span>
              </div>
            </div>

            {/* Объём и заявки */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1, background: COLORS.input, borderRadius: '12px', padding: '12px 14px' }}>
                <div style={{ color: COLORS.muted, fontSize: '12px', marginBottom: '4px' }}>Объём бетона</div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: COLORS.accent }}>{Math.round(weekStats.totalVol)} <span style={{ fontSize: '12px', color: COLORS.muted }}>м³</span></div>
              </div>
              <div style={{ flex: 1, background: COLORS.input, borderRadius: '12px', padding: '12px 14px' }}>
                <div style={{ color: COLORS.muted, fontSize: '12px', marginBottom: '4px' }}>Заявок</div>
                <div style={{ fontSize: '20px', fontWeight: 700 }}>{weekStats.total}</div>
              </div>
            </div>

            {/* Марки недели — что предстоит контролировать/испытывать */}
            <div style={{ background: COLORS.input, borderRadius: '12px', padding: '12px 14px' }}>
              <div style={{ color: COLORS.muted, fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>Марки недели</div>
              {weekStats.grades.length === 0 ? (
                <div style={{ color: COLORS.muted, fontSize: '12.5px', fontStyle: 'italic' }}>Нет данных</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {weekStats.grades.slice(0, 6).map(([grade, info]) => {
                    const maxCount = weekStats.grades[0][1].count || 1;
                    const pct = Math.round((info.count / maxCount) * 100);
                    return (
                      <div key={grade}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '4px' }}>
                          <span className="lab-clamp1" style={{ color: COLORS.blue, fontWeight: 600, maxWidth: '170px' }} title={grade}>{grade}</span>
                          <span style={{ color: '#CBD5E1' }}>{info.count} • {Math.round(info.vol)} м³</span>
                        </div>
                        <div style={{ height: '5px', background: '#0F172A', borderRadius: '9999px', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'rgba(96,165,250,0.7)', borderRadius: '9999px' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          </div>
        </div>

        {/* ==================== ПРАВАЯ КОЛОНКА — ЗАЯВКИ ДНЯ ==================== */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
              Заявки на {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              {monthLoading && <span style={{ color: COLORS.muted, fontSize: '13px' }}>загрузка…</span>}
              {newOrderIds.size > 0 && (
                <span style={{ ...pillStyle('rgba(74,222,128,0.15)', COLORS.accent) }} className="lab-new-dot">{newOrderIds.size} новых</span>
              )}
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px', color: COLORS.muted, fontSize: '14px' }}>
              {newOrderIds.size > 0 && (
                <button onClick={onAcknowledgeAll} style={ghostButton}>Отметить все просмотренными</button>
              )}
              <span>Объём: <strong style={{ color: '#fff' }}>{Math.round(doneVolume)}</strong> / {Math.round(totalVolume)} м³</span>
              <span>Доставок: <strong style={{ color: '#fff' }}>{activeDay.length}</strong></span>
            </div>
          </div>

          {/* Поиск + фильтры + вид */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
            <input
              placeholder="Поиск по клиенту, №, марке, ИНН..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputStyle, width: '300px' }}
            />
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStatusFilter(f.key)}
                  style={{
                    padding: '10px 16px',
                    background: 'transparent',
                    border: 'none',
                    color: statusFilter === f.key ? '#10B981' : '#64748B',
                    fontSize: '15px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
              <button onClick={() => setViewMode('list')} style={{ padding: '8px 14px', background: 'transparent', border: 'none', color: viewMode === 'list' ? '#10B981' : '#64748B', fontSize: '15px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '20px', lineHeight: 1 }}>≡</span> Список
              </button>
              <button onClick={() => setViewMode('grid')} style={{ padding: '8px 14px', background: 'transparent', border: 'none', color: viewMode === 'grid' ? '#10B981' : '#64748B', fontSize: '15px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '18px' }}>▦</span> Плитка
              </button>
            </div>
          </div>

          {/* Список/плитка заявок дня */}
          {loading ? (
            <p style={{ color: COLORS.muted }}>Загрузка заявок...</p>
          ) : dayOrders.length === 0 ? (
            <div style={{ background: COLORS.card, borderRadius: '16px', padding: '48px 24px', textAlign: 'center', color: COLORS.muted }}>
              На этот день заявок нет.
            </div>
          ) : viewMode === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', alignItems: 'stretch' }}>
              {dayOrders.map((o) => {
                const isNew = newOrderIds.has(String(o.id));
                const hasPassport = passportOrderIds.has(String(o.id));
                const sm = STATUS_META[o.status] || { label: o.status || '—', bg: '#334155', color: '#E2E8F0' };
                const client = o.organization_name || o.full_name || 'Без названия';
                const tests = testSummary?.get(String(o.id));
                return (
                  <div
                    key={o.id}
                    className={isNew ? 'lab-new-card' : undefined}
                    style={{
                      padding: '14px',
                      borderRadius: '14px',
                      border: isNew ? `1px solid ${COLORS.accent}` : `1px solid #3B4A63`,
                      background: isNew ? 'rgba(74,222,128,0.08)' : '#2A3852',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '15px', fontWeight: 700 }}>№{o.id}</span>
                        <span style={{ color: COLORS.muted, fontSize: '13px' }}>{fmtTime(o.delivery_time)}</span>
                        {isNew && <span style={{ ...pillStyle('rgba(74,222,128,0.18)', COLORS.accent), padding: '2px 8px', fontSize: '11.5px' }} className="lab-new-dot">● Новая</span>}
                      </div>
                      <span style={{ ...pillStyle(sm.bg, sm.color), padding: '3px 10px', fontSize: '12px' }}>{sm.label}</span>
                    </div>
                    <div className="lab-clamp1" style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }} title={client}>{client}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                      <span style={{ ...pillStyle('rgba(96,165,250,0.15)', COLORS.blue), padding: '3px 10px', fontSize: '12.5px' }}>{o.grade || '—'}</span>
                      <span style={{ fontSize: '17px', fontWeight: 700, color: COLORS.accent }}>{o.volume ?? '—'} м³</span>
                      {hasPassport && <span title="Паспорт оформлен" style={{ marginLeft: 'auto', color: COLORS.accent, fontSize: '13px', fontWeight: 700 }}>✓ паспорт</span>}
                    </div>
                    {/* Бейджи испытаний */}
                    {tests && (tests['7'] || tests['28']) && (
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                        {tests['7']  && <TestBadge days="7"  result={tests['7']}  onClick={onOpenTests} />}
                        {tests['28'] && <TestBadge days="28" result={tests['28']} onClick={onOpenTests} />}
                      </div>
                    )}
                    <div className="lab-clamp1" style={{ fontSize: '12.5px', color: '#CBD5E1', marginBottom: '12px' }} title={o.address || ''}>{o.address || '—'}</div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                      <button onClick={() => openPassport(o)} style={{ ...primaryButton(), flex: 1, justifyContent: 'center', padding: '9px 14px', fontSize: '13.5px' }}>
                        {hasPassport ? 'Паспорт' : 'Оформить паспорт'}
                      </button>
                      {isNew && <button onClick={() => onAcknowledge(String(o.id))} style={{ ...ghostButton, padding: '9px 14px' }} title="Просмотрено">✓</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ background: COLORS.card, borderRadius: '16px', overflow: 'hidden' }}>
              {dayOrders.map((o, idx) => {
                const isNew = newOrderIds.has(String(o.id));
                const hasPassport = passportOrderIds.has(String(o.id));
                const sm = STATUS_META[o.status] || { label: o.status || '—', bg: '#334155', color: '#E2E8F0' };
                const client = o.organization_name || o.full_name || 'Без названия';
                const tests = testSummary?.get(String(o.id));
                return (
                  <div
                    key={o.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      padding: '11px 18px',
                      borderBottom: idx < dayOrders.length - 1 ? `1px solid ${COLORS.border}` : 'none',
                      borderLeft: isNew ? `3px solid ${COLORS.accent}` : '3px solid transparent',
                      background: isNew ? 'rgba(74,222,128,0.06)' : 'transparent',
                    }}
                  >
                    <div style={{ width: '58px', fontWeight: 700, fontSize: '14px' }}>{fmtTime(o.delivery_time) || '—'}</div>
                    <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                      <div className="lab-clamp1" style={{ fontWeight: 600, fontSize: '14.5px' }}>
                        №{o.id} — {client}
                        {isNew && <span className="lab-new-dot" style={{ color: COLORS.accent, marginLeft: '8px', fontSize: '12px' }}>● Новая</span>}
                      </div>
                      <div style={{ color: COLORS.muted, fontSize: '13px' }}>{o.grade || '—'} • {o.volume ?? '—'} м³</div>
                    </div>
                    {/* Бейджи испытаний в строке */}
                    {tests && (
                      <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                        {tests['7']  && <TestBadge days="7"  result={tests['7']}  onClick={onOpenTests} />}
                        {tests['28'] && <TestBadge days="28" result={tests['28']} onClick={onOpenTests} />}
                      </div>
                    )}
                    {hasPassport && <span title="Паспорт оформлен" style={{ color: COLORS.accent, fontSize: '13px', fontWeight: 700, flexShrink: 0 }}>✓</span>}
                    <span style={{ ...pillStyle(sm.bg, sm.color), padding: '4px 12px', fontSize: '12.5px', flexShrink: 0 }}>{sm.label}</span>
                    <button onClick={() => openPassport(o)} style={{ ...primaryButton(), padding: '8px 16px', fontSize: '13.5px', flexShrink: 0 }}>
                      {hasPassport ? 'Паспорт' : 'Оформить паспорт'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {passportOrder && (
        <PassportModal
          orderId={Number(passportOrder.id)}
          onClose={() => setPassportOrder(null)}
          onSaved={onPassportSaved}
        />
      )}
    </div>
  );
}
