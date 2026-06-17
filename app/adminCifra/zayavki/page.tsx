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
  const [userFullName, setUserFullName] = useState<string>('');
  const [currentRole, setCurrentRole] = useState<string>('');
 
  
  const [notificationSent, setNotificationSent] = useState(false);
  const [isSendingNotification, setIsSendingNotification] = useState(false);

  const [recipes, setRecipes] = useState<any[]>([]);

  // ==================== HELPER ДЛЯ СТАТУСОВ (getStatusConfig) ====================
const getStatusConfig = (status: string) => {
  switch (status) {
    case 'new':
      return { label: 'Новая', bg: '#FACC1520', color: '#FACC15', final: false };
    case 'processing':
      return { label: 'В работе', bg: '#3B82F620', color: '#3B82F6', final: false };
    case 'completed':
      return { label: 'Выполнена', bg: '#10B98120', color: '#10B981', final: true };
    case 'cancelled':
      return { label: 'Отменена', bg: '#EF444420', color: '#EF4444', final: true };
    default:
      return { label: status, bg: '#64748B20', color: '#64748B', final: false };
  }
};

    // ==================== HELPER ДЛЯ ПРОВЕРКИ ПРАВ ====================
  const hasManagerPermissions = (role: string): boolean => {
    if (!role) return false;
    const r = role.toLowerCase().trim();
    return r === 'admin' || r === 'manager' || r === 'dispatcher' || r === 'logist';
  };

  const isAdmin = (role: string): boolean => {
    return role?.toLowerCase().trim() === 'admin';
  };
 

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

                  // ==================== ЗАГРУЗКА РОЛИ И РЕАЛЬНОГО ИМЕНИ ====================
useEffect(() => {
  const loadRoleAndName = async () => {
    const savedUserId = localStorage.getItem('userId');
    if (!savedUserId) {
      setCurrentRole('admin');
      setUserFullName('Сотрудник');
      return;
    }

    try {
      const res = await fetch('/api/user/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: savedUserId }),
        cache: 'no-store'
      });

      if (res.ok) {
        const data = await res.json();
        const role = (data.role || 'admin').toLowerCase();
        const name = data.full_name || data.username || data.name || 'Сотрудник';

        setCurrentRole(role);
        setUserFullName(name);

        localStorage.setItem('userRole', role);
        localStorage.setItem('userName', name);

        console.log(`✅ Загружено: ${name} (${role})`);
      } else {
        setCurrentRole('admin');
        setUserFullName('Сотрудник');
      }
    } catch (err) {
      console.error('❌ Ошибка загрузки роли/имени:', err);
      setCurrentRole('admin');
      setUserFullName('Сотрудник');
    }
  };

  loadRoleAndName();
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

  // ==================== 1. РАБОТА С ДАТАМИ (ИСПРАВЛЕНО) ====================
  // Новая функция — надёжно получает дату в локальном часовом поясе
  const getLocalDateString = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const selectedDateStr = getLocalDateString(selectedDate);

  // ==================== 2. ФИЛЬТРАЦИЯ ЗАЯВОК НА ВЫБРАННЫЙ ДЕНЬ (с часовым поясом) ====================
  const dayOrders = allOrders
    .filter((o: Order) => {
      if (!o?.delivery_date) return false;

      let orderDate: Date;

      if (typeof o.delivery_date === 'string') {
        // Если приходит строка — парсим как local дату
        orderDate = new Date(o.delivery_date);
      } else {
        orderDate = new Date(o.delivery_date);
      }

      // Приводим к локальной дате (учитываем часовой пояс пользователя)
      const orderDateStr = orderDate.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('.').reverse().join('-'); // YYYY-MM-DD

      const selectedStr = selectedDate.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('.').reverse().join('-');

      return orderDateStr === selectedStr;
    })
    .sort((a, b) => (a.delivery_time || '00:00').localeCompare(b.delivery_time || '00:00'));

    // Заявки на день
    // console.log(`📅 Выбранная дата: ${selectedDateStr} | Найдено заявок: ${dayOrders.length}`);

  // ==================== KPI ====================
  // Исключаем отменённые заявки из всех расчётов
  const activeOrders = dayOrders.filter((o: Order) => o.status !== 'cancelled');

  const totalVolume = activeOrders.reduce((sum: number, o: Order) => 
    sum + (Number(o.volume) || 0), 0);

  const completedVolume = activeOrders
    .filter((o: Order) => o.status === 'completed')
    .reduce((sum: number, o: Order) => 
      sum + (Number(o.volume) || 0), 0);

  const deliveriesCount = activeOrders.length;   // количество активных заявок

  const pprz = totalVolume > 0 
    ? Math.round((completedVolume / totalVolume) * 100) 
    : 0;

              // ==================== НЕДЕЛЯ (ПН - ВС) ====================
  const getWeekDays = () => {
    const days = [];
    const current = new Date(selectedDate);
    
    // Находим понедельник текущей недели
    const dayOfWeek = current.getDay(); // 0 = воскресенье, 1 = понедельник...
    const diff = current.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // сдвиг к понедельнику
    const monday = new Date(current);
    monday.setDate(diff);
    monday.setHours(12, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const weekDays = getWeekDays();

  // ==================== 4. ПОДСЧЁТ ЗАЯВОК НА ДЕНЬ ====================
  const getOrdersCountForDate = (date: Date) => {
    const dateStr = getLocalDateString(date);
    
    return allOrders.filter(o => {
      if (!o?.delivery_date) return false;
      
      let orderDateStr: string;
      if (typeof o.delivery_date === 'string') {
        orderDateStr = o.delivery_date.substring(0, 10);
      } else {
        orderDateStr = getLocalDateString(new Date(o.delivery_date));
      }
      return orderDateStr === dateStr;
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

       // ==================== ЗАГРУЗКА РЕЦЕПТОВ ====================
  useEffect(() => {
    const fetchRecipes = async () => {
      try {
        const res = await fetch('/api/adminCifra/recipes');
        if (res.ok) {
          const data = await res.json();
         // console.log('✅ Загружено рецептов из adminCifra:', data.length, data);
          setRecipes(data);
        } else {
          console.error('❌ Ошибка загрузки рецептов, статус:', res.status);
        }
      } catch (err) {
        console.error('❌ Ошибка загрузки рецептов:', err);
      }
    };

    fetchRecipes();
  }, []);

         // ==================== РАСЧЁТ ЦЕМЕНТА ====================
  const calculateCementNeeded = (onlyCompleted: boolean) => {
    // Исключаем отменённые заявки из расчётов
    let orders = dayOrders.filter((o: Order) => o.status !== 'cancelled');

    if (onlyCompleted) {
      orders = orders.filter((o: Order) => o.status === 'completed');
    }

    let totalKg = 0;

    // console.log(`📊 Расчёт цемента. Всего активных заказов на день: ${orders.length}`);

    orders.forEach((order: any, index: number) => {
      const grade = String(order.grade || '').trim();
      const volume = Number(order.volume || 0);

      if (volume <= 0) return;

      // Расширенный поиск рецепта
      let recipe = recipes.find(r => r.code === grade);
      if (!recipe) recipe = recipes.find(r => r.code === grade.replace('и', ''));
      if (!recipe) recipe = recipes.find(r => r.name?.includes(grade));

    // Лог для определения правильности рецептов в заявках
    // console.log(`   [${index}] Марка: "${grade}" → рецепт найден:`, recipe ? recipe.code : 'НЕ НАЙДЕН');

      if (recipe && recipe.cement) {
        totalKg += volume * Number(recipe.cement);
      }
    });

    const tons = (totalKg / 1000).toFixed(1);
    // console.log(`✅ Итого цемента: ${tons} т`);
    return tons;
  };

    // ==================== РАСЧЁТ ДОБАВОК (с поддержкой additive2 для растворов) ====================
  const calculateAdditiveNeeded = (onlyCompleted: boolean = false) => {
    let orders = dayOrders.filter((o: any) => o.status !== 'cancelled');
    if (onlyCompleted) {
      orders = orders.filter((o: any) => o.status === 'completed');
    }

    let totalKg = 0;

    orders.forEach((order: any) => {
      let grade = String(order.grade || '').trim();
      const volume = Number(order.volume || 0);
      if (volume <= 0 || !grade) return;

      // Поиск рецепта
      let recipe = recipes.find((r: any) => r.code === grade);
      if (!recipe) recipe = recipes.find((r: any) => r.code === grade.replace(/и$/, ''));
      if (!recipe) recipe = recipes.find((r: any) => grade.includes(r.code));
      if (!recipe) recipe = recipes.find((r: any) => r.name?.toLowerCase().includes(grade.toLowerCase()));

      if (!recipe) return;

      let additiveValue = 0;

      // Логика выбора колонки добавки
      if (recipe.type === 'mortar' && recipe.additive2 !== null && recipe.additive2 !== undefined) {
        additiveValue = Number(recipe.additive2);
      } else if (recipe.additive !== null && recipe.additive !== undefined) {
        additiveValue = Number(recipe.additive);
      }

      if (additiveValue > 0) {
        totalKg += volume * additiveValue;
      }
    });

    return totalKg.toFixed(1);   // в кг
  };


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
        <div style={{ fontSize: '32px', fontWeight: '700' }}>Заявки</div>
        
        
      </div>
    </div>

                              {/* ==================== KPI БАР ==================== */}
      <div style={{ 
        padding: '24px 40px', 
        background: '#1E2937', 
        display: 'flex', 
        gap: '60px', 
        borderBottom: '1px solid #334155',
        alignItems: 'center',
        flexWrap: 'wrap'
      }}>
        
        {/* Выполнено сегодня */}
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Выполнено сегодня</div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>
            {Math.round(completedVolume)} / <span style={{ opacity: 0.6, color: '#94A3B8' }}>{Math.round(totalVolume)}</span> м³
          </div>
        </div>

        {/* Понадобится цемента */}
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Понадобится цемента</div>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#60A5FA' }}>
            {calculateCementNeeded(true)} / 
            <span style={{ opacity: 0.6, color: '#94A3B8' }}>
              {Math.round(Number(calculateCementNeeded(false)))}
            </span> т
          </div>
        </div>

        {/* Понадобится добавок */}
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Понадобится добавок</div>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#FACC15' }}>
            {calculateAdditiveNeeded(true)} / 
            <span style={{ opacity: 0.6, color: '#94A3B8' }}>
              {Math.round(Number(calculateAdditiveNeeded(false)))}
            </span> кг
          </div>
        </div>

        {/* Доставок сегодня */}
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Доставок сегодня</div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>
            {deliveriesCount}
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
            minHeight: '1100px',                    // минимальная комфортная высота для 1920
            height: 'calc(100vh - 180px)',         // основная высота
            maxHeight: 'calc(80vh - 120px)',      // ограничение сверху на 4K
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            
            <h3 style={{ marginBottom: '20px', color: '#94A3B8', fontSize: '18px' }}>
              ЗАЯВКИ НА НЕДЕЛЮ
            </h3>

            {/* ==================== НАВИГАЦИЯ ПО НЕДЕЛЯМ ==================== */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '20px',
              color: '#CBD5E1',
              flexShrink: 0,
              gap: '16px'
            }}>
              <button 
                onClick={() => {
                  const newDate = new Date(selectedDate);
                  newDate.setDate(newDate.getDate() - 7);
                  setSelectedDate(newDate);
                }}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#94A3B8', 
                  fontSize: '32px', 
                  cursor: 'pointer',
                  padding: '8px 16px',
                  flexShrink: 0,
                  userSelect: 'none'
                }}
              >
                ←
              </button>

              <div style={{ 
                fontWeight: '700', 
                fontSize: '18px', 
                textAlign: 'center',
                flex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {selectedDate.toLocaleDateString('ru-RU', { 
                  month: 'long', 
                  year: 'numeric' 
                })}
              </div>

              <button 
                onClick={() => {
                  const newDate = new Date(selectedDate);
                  newDate.setDate(newDate.getDate() + 7);
                  setSelectedDate(newDate);
                }}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#94A3B8', 
                  fontSize: '32px', 
                  cursor: 'pointer',
                  padding: '8px 16px',
                  flexShrink: 0,
                  userSelect: 'none'
                }}
              >
                →
              </button>
            </div>

            {/* ==================== СПИСОК ДНЕЙ НЕДЕЛИ ==================== */}
<div style={{ 
  flex: 1, 
  overflowY: 'auto', 
  paddingRight: '8px'
}}>
  {weekDays.map((d: Date) => {
    const dateStr = d.toISOString().split('T')[0];
    const count = getOrdersCountForDate(d);
    const isSelected = dateStr === selectedDateStr;
    const isToday = d.toDateString() === new Date().toDateString();

    // Количество отменённых заявок в этот день
    const cancelledCount = dayOrders.filter(o => {
      const orderDate = typeof o.delivery_date === 'string' 
        ? o.delivery_date.substring(0, 10) 
        : new Date(o.delivery_date).toISOString().substring(0, 10);
      return orderDate === dateStr && o.status === 'cancelled';
    }).length;

    return (
      <div
        key={dateStr}
        onClick={() => setSelectedDate(d)}
        style={{
          padding: '16px 20px',
          marginBottom: '8px',
          background: isSelected ? '#3B82F620' : '#25334A',
          borderRadius: '16px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          border: isSelected ? '2px solid #3B82F6' : 'none',
          transition: 'all 0.2s ease',
          userSelect: 'none'
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
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Бейдж отменённых заявок — теперь СЛЕВА */}
          {cancelledCount > 0 && (
            <div style={{
              background: '#EF444420',
              color: '#EF4444',
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '13px',
              fontWeight: '600',
              border: '1px solid #EF444440'
            }}>
              -{cancelledCount}
            </div>
          )}

          {/* Основной счётчик активных заявок */}
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
      </div>
    );
  })}
</div>

{/* ==================== ГРАФИК ЗА НЕДЕЛЮ ==================== */}
<div style={{ 
  background: '#1E2937', 
  borderRadius: '16px', 
  padding: '20px 24px',
  marginBottom: '5px',
  height: '200px',
  position: 'relative'
}}>
  <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '12px', fontWeight: '600' }}>
    Объём по дням недели (м³)
  </div>

  <svg width="100%" height="120" viewBox="0 0 280 110" style={{ overflow: 'visible' }}>
    {/* Сетка */}
    {[0, 30, 60, 90, 120].map(y => (
      <line key={y} x1="0" y1={y} x2="280" y2={y} stroke="#334155" strokeWidth="1" />
    ))}

    {/* Линия графика */}
    <polyline
      points={weekDays.map((d, i) => {
        const dateStr = d.toISOString().split('T')[0];
        const dailyVolume = allOrders
          .filter(o => {
            if (!o?.delivery_date) return false;
            const orderDate = typeof o.delivery_date === 'string' 
              ? o.delivery_date.substring(0, 10) 
              : new Date(o.delivery_date).toISOString().split('T')[0];
            return orderDate === dateStr && o.status !== 'cancelled';
          })
          .reduce((sum, o) => sum + Number(o.volume || 0), 0);

        const maxVolume = Math.max(...weekDays.map(dd => {
          const ds = dd.toISOString().split('T')[0];
          return allOrders
            .filter(o => {
              const od = typeof o.delivery_date === 'string' ? o.delivery_date.substring(0,10) : new Date(o.delivery_date).toISOString().split('T')[0];
              return od === ds && o.status !== 'cancelled';
            })
            .reduce((s, o) => s + Number(o.volume || 0), 0);
        })) || 100;

        const x = 20 + i * 40;
        const y = 100 - (dailyVolume / (maxVolume || 1)) * 80;
        return `${x},${y}`;
      }).join(' ')}
      fill="none"
      stroke="#60A5FA"
      strokeWidth="3"
      strokeLinejoin="round"
      strokeLinecap="round"
    />

    {/* Точки на графике */}
    {weekDays.map((d, i) => {
      const dateStr = d.toISOString().split('T')[0];
      const dailyVolume = allOrders
        .filter(o => {
          if (!o?.delivery_date) return false;
          const orderDate = typeof o.delivery_date === 'string' 
            ? o.delivery_date.substring(0, 10) 
            : new Date(o.delivery_date).toISOString().split('T')[0];
          return orderDate === dateStr && o.status !== 'cancelled';
        })
        .reduce((sum, o) => sum + Number(o.volume || 0), 0);

      const maxVolume = Math.max(...weekDays.map(dd => {
        const ds = dd.toISOString().split('T')[0];
        return allOrders
          .filter(o => {
            const od = typeof o.delivery_date === 'string' ? o.delivery_date.substring(0,10) : new Date(o.delivery_date).toISOString().split('T')[0];
            return od === ds && o.status !== 'cancelled';
          })
          .reduce((s, o) => s + Number(o.volume || 0), 0);
      })) || 100;

      const x = 20 + i * 40;
      const y = 100 - (dailyVolume / (maxVolume || 1)) * 80;

      return (
        <g key={i}>
          <circle cx={x} cy={y} r="4" fill="#60A5FA" />
          <text x={x} y={y - 12} textAnchor="middle" fill="#94A3B8" fontSize="11">
            {Math.round(dailyVolume)}
          </text>
        </g>
      );
    })}

    {/* Подписи дней */}
    {weekDays.map((d, i) => {
      const x = 20 + i * 40;
      return (
        <text 
          key={i} 
          x={x} 
          y="118" 
          textAnchor="middle" 
          fill="#64748B" 
          fontSize="11"
        >
          {d.toLocaleDateString('ru-RU', { weekday: 'short' })}
        </text>
      );
    })}
  </svg>
</div>

                                    {/* ==================== РАЗДЕЛИТЕЛЬ + СВОДКА ЗА НЕДЕЛЮ ==================== */}
            <div style={{ marginTop: '12px', paddingTop: '16px', borderTop: '1px solid #334155' }}>
              <div style={{ 
                background: '#25334A', 
                borderRadius: '16px', 
                padding: '16px 18px',
                fontSize: '15px'
              }}>
                <div style={{ color: '#94A3B8', marginBottom: '12px', fontWeight: '600' }}>Итого за неделю</div>
                
                {/* 1. Количество заявок */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '15px' }}>Всего заявок:</span>
                  <strong style={{ fontSize: '17px' }}>
                    {weekDays.reduce((sum, d) => sum + getOrdersCountForDate(d), 0)}
                  </strong>
                </div>
                
                {/* 2. Запланировано */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '15px' }}>Запланировано:</span>
                  <strong style={{ fontSize: '17px' }}>
                    {Math.round(weekDays.reduce((sum, d) => {
                      const dateStr = getLocalDateString(d);
                      return sum + allOrders
                        .filter(o => {
                          if (!o?.delivery_date) return false;
                          const orderDate = typeof o.delivery_date === 'string' 
                            ? o.delivery_date.substring(0, 10) 
                            : getLocalDateString(new Date(o.delivery_date));
                          return orderDate === dateStr;
                        })
                        .reduce((v, o) => v + Number(o.volume || 0), 0);
                    }, 0))} м³
                  </strong>
                </div>

                {/* 3. Отгружено */}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '15px' }}>Отгружено:</span>
                  <strong style={{ fontSize: '17px', color: '#10B981' }}>
                    {Math.round(weekDays.reduce((sum, d) => {
                      const dateStr = getLocalDateString(d);
                      return sum + allOrders
                        .filter(o => {
                          if (!o?.delivery_date) return false;
                          const orderDate = typeof o.delivery_date === 'string' 
                            ? o.delivery_date.substring(0, 10) 
                            : getLocalDateString(new Date(o.delivery_date));
                          return orderDate === dateStr && o.status === 'completed';
                        })
                        .reduce((v, o) => v + Number(o.volume || 0), 0);
                    }, 0))} м³
                  </strong>
                </div>
              </div>

              <button 
                onClick={() => setShowNewOrderModal(true)}
                style={{
                  width: '100%',
                  marginTop: '12px',
                  padding: '14px',
                  background: '#10B981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                + Новая заявка
              </button>
              
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
    gap: '10px',
    paddingRight: '8px'
  }}>
    {loading ? (
      <div style={{ textAlign: 'center', padding: '100px', color: '#64748B' }}>Загрузка заявок...</div>
    ) : filteredOrders.length > 0 ? filteredOrders.map((order: Order, index: number) => (
      <div
  key={order.id}
  onClick={() => handleOpenOrder(order)}
  style={{
    background: '#25334A',
    borderRadius: '16px',
    padding: '16px 20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    transition: 'all 0.2s',
    minHeight: '14px',           // ← основная регулировка высоты строки
    flexShrink: 0
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

        {/* БЕЙДЖ "ПОД ВОПРОСОМ" */}
{(order as any).is_questionable && (
  <div style={{
    padding: '6px 14px',
    background: '#EF4444',
    color: 'white',
    fontSize: '13px',
    fontWeight: '700',
    borderRadius: '9999px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    boxShadow: '0 2px 6px rgba(239, 68, 68, 0.3)'
  }}>
    ⚠️ Под вопросом
  </div>
)}

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

            {/* ==================== СТАТУС + "ПОД ВОПРОСОМ" (в одну линию) ==================== */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '16px', 
        marginBottom: '28px',
        flexWrap: 'wrap'
      }}>
        
        {/* Статус */}
        <div style={{ 
          display: 'inline-block', 
          padding: '10px 26px', 
          borderRadius: '9999px', 
          fontWeight: '600',
          backgroundColor: getStatusColor(selectedOrder.status) + '20',
          color: getStatusColor(selectedOrder.status),
        }}>
          {selectedOrder.status === 'new' && '🟡 Новый заказ'}
          {selectedOrder.status === 'processing' && '🔵 В работе'}
          {selectedOrder.status === 'completed' && '🟢 Выполнен'}
          {selectedOrder.status === 'cancelled' && '🔴 Отменён'}
        </div>

        {/* Чекбокс "Под вопросом" */}
        {hasManagerPermissions(currentRole) && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '8px', 
            background: '#25334A', 
            padding: '10px 18px', 
            borderRadius: '9999px',
            fontSize: '15px'
          }}>
            <input 
              type="checkbox" 
              id="isQuestionable"
              checked={selectedOrder?.is_questionable || false}
              onChange={async (e) => {
                const newValue = e.target.checked;
                
                const res = await fetch('/api/adminCifra/orders/update', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    id: selectedOrder.id,
                    is_questionable: newValue,
                    userRole: currentRole
                  })
                });

                if (res.ok) {
                  setSelectedOrder((prev: any) => ({
                    ...prev,
                    is_questionable: newValue
                  }));

                  setAllOrders((prev: any[]) => prev.map((o: any) => 
                    o.id === selectedOrder.id 
                      ? { ...o, is_questionable: newValue } 
                      : o
                  ));
                }
              }}
              style={{ width: '20px', height: '20px', accentColor: '#EF4444' }}
            />
            <label 
              htmlFor="isQuestionable" 
              style={{ 
                color: '#F87171', 
                fontWeight: '600', 
                cursor: 'pointer',
                userSelect: 'none'
              }}
            >
              Под вопросом
            </label>
          </div>
        )}
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
                
                {getStatusConfig(selectedOrder.status).final ? (
                  // ==================== ФИНАЛЬНЫЕ СТАТУСЫ — ЗАЩИЩЕНЫ ====================
                  <div style={{ 
                    backgroundColor: getStatusConfig(selectedOrder.status).bg,
                    color: getStatusConfig(selectedOrder.status).color,
                    padding: '12px 20px',
                    borderRadius: '16px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: '600',
                    fontSize: '16px',
                    width: '88%'
                  }}>
                    {getStatusConfig(selectedOrder.status).label} — конечный статус
                  </div>
                ) : (
                  // Можно менять
                  <select 
                    value={selectedOrder.status || 'new'} 
                    onChange={(e) => setSelectedOrder({ ...selectedOrder, status: e.target.value })}
                    style={{ 
                      background: '#334155', 
                      border: 'none', 
                      borderRadius: '8px', 
                      padding: '10px 12px', 
                      color: '#fff',
                      fontSize: '16px',
                      width: '100%'
                    }}
                  >
                    <option value="new">🟡 Новый</option>
                    <option value="processing">🔵 В работе</option>
                    <option value="completed">🟢 Выполнен</option>
                    <option value="cancelled">🔴 Отменён</option>
                  </select>
                )}

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
    {orderHistory.length > 0 ? orderHistory.map((entry, index) => {
      const actionText = entry.action === 'Создал заявку' 
        ? 'Создал заявку' 
        : entry.action;

      let newValueDisplay = entry.new_value;
      let statusColor = '#CBD5E1';

      if (entry.field_name === 'status' || entry.action === 'Создал заявку') {
        if (entry.new_value === 'new' || entry.new_value === null) {
          newValueDisplay = 'Новая';
          statusColor = '#FACC15';           // Жёлтый
        } else if (entry.new_value === 'processing') {
          newValueDisplay = 'В работе';
          statusColor = '#3B82F6';           // Синий
        } else if (entry.new_value === 'completed') {
          newValueDisplay = 'Выполнена';
          statusColor = '#10B981';           // Зелёный
        } else if (entry.new_value === 'cancelled') {
          newValueDisplay = 'Отменена';
          statusColor = '#EF4444';           // Красный
        }
      }

      let oldValueDisplay = entry.old_value;
      if (entry.field_name === 'status') {
        if (entry.old_value === 'new') oldValueDisplay = 'Новая';
        else if (entry.old_value === 'processing') oldValueDisplay = 'В работе';
        else if (entry.old_value === 'completed') oldValueDisplay = 'Выполнена';
        else if (entry.old_value === 'cancelled') oldValueDisplay = 'Отменена';
      }

      return (
        <div key={index} style={{ 
          marginBottom: '16px', 
          paddingBottom: '12px', 
          borderBottom: index < orderHistory.length - 1 ? '1px solid #334155' : 'none' 
        }}>
          <div style={{ color: '#94A3B8', fontSize: '13px' }}>
            {new Date(entry.created_at).toLocaleString('ru-RU')}
          </div>
          
          <div style={{ marginTop: '4px', fontWeight: '600' }}>
            {actionText}
          </div>
          
          <div style={{ color: '#60A5FA', marginTop: '2px' }}>
            {entry.user_name} 
            {entry.user_role && entry.user_role !== 'unknown' && (
              <span style={{ color: '#94A3B8', fontSize: '13px' }}> ({entry.user_role})</span>
            )}
          </div>

          {entry.field_name && (
            <div style={{ marginTop: '6px', color: '#CBD5E1' }}>
              {entry.field_name}: 
              <span style={{ color: '#EF4444' }}> {oldValueDisplay || '—'} </span> 
              → 
              <span style={{ color: statusColor, fontWeight: '600' }}> 
                {newValueDisplay || '—'}
              </span>
            </div>
          )}
        </div>
      );
    }) : (
      <div style={{ color: '#64748B', textAlign: 'center', padding: '60px 0' }}>
        История изменений пуста
      </div>
    )}
  </div>
</div>
              </div>
            </div>
            
        {/* ==================== КНОПКИ ДЕЙСТВИЙ ==================== */}
    <div style={{ marginTop: '40px', display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>

      { hasManagerPermissions(currentRole) && (
        <>
                              {/* Сохранить изменения */}
<button 
  onClick={async () => {
    console.log('🟡 Сохраняем. userFullName =', userFullName);   // ← Добавили

    const updatedOrder = { ...selectedOrder };

    try {
      const payload = {
        id: selectedOrder.id,
        ...selectedOrder,
        userRole: currentRole || 'admin',
        userName: userFullName || 'Сотрудник'
      };

      console.log('📤 Отправляем в API payload.userName =', payload.userName);   // ← Добавили

      const res = await fetch('/api/adminCifra/orders/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        alert('✅ Изменения успешно сохранены!');
        setAllOrders(prev => prev.map(order => String(order.id) === String(selectedOrder.id) ? updatedOrder : order));
        if (typeof loadOrderHistory === 'function') loadOrderHistory(selectedOrder.id);
      } else {
        const errorData = await res.json().catch(() => ({}));
        alert(errorData.message || 'Ошибка сохранения');
      }
    } catch (err) {
      console.error('Ошибка сохранения:', err);
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
  isOpen={showNewOrderModal}
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
    defaultDeliveryDate={selectedDateStr}
    currentRole={currentRole}
    currentUserName={userFullName || 'Сотрудник'}   // ← Реальное имя
  />
)}
    </div>
    </div>
  );
}