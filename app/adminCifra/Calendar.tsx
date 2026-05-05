'use client';

import { useState } from 'react';
import { useCalendarOrders, Order } from './hooks/useCalendarOrders';

interface CalendarProps {
  onClose: () => void;
}

export default function Calendar({ onClose }: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const { orders, loading } = useCalendarOrders(year, month);

  const groupedByDate: { [key: string]: Order[] } = {};
  const dailyVolumes: { [key: string]: number } = {};

  orders.forEach((order) => {
    const date = order.delivery_date;
    if (!groupedByDate[date]) groupedByDate[date] = [];
    groupedByDate[date].push(order);
    dailyVolumes[date] = (dailyVolumes[date] || 0) + (order.volume || 0);
  });

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDay(null);
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDay(null);
  };

  const handleDayClick = (day: number) => {
    setSelectedDay(day);
  };

  const currentMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const selectedDateKey = selectedDay 
    ? `${currentMonthKey}-${String(selectedDay).padStart(2, '0')}` 
    : null;

  const dayOrders = selectedDateKey ? groupedByDate[selectedDateKey] || [] : [];

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const currentDay = today.getDate();

  return (
    <div style={{
      backgroundColor: '#1E2937',
      borderRadius: '24px',
      padding: '32px',
      width: '1280px',
      height: '820px',
      overflow: 'hidden',
      boxShadow: '0 25px 70px rgba(0,0,0,0.7)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Шапка календаря */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <button 
          onClick={handlePrevMonth} 
          style={{ 
            padding: '12px 24px', 
            backgroundColor: '#334155', 
            color: '#fff', 
            borderRadius: '9999px', 
            fontSize: '16px',
            cursor: 'pointer'
          }}
        >
          ‹ Предыдущий
        </button>
        
        <h2 style={{ fontSize: '28px', fontWeight: '600', color: '#fff' }}>
          {currentDate.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}
        </h2>

        <button 
          onClick={handleNextMonth} 
          style={{ 
            padding: '12px 24px', 
            backgroundColor: '#334155', 
            color: '#fff', 
            borderRadius: '9999px', 
            fontSize: '16px',
            cursor: 'pointer'
          }}
        >
          Следующий ›
        </button>
        
        <button 
          onClick={onClose} 
          style={{ 
            padding: '12px 28px', 
            backgroundColor: '#EF4444', 
            color: '#fff', 
            borderRadius: '9999px', 
            fontSize: '16px',
            cursor: 'pointer'
          }}
        >
          Закрыть
        </button>
      </div>

      <div style={{ display: 'flex', gap: '36px', flex: 1, overflow: 'hidden' }}>
        
        {/* Календарь */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(7, 1fr)', 
            textAlign: 'center', 
            fontSize: '15px', 
            color: '#94A3B8', 
            marginBottom: '16px' 
          }}>
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => <div key={day}>{day}</div>)}
          </div>

          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(7, 1fr)', 
            rowGap: '4px',
            columnGap: '8px',
          }}>
            {Array.from({ length: new Date(year, month, 1).getDay() === 0 ? 6 : new Date(year, month, 1).getDay() - 1 }).map((_, i) => (
              <div key={`empty-${i}`} style={{ height: '78px' }} />
            ))}

            {Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => {
              const day = i + 1;
              const dateKey = `${currentMonthKey}-${String(day).padStart(2, '0')}`;
              const volume = dailyVolumes[dateKey] || 0;
              const isSelected = selectedDay === day;
              const isToday = isCurrentMonth && day === currentDay;

              return (
                <div
                  key={day}
                  onClick={() => handleDayClick(day)}
                  style={{
                    height: '78px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '14px',
                    backgroundColor: isSelected ? '#3B82F6' : '#334155',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '19px',
                    fontWeight: '600',
                    position: 'relative',
                    border: isToday ? '4px solid #EF4444' : 'none',
                  }}
                >
                  <span>{day}</span>
                  {volume > 0 && (
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#10B981', marginTop: '4px' }}>
                      {volume} м³
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Список заказов на выбранный день */}
        <div style={{ width: '520px', backgroundColor: '#334155', borderRadius: '20px', padding: '28px', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '22px', marginBottom: '24px', color: '#fff' }}>
            {selectedDay 
              ? `Заказы на ${selectedDay} ${currentDate.toLocaleString('ru-RU', { month: 'long' })}` 
              : 'Выберите день'}
          </h3>

          {loading ? (
            <p style={{ color: '#94A3B8', textAlign: 'center', margin: 'auto' }}>Загрузка...</p>
          ) : dayOrders.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflow: 'auto' }}>
              {dayOrders.map((order) => (
                <div 
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  style={{ 
                    backgroundColor: '#1E2937', 
                    padding: '18px', 
                    borderRadius: '14px',
                    cursor: 'pointer',
                    position: 'relative'
                  }}
                >
                  {/* Номер заказа — белый */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: '600', color: '#fff', fontSize: '18px' }}>#{order.id}</span>
                    
                    {/* Текущий статус с цветом */}
                    <span style={{
                      padding: '4px 14px',
                      borderRadius: '9999px',
                      fontSize: '13px',
                      fontWeight: '600',
                      backgroundColor: (order as any).status === 'new' ? '#fef9c3' :
                                      (order as any).status === 'processing' ? '#dbeafe' :
                                      (order as any).status === 'completed' ? '#dcfce7' : '#fee2e2',
                      color: (order as any).status === 'new' ? '#854d0e' :
                             (order as any).status === 'processing' ? '#1e40af' :
                             (order as any).status === 'completed' ? '#166534' : '#b91c1c'
                    }}>
                      {(order as any).status === 'new' && 'Новый'}
                      {(order as any).status === 'processing' && 'Вработе'}
                      {(order as any).status === 'completed' && 'Выполнена'}
                      {(order as any).status === 'cancelled' && 'Отменена'}
                    </span>
                  </div>

                  <div style={{ fontSize: '15px', color: '#94A3B8', marginTop: '8px' }}>
                    {(order as any).organization_name || (order as any).full_name || '—'}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', alignItems: 'center' }}>
                    <span style={{ color: '#10B981', fontWeight: '600' }}>{order.volume} м³</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#94A3B8', textAlign: 'center', margin: 'auto', fontSize: '17px' }}>
              На выбранный день заказов нет
            </p>
          )}
        </div>
      </div>

      {/* Детальная модалка заказа */}
      {selectedOrder && (
        <div 
          style={{
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)', 
            zIndex: 2000,
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center'
          }}
          onClick={() => setSelectedOrder(null)}
        >
          <div 
            style={{
              backgroundColor: '#1E2937',
              borderRadius: '20px',
              padding: '32px',
              width: '560px',
              color: '#fff',
              maxHeight: '90vh',
              overflow: 'auto'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '26px', margin: 0 }}>Заказ #{selectedOrder.id}</h2>
              
              <span style={{
                padding: '8px 20px',
                borderRadius: '9999px',
                fontSize: '14px',
                fontWeight: '600',
                backgroundColor: (selectedOrder as any).status === 'new' ? '#fef9c3' :
                                  (selectedOrder as any).status === 'processing' ? '#dbeafe' :
                                  (selectedOrder as any).status === 'completed' ? '#dcfce7' : '#fee2e2',
                color: (selectedOrder as any).status === 'new' ? '#854d0e' :
                       (selectedOrder as any).status === 'processing' ? '#1e40af' :
                       (selectedOrder as any).status === 'completed' ? '#166534' : '#b91c1c'
              }}>
                {(selectedOrder as any).status === 'new' && 'Новый'}
                {(selectedOrder as any).status === 'processing' && 'Вработе'}
                {(selectedOrder as any).status === 'completed' && 'Выполнена'}
                {(selectedOrder as any).status === 'cancelled' && 'Отменена'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', fontSize: '15px' }}>
              <div><strong>Дата доставки:</strong><br/>{selectedOrder.delivery_date}</div>
              <div><strong>Время доставки:</strong><br/>{(selectedOrder as any).delivery_time || '—'}</div>
              <div><strong>Марка бетона:</strong><br/>{(selectedOrder as any).grade || '—'}</div>
              <div><strong>Объём:</strong><br/><span style={{ color: '#10B981', fontSize: '18px' }}>{selectedOrder.volume} м³</span></div>
              <div><strong>Клиент:</strong><br/>{(selectedOrder as any).organization_name || (selectedOrder as any).full_name || '—'}</div>
              <div><strong>Телефон:</strong><br/>{(selectedOrder as any).phone || '—'}</div>
              <div><strong>Адрес:</strong><br/>{selectedOrder.address || '—'}</div>
            </div>

            <div style={{ marginTop: '28px', padding: '20px', backgroundColor: '#334155', borderRadius: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span>Стоимость бетона</span>
                <span style={{ fontWeight: '600' }}>{(selectedOrder as any).concrete_cost || 0} ₽</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span>Стоимость доставки</span>
                <span style={{ fontWeight: '600' }}>{(selectedOrder as any).delivery_cost || 0} ₽</span>
              </div>
              <div style={{ borderTop: '1px solid #64748B', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: '700' }}>
                <span>Общая стоимость</span>
                <span style={{ color: '#10B981' }}>{(selectedOrder as any).total_price || 0} ₽</span>
              </div>
            </div>

            {(selectedOrder as any).comment && (
              <div style={{ marginTop: '24px' }}>
                <strong>Комментарий к заказу:</strong>
                <div style={{ marginTop: '8px', padding: '16px', backgroundColor: '#334155', borderRadius: '12px', whiteSpace: 'pre-wrap' }}>
                  {(selectedOrder as any).comment}
                </div>
              </div>
            )}

            <button 
              onClick={() => setSelectedOrder(null)}
              style={{ 
                marginTop: '32px', 
                width: '100%', 
                padding: '16px', 
                backgroundColor: '#3B82F6', 
                color: 'white', 
                border: 'none', 
                borderRadius: '9999px', 
                fontSize: '17px',
                fontWeight: '600'
              }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  );
}