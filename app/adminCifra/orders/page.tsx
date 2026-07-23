'use client';

import { useState, useEffect, Fragment } from 'react';
import { Order } from '../hooks/useCalendarOrders';
import { useRealtimeOrders } from '../../../hooks/useRealtimeOrders';
import ModalSelect from '../components/ModalSelect';

export default function OrdersPage() {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  // ==================== REALTIME — НОВЫЕ ЗАКАЗЫ ====================
  useRealtimeOrders(setAllOrders);

  // Загружаем ВСЕ заказы (без ограничения по месяцу)
  useEffect(() => {
    const fetchAllOrders = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/adminCifra/all-orders');
        if (res.ok) {
          const data = await res.json();
          setAllOrders(data);
          setFilteredOrders(data);
        }
      } catch (err) {
        console.error('Ошибка загрузки всех заказов:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAllOrders();
  }, []);

  // Фильтрация
  useEffect(() => {
    let result = [...allOrders];

    if (search) {
      result = result.filter(order => {
        const client = (
          ((order as any).organization_name || '') + 
          ' ' + 
          ((order as any).full_name || '')
        ).trim().toLowerCase();
        
        return client.includes(search.toLowerCase()) || 
               String(order.id).includes(search);
      });
    }

    if (statusFilter !== 'all') {
      result = result.filter(order => order.status === statusFilter);
    }

    // Сортировка по дате (новые сверху)
    result.sort((a, b) => new Date(b.delivery_date).getTime() - new Date(a.delivery_date).getTime());

    setFilteredOrders(result);
  }, [allOrders, search, statusFilter]);

  const updateStatus = async (orderId: string | number, newStatus: string) => {
    const stringId = String(orderId);   // ← безопасное приведение

    // Оптимистическое обновление
    setAllOrders(prev =>
      prev.map(order =>
        String(order.id) === stringId 
          ? { ...order, status: newStatus } 
          : order
      )
    );

    try {
      const res = await fetch('/api/adminCifra/orders/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: stringId,
          status: newStatus,
          userName: localStorage.getItem('userName') || undefined,
          userRole: localStorage.getItem('userRole') || undefined,
        }),
      });

      if (!res.ok) {
        alert('Не удалось изменить статус');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения');
    }
  };

  const groupedByDate: { [date: string]: Order[] } = {};
  filteredOrders.forEach(order => {
    const date = order.delivery_date.split('T')[0]; // нормализуем дату
    if (!groupedByDate[date]) groupedByDate[date] = [];
    groupedByDate[date].push(order);
  });

  const sortedDates = Object.keys(groupedByDate).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  if (loading) {
    return <div style={{ padding: '100px', textAlign: 'center' }}>Загрузка всех заказов...</div>;
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: '1600px', margin: '0 auto', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: '600' }}>Все заказы</h1>
        <p style={{ color: '#94A3B8', fontSize: '15px' }}>
          Всего: <strong>{filteredOrders.length}</strong>
        </p>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <input
          type="text"
          placeholder="Поиск по клиенту или № заказа..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            maxWidth: '420px',
            padding: '12px 20px',
            backgroundColor: '#334155',
            border: 'none',
            borderRadius: '12px',
            color: '#fff',
            fontSize: '15px'
          }}
        />
        <ModalSelect
          value={statusFilter}
          onChange={setStatusFilter}
          minPopupWidth={180}
          triggerStyle={{
            padding: '12px 20px',
            background: '#334155',
            border: 'none',
            borderRadius: 12,
            color: '#fff',
            fontSize: 15,
            boxShadow: 'none',
            minWidth: 180,
          }}
          options={[
            { value: 'all', label: 'Все статусы', text: 'Все статусы' },
            { value: 'new', label: 'Новый', text: 'Новый' },
            { value: 'processing', label: 'В работе', text: 'В работе' },
            { value: 'completed', label: 'Выполнена', text: 'Выполнена' },
            { value: 'cancelled', label: 'Отменена', text: 'Отменена' },
          ]}
        />
      </div>

      <div style={{ backgroundColor: '#1E2937', borderRadius: '16px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#334155' }}>
              <th style={{ padding: '18px 20px', textAlign: 'left', fontWeight: '500', color: '#94A3B8', width: '80px' }}>№</th>
              <th style={{ padding: '18px 20px', textAlign: 'left', fontWeight: '500', color: '#94A3B8', width: '110px' }}>Дата</th>
              <th style={{ padding: '18px 20px', textAlign: 'left', fontWeight: '500', color: '#94A3B8' }}>Клиент</th>
              <th style={{ padding: '18px 20px', textAlign: 'left', fontWeight: '500', color: '#94A3B8', width: '100px' }}>Объём</th>
              <th style={{ padding: '18px 20px', textAlign: 'left', fontWeight: '500', color: '#94A3B8' }}>Адрес</th>
              <th style={{ padding: '18px 20px', textAlign: 'left', fontWeight: '500', color: '#94A3B8', width: '140px' }}>Статус</th>
              <th style={{ padding: '18px 20px', textAlign: 'center', fontWeight: '500', color: '#94A3B8', width: '280px' }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {sortedDates.map(date => (
              <Fragment key={date}>
                <tr style={{ backgroundColor: '#25334A' }}>
                  <td colSpan={7} style={{ padding: '14px 20px', fontSize: '15px', fontWeight: '600', color: '#10B981' }}>
                    {new Date(date).toLocaleDateString('ru-RU', { 
                      weekday: 'short', 
                      day: 'numeric', 
                      month: 'long', 
                      year: 'numeric' 
                    })}
                  </td>
                </tr>

                {groupedByDate[date].map((order) => (
                  <tr key={order.id} style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '18px 20px', fontWeight: '600' }}>#{order.id}</td>
                    <td style={{ padding: '18px 20px' }}>{order.delivery_date}</td>
                    <td style={{ padding: '18px 20px' }}>
                      {(order as any).organization_name || (order as any).full_name || '—'}
                    </td>
                    <td style={{ padding: '18px 20px', fontWeight: '600', color: '#10B981' }}>{order.volume} м³</td>
                    <td style={{ padding: '18px 20px', fontSize: '14px', color: '#CBD5E1' }}>{order.address || '—'}</td>
                    <td style={{ padding: '18px 20px' }}>
                      <span style={{
                        padding: '6px 18px',
                        borderRadius: '9999px',
                        fontSize: '13px',
                        fontWeight: '600',
                        backgroundColor: order.status === 'new' ? '#fef9c3' : 
                                        order.status === 'processing' ? '#dbeafe' :
                                        order.status === 'completed' ? '#dcfce7' : '#fee2e2',
                        color: order.status === 'new' ? '#854d0e' :
                               order.status === 'processing' ? '#1e40af' :
                               order.status === 'completed' ? '#166534' : '#b91c1c'
                      }}>
                        {order.status === 'new' && 'Новая'}
                        {order.status === 'processing' && 'В работе'}
                        {order.status === 'completed' && 'Выполнена'}
                        {order.status === 'cancelled' && 'Отменена'}
                      </span>
                    </td>
                    <td style={{ padding: '18px 20px' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                        <button onClick={() => updateStatus(order.id, 'new')} style={{ padding: '5px 12px', fontSize: '12.5px', borderRadius: '9999px', background: '#fef9c3', color: '#854d0e', border: 'none' }}>Новый</button>
                        <button onClick={() => updateStatus(order.id, 'processing')} style={{ padding: '5px 12px', fontSize: '12.5px', borderRadius: '9999px', background: '#dbeafe', color: '#1e40af', border: 'none' }}>В работе</button>
                        <button onClick={() => updateStatus(order.id, 'completed')} style={{ padding: '5px 12px', fontSize: '12.5px', borderRadius: '9999px', background: '#dcfce7', color: '#166534', border: 'none' }}>Выполнена</button>
                        <button onClick={() => updateStatus(order.id, 'cancelled')} style={{ padding: '5px 12px', fontSize: '12.5px', borderRadius: '9999px', background: '#fee2e2', color: '#b91c1c', border: 'none' }}>Отменена</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}