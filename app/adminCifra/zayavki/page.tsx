'use client';

import { useState, useEffect } from 'react';
import { useCalendarOrders } from '../hooks/useCalendarOrders';

export default function ZayavkiPage() {
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [currentTimePercent, setCurrentTimePercent] = useState(45);
  const [selectedDate, setSelectedDate] = useState(new Date());

  const { orders } = useCalendarOrders(
    selectedDate.getFullYear(),
    selectedDate.getMonth()
  );

  const selectedDateStr = selectedDate.toISOString().split('T')[0];
  
  const dayOrders = orders
    .filter((o: any) => o?.delivery_date === selectedDateStr)
    .sort((a: any, b: any) => (a.delivery_time || '00:00').localeCompare(b.delivery_time || '00:00'));

  // KPI
  const totalVolume = dayOrders.reduce((sum: number, o: any) => sum + (Number(o.volume) || 0), 0);
  const completedVolume = dayOrders
    .filter((o: any) => o.status === 'completed')
    .reduce((sum: number, o: any) => sum + (Number(o.volume) || 0), 0);
  const deliveriesCount = dayOrders.length;
  const pprz = totalVolume > 0 ? Math.round((completedVolume / totalVolume) * 100) : 0;

  // Дни недели
  const getWeekDays = () => {
    const days = [];
    const today = new Date();
    for (let i = -3; i <= 3; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push(d);
    }
    return days;
  };
  const weekDays = getWeekDays();

  // Текущее время
  useEffect(() => {
    const updateCurrentTime = () => {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      const percent = (minutes / 1440) * 100;
      setCurrentTimePercent(Math.min(Math.max(percent, 3), 97));
    };
    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'new': return '#FACC15';
      case 'processing': return '#3B82F6';
      case 'completed': return '#10B981';
      case 'cancelled': return '#EF4444';
      default: return '#64748B';
    }
  };

  // Безопасная функция для Яндекс карты
  const getYandexMapUrl = (order: any) => {
    if (!order) return '';
    const factoryLat = 53.254623;
    const factoryLon = 34.415968;
    const factoryPoint = `${factoryLon},${factoryLat}`;
    const destination = order.delivery_address 
      ? encodeURIComponent(order.delivery_address) 
      : 'Брянск';
    return `https://yandex.ru/map-widget/v1/?um=constructor&source=constructor&ll=${factoryLon}%2C${factoryLat}&z=11&mode=route&pt=${factoryPoint}~${destination}&rtt=auto`;
  };

  return (
    <div style={{ background: '#0F172A', minHeight: '100vh', color: '#fff' }}>
      
      {/* Верхний бар */}
      <div style={{ 
        background: '#1E2937', 
        padding: '20px 40px', 
        borderBottom: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
          <div style={{ fontSize: '24px', fontWeight: '700' }}>РБУ ТрейдКом</div>
          <div style={{ display: 'flex', gap: '8px', background: '#0F172A', padding: '6px', borderRadius: '9999px' }}>
            <div style={{ padding: '10px 24px', borderRadius: '9999px', cursor: 'pointer' }}>Заказы</div>
            <div style={{ padding: '10px 24px', borderRadius: '9999px', background: '#3B82F6', color: 'white', fontWeight: '600' }}>Заявки</div>
            <div style={{ padding: '10px 24px', borderRadius: '9999px', cursor: 'pointer' }}>Миксеры</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button style={{ padding: '10px 20px', background: '#334155', border: 'none', borderRadius: '9999px', color: '#fff' }}>🔍 Фильтры</button>
          <button style={{ padding: '10px 20px', background: '#334155', border: 'none', borderRadius: '9999px', color: '#fff' }}>🖨️ Печать</button>
          <button style={{ padding: '10px 24px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '9999px', fontWeight: '600' }}>+ Добавить заявку</button>
          <button style={{ padding: '10px 24px', background: '#10B981', color: 'white', border: 'none', borderRadius: '9999px', fontWeight: '600' }}>+ Создать заказ</button>
        </div>
      </div>

      {/* KPI */}
      <div style={{ padding: '24px 40px', background: '#1E2937', display: 'flex', gap: '60px', borderBottom: '1px solid #334155' }}>
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Выполненный / Запланированный объём</div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>{completedVolume} м³ / {totalVolume} м³</div>
        </div>
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Доставок</div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>{deliveriesCount}</div>
        </div>
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Средняя задержка</div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>4 мин</div>
        </div>
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>ППРЗ</div>
          <div style={{ fontSize: '32px', fontWeight: '700', color: pprz >= 85 ? '#10B981' : '#FACC15' }}>{pprz}%</div>
        </div>
      </div>

      <div style={{ padding: '32px 40px', display: 'flex', gap: '24px' }}>
        
        {/* Левая колонка */}
        <div style={{ width: '280px', background: '#1E2937', borderRadius: '16px', padding: '20px', alignSelf: 'flex-start' }}>
          <div style={{ fontWeight: '600', marginBottom: '16px', color: '#94A3B8' }}>ЗАЯВКИ</div>
          {dayOrders.length > 0 ? dayOrders.map((order: any) => (
            <div
              key={order.id}
              onClick={() => setSelectedOrder(order)}
              style={{
                padding: '12px 16px',
                marginBottom: '8px',
                background: selectedOrder?.id === order.id ? '#3B82F620' : '#25334A',
                borderRadius: '10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}
            >
              <div style={{ color: '#94A3B8' }}>🔒</div>
              <div>
                <div style={{ fontWeight: '600' }}>#{order.id}</div>
                <div style={{ fontSize: '13px', color: '#94A3B8' }}>{order.organization_name || order.full_name}</div>
              </div>
            </div>
          )) : <div style={{ color: '#64748B', textAlign: 'center', padding: '40px 0' }}>Нет заявок</div>}
        </div>

        {/* Gantt Таймлайн */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
            {weekDays.map((date, i) => {
              const isSelected = date.toISOString().split('T')[0] === selectedDateStr;
              return (
                <div key={i} onClick={() => setSelectedDate(date)} style={{
                  padding: '12px 24px', background: isSelected ? '#3B82F6' : '#1E2937', borderRadius: '9999px',
                  fontWeight: '600', cursor: 'pointer', minWidth: '92px', textAlign: 'center'
                }}>
                  {date.toLocaleDateString('ru-RU', { weekday: 'short' })} {date.getDate()}
                </div>
              );
            })}
          </div>

          <div style={{ background: '#1E2937', borderRadius: '24px', padding: '32px', position: 'relative' }}>
            <div style={{ display: 'flex', marginBottom: '20px' }}>
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: '13px',
                  color: '#64748B',
                  borderRight: i < 23 ? '1px solid #334155' : 'none',
                  paddingBottom: '12px'
                }}>
                  {i}:00
                </div>
              ))}
            </div>

            <div style={{ position: 'relative', height: '680px', border: '1px solid #334155', borderRadius: '16px', overflow: 'visible' }}>
              <div style={{
                position: 'absolute',
                left: `${currentTimePercent}%`,
                top: '0',
                bottom: '40px',
                width: '3px',
                background: 'linear-gradient(to bottom, #3B82F6, #60A5FA)',
                boxShadow: '0 0 20px #3B82F6',
                zIndex: 30,
                transition: 'left 0.4s linear'
              }} />

              <div style={{
                position: 'absolute',
                left: `${currentTimePercent}%`,
                bottom: '20px',
                transform: 'translateX(-50%)',
                background: '#1E2937',
                padding: '6px 16px',
                borderRadius: '9999px',
                fontSize: '14px',
                fontWeight: '700',
                color: '#3B82F6',
                whiteSpace: 'nowrap',
                zIndex: 40,
                boxShadow: '0 4px 15px rgba(59, 130, 246, 0.4)',
                border: '2px solid #3B82F6'
              }}>
                {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </div>

              {dayOrders.map((order: any, index: number) => {
                const [hour, min] = (order.delivery_time || '09:00').split(':').map(Number);
                const left = ((hour * 60 + min) / 1440) * 100;
                const width = Math.min(Math.max((order.volume || 10) * 3, 10), 45);

                return (
                  <div
                    key={order.id}
                    onClick={() => setSelectedOrder(order)}
                    style={{
                      position: 'absolute',
                      left: `${left}%`,
                      top: `${100 + index * 85}px`,
                      width: `${width}%`,
                      height: '68px',
                      backgroundColor: getStatusColor(order.status),
                      borderRadius: '12px',
                      padding: '0 20px',
                      color: '#fff',
                      cursor: 'pointer',
                      boxShadow: '0 6px 16px rgba(0,0,0,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      zIndex: 10
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '700' }}>#{order.id}</div>
                      <div style={{ fontSize: '14px', opacity: 0.9 }}>{order.organization_name || order.full_name}</div>
                    </div>
                    <div style={{ fontWeight: '600' }}>{order.volume} м³</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* МОДАЛЬНОЕ ОКНО */}
      {selectedOrder && (
        <div 
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
          onClick={() => setSelectedOrder(null)}
        >
          <div 
            style={{ background: '#1E2937', width: '980px', borderRadius: '24px', padding: '32px', maxHeight: '92vh', overflow: 'auto' }} 
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2>Заявка #{selectedOrder.id} — {selectedOrder.organization_name || selectedOrder.full_name}</h2>
              <button onClick={() => setSelectedOrder(null)} style={{ fontSize: '32px', background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }}>×</button>
            </div>

            {/* Яндекс Карта */}
            <div style={{ height: '440px', borderRadius: '16px', overflow: 'hidden', marginBottom: '28px' }}>
              <iframe
                src={getYandexMapUrl(selectedOrder)}
                width="100%"
                height="100%"
                frameBorder="0"
                style={{ border: 'none' }}
                title="Маршрут доставки"
              />
            </div>

            {/* Этапы */}
            <div style={{ background: '#25334A', borderRadius: '16px', padding: '24px' }}>
              <div style={{ fontWeight: '600', marginBottom: '20px' }}>Этапы выполнения</div>
              {[
                { label: 'Загрузка', time: '09:30', status: 'completed' },
                { label: 'Доставка', time: '10:30', status: 'completed' },
                { label: 'На объекте', time: '11:15', status: 'processing' },
                { label: 'Заливка', time: '12:00', status: 'pending' },
                { label: 'Возврат', time: '14:00', status: 'pending' }
              ].map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '20px', padding: '14px 0', borderTop: i > 0 ? '1px solid #334155' : 'none' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: step.status === 'completed' ? '#10B981' : step.status === 'processing' ? '#3B82F6' : '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>
                    {step.status === 'completed' ? '✓' : step.status === 'processing' ? '→' : '○'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div>{step.label}</div>
                    <div style={{ fontSize: '14px', color: '#94A3B8' }}>{step.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}