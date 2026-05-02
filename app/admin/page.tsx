'use client';

import { useEffect, useState } from 'react';

export default function AdminPanel() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'days' | 'calendar'>('table');
  const [search, setSearch] = useState('');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [userId, setUserId] = useState<number | null>(null);

  const loadOrders = async () => {
    if (!userId) {
      console.log('❌ loadOrders: userId отсутствует');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/orders?userId=${userId}`, { cache: 'no-store' });
      console.log('📡 /api/admin/orders запрос для userId:', userId);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (orderId: number, newStatus: string) => {
    await fetch('/api/admin/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, status: newStatus, userId: userId }),
    });
    loadOrders();
  };

  // Получаем userId из localStorage
  useEffect(() => {
    const savedUserId = localStorage.getItem('userId');
    console.log('Admin page - savedUserId from localStorage:', savedUserId);

    if (savedUserId) {
      const id = parseInt(savedUserId, 10);
      if (!isNaN(id)) {
        setUserId(id);
      }
    }
  }, []);

  useEffect(() => {
    if (!userId) return;

    // Получаем реальную роль пользователя
    fetch('/api/user/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userId }),
    })
      .then(res => {
        console.log('Role response status:', res.status);
        return res.json();
      })
      .then(data => {
        console.log('Role data received:', data);
        console.log('Role value specifically:', data.role);
        setUserRole(data.role || 'client');
      })
      .catch((e) => {
        console.error('Role fetch error:', e);
        setUserRole('client');
      });

    loadOrders();
  }, [userId]);

  // Проверка доступа
  if (!userRole || (userRole !== 'admin' && userRole !== 'manager' && userRole !== 'dispatcher')) {
    return (
      <div style={{ padding: '100px 20px', textAlign: 'center', fontSize: '18px', color: '#666' }}>
        У вас нет прав доступа к админ-панели.<br />
        Текущая роль: <strong>{userRole || 'не определена'}</strong>
      </div>
    );
  }

  const groupedByDate = orders.reduce((acc: any, order: any) => {
    const date = order.delivery_date || order.created_at?.split('T')[0];
    if (!acc[date]) acc[date] = [];
    acc[date].push(order);
    return acc;
  }, {});

  const generateCalendarDays = () => {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const days = [];

    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({ date: dateStr, day });
    }
    return days;
  };

  const calendarDays = generateCalendarDays();

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
    setExpandedDate(null);
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
    setExpandedDate(null);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '10px' }}>Админ-панель — Управление заказами</h1>
      <p style={{ marginBottom: '30px', color: '#2563eb', fontWeight: '600' }}>
        Ваша роль: <strong>{userRole}</strong> | ID: <strong>{userId}</strong>
      </p>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '25px', flexWrap: 'wrap' }}>
        <button onClick={() => setViewMode('table')} style={{ padding: '12px 24px', background: viewMode === 'table' ? '#2563eb' : '#f1f5f9', color: viewMode === 'table' ? 'white' : '#333', border: 'none', borderRadius: '12px', fontWeight: '600' }}>Таблица</button>
        <button onClick={() => setViewMode('days')} style={{ padding: '12px 24px', background: viewMode === 'days' ? '#2563eb' : '#f1f5f9', color: viewMode === 'days' ? 'white' : '#333', border: 'none', borderRadius: '12px', fontWeight: '600' }}>По дням</button>
        <button onClick={() => setViewMode('calendar')} style={{ padding: '12px 24px', background: viewMode === 'calendar' ? '#2563eb' : '#f1f5f9', color: viewMode === 'calendar' ? 'white' : '#333', border: 'none', borderRadius: '12px', fontWeight: '600' }}>Календарь</button>
      </div>

      <input
        type="text"
        placeholder="Поиск..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ padding: '12px 16px', width: '100%', maxWidth: '500px', borderRadius: '10px', border: '1px solid #ddd', marginBottom: '25px' }}
      />

      {/* ТАБЛИЦА */}
      {viewMode === 'table' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th style={{ padding: '14px', textAlign: 'left' }}>ID</th>
              <th style={{ padding: '14px', textAlign: 'left' }}>Дата и время</th>
              <th style={{ padding: '14px', textAlign: 'left' }}>Клиент</th>
              <th style={{ padding: '14px', textAlign: 'left' }}>Бетон</th>
              <th style={{ padding: '14px', textAlign: 'left' }}>Объём</th>
              <th style={{ padding: '14px', textAlign: 'left' }}>Сумма</th>
              <th style={{ padding: '14px', textAlign: 'left' }}>Статус</th>
              <th style={{ padding: '14px' }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '14px', fontWeight: '600' }}>#{order.id}</td>
                <td style={{ padding: '14px' }}>{order.delivery_date} {order.delivery_time}</td>
                <td style={{ padding: '14px' }}>{order.full_name || order.organization_name || '—'}</td>
                <td style={{ padding: '14px' }}>{order.grade}</td>
                <td style={{ padding: '14px' }}>{order.volume} м³</td>
                <td style={{ padding: '14px', fontWeight: '700', color: '#2563eb' }}>{order.total_price?.toLocaleString('ru-RU')} ₽</td>
                <td style={{ padding: '14px' }}>
                  <span style={{ 
                    padding: '6px 14px', 
                    borderRadius: '9999px', 
                    fontSize: '13px', 
                    fontWeight: '600',
                    backgroundColor: 
                      order.status === 'completed' ? '#dcfce7' : 
                      order.status === 'processing' ? '#dbeafe' : 
                      order.status === 'cancelled' ? '#fee2e2' : '#fef9c3',
                    color: 
                      order.status === 'completed' ? '#166534' : 
                      order.status === 'processing' ? '#1e40af' : 
                      order.status === 'cancelled' ? '#b91c1c' : '#854d0e'
                  }}>
                    {order.status === 'new' && 'Новая'}
                    {order.status === 'processing' && 'В работе'}
                    {order.status === 'completed' && 'Выполнена'}
                    {order.status === 'cancelled' && 'Отменена'}
                  </span>
                </td>
                <td style={{ padding: '14px' }}>
                  <select 
                    value={order.status || 'new'} 
                    onChange={(e) => updateStatus(order.id, e.target.value)} 
                    style={{ padding: '8px', borderRadius: '8px' }}
                  >
                    <option value="new">Новая</option>
                    <option value="processing">В работе</option>
                    <option value="completed">Выполнена</option>
                    <option value="cancelled">Отменена</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ПО ДНЯМ */}
      {viewMode === 'days' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {Object.keys(groupedByDate).sort().reverse().map(date => {
            const dayOrders = groupedByDate[date];
            const daySum = dayOrders.reduce((sum: number, o: any) => sum + (o.total_price || 0), 0);

            return (
              <div key={date} style={{ background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <strong style={{ fontSize: '18px' }}>
                    {new Date(date).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </strong>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#2563eb' }}>
                    {daySum.toLocaleString('ru-RU')} ₽
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {dayOrders.map((order: any) => (
                    <div key={order.id} style={{ padding: '18px', background: '#f8fafc', borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '20px' }}>
                      <div style={{ flex: 1 }}>
                        <strong>#{order.id} — {order.grade} — {order.volume} м³</strong>
                        <div style={{ marginTop: '6px', color: '#444' }}>{order.full_name || order.organization_name}</div>
                        <div style={{ color: '#555', fontSize: '15px' }}>{order.address}</div>
                        <div style={{ color: '#555', fontSize: '15px', marginTop: '4px' }}>
                          {order.delivery_date} в {order.delivery_time}
                        </div>
                        {order.comment && (
                          <div style={{ marginTop: '12px', padding: '10px', background: 'white', borderRadius: '8px', fontSize: '14px', color: '#444', borderLeft: '4px solid #eab308' }}>
                            💬 {order.comment}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        <button onClick={(e) => { e.stopPropagation(); updateStatus(order.id, 'new'); }} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: order.status === 'new' ? '#fef9c3' : '#f1f5f9', color: order.status === 'new' ? '#854d0e' : '#666', fontSize: '13px', fontWeight: '600' }}>Новая</button>
                        <button onClick={(e) => { e.stopPropagation(); updateStatus(order.id, 'processing'); }} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: order.status === 'processing' ? '#dbeafe' : '#f1f5f9', color: order.status === 'processing' ? '#1e40af' : '#666', fontSize: '13px', fontWeight: '600' }}>В работе</button>
                        <button onClick={(e) => { e.stopPropagation(); updateStatus(order.id, 'completed'); }} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: order.status === 'completed' ? '#dcfce7' : '#f1f5f9', color: order.status === 'completed' ? '#166534' : '#666', fontSize: '13px', fontWeight: '600' }}>Выполнена</button>
                        <button onClick={(e) => { e.stopPropagation(); updateStatus(order.id, 'cancelled'); }} style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: order.status === 'cancelled' ? '#fee2e2' : '#f1f5f9', color: order.status === 'cancelled' ? '#b91c1c' : '#666', fontSize: '13px', fontWeight: '600' }}>Отменена</button>
                      </div>

                      <div style={{ fontWeight: '700', color: '#2563eb', minWidth: '110px', textAlign: 'right' }}>
                        {order.total_price?.toLocaleString('ru-RU')} ₽
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ==================== КАЛЕНДАРЬ ==================== */}
      {viewMode === 'calendar' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <button onClick={prevMonth} style={{ padding: '10px 20px', fontSize: '18px' }}>← Предыдущий</button>
            <h2 style={{ margin: 0 }}>
              {new Date(currentYear, currentMonth).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
            </h2>
            <button onClick={nextMonth} style={{ padding: '10px 20px', fontSize: '18px' }}>Следующий →</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px' }}>
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => (
              <div key={day} style={{ textAlign: 'center', fontWeight: '600', padding: '10px', color: '#666' }}>{day}</div>
            ))}

            {calendarDays.map((dayInfo, index) => {
              if (!dayInfo) return <div key={index} style={{ height: '130px' }}></div>;

              const { date, day } = dayInfo;
              const dayOrders = groupedByDate[date] || [];
              
              // Суммарный объём бетона
              const dayVolume = dayOrders.reduce((sum: number, o: any) => {
                return sum + parseFloat(o.volume || 0);
              }, 0);

              const isExpanded = expandedDate === date;

              return (
                <div 
                  key={date}
                  onClick={() => setExpandedDate(isExpanded ? null : date)}
                  style={{
                    height: '160px',
                    background: dayOrders.length > 0 ? '#f0f9ff' : '#fafafa',
                    border: isExpanded ? '2px solid #2563eb' : '1px solid #e5e7eb',
                    borderRadius: '12px',
                    padding: '12px',
                    cursor: 'pointer',
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column'
                  }}
                >
                  <div style={{ fontWeight: '600', fontSize: '18px' }}>{day}</div>

                  {dayOrders.length > 0 ? (
                    <>
                      <div style={{ 
                        fontSize: '26px', 
                        fontWeight: '700', 
                        color: '#2563eb', 
                        marginTop: '8px' 
                      }}>
                        {dayVolume.toFixed(1)} м³
                      </div>
                      <div style={{ fontSize: '13px', color: '#666' }}>
                        {dayOrders.length} заявок
                      </div>
                    </>
                  ) : (
                    <div style={{ color: '#aaa', fontSize: '13px', marginTop: '40px' }}>Заказов нет</div>
                  )}

                  {isExpanded && dayOrders.length > 0 && (
                    <div style={{ 
                      position: 'absolute', 
                      top: '100%', 
                      left: 0, 
                      right: 0, 
                      background: 'white', 
                      border: '1px solid #ddd', 
                      borderRadius: '8px', 
                      marginTop: '6px', 
                      padding: '12px', 
                      zIndex: 10, 
                      boxShadow: '0 4px 15px rgba(0,0,0,0.15)' 
                    }}>
                      {dayOrders.map((order: any) => (
                        <div key={order.id} style={{ padding: '6px 0', borderBottom: '1px solid #eee', fontSize: '14px' }}>
                          <strong>#{order.id}</strong> — {order.grade} — {order.volume} м³ в {order.delivery_time}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}