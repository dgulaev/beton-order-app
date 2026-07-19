'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MobileCalendarProps {
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  allOrders: any[];
  onClose: () => void;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKEND_IDX = new Set([5, 6]); // Сб, Вс (0-based в нашей сетке)

export default function MobileCalendar({
  selectedDate,
  setSelectedDate,
  allOrders,
  onClose,
}: MobileCalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState(selectedDate.getMonth());
  const [currentYear, setCurrentYear] = React.useState(selectedDate.getFullYear());

  const today = new Date();

  const jsFirstDay = new Date(currentYear, currentMonth, 1).getDay();
  const firstDay = jsFirstDay === 0 ? 6 : jsFirstDay - 1;
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  const ordersByDate = React.useMemo(() => {
    const map = new Map<string, any[]>();
    allOrders.forEach(order => {
      if (order.delivery_date) {
        const key = order.delivery_date.substring(0, 10);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(order);
      }
    });
    return map;
  }, [allOrders]);

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };

  const goToday = () => {
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
  };

  const handleDayClick = (day: number) => {
    setSelectedDate(new Date(currentYear, currentMonth, day));
    onClose();
  };

  // Строим сетку: null для пустых ячеек
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);

  const isCurrentMonth =
    currentMonth === today.getMonth() && currentYear === today.getFullYear();

  const monthLabel = new Date(currentYear, currentMonth).toLocaleString('ru-RU', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div style={{ padding: '0 16px 8px' }}>

      {/* ── Навигация по месяцам ───────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <button onClick={prevMonth} style={navBtn}>
          <ChevronLeft size={18} color="#64748B" />
        </button>

        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: '17px', fontWeight: 700, color: '#E2E8F0', textTransform: 'capitalize' }}>
            {monthLabel}
          </div>
        </div>

        {!isCurrentMonth && (
          <button onClick={goToday} style={{ ...navBtn, width: 'auto', padding: '0 12px', fontSize: '12px', fontWeight: 600, color: '#10B981', border: '1px solid #10B98140' }}>
            Сегодня
          </button>
        )}

        <button onClick={nextMonth} style={navBtn}>
          <ChevronRight size={18} color="#64748B" />
        </button>
      </div>

      {/* ── Заголовки дней недели ─────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: '6px' }}>
        {WEEKDAYS.map((d, i) => (
          <div key={d} style={{
            textAlign: 'center',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: WEEKEND_IDX.has(i) ? '#EF444460' : '#475569',
            paddingBottom: '4px',
          }}>
            {d}
          </div>
        ))}
      </div>

      {/* ── Сетка дней ───────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} />;

          const colIdx = idx % 7;
          const isWeekend = WEEKEND_IDX.has(colIdx);
          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayOrders = ordersByDate.get(dateStr) || [];
          const hasOrders = dayOrders.length > 0;
          const totalVol = dayOrders.reduce((s: number, o: any) => s + Number(o.volume || 0), 0);
          const completedCount = dayOrders.filter((o: any) => o.status === 'completed').length;
          const allDone = hasOrders && completedCount === dayOrders.length;

          const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
          const isSelected = day === selectedDate.getDate() && currentMonth === selectedDate.getMonth() && currentYear === selectedDate.getFullYear();

          let bg = '#131C2B';
          if (isSelected) bg = '#2563EB';
          else if (isToday) bg = '#10B98120';
          else if (hasOrders) bg = '#1E2D40';

          let dayColor = '#E2E8F0';
          if (isSelected) dayColor = '#fff';
          else if (isWeekend) dayColor = '#F87171';
          else if (!hasOrders) dayColor = '#475569';

          return (
            <button
              key={idx}
              onClick={() => handleDayClick(day)}
              style={{
                height: '56px',
                borderRadius: '12px',
                border: isToday && !isSelected ? '1.5px solid #10B981' : isSelected ? 'none' : '1px solid transparent',
                background: bg,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '2px',
                padding: '4px 2px',
                position: 'relative',
                transition: 'opacity 0.15s',
              }}
            >
              <span style={{ fontSize: '15px', fontWeight: isToday || isSelected ? 700 : 500, color: dayColor, lineHeight: 1 }}>
                {day}
              </span>

              {hasOrders && (
                <span style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  color: isSelected ? '#ffffff99' : allDone ? '#10B981' : '#60A5FA',
                  lineHeight: 1,
                }}>
                  {dayOrders.length}×{totalVol % 1 === 0 ? totalVol : totalVol.toFixed(1)}м³
                </span>
              )}

              {/* точка-индикатор внизу ячейки */}
              {hasOrders && (
                <span style={{
                  position: 'absolute',
                  bottom: '4px',
                  width: '4px',
                  height: '4px',
                  borderRadius: '50%',
                  background: allDone ? '#10B981' : '#3B82F6',
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Легенда ──────────────────────── */}
      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '18px', paddingTop: '14px', borderTop: '1px solid #1E2937' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#475569' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3B82F6', display: 'inline-block' }} />
          Заявки
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#475569' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
          Выполнено
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#475569' }}>
          <span style={{ width: '12px', height: '12px', borderRadius: '3px', border: '1.5px solid #10B981', display: 'inline-block' }} />
          Сегодня
        </div>
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  background: '#1E2937',
  border: 'none',
  borderRadius: '10px',
  width: '36px',
  height: '36px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  flexShrink: 0,
};
