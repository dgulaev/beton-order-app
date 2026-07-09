'use client';

import React from 'react';


interface MobileCalendarProps {
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  allOrders: any[];
  onClose: () => void;
}

export default function MobileCalendar({ 
  selectedDate, 
  setSelectedDate, 
  allOrders, 
  onClose 
}: MobileCalendarProps) {
  
  const [currentMonth, setCurrentMonth] = React.useState(selectedDate.getMonth());
  const [currentYear, setCurrentYear] = React.useState(selectedDate.getFullYear());

  const today = new Date();
    // firstDay с понедельника как первого дня недели
  const jsFirstDay = new Date(currentYear, currentMonth, 1).getDay();
  const firstDay = (jsFirstDay === 0 ? 6 : jsFirstDay - 1); // 0 (вс) → 6, 1 (пн) → 0 и т.д.
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // Группируем заказы по дням
  const ordersByDate = React.useMemo(() => {
    const map = new Map();
    allOrders.forEach(order => {
      if (order.delivery_date) {
        const dateStr = order.delivery_date.substring(0, 10);
        if (!map.has(dateStr)) map.set(dateStr, []);
        map.get(dateStr).push(order);
      }
    });
    return map;
  }, [allOrders]);

  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

    const handleDateClick = (day: number) => {
    const newDate = new Date(currentYear, currentMonth, day);
    setSelectedDate(newDate);
    onClose();
  };

  return (
    <div>
      {/* Навигация по месяцам */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <button 
          onClick={() => {
            if (currentMonth === 0) {
              setCurrentMonth(11); 
              setCurrentYear(currentYear - 1);
            } else {
              setCurrentMonth(currentMonth - 1);
            }
          }} 
          style={{ background: 'none', border: 'none', fontSize: '26px', color: '#94A3B8' }}
        >
          ←
        </button>
        
        <div style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff' }}>
          {new Date(currentYear, currentMonth).toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}
        </div>

        <button 
          onClick={() => {
            if (currentMonth === 11) {
              setCurrentMonth(0); 
              setCurrentYear(currentYear + 1);
            } else {
              setCurrentMonth(currentMonth + 1);
            }
          }} 
          style={{ background: 'none', border: 'none', fontSize: '26px', color: '#94A3B8' }}
        >
          →
        </button>
      </div>

            {/* Дни недели — Воскресенье последним */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: '13px', color: '#94A3B8', marginBottom: '8px' }}>
        {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => <div key={d}>{d}</div>)}
      </div>

      {/* Дни */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {days.map((day, index) => {
          if (!day) return <div key={index} style={{ height: '52px' }} />;

          const dateStr = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          const dayOrders = ordersByDate.get(dateStr) || [];
          const totalVolume = dayOrders.reduce((sum: number, o: any) => sum + Number(o.volume || 0), 0);

          const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
          const isSelected = day === selectedDate.getDate() && currentMonth === selectedDate.getMonth() && currentYear === selectedDate.getFullYear();

          return (
            <button
              key={index}
              onClick={() => handleDateClick(day)}
              style={{
                height: '52px',
                borderRadius: '10px',
                border: 'none',
                background: isSelected ? '#3B82F6' : isToday ? '#334155' : '#25334A',
                color: isSelected ? '#ffffff' : '#E2E8F0',
                fontSize: '15px',
                position: 'relative',
                paddingTop: '4px'
              }}
            >
              <div>{day}</div>
              {dayOrders.length > 0 && (
                <div style={{ fontSize: '10px', lineHeight: '1.1', marginTop: '2px', opacity: 0.9 }}>
                  {dayOrders.length} • {totalVolume.toFixed(1)}м³
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}