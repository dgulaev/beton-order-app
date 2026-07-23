'use client';

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CARD_BORDER, volumeCardSoftStyle, volumeCardStyle, volumeModalStyle } from '@/app/adminCifra/cardStyles';

interface MobileCalendarProps {
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  allOrders: any[];
  onClose: () => void;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKEND_IDX = new Set([5, 6]); // Сб, Вс (0-based в нашей сетке)

// Официальные нерабочие праздничные дни РФ (фиксированные даты по ТК РФ).
const RUSSIAN_HOLIDAYS: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8],
  [1, 23], [2, 8], [4, 1], [4, 9], [5, 12], [10, 4],
];
const isRussianHoliday = (month: number, day: number): boolean =>
  RUSSIAN_HOLIDAYS.some(([hM, hD]) => hM === month && hD === day);

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
    <div style={volumeCardStyle({ padding: '12px 16px 8px', borderRadius: 18, margin: '0 8px' })}>

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

          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const dayOrders = ordersByDate.get(dateStr) || [];
          const hasOrders = dayOrders.length > 0;
          const totalVol = dayOrders.reduce((s: number, o: any) => s + Number(o.volume || 0), 0);
          const cancelledCount = dayOrders.filter((o: any) => o.status === 'cancelled').length;

          const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
          const isSelected = day === selectedDate.getDate() && currentMonth === selectedDate.getMonth() && currentYear === selectedDate.getFullYear();

          // Праздники и выходные — жёлтый, как в основном Calendar
          const jsDay = new Date(currentYear, currentMonth, day).getDay();
          const isWeekendOrHoliday = jsDay === 0 || jsDay === 6 || isRussianHoliday(currentMonth, day);

          const dayColor = isWeekendOrHoliday ? '#FACC15' : '#E2E8F0';
          const dayExtra: React.CSSProperties = {
            height: '64px',
            borderRadius: 12,
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2px',
            padding: '4px 2px',
            position: 'relative',
            transition: 'background-color 0.15s ease',
          };
          if (isSelected) {
            dayExtra.background = 'rgba(16,185,129,0.16)';
            dayExtra.boxShadow = 'inset 0 0 0 2px #10B981';
            dayExtra.border = 'none';
          } else if (isToday) {
            dayExtra.boxShadow = 'inset 0 0 0 2px #10B981';
          }

          return (
            <button
              key={idx}
              onClick={() => handleDayClick(day)}
              style={isSelected
                ? dayExtra
                : volumeCardSoftStyle(dayExtra)}
            >
              {/* Количество заявок — правый верхний угол, синий без фона */}
              {hasOrders && (
                <span style={{
                  position: 'absolute', top: '4px', right: '5px',
                  fontSize: '9px', fontWeight: 700,
                  color: isSelected ? '#A7F3D0' : '#60A5FA',
                  lineHeight: '14px',
                }}>
                  {dayOrders.length}
                </span>
              )}

              {/* Отменённые — левый верхний угол, красный без фона */}
              {cancelledCount > 0 && (
                <span style={{
                  position: 'absolute', top: '4px', left: '5px',
                  fontSize: '9px', fontWeight: 700,
                  color: '#EF4444',
                  lineHeight: '14px',
                }}>
                  {cancelledCount}
                </span>
              )}

              {/* Число */}
              <span style={{ fontSize: '16px', fontWeight: isToday || isSelected ? 700 : 500, color: dayColor, lineHeight: 1 }}>
                {day}
              </span>

              {/* Объём — зелёный, как в основном Calendar */}
              {hasOrders && (
                <span style={{
                  fontSize: '13px', fontWeight: 700,
                  color: isSelected ? '#A7F3D0' : '#10B981',
                  lineHeight: 1,
                }}>
                  {totalVol % 1 === 0 ? totalVol : totalVol.toFixed(1)}м³
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Легенда ──────────────────────── */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '18px', paddingTop: '14px', borderTop: CARD_BORDER }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#475569' }}>
          <span style={{ width: '12px', height: '12px', borderRadius: '3px', boxShadow: 'inset 0 0 0 1.5px #10B981', display: 'inline-block' }} />
          Сегодня / выбран
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#475569' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: '#EF4444' }}>1</span>
          Отменена
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#475569' }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: '#60A5FA' }}>3</span>
          Заявок
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#FACC15' }}>
          <span style={{ fontSize: '14px', fontWeight: 700 }}>7</span>
          Вых./праздник
        </div>
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = volumeCardSoftStyle({
  borderRadius: 10,
  width: 36,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  flexShrink: 0,
  padding: 0,
});
