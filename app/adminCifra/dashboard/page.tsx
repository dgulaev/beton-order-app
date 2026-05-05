'use client';

import { useState, useEffect } from 'react';
import Calendar from '../Calendar';
import { useCalendarOrders } from '../hooks/useCalendarOrders';

export default function AdminCifraDashboard() {
  const [currentHourPercent, setCurrentHourPercent] = useState(95);
  const [showCalendar, setShowCalendar] = useState(false);

  const { orders } = useCalendarOrders(new Date().getFullYear(), new Date().getMonth());

  const today = new Date().toISOString().split('T')[0];
  const todayOrders = orders.filter((o: any) => {
    if (!o || !o.delivery_date) return false;
    const orderDate = o.delivery_date.toString().split('T')[0];
    return orderDate === today;
  });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const totalMinutes = hours * 60 + minutes;
      const percent = (totalMinutes / (24 * 60)) * 100;
      setCurrentHourPercent(Math.min(Math.max(percent, 3), 97));
    };

    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ flex: 1, display: 'flex', backgroundColor: '#0F172A', padding: '32px', gap: '24px', overflow: 'hidden' }}>
      
      {/* Основная часть */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        
        {/* Topbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          
          {/* Левый блок: название + кнопка календаря рядом */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <h1 style={{ fontSize: '32px', fontWeight: '600', color: '#fff' }}>РБУ ТрейдКом</h1>
            
            {/* Кнопка календаря справа от названия */}
            <div 
              style={{ 
                cursor: 'pointer',
                backgroundColor: '#334155',
                color: '#fff',
                padding: '8px 20px',
                borderRadius: '9999px',
                fontSize: '15px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
              onClick={() => setShowCalendar(true)}
            >
              📅 {new Date().toLocaleDateString('ru-RU', { 
                day: 'numeric', 
                month: 'long', 
                year: 'numeric' 
              })}
            </div>
          </div>
        </div>

        {/* Метрики */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
          <div style={{ backgroundColor: '#1E2937', borderRadius: '16px', padding: '20px', color: '#fff' }}>
            <div style={{ fontSize: '13px', color: '#94A3B8' }}>План сегодня</div>
            <div style={{ fontSize: '32px', fontWeight: '600' }}>240 м³</div>
          </div>
          <div style={{ backgroundColor: '#1E2937', borderRadius: '16px', padding: '20px', color: '#fff' }}>
            <div style={{ fontSize: '13px', color: '#94A3B8' }}>Выполнено</div>
            <div style={{ fontSize: '32px', fontWeight: '600', color: '#10B981' }}>185 м³</div>
          </div>
          <div style={{ backgroundColor: '#1E2937', borderRadius: '16px', padding: '20px', color: '#fff' }}>
            <div style={{ fontSize: '13px', color: '#94A3B8' }}>В работе</div>
            <div style={{ fontSize: '32px', fontWeight: '600' }}>3 миксера</div>
          </div>
          <div style={{ backgroundColor: '#1E2937', borderRadius: '16px', padding: '20px', color: '#fff' }}>
            <div style={{ fontSize: '13px', color: '#94A3B8' }}>Осталось</div>
            <div style={{ fontSize: '32px', fontWeight: '600' }}>55 м³</div>
          </div>
        </div>

        {/* Таймлайн */}
        <div style={{ flex: 1, backgroundColor: '#1E2937', border: '1px solid #334155', borderRadius: '20px', padding: '28px', position: 'relative' }}>
          <h2 style={{ fontSize: '22px', marginBottom: '20px', color: '#fff' }}>График отгрузок на сегодня</h2>
          
          <div style={{ position: 'relative' }}>
            
            {/* Строки заказов — единый grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {todayOrders.map((order: any, index: number) => {
                const client = (order.organization_name || order.full_name || '—');
                const time = order.delivery_time || '00:00';
                
                const [hourStr, minuteStr] = time.split(':');
                const hour = parseInt(hourStr) || 0;
                const minute = parseInt(minuteStr) || 0;
                const startPercent = ((hour * 60 + minute) / 1440) * 100;

                const durationMinutes = (order.volume || 0) * 2;
                const widthPercent = Math.min(Math.max(durationMinutes / 14.4, 6), 28);

                const statusColor = order.status === 'new' ? '#10B981' : 
                                   order.status === 'processing' ? '#3B82F6' : 
                                   order.status === 'completed' ? '#10B981' : '#EF4444';

                return (
                  <div 
                    key={order.id} 
                    style={{ 
                      display: 'grid',
                      gridTemplateColumns: '220px 1fr',
                      gap: '16px',
                      alignItems: 'center',
                      height: '38px',
                      backgroundColor: '#25334A',
                      borderRadius: '8px',
                      transition: 'background-color 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#25334A'}
                  >
                    <div style={{ fontWeight: '500', color: '#fff', fontSize: '15px', paddingLeft: '12px' }}>
                      #{order.id} {client}
                    </div>
                    <div style={{ 
                      height: '34px', 
                      backgroundColor: '#334155', 
                      borderRadius: '9999px', 
                      position: 'relative',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        position: 'absolute',
                        left: `${startPercent}%`,
                        width: `${widthPercent}%`,
                        height: '100%',
                        backgroundColor: statusColor,
                        borderRadius: '9999px',
                        display: 'flex',
                        alignItems: 'center',
                        paddingLeft: '12px',
                        paddingRight: '8px',
                        color: '#fff',
                        fontSize: '13px',
                        fontWeight: '500',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {time} • {order.status === 'new' ? 'Новый' : 
                                 order.status === 'processing' ? 'В работе' : 
                                 order.status === 'completed' ? 'Выполнена' : 'Отменена'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Регулировка оси времени */}
            {(() => {
              const axisOffset = 0;   // ← ИЗМЕНЯЙ ЗДЕСЬ

              return (
                <>
                  <div style={{
                    position: 'absolute',
                    left: `calc(${currentHourPercent}% + ${axisOffset}px)`,
                    top: '48px',
                    bottom: '28px',
                    width: '3px',
                    backgroundColor: '#3B82F6',
                    boxShadow: '0 0 12px #3B82F6',
                    zIndex: 10,
                    transition: 'left 1s linear'
                  }} />

                  <div style={{
                    position: 'absolute',
                    left: `calc(${currentHourPercent}% + ${axisOffset}px)`,
                    bottom: '-22px',
                    transform: 'translateX(-50%)',
                    fontSize: '13px',
                    color: '#3B82F6',
                    fontWeight: '600',
                    whiteSpace: 'nowrap',
                    backgroundColor: '#1E2937',
                    padding: '4px 12px',
                    borderRadius: '9999px',
                    zIndex: 25,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                  }}>
                    {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Правая панель */}
      <div style={{ width: '380px', backgroundColor: '#1E2937', borderRadius: '20px', padding: '24px', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontSize: '20px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px', color: '#fff' }}>
          🚛 Миксеры в работе
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
          <div style={{ backgroundColor: '#334155', borderRadius: '16px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: '500', color: '#fff' }}>SHACMAN e834pp750</div>
              <div style={{ color: '#10B981' }}>11:45</div>
            </div>
            <div style={{ fontSize: '14px', color: '#94A3B8', marginTop: '4px' }}>19 м³ • ООО "Стройка"</div>
            <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: '#10B981', fontSize: '14px' }}>
              <div style={{ width: '10px', height: '10px', backgroundColor: '#10B981', borderRadius: '50%' }}></div>
              На объекте (26 мин)
            </div>
          </div>

          <div style={{ backgroundColor: '#334155', borderRadius: '16px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: '500', color: '#fff' }}>KAMAZ e746on750</div>
              <div style={{ color: '#10B981' }}>12:10</div>
            </div>
            <div style={{ fontSize: '14px', color: '#94A3B8', marginTop: '4px' }}>12 м³ • ИП Василенко</div>
            <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: '#10B981', fontSize: '14px' }}>
              <div style={{ width: '10px', height: '10px', backgroundColor: '#10B981', borderRadius: '50%' }}></div>
              В пути
            </div>
          </div>
        </div>

        <button style={{ marginTop: 'auto', padding: '16px', backgroundColor: '#3B82F6', color: 'white', borderRadius: '9999px', fontWeight: '500' }}>
          📍 Показать все на карте
        </button>
      </div>

      {/* Модальное окно календаря */}
      {showCalendar && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={() => setShowCalendar(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <Calendar onClose={() => setShowCalendar(false)} />
          </div>
        </div>
      )}
    </div>
  );
}