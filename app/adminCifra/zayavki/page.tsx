'use client';

import { useState, useEffect } from 'react';
import { Order } from '../hooks/useCalendarOrders';
import { useRealtimeOrders } from '../../../hooks/useRealtimeOrders';
import NewOrderModal from '@/app/adminCifra/components/NewOrderModal';

export default function ZayavkiPage() {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'processing' | 'completed' | 'cancelled'>('all');
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);

  // ==================== REALTIME ====================
  useRealtimeOrders(setAllOrders);

  // Загрузка всех заказов при открытии страницы
  useEffect(() => {
    const fetchAllOrders = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/adminCifra/all-orders');
        if (res.ok) {
          const data = await res.json();
          setAllOrders(data);
        }
      } catch (err) {
        console.error('Ошибка загрузки заказов:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAllOrders();
  }, []);

    // ==================== АВТООБНОВЛЕНИЕ РАЗ В МИНУТУ ====================
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/adminCifra/all-orders', { 
          cache: 'no-store' 
        });
        
        if (res.ok) {
          const data = await res.json();
          setAllOrders(data);
          console.log(`🔄 Автообновление заявок (${new Date().toLocaleTimeString('ru-RU')})`);
        }
      } catch (err) {
        console.error('Ошибка автообновления заявок:', err);
      }
    }, 60000); // 60 секунд = 1 минута

    return () => clearInterval(interval);
  }, []);

  const selectedDateStr = selectedDate.toISOString().split('T')[0];

  const dayOrders = allOrders
    .filter((o: Order) => {
      if (!o?.delivery_date) return false;
      const orderDateStr = typeof o.delivery_date === 'string' 
        ? o.delivery_date.substring(0, 10) 
        : new Date(o.delivery_date).toISOString().substring(0, 10);
      return orderDateStr === selectedDateStr;
    })
    .sort((a, b) => (a.delivery_time || '00:00').localeCompare(b.delivery_time || '00:00'));

  // KPI
  const totalVolume = dayOrders.reduce((sum: number, o: Order) => sum + (Number(o.volume) || 0), 0);
  const completedVolume = dayOrders
    .filter((o: Order) => o.status === 'completed')
    .reduce((sum: number, o: Order) => sum + (Number(o.volume) || 0), 0);
  const deliveriesCount = dayOrders.length;
  const pprz = totalVolume > 0 ? Math.round((completedVolume / totalVolume) * 100) : 0;

  // ==================== НЕДЕЛЯ ====================
  const getWeekDays = () => {
    const days = [];
    const today = new Date();
    for (let i = -3; i <= 4; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const weekDays = getWeekDays();

  const getOrdersCountForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return allOrders.filter(o => {
      const d = typeof o.delivery_date === 'string' 
        ? o.delivery_date.substring(0, 10) 
        : new Date(o.delivery_date).toISOString().substring(0, 10);
      return d === dateStr;
    }).length;
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'new': return '#FACC15';
      case 'processing': return '#3B82F6';
      case 'completed': return '#10B981';
      case 'cancelled': return '#EF4444';
      default: return '#64748B';
    }
  };

  const filteredOrders = dayOrders.filter(order => {
  const searchLower = searchQuery.toLowerCase();

  const matchesSearch = 
    (order.organization_name || '').toLowerCase().includes(searchLower) ||
    (order.full_name || '').toLowerCase().includes(searchLower) ||
    String(order.id).includes(searchQuery) ||
    (order.inn || '').includes(searchQuery);   // ← теперь работает

  const matchesStatus = statusFilter === 'all' || order.status === statusFilter;

  return matchesSearch && matchesStatus;
});

  return (
    <div style={{ 
    background: '#0F172A', 
    minHeight: '100vh',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    color: '#fff',
    overflow: 'hidden'
  }}>
    
    {/* Header */}
    <div style={{ 
      background: '#1E2937', 
      padding: '20px 40px', 
      borderBottom: '1px solid #334155', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'space-between',
      flexShrink: 0
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
        <div style={{ fontSize: '24px', fontWeight: '700' }}>РБУ ТрейдКом</div>
        <div style={{ display: 'flex', gap: '8px', background: '#0F172A', padding: '6px', borderRadius: '9999px' }}>
          <div style={{ padding: '10px 24px', borderRadius: '9999px', cursor: 'pointer' }}>Заказы</div>
          <div style={{ padding: '10px 24px', borderRadius: '9999px', background: '#3B82F6', color: 'white', fontWeight: '600' }}>Заявки</div>
          <div style={{ padding: '10px 24px', borderRadius: '9999px', cursor: 'pointer' }}>Миксеры</div>
        </div>
      </div>
    </div>

      {/* ==================== KPI БАР ==================== */}
      <div style={{ 
        padding: '24px 40px', 
        background: '#1E2937', 
        display: 'flex', 
        gap: '80px', 
        borderBottom: '1px solid #334155',
        alignItems: 'center'
      }}>
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Выполнено сегодня</div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>
            {completedVolume} / {totalVolume} м³
          </div>
        </div>

        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Доставок сегодня</div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>
            {deliveriesCount}
          </div>
        </div>

        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>ППРЗ</div>
          <div style={{ 
            fontSize: '32px', 
            fontWeight: '700', 
            color: pprz >= 80 ? '#10B981' : '#FACC15' 
          }}>
            {pprz}%
          </div>
        </div>
      </div>

      <div style={{ padding: '32px 40px', display: 'flex', gap: '28px' }}>
        
        {/* ==================== ЛЕВАЯ КОЛОНКА — ЗАЯВКИ НА НЕДЕЛЮ ==================== */}
<div style={{ 
  width: '340px', 
  flexShrink: 0 
}}>
  <div style={{ 
    background: '#1E2937', 
    borderRadius: '20px', 
    padding: '24px',
    minHeight: '920px',
    height: 'calc(100vh - 180px)',   // ← помогает с высотой
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  }}>
    
    <h3 style={{ marginBottom: '20px', color: '#94A3B8', fontSize: '18px' }}>
      ЗАЯВКИ НА НЕДЕЛЮ
    </h3>

    {/* Навигация */}
    <div style={{ 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center', 
      marginBottom: '16px',
      color: '#CBD5E1',
      flexShrink: 0
    }}>
      <button 
        onClick={() => {
          const newDate = new Date(selectedDate);
          newDate.setDate(newDate.getDate() - 14);
          setSelectedDate(newDate);
        }}
        style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '18px', cursor: 'pointer' }}
      >
        ←
      </button>
      
      <div style={{ fontWeight: '600', fontSize: '15px' }}>
        {selectedDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
      </div>

      <button 
        onClick={() => {
          const newDate = new Date(selectedDate);
          newDate.setDate(newDate.getDate() + 14);
          setSelectedDate(newDate);
        }}
        style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '18px', cursor: 'pointer' }}
      >
        →
      </button>
    </div>

    {/* ==================== СПИСОК ДНЕЙ СО СКРОЛЛОМ ==================== */}
    <div style={{ 
      flex: 1,
      overflowY: 'auto', 
      scrollbarWidth: 'thin',
      scrollbarColor: '#3B82F6 #25334A',
      paddingRight: '8px',
      minHeight: '0'                    // важно для скролла
    }}>
      {(() => {
        const days = [];
        const startDate = new Date(selectedDate);
        startDate.setDate(startDate.getDate() - 14);

        for (let i = 0; i < 29; i++) {
          const d = new Date(startDate);
          d.setDate(startDate.getDate() + i);
          
          const dateStr = d.toISOString().split('T')[0];
          const count = getOrdersCountForDate(d);
          const isSelected = dateStr === selectedDateStr;
          const isToday = d.toDateString() === new Date().toDateString();

          days.push(
            <div
              key={i}
              onClick={() => setSelectedDate(d)}
              style={{
                padding: '14px 20px',
                marginBottom: '8px',
                background: isSelected ? '#3B82F620' : '#25334A',
                borderRadius: '16px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                border: isSelected ? '2px solid #3B82F6' : isToday ? '1px solid #60A5FA' : 'none',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ fontWeight: '600' }}>
                {d.toLocaleDateString('ru-RU', { 
                  weekday: 'short', 
                  day: 'numeric', 
                  month: 'short' 
                })}
                {isToday && <span style={{ color: '#60A5FA', marginLeft: '6px' }}>●</span>}
              </div>
              
              <div style={{ 
                background: '#334155', 
                color: '#CBD5E1', 
                padding: '4px 12px', 
                borderRadius: '9999px',
                fontSize: '14px',
                fontWeight: '600',
                minWidth: '28px',
                textAlign: 'center'
              }}>
                {count}
              </div>
            </div>
          );
        }
        return days;
      })()}
    </div>
  </div>
</div>

        {/* ==================== ПРАВАЯ КОЛОНКА — ОСНОВНОЙ СПИСОК ==================== */}
<div style={{ flex: 1 }}>

  <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
    <h2 style={{ margin: 0 }}>
      Заявки на {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
    </h2>

    <button 
      onClick={() => setShowNewOrderModal(true)}
      style={{
        padding: '14px 32px',
        background: '#10B981',
        color: 'white',
        border: 'none',
        borderRadius: '9999px',
        fontSize: '16px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer'
      }}
    >
      + Новая заявка
    </button>
  </div>

  {/* Поиск и фильтры */}
  <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
    <input
      type="text"
      placeholder="Поиск по клиенту, № заявки или ИНН..."
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      style={{
        padding: '12px 20px',
        background: '#25334A',
        border: 'none',
        borderRadius: '9999px',
        width: '320px',
        color: '#fff',
        fontSize: '15px'
      }}
    />

    <select 
      value={statusFilter}
      onChange={(e) => setStatusFilter(e.target.value as 'all' | 'new' | 'processing' | 'completed' | 'cancelled')}
      style={{
        padding: '12px 20px',
        background: '#25334A',
        border: 'none',
        borderRadius: '9999px',
        color: '#fff',
        fontSize: '15px',
        minWidth: '160px'
      }}
    >
      <option value="all">Все статусы</option>
      <option value="new">🟡 Новый</option>
      <option value="processing">🔵 В работе</option>
      <option value="completed">🟢 Выполнен</option>
      <option value="cancelled">🔴 Отменён</option>
    </select>
  </div>

  {/* Простой список без дополнительного окна */}
  {loading ? (
    <div style={{ textAlign: 'center', padding: '100px', color: '#64748B' }}>Загрузка заявок...</div>
  ) : filteredOrders.length > 0 ? (
    filteredOrders.map((order: Order) => (
      <div
        key={order.id}
        onClick={() => setSelectedOrder(order)}
        style={{
          background: '#1E2937',           // каждая карточка с фоном
          borderRadius: '16px',
          padding: '20px',
          marginBottom: '12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          transition: 'all 0.2s'
        }}
      >
        <div style={{ width: '90px', fontWeight: '700', fontSize: '17px' }}>
          {order.delivery_time}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: '600', fontSize: '17px' }}>
            #{order.id} — {order.organization_name || order.full_name || '—'}
          </div>
          <div style={{ color: '#94A3B8' }}>
            {order.grade} • {order.volume} м³
          </div>
        </div>
        <div style={{ 
          padding: '8px 20px', 
          borderRadius: '9999px', 
          background: getStatusColor(order.status) + '20', 
          color: getStatusColor(order.status),
          fontWeight: '600',
          fontSize: '15px'
        }}>
          {order.status === 'new' && 'Новый'}
          {order.status === 'processing' && 'В работе'}
          {order.status === 'completed' && 'Выполнен'}
          {order.status === 'cancelled' && 'Отменён'}
        </div>
      </div>
    ))
  ) : (
    <div style={{ textAlign: 'center', padding: '120px 0', color: '#64748B', fontSize: '18px' }}>
      По выбранным фильтрам ничего не найдено
    </div>
  )}
  </div>
</div>

      {/* МОДАЛЬНОЕ ОКНО ЗАКАЗА — БЕЗ IFRAME */}
      {selectedOrder && (
        <div 
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.94)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
          onClick={() => setSelectedOrder(null)}
        >
          <div 
            style={{ 
              background: '#1E2937', 
              width: '1080px', 
              borderRadius: '24px', 
              padding: '32px', 
              maxHeight: '94vh', 
              overflow: 'auto',
              boxShadow: '0 30px 80px rgba(0,0,0,0.7)'
            }} 
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ margin: 0, fontSize: '28px' }}>
                Заявка #{selectedOrder.id}
              </h2>
              <button 
                onClick={() => setSelectedOrder(null)} 
                style={{ fontSize: '42px', background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            {/* Статус */}
            <div style={{ 
              display: 'inline-block', 
              padding: '8px 26px', 
              borderRadius: '9999px', 
              fontWeight: '600',
              backgroundColor: getStatusColor(selectedOrder.status) + '20',
              color: getStatusColor(selectedOrder.status),
              marginBottom: '28px'
            }}>
              {selectedOrder.status === 'new' && '🟡 Новый заказ'}
              {selectedOrder.status === 'processing' && '🔵 В работе'}
              {selectedOrder.status === 'completed' && '🟢 Выполнен'}
              {selectedOrder.status === 'cancelled' && '🔴 Отменён'}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
              
              {/* Левая колонка — Информация */}
<div>
  <h3 style={{ marginBottom: '18px', color: '#94A3B8' }}>Информация о заказе</h3>
  
  <div style={{ background: '#25334A', borderRadius: '16px', padding: '24px', lineHeight: '2' }}>
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px' }}>
      <div style={{ color: '#94A3B8' }}>Клиент</div>
      <div style={{ fontWeight: '600' }}>
        {selectedOrder.organization_name || selectedOrder.full_name || '—'}
      </div>

      {selectedOrder.inn && (
        <>
          <div style={{ color: '#94A3B8' }}>ИНН</div>
          <div style={{ fontWeight: '600', color: '#60A5FA' }}>
            {selectedOrder.inn}
          </div>
        </>
      )}

      <div style={{ color: '#94A3B8' }}>Телефон</div>
      <div>{selectedOrder.phone || '—'}</div>

      <div style={{ color: '#94A3B8' }}>Марка бетона</div>
      <div style={{ fontWeight: '600', color: '#60A5FA' }}>{selectedOrder.grade}</div>

      <div style={{ color: '#94A3B8' }}>Объём</div>
      <div style={{ fontSize: '24px', fontWeight: '700', color: '#10B981' }}>{selectedOrder.volume} м³</div>

      <div style={{ color: '#94A3B8' }}>Дата и время</div>
      <div>{selectedOrder.delivery_date} • {selectedOrder.delivery_time}</div>

      <div style={{ color: '#94A3B8' }}>Адрес доставки</div>
      <div style={{ fontWeight: '600', fontSize: '17px' }}>{selectedOrder.address}</div>
    </div>
  </div>
      </div>          
              
              {/* Правая колонка — Маршрут */}
              <div>
                <h3 style={{ marginBottom: '20px', color: '#94A3B8' }}>Маршрут доставки</h3>
                
                <div style={{ background: '#25334A', borderRadius: '16px', padding: '28px', marginBottom: '24px' }}>
                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ color: '#94A3B8', fontSize: '14px' }}>От завода</div>
                    <div style={{ fontWeight: '600' }}>Брянск, Орловский тупик, 6</div>
                  </div>
                  <div>
                    <div style={{ color: '#94A3B8', fontSize: '14px' }}>До объекта</div>
                    <div style={{ fontWeight: '600', fontSize: '18px' }}>{selectedOrder.address}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <a 
                    href={`https://2gis.ru/dir/534687/70000001000000000?from=534687%2C70000001000000000&to=${encodeURIComponent(selectedOrder.address || '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      padding: '18px', 
                      background: '#10B981', 
                      color: 'white', 
                      textAlign: 'center', 
                      borderRadius: '16px',
                      textDecoration: 'none',
                      fontSize: '17px',
                      fontWeight: '600',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px'
                    }}
                  >
                    🚛 Построить маршрут в 2ГИС
                  </a>

                  <a 
                    href={`https://yandex.ru/maps/?ll=34.415968,53.254623&z=12&mode=route&rtext=Брянск,%20Орловский%20тупик,%206~${encodeURIComponent(selectedOrder.address || '')}&rtt=auto`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      padding: '18px', 
                      background: '#3B82F6', 
                      color: 'white', 
                      textAlign: 'center', 
                      borderRadius: '16px',
                      textDecoration: 'none',
                      fontSize: '17px',
                      fontWeight: '600',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px'
                    }}
                  >
                    🗺️ Построить маршрут в Яндекс.Картах
                  </a>

                  <a 
                    href={`https://www.google.com/maps/dir/?api=1&origin=Брянск,+Орловский+тупик,+6&destination=${encodeURIComponent(selectedOrder.address || '')}&travelmode=driving`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      padding: '18px', 
                      background: '#EF4444', 
                      color: 'white', 
                      textAlign: 'center', 
                      borderRadius: '16px',
                      textDecoration: 'none',
                      fontSize: '17px',
                      fontWeight: '600',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px'
                    }}
                  >
                    🗺️ Построить маршрут в Google Maps
                  </a>
                </div>

                <div style={{ textAlign: 'center', marginTop: '28px', color: '#64748B', fontSize: '14px' }}>
                  Нажмите на кнопку — маршрут откроется в новой вкладке
                </div>
              </div>
            </div>

            <div style={{ marginTop: '40px', textAlign: 'center' }}>
              <button 
                onClick={() => setSelectedOrder(null)}
                style={{ 
                  padding: '16px 52px', 
                  background: '#334155', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '9999px', 
                  fontSize: '17px',
                  fontWeight: '600'
                }}
              >
                Закрыть карточку
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewOrderModal && (
    <NewOrderModal 
       onClose={() => setShowNewOrderModal(false)} 
       onSuccess={(newOrder) => {
         if (newOrder) {
           // Оптимистический апдейт — сразу добавляем в список
          setAllOrders(prev => [newOrder, ...prev]);
        }
       // Можно добавить небольшую задержку или оставить как есть
     }} 
   />
 )}
    </div>
  );
}