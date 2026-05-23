'use client';

import { useState, useEffect, useCallback } from 'react';
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
  const [newOrderInitialData, setNewOrderInitialData] = useState<any>(null);
  const [orderHistory, setOrderHistory] = useState<any[]>([]);
  
  const [notificationSent, setNotificationSent] = useState(false);
  const [isSendingNotification, setIsSendingNotification] = useState(false);
 

  // ==================== ЗАГРУЗКА ИСТОРИИ ИЗМЕНЕНИЙ ====================
  const loadOrderHistory = useCallback(async (orderId: number) => {
    try {
      const res = await fetch(`/api/adminCifra/orders/${orderId}/history`);
      if (res.ok) {
        const data = await res.json();
        setOrderHistory(data);
      } else {
        setOrderHistory([]);
      }
    } catch (err) {
      console.error('Ошибка загрузки истории:', err);
      setOrderHistory([]);
    }
  }, []);

  // ==================== ОТКРЫТИЕ ЗАЯВКИ С ИСТОРИЕЙ ====================
  const handleOpenOrder = useCallback((order: Order) => {
    setSelectedOrder(order);
    const orderId = order.id ? Number(order.id) : null;
    if (orderId) {
      loadOrderHistory(orderId);
    } else {
      console.error('У заявки отсутствует id:', order);
    }
  }, [loadOrderHistory]);

                // ==================== ЗАГРУЗКА РОЛИ ====================
  const [currentRole, setCurrentRole] = useState<string>('');

  useEffect(() => {
    const loadRole = async () => {
      console.log('🔄 Запуск загрузки роли...');

      const savedRole = localStorage.getItem('userRole');
      if (savedRole) {
        const role = savedRole.toLowerCase();
        setCurrentRole(role);
        console.log('✅ Роль из localStorage:', role);
        return;
      }

      try {
        const res = await fetch('/api/user/role', { 
          method: 'POST',
          cache: 'no-store',
          credentials: 'include'
        });

        if (res.ok) {
          const data = await res.json();
          const role = (data.role || 'client').toLowerCase();
          setCurrentRole(role);
          localStorage.setItem('userRole', role);
          console.log('✅ Роль получена с сервера:', role);
        } else {
          console.warn('⚠️ API /api/user/role вернул ошибку, ставим admin');
          setCurrentRole('admin');
          localStorage.setItem('userRole', 'admin');
        }
      } catch (err) {
        console.error('❌ Ошибка запроса роли:', err);
        setCurrentRole('admin');
        localStorage.setItem('userRole', 'admin');
      }
    };

    loadRole();
  }, []);

  // ==================== УДАЛЕНИЕ ЗАЯВКИ ====================
  const handleDeleteOrder = async (orderId: number) => {
    if (!confirm('Вы уверены, что хотите удалить эту заявку? Действие необратимо.')) return;

    try {
      const res = await fetch(`/api/adminCifra/orders/${orderId}`, { method: 'DELETE' });

      if (res.ok) {
        alert('✅ Заявка успешно удалена');
        setSelectedOrder(null);
        setAllOrders(prev => prev.filter(o => String(o.id) !== String(orderId)));
      } else {
        alert('Ошибка при удалении заявки');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения с сервером');
    }
  };

  // ==================== РЕДАКТИРОВАНИЕ ЗАЯВКИ ====================
  const handleEditOrder = (order: any) => {
    const newAddress = prompt('Новый адрес:', order.address);
    if (newAddress === null) return;

    const newVolume = prompt('Новый объём (м³):', order.volume);
    if (newVolume === null) return;

    const updatedOrder = {
      ...order,
      address: newAddress,
      volume: parseFloat(newVolume),
    };

    fetch('/api/adminCifra/orders/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedOrder),
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert('✅ Заявка обновлена!');
        setSelectedOrder(updatedOrder);
        setAllOrders(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
      } else {
        alert('Ошибка обновления');
      }
    })
    .catch(() => alert('Ошибка соединения'));
  };

  // ==================== РУЧНАЯ ОТПРАВКА УВЕДОМЛЕНИЯ В MAX ====================
  const sendNotification = async (orderId: number) => {
    if (!orderId) return alert('ID заявки не найден');

    if (!confirm('Отправить обновлённую заявку в Max?')) return;

    setIsSendingNotification(true);

    try {
      const res = await fetch('/api/order/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });

      if (res.ok) {
        setNotificationSent(true);
        alert('✅ Уведомление успешно отправлено в Max!');
      } else {
        alert('Не удалось отправить уведомление');
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка отправки уведомления');
    } finally {
      setIsSendingNotification(false);
    }
  };

  // ==================== ПОДЕЛИТЬСЯ ЗАЯВКОЙ (ЧИСТЫЙ ТЕКСТ) ====================
  const shareOrder = (order: any) => {
    const shareText = `Заявка №${order.id}

Марка: ${order.grade}
Объём: ${order.volume} м³
Дата: ${order.delivery_date}
Время: ${order.delivery_time}

Адрес: ${order.address}

Тип: ${order.customer_type}
${order.customer_type?.includes('Юридическое') 
  ? `Организация: ${order.organization_name || '-'}`
  : `ФИО: ${order.full_name || '-'}`}

Телефон: ${order.phone}

Комментарий: ${order.comment || '-'}`.trim();

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(shareText).then(() => {
        alert('✅ Информация скопирована!\nМожно отправить клиенту.');
      }).catch(() => {
        fallbackCopyText(shareText);
      });
    } else {
      fallbackCopyText(shareText);
    }
  };

  // Fallback для случаев, когда clipboard API недоступен
  const fallbackCopyText = (text: string) => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      document.execCommand('copy');
      alert('✅ Информация скопирована!\nМожно отправить клиенту.');
    } catch (err) {
      alert('Не удалось скопировать текст. Скопируйте вручную.');
      console.error('Fallback copy failed', err);
    }

    document.body.removeChild(textArea);
  };

  // ==================== КОПИРОВАТЬ ЗАЯВКУ ====================
  const copyOrder = (order: any) => {
    const copiedData = {
      grade: order.grade,
      volume: order.volume,
      deliveryDate: order.delivery_date,
      deliveryTime: order.delivery_time,
      address: order.address,
      customerType: order.customer_type?.includes('Юридическое') ? 'legal' : 'physical',
      organizationName: order.organization_name || '',
      fullName: order.full_name || '',
      phone: order.phone,
      inn: order.inn || '',
      comment: order.comment || '',
    };

    setSelectedOrder(null);
    setNewOrderInitialData(copiedData);
    setShowNewOrderModal(true);

    console.log('📋 Данные заявки успешно скопированы:', copiedData);
  };

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
    }, 60000);

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
      (order.inn || '').includes(searchQuery);

    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;

    return matchesSearch && matchesStatus;
  });


  return (
    <div style={{ 
      padding: '32px 40px', 
      width: '100%',                    // занимает всю ширину
      maxWidth: '96%',                  // ← Здесь регулируй ширину (в процентах)
      margin: '0 auto', 
      color: '#fff',
      minHeight: 'calc(100vh - 80px)'
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
<div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

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

    {/* ==================== СПИСОК ЗАЯВОК СО СКРОЛЛОМ ==================== */}
  <div style={{ 
    flex: 1,
    background: '#1E2937', 
    borderRadius: '24px', 
    padding: '24px 32px',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '620px',
    overflow: 'hidden'
  }}>
    
    <div style={{ 
      flex: 1, 
      overflowY: 'auto', 
      display: 'flex', 
      flexDirection: 'column', 
      gap: '12px',
      paddingRight: '8px'
    }}>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px', color: '#64748B' }}>Загрузка заявок...</div>
      ) : filteredOrders.length > 0 ? filteredOrders.map((order: Order, index: number) => (
        <div
          key={order.id}
          onClick={() => handleOpenOrder(order)}   // ← Изменили на отдельную функцию
          style={{
            background: '#25334A',
            borderRadius: '16px',
            padding: '20px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '24px',
            transition: 'all 0.2s'
          }}
        >
          {/* Порядковый номер */}
          <div style={{ 
            width: '50px', 
            textAlign: 'center',
            color: '#64748B',
            fontWeight: '700',
            fontSize: '18px',
            userSelect: 'none'
          }}>
            {index + 1}
          </div>

          {/* Время */}
          <div style={{ width: '90px', fontWeight: '700', fontSize: '17px' }}>
            {order.delivery_time}
          </div>

          {/* Информация о заявке */}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: '600', fontSize: '17px' }}>
              #{order.id} — {order.organization_name || order.full_name || '—'}
            </div>
            <div style={{ color: '#94A3B8' }}>
              {order.grade} • {order.volume} м³
            </div>
          </div>

          {/* Статус */}
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
      )) : (
        <div style={{ textAlign: 'center', padding: '140px 0', color: '#64748B', fontSize: '18px' }}>
          По выбранным фильтрам ничего не найдено
        </div>
      )}
    </div>
  </div>
</div>


      {/* МОДАЛЬНОЕ ОКНО ЗАКАЗА — БЕЗ IFRAME */}
{selectedOrder && (
  <div 
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.94)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
    
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
          Редактирование заявки #{selectedOrder.id}
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
        
        {/* Левая колонка — Информация (с возможностью редактирования) */}
        <div>
          <h3 style={{ marginBottom: '18px', color: '#94A3B8' }}>Информация о заказе</h3>
          
          <div style={{ background: '#25334A', borderRadius: '16px', padding: '24px', lineHeight: '2' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px' }}>

              <div style={{ color: '#94A3B8' }}>Клиент</div>
              <input 
                value={selectedOrder.organization_name || selectedOrder.full_name || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, organization_name: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
              />

              {selectedOrder.inn !== undefined && (
                <>
                  <div style={{ color: '#94A3B8' }}>ИНН</div>
                  <input 
                    value={selectedOrder.inn || ''} 
                    onChange={(e) => setSelectedOrder({ ...selectedOrder, inn: e.target.value })}
                    style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
                  />
                </>
              )}

              <div style={{ color: '#94A3B8' }}>Телефон</div>
              <input 
                value={selectedOrder.phone || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, phone: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Марка бетона</div>
              <input 
                value={selectedOrder.grade || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, grade: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Объём</div>
              <input 
                type="number" 
                step="0.1"
                min="0.1"
                value={selectedOrder.volume || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, volume: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Дата доставки</div>
              <input 
                type="date" 
                value={selectedOrder.delivery_date ? selectedOrder.delivery_date.split('T')[0] : ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, delivery_date: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Время доставки</div>
              <input 
                type="time" 
                value={selectedOrder.delivery_time || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, delivery_time: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff' }}
              />

                <div style={{ color: '#94A3B8' }}>Статус заявки</div>
                <select 
                value={selectedOrder.status || 'new'} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, status: e.target.value })}
                style={{ 
                  background: '#334155', 
                  border: 'none', 
                  borderRadius: '8px', 
                  padding: '10px 12px', 
                  color: '#fff',
                  fontSize: '16px'
                }}
              >
                <option value="new">🟡 Новый</option>
                <option value="processing">🔵 В работе</option>
                <option value="completed">🟢 Выполнен</option>
                <option value="cancelled">🔴 Отменён</option>
                </select>

              <div style={{ color: '#94A3B8' }}>Адрес доставки</div>
              <textarea 
                value={selectedOrder.address || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, address: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '8px 12px', color: '#fff', minHeight: '70px', gridColumn: '2' }}
              />

            </div>
          </div>

          {/* Комментарий */}
          {selectedOrder.comment && (
            <div style={{ marginTop: '24px' }}>
              <h4 style={{ color: '#94A3B8', marginBottom: '8px' }}>Комментарий клиента</h4>
              <textarea 
                value={selectedOrder.comment} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, comment: e.target.value })}
                style={{ width: '95%', background: '#25334A', border: 'none', borderRadius: '16px', padding: '16px', color: '#fff', minHeight: '80px' }}
              />
            </div>
          )}
        </div>          
              
                            {/* Правая колонка — Маршрут + История */}
              <div>
                <h3 style={{ marginBottom: '20px', color: '#94A3B8' }}>Маршрут доставки</h3>
                
                <div style={{ background: '#25334A', borderRadius: '16px', padding: '24px', marginBottom: '24px' }}>
                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ color: '#94A3B8', fontSize: '14px' }}>От завода</div>
                    <div style={{ fontWeight: '600' }}>Брянск, Орловский тупик, 6</div>
                  </div>
                  <div>
                    <div style={{ color: '#94A3B8', fontSize: '14px' }}>До объекта</div>
                    <div style={{ fontWeight: '600', fontSize: '18px' }}>{selectedOrder.address}</div>
                  </div>
                </div>

                {/* Компактные кнопки маршрутов в одну строку */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '32px' }}>
                  <a 
                    href={`https://2gis.ru/dir/534687/70000001000000000?from=534687%2C70000001000000000&to=${encodeURIComponent(selectedOrder.address || '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      flex: 1,
                      padding: '12px 16px', 
                      background: '#10B981', 
                      color: 'white', 
                      textAlign: 'center', 
                      borderRadius: '12px',
                      textDecoration: 'none',
                      fontSize: '15px',
                      fontWeight: '600'
                    }}
                  >
                    2ГИС
                  </a>

                  <a 
                    href={`https://yandex.ru/maps/?ll=34.415968,53.254623&z=12&mode=route&rtext=Брянск,%20Орловский%20тупик,%206~${encodeURIComponent(selectedOrder.address || '')}&rtt=auto`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      flex: 1,
                      padding: '12px 16px', 
                      background: '#3B82F6', 
                      color: 'white', 
                      textAlign: 'center', 
                      borderRadius: '12px',
                      textDecoration: 'none',
                      fontSize: '15px',
                      fontWeight: '600'
                    }}
                  >
                    Яндекс
                  </a>

                  <a 
                    href={`https://www.google.com/maps/dir/?api=1&origin=Брянск,+Орловский+тупик,+6&destination=${encodeURIComponent(selectedOrder.address || '')}&travelmode=driving`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ 
                      flex: 1,
                      padding: '12px 16px', 
                      background: '#EF4444', 
                      color: 'white', 
                      textAlign: 'center', 
                      borderRadius: '12px',
                      textDecoration: 'none',
                      fontSize: '15px',
                      fontWeight: '600'
                    }}
                  >
                    Google
                  </a>
                </div>

                                               {/* ==================== ИСТОРИЯ ИЗМЕНЕНИЙ ==================== */}
                <div>
                  <h3 style={{ marginBottom: '12px', color: '#94A3B8' }}>История изменений</h3>
                  <div style={{ 
                    background: '#25334A', 
                    borderRadius: '16px', 
                    padding: '20px', 
                    height: '340px', 
                    overflowY: 'auto',
                    fontSize: '14px',
                    lineHeight: '1.6'
                  }}>
                    {orderHistory.length > 0 ? (
                      orderHistory.map((entry, index) => (
                        <div key={index} style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #334155' }}>
                          <div style={{ color: '#64748B', fontSize: '13px' }}>
                            {new Date(entry.created_at).toLocaleString('ru-RU')}
                          </div>
                          
                          <div>
                            <strong>{entry.user_role || entry.user_name || 'Администратор'}</strong> 
                            {' '}изменил 
                            <strong> {entry.field_name}</strong>
                          </div>
                          
                          <div style={{ fontSize: '13px', marginTop: '4px', color: '#CBD5E1' }}>
                            Было: <span style={{ color: '#94A3B8' }}>{entry.old_value || '—'}</span><br />
                            Стало: <span style={{ color: '#60A5FA' }}>{entry.new_value || '—'}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: '#64748B', textAlign: 'center', paddingTop: '100px' }}>
                        История изменений пока пустая
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            
        {/* ==================== КНОПКИ ДЕЙСТВИЙ ==================== */}
    <div style={{ marginTop: '40px', display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>

      {(currentRole === 'admin' || currentRole === 'manager') && (
        <>
                              {/* Сохранить изменения */}
          <button 
            onClick={async () => {
              const updatedOrder = { ...selectedOrder };

              try {
                const res = await fetch('/api/adminCifra/orders/update', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    ...selectedOrder,
                    userRole: currentRole,           // для совместимости
                   
                  })
                });

                if (res.ok) {
                  alert('✅ Изменения успешно сохранены!');
                  
                  setAllOrders(prev => 
                    prev.map(order => 
                      String(order.id) === String(selectedOrder.id) ? updatedOrder : order
                    )
                  );

                  loadOrderHistory(selectedOrder.id);
                } else {
                  alert('Ошибка сохранения изменений');
                }
              } catch (err) {
                console.error(err);
                alert('Ошибка соединения с сервером');
              }
            }}
            style={{ 
              padding: '10px 24px', 
              background: '#10B981', 
              color: 'white', 
              border: 'none', 
              borderRadius: '9999px', 
              fontWeight: '600',
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            💾 Сохранить
          </button>

          {/* Удалить заявку */}
          <button 
            onClick={() => handleDeleteOrder(selectedOrder.id)}
            style={{ 
              padding: '10px 24px', 
              background: '#EF4444', 
              color: 'white', 
              border: 'none', 
              borderRadius: '9999px', 
              fontWeight: '600',
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            🗑️ Удалить
          </button>

          {/* Отправить в Max */}
          <button 
            onClick={() => sendNotification(selectedOrder.id)}
            disabled={isSendingNotification}
            style={{ 
              padding: '10px 24px', 
              background: '#3B82F6', 
              color: 'white', 
              border: 'none', 
              borderRadius: '9999px', 
              fontWeight: '600',
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            📢 В Max
          </button>

          {/* Поделиться */}
          <button 
            onClick={() => shareOrder(selectedOrder)}
            style={{ 
              padding: '10px 24px', 
              background: '#8B5CF6', 
              color: 'white', 
              border: 'none', 
              borderRadius: '9999px', 
              fontWeight: '600',
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            🔗 Поделиться
          </button>

          {/* Копировать заявку */}
          <button 
            onClick={() => copyOrder(selectedOrder)}
            style={{ 
              padding: '10px 24px', 
              background: '#6366F1', 
              color: 'white', 
              border: 'none', 
              borderRadius: '9999px', 
              fontWeight: '600',
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            📋 Копировать заявку
          </button>
        </>
      )}

      {/* Отмена */}
      <button 
        onClick={() => setSelectedOrder(null)}
        style={{ 
          padding: '10px 24px', 
          background: '#475569', 
          color: 'white', 
          border: 'none', 
          borderRadius: '9999px', 
          fontWeight: '600',
          fontSize: '15px'
        }}
      >
        Отмена
      </button>
    </div>
    </div>
  </div>
)}


      {showNewOrderModal && (
  <NewOrderModal 
    onClose={() => {
      setShowNewOrderModal(false);
      setNewOrderInitialData(null);
    }} 
    onSuccess={(newOrder) => {
      if (newOrder) {
        setAllOrders(prev => [newOrder, ...prev]);
      }
    }} 
    initialData={newOrderInitialData}
    defaultDeliveryDate={selectedDateStr}     // ← Добавили передачу выбранной даты
  />
)}
    </div>
    </div>
  );
}