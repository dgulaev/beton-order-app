'use client';

import { useState, useEffect } from 'react';
import Calendar from '../Calendar';
import { Order } from '../hooks/useCalendarOrders';
import { createClient } from '@supabase/supabase-js';
import { useRealtimeOrders } from '../../../hooks/useRealtimeOrders';
import OrderDetailModal from '../components/OrderDetailModal';

// Создаём клиент Supabase (один раз на весь файл)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AdminCifraDashboard() {
   // ==================== ВСЕ СОСТОЯНИЯ ====================
  const [userId, setUserId] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);

  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const MINUTES_PER_CUBIC_METER = 1;

  // ==================== СТАТУСЫ ЗАКАЗОВ (глобальная функция) ====================
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'new':
        return { label: 'Новая', color: '#FACC15', bg: '#FACC1520', final: false };
      case 'processing':
        return { label: 'В работе', color: '#3B82F6', bg: '#3B82F620', final: false };
      case 'completed':
        return { label: 'Выполнена', color: '#10B981', bg: '#10B98120', final: true };
      case 'cancelled':
        return { label: 'Отменена', color: '#EF4444', bg: '#EF444420', final: true };
      default:
        return { label: 'Неизвестно', color: '#64748B', bg: '#334155', final: false };
    }
  };

 const [notifications, setNotifications] = useState<any[]>([]);
 const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
 const [mixerAssignments, setMixerAssignments] = useState<any[]>([]); // для текущего заказа
 const [allMixers, setAllMixers] = useState<any[]>([]);
 const [activeMixers, setActiveMixers] = useState<any[]>([]);
 const [currentHourPercent, setCurrentHourPercent] = useState(42);
 const [showCalendar, setShowCalendar] = useState(false);
 const [history, setHistory] = useState<any[]>([]);
 const [currentUser, setCurrentUser] = useState<{ id: number; name?: string; role: string } | null>(null);

      // ==================== ДОБАВЛЕНИЕ В ИСТОРИЮ (с красивым названием роли) ====================
  const addToHistory = async (action: string) => {
    if (!selectedOrder) return;

    const displayRole = getRoleDisplayName(userRole);        // ← красивое название
    const displayName = displayRole;                         // используем роль как имя

    try {
      await fetch('/api/adminCifra/order-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: selectedOrder.id,
          action: action,
          user_name: displayName,           // ← теперь всегда красивое название
          user_role: userRole || 'admin'
        })
      });

      // Обновляем историю
      const res = await fetch(`/api/adminCifra/order-history?orderId=${selectedOrder.id}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err) {
      console.error('Не удалось добавить в историю:', err);
    }
  };

      // ==================== ЗАГРУЗКА НАЗНАЧЕННЫХ МИКСЕРОВ ====================
  useEffect(() => {
    const fetchAssignedMixers = async () => {
      try {
        const res = await fetch('/api/adminCifra/order-mixers');
        if (res.ok) {
          const data = await res.json();
          setMixerAssignments(data);
        }
      } catch (err) {
        console.error('Ошибка загрузки назначенных миксеров:', err);
      }
    };

    fetchAssignedMixers();
  }, []);

 // ==================== НОВЫЙ РЕАКТИВНЫЙ МАСШТАБ ====================
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      const width = window.innerWidth;
      let newScale = 1;

      if (width >= 2560) newScale = 1.00;
      else if (width >= 1920) newScale = 0.92;   // ← меняй здесь
      else if (width >= 1680) newScale = 0.88;
      else if (width >= 1440) newScale = 0.84;
      else if (width >= 1366) newScale = 0.79;
      else newScale = 0.74;

      setScale(newScale);
    };

    updateScale();
    window.addEventListener('resize', updateScale);

    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // ==================== УВЕДОМЛЕНИЯ О ВЫВОДЕ НАЛИЧНЫХ ====================
  const fetchNotifications = async () => {
    if (!['admin', 'manager'].includes(userRole || '')) {
      setNotifications([]);
      return;
    }

    try {
      // Запрашиваем активные (непогашенные) выводы
      const res = await fetch(`/api/adminCifra/withdrawals?userId=${userId}`);
      if (res.ok) {
        const data = await res.json();
        // Оставляем только pending
        const pending = data.withdrawals?.filter((w: any) => w.status !== 'completed') || [];
        setNotifications(pending);
        console.log(`🔔 Активных запросов на вывод: ${pending.length}`);
      }
    } catch (err) {
      console.error('Ошибка загрузки уведомлений:', err);
    }
  };

  const getMixerStatusStyle = (status: string) => {
  switch (status) {
    case 'Загрузка':
      return { color: '#FACC15', bg: '#FACC1520' };
    case 'В пути':
      return { color: '#3B82F6', bg: '#3B82F620' };
    case 'На объекте':
      return { color: '#10B981', bg: '#10B98120' };
    case 'Возврат':
      return { color: '#94A3B8', bg: '#334155' };
    default:
      return { color: '#94A3B8', bg: '#334155' };
  }
};

  // Только ручное обновление (без автотаймера)
  useEffect(() => {
    fetchNotifications(); // первая загрузка

    const handleRefresh = () => fetchNotifications();
    window.addEventListener('refreshNotifications', handleRefresh);

    return () => {
      window.removeEventListener('refreshNotifications', handleRefresh);
    };
  }, [userRole, userId]);

  // ==================== ЗАГРУЗКА ВСЕХ ЗАКАЗОВ ====================
  useEffect(() => {
    const fetchAllOrders = async () => {
      setLoadingOrders(true);
      try {
        const res = await fetch('/api/adminCifra/all-orders');
        if (res.ok) {
          const data = await res.json();
          setAllOrders(data);
        }
      } catch (err) {
        console.error('Ошибка загрузки заказов:', err);
      } finally {
        setLoadingOrders(false);
      }
    };
    fetchAllOrders();
  }, []);

    // ==================== ЗАГРУЗКА МИКСЕРОВ В РАБОТЕ ====================
  useEffect(() => {
    const fetchActiveMixers = async () => {
      try {
        const res = await fetch('/api/adminCifra/active-mixers');
        if (res.ok) {
          const data = await res.json();
          setActiveMixers(data);
        }
      } catch (err) {
        console.error('Ошибка загрузки активных миксеров:', err);
      }
    };

    fetchActiveMixers();
  }, []);

  const today = new Date().toISOString().split('T')[0];

  // ==================== ФИНАЛЬНЫЙ РАСЧЁТ ЗАКАЗОВ (учёт timezone) ====================
const selectedYear = selectedDate.getFullYear();
const selectedMonth = String(selectedDate.getMonth() + 1).padStart(2, '0');
const selectedDay = String(selectedDate.getDate()).padStart(2, '0');
const selectedDateStr = `${selectedYear}-${selectedMonth}-${selectedDay}`;

const todayOrders = allOrders
  .filter((o: Order) => {
    if (!o?.delivery_date) return false;

    let orderDateStr = '';

    if (typeof o.delivery_date === 'string') {
      orderDateStr = o.delivery_date.substring(0, 10);
    } else {
      try {
        const date = new Date(o.delivery_date);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        orderDateStr = `${year}-${month}-${day}`;
      } catch (e) {
        orderDateStr = String(o.delivery_date).substring(0, 10);
      }
    }

    return orderDateStr === selectedDateStr;
  })
  .sort((a: Order, b: Order) => 
    (a.delivery_time || '00:00').localeCompare(b.delivery_time || '00:00')
  );

console.log(`Выбрана дата: ${selectedDateStr} | Найдено заказов: ${todayOrders.length}`);

// ==================== РАСЧЁТ ЗАДЕРЖЕК ОТГРУЗОК (реал-тайм) ====================
const now = new Date();
const currentMinutes = now.getHours() * 60 + now.getMinutes();

const delayedOrders = todayOrders
  .map((order: Order) => {
    const [h, m] = (order.delivery_time || '00:00').split(':').map(Number);
    const plannedStart = h * 60 + m;
    const volume = Number(order.volume || 0);
    const duration = volume * MINUTES_PER_CUBIC_METER;

    const expectedEnd = plannedStart + duration;
    const delayMinutes = Math.max(0, currentMinutes - expectedEnd);

    return { 
      ...order, 
      delayMinutes,
      delayText: delayMinutes > 0 ? `+${delayMinutes} мин` : '' 
    };
  })
  .filter(order => order.delayMinutes > 15) // задержка больше 15 минут
  .sort((a, b) => b.delayMinutes - a.delayMinutes);

// ==================== ДИНАМИЧЕСКИЕ KPI ====================
const planToday = todayOrders.reduce((sum, o) => sum + Number(o.volume || 0), 0);
const newOrders = todayOrders.filter(o => o.status === 'new').length;
const inWorkOrders = todayOrders.filter(o => o.status === 'processing').length;
const activeOrdersCount = newOrders + inWorkOrders;

const completedVolume = todayOrders
  .filter(o => o.status === 'completed')
  .reduce((sum, o) => sum + Number(o.volume || 0), 0);

const totalToday = todayOrders.length;
const completedOrders = todayOrders.filter(o => o.status === 'completed').length;

const completionPercent = planToday > 0 
  ? Math.round((completedVolume / planToday) * 100) 
  : 0;

      // ==================== МИКСЕРЫ ЗА ВЫБРАННУЮ ДАТУ (улучшенная) ====================
  const activeMixersToday = activeMixers.filter((mixer: any) => {
    if (!mixer.orderId) return false;

    // Основная проверка
    const hasOrderToday = todayOrders.some(order => 
      String(order.id) === String(mixer.orderId)
    );

    if (hasOrderToday) return true;

    // Дополнительно: если заказ перетекает (например, поздний рейс)
    // Можно добавить логику по времени, но пока оставим просто
    return false;
  });

  // ==================== ЗАГРУЗКА USER ID ====================
  useEffect(() => {
    const saved = localStorage.getItem('userId');
    if (saved) setUserId(parseInt(saved, 10));
  }, []);

  // ==================== ЗАГРУЗКА РОЛИ ====================
  useEffect(() => {
    if (!userId) {
      setLoadingRole(false);
      return;
    }

    fetch('/api/user/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
      .then(r => r.json())
      .then(data => setUserRole(data.role || 'client'))
      .catch(() => setUserRole('client'))
      .finally(() => setLoadingRole(false));
  }, [userId]);

    // ==================== ЗАГРУЗКА CURRENT USER ====================
  useEffect(() => {
    if (userId && userRole) {
      setCurrentUser({
        id: userId,
        name: 'Администратор',     // потом можно взять из профиля
        role: userRole
      });
    }
  }, [userId, userRole]);

// ==================== ЗАГРУЗКА ВСЕХ МИКСЕРОВ ====================
  useEffect(() => {
    const fetchMixers = async () => {
      try {
        const res = await fetch('/api/adminCifra/mixers');
        if (res.ok) {
          const data = await res.json();
          setAllMixers(data);
          console.log(`✅ Загружено ${data.length} миксеров для выбора`);
        }
      } catch (err) {
        console.error('Ошибка загрузки миксеров:', err);
      }
    };

    fetchMixers();
  }, []);

    // ==================== ЗАГРУЗКА АКТИВНЫХ МИКСЕРОВ ====================
  useEffect(() => {
    const fetchActiveMixers = async () => {
      try {
        console.log('🔄 Запрашиваем активные миксеры...');
        const res = await fetch('/api/adminCifra/active-mixers');
        console.log('📡 Статус ответа:', res.status);
        
        if (res.ok) {
          const data = await res.json();
          console.log('✅ Получены миксеры:', data);
          setActiveMixers(data);
        } else {
          console.error('❌ Ошибка API:', res.status);
        }
      } catch (err) {
        console.error('❌ Ошибка запроса:', err);
      }
    };

    fetchActiveMixers();
  }, []);

      // ==================== СМЕНА СТАТУСА МИКСЕРА ====================
  const handleStatusChange = async (mixerId: number | string, newStatus: string) => {
    console.log(`🔄 Меняем статус миксера ${mixerId} → ${newStatus}`);

    try {
      const res = await fetch('/api/adminCifra/order-mixers/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mixerId, status: newStatus })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        console.log('✅ Статус успешно обновлён в базе');

        // Обновляем статус в списке
        setActiveMixers(prev => 
          prev.map(m => String(m.id) === String(mixerId) ? { ...m, status: newStatus } : m)
        );

        // Если статус завершающий — убираем миксер из списка
        if (['Разгружен', 'Возврат'].includes(newStatus)) {
          console.log(`🗑️ Убираем миксер ${mixerId} из активных`);
          setTimeout(() => {
            setActiveMixers(prev => prev.filter(m => String(m.id) !== String(mixerId)));
          }, 600);
        }
      } else {
        alert('Ошибка: ' + (data.message || 'Не удалось обновить статус'));
      }
    } catch (err) {
      console.error('Ошибка запроса:', err);
      alert('Не удалось связаться с сервером');
    }
  };

  // ==================== ТАЙМЛАЙН ====================
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      setCurrentHourPercent(Math.min(Math.max((minutes / 1440) * 100, 3), 97));
    };
    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

    // ==================== АВТО-ОБНОВЛЕНИЕ ТАЙМЛАЙНА ====================
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/adminCifra/all-orders');
        if (res.ok) {
          const freshOrders = await res.json();
          setAllOrders(freshOrders);
        }
      } catch (err) {
        console.error('Ошибка автообновления заказов:', err);
      }
    }, 5000); // каждые 5 секунд

    return () => clearInterval(interval);
  }, []);

  // ==================== REALTIME ====================
  useRealtimeOrders(setAllOrders);

      // ==================== АВТО-ОБНОВЛЕНИЕ ДАННЫХ ====================
  useEffect(() => {
    const refreshData = async () => {
      try {
        const [ordersRes, mixersRes] = await Promise.all([
          fetch('/api/adminCifra/all-orders'),
          fetch('/api/adminCifra/active-mixers')
        ]);

        if (ordersRes.ok) {
          const freshOrders = await ordersRes.json();
          setAllOrders(freshOrders);
        }
        if (mixersRes.ok) {
          const freshMixers = await mixersRes.json();
          setActiveMixers(freshMixers);
        }
      } catch (err) {
        console.error('Ошибка автообновления:', err);
      }
    };

    refreshData();                    // сразу при загрузке
    const interval = setInterval(refreshData, 12000); // ← каждые 12 секунд

    return () => clearInterval(interval);
  }, []);

    // ==================== ГЛОБАЛЬНАЯ ЗАГРУЗКА ВСЕХ НАЗНАЧЕННЫХ МИКСЕРОВ ====================
  useEffect(() => {
    const fetchAllAssignedMixers = async () => {
      try {
        const res = await fetch('/api/adminCifra/order-mixers');
        if (res.ok) {
          const data = await res.json();
          setMixerAssignments(data);
          console.log(`[MixerAssignments] Загружено ${data.length} записей`);
        }
      } catch (err) {
        console.error('Ошибка загрузки mixerAssignments:', err);
      }
    };

    fetchAllAssignedMixers();
  }, []);

    // ==================== ВОССТАНОВЛЕНИЕ ГЛОБАЛЬНОГО СОСТОЯНИЯ ПРИ ЗАКРЫТИИ МОДАЛКИ ====================
  useEffect(() => {
    if (!selectedOrder) {
      // При закрытии модалки — перезагружаем все миксеры
      const reloadAllMixers = async () => {
        try {
          const res = await fetch('/api/adminCifra/order-mixers');
          if (res.ok) {
            const data = await res.json();
            setMixerAssignments(data);
          }
        } catch (e) {}
      };
      reloadAllMixers();
    }
  }, [selectedOrder]);

  // ==================== ЗАГРУЗКА МИКСЕРОВ ДЛЯ ОТКРЫТОЙ МОДАЛКИ ====================
        useEffect(() => {
    if (!selectedOrder?.id) {
      setMixerAssignments([]);        // очищаем при закрытии
      return;
    }

    const loadOrderMixers = async () => {
      try {
        const res = await fetch(`/api/adminCifra/order-mixers?orderId=${selectedOrder.id}`);
        if (res.ok) {
          const data = await res.json();
          setMixerAssignments(data); 
          console.log(`📥 Загружено ${data.length} миксеров для заказа #${selectedOrder.id}`);
        }
      } catch (err) {
        console.error('Ошибка загрузки миксеров заказа:', err);
      }
    };

    loadOrderMixers();
  }, [selectedOrder?.id]);

  // ==================== ЗАГРУЗКА ИСТОРИИ ПРИ ОТКРЫТИИ МОДАЛКИ ====================
  useEffect(() => {
    if (!selectedOrder?.id) {
      setHistory([]);   // очищаем при закрытии модалки
      return;
    }

    const loadHistory = async () => {
      try {
        const res = await fetch(`/api/adminCifra/order-history?orderId=${selectedOrder.id}`);
        if (res.ok) {
          const data = await res.json();
          setHistory(data);
          console.log(`📜 Загружена история для заказа #${selectedOrder.id}: ${data.length} записей`);
        }
      } catch (err) {
        console.error('Ошибка загрузки истории:', err);
      }
    };

    loadHistory();
  }, [selectedOrder?.id]);   // ← важно: зависимость только от id

  // ==================== СЛУШАТЕЛЬ ДЛЯ ОБНОВЛЕНИЯ ПОСЛЕ ДОБАВЛЕНИЯ МИКСЕРА ====================
  useEffect(() => {
    const handleMixerAdded = () => {
      console.log('🔄 Миксер добавлен из модалки, обновляем данные...');
      
      // Можно добавить принудительную перезагрузку назначенных миксеров
      const reloadMixers = async () => {
        try {
          const res = await fetch('/api/adminCifra/order-mixers');
          if (res.ok) {
            const data = await res.json();
            setMixerAssignments(data);
          }
        } catch (e) {}
      };

      reloadMixers();
    };

    window.addEventListener('mixerAdded', handleMixerAdded);

    return () => {
      window.removeEventListener('mixerAdded', handleMixerAdded);
    };
  }, []);

  if (loadingRole || loadingOrders) {
    return <div style={{ minHeight: '100vh', background: '#0F172A', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Загрузка дашборда...</div>;
  }

    // ==================== КРАСИВЫЕ НАЗВАНИЯ РОЛЕЙ ====================
  const getRoleDisplayName = (role: string | null): string => {
    switch (role) {
      case 'admin':      return 'Админ';
      case 'manager':    return 'Менеджер';
      case 'dispatcher': return 'Диспетчер';
      case 'logistic':   return 'Логист';
      case 'accountant': return 'Бухгалтер';
      default:           return 'Сотрудник';
    }
  };

    // ==================== УДАЛЕНИЕ МИКСЕРА + ЗАПИСЬ В ИСТОРИЮ ====================
  const deleteMixer = async (mixerId: number | string, index: number) => {
    if (!mixerId) return;

    // Находим информацию о миксере для истории
    const mixerToDelete = mixerAssignments.find(m => String(m.id) === String(mixerId));
    const mixerName = mixerToDelete?.mixerName || mixerToDelete?.number || mixerToDelete?.mixer_name || 'Миксер';

    try {
      await fetch('/api/adminCifra/order-mixers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mixerId })
      });

      // Удаляем из локального состояния
      setMixerAssignments(prev => prev.filter((_, i) => i !== index));

      // ==================== ЗАПИСЬ В ИСТОРИЮ ====================
      if (typeof addToHistory === 'function' && selectedOrder) {
        await addToHistory(`Удалил миксер ${mixerName} из заказа`);
      }

    } catch (err) {
      console.error('Ошибка удаления миксера:', err);
      alert('Не удалось удалить миксер');
    }
  };

        // ==================== ЗАВЕРШЕНИЕ ЛОГИСТИКИ + АВТО-СМЕНА СТАТУСА ====================
  const completeLogistics = async (selectedOrderParam?: Order) => {
    const targetOrder = selectedOrderParam || selectedOrder;
    if (!targetOrder) return;

    const assignedVolume = mixerAssignments
      .filter(m => String(m.orderId) === String(targetOrder.id))
      .reduce((sum, m) => sum + Number(m.volume || 0), 0);

    const orderVolume = Number(targetOrder.volume || 0);
    const isFullyReady = assignedVolume >= orderVolume && assignedVolume > 0;

    const newStatus = isFullyReady ? 'processing' : 'new';

    // Optimistic update
    setAllOrders(prev => prev.map(o => 
      o.id === targetOrder.id 
        ? { ...o, logistics_ready: true, status: newStatus } 
        : o
    ));

    if (selectedOrder && selectedOrder.id === targetOrder.id) {
      setSelectedOrder(prev => prev ? { ...prev, status: newStatus, logistics_ready: true } : null);
    }

    try {
      const res = await fetch('/api/adminCifra/order-logistics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: targetOrder.id,
          logisticsReady: true,
          autoStatus: newStatus
        })
      });

      const data = await res.json();

      if (data.success) {
        alert(isFullyReady 
          ? `✅ Полная логистика (${assignedVolume}/${orderVolume} м³). Заказ переведён в "В работе"` 
          : `⚠️ Сохранена частичная логистика (${assignedVolume}/${orderVolume} м³)`
        );
        setSelectedOrder(null);
      } else {
        alert('Ошибка: ' + (data.message || 'Не удалось сохранить'));
      }
    } catch (err) {
      console.error('Ошибка завершения логистики:', err);
      alert('Не удалось связаться с сервером');
    }
  };

     // ==================== ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ ДЛЯ МОДАЛКИ ====================
  const modalCurrentUser = currentUser || {
    id: userId || 0,
    name: getRoleDisplayName(userRole) || 'Сотрудник',
    role: userRole || 'admin'
  };


  return (
  <div style={{ 
      transform: `scale(${scale})`, 
      transformOrigin: 'top left',
      width: `${100 / scale}%`,        // ← возвращаем этот вариант
      height: `${100 / scale}%`,
      overflow: 'hidden',
      minHeight: '100vh'
    }}>

      <div style={{ 
        background: '#0F172A', 
        minHeight: '100vh', 
        color: '#fff',
        padding: '16px'
      }}>

        {/* ==================== ОСНОВНОЙ GRID ==================== */}
        <div style={{ 
          display: 'grid',
          gridTemplateColumns: 'minmax(820px, 1fr) minmax(430px, 510px)', 
          gap: '32px',
          maxWidth: '100%', 
          width: '100%', 
          margin: '0 auto',
          minHeight: 'calc(100vh - 80px)'
        }}>

      {/* ==================== ЛЕВАЯ КОЛОНКА ( KPI) ==================== */}
      <div style={{ 
          flex: 1, 
          minWidth: '950px',
          display: 'flex', 
          flexDirection: 'column', 
          gap: '20px',
          minHeight: '100%'
        }}>
        
        {/* Topbar — адаптив */}
<div style={{ 
  display: 'flex', 
  justifyContent: 'space-between', 
  alignItems: 'center',
  flexWrap: 'wrap',           // ← разрешает перенос на новую строку
  gap: '16px' 
}}>
  <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
    <h1 style={{ 
      fontSize: '32px',           // ← уменьшил с 38px
      fontWeight: '700', 
      margin: 0 
    }}>
      РБУ ТрейдКом
    </h1>
    
    <div 
      onClick={() => setShowCalendar(true)}
      style={{ 
        background: '#1E2937', 
        padding: '10px 20px', 
        borderRadius: '9999px', 
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '14.5px',
        whiteSpace: 'nowrap'
      }}
    >
      📅 {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
    </div>
  </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            {(userRole === 'admin' || userRole === 'manager') && notifications.length > 0 && (
              <div 
                style={{ 
                  background: '#EF4444', 
                  color: 'white', 
                  padding: '12px 20px', 
                  borderRadius: '9999px',
                  fontWeight: '700',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  animation: 'pulse 2s infinite',
                  cursor: 'pointer'
                }}
                onClick={() => window.location.href = '/adminCifra/withdrawals'}
              >
                ⚠️ {notifications.length} активных запросов на вывод наличных
              </div>
            )}
            <div style={{ color: '#60A5FA', fontWeight: '500' }}>Роль: {userRole}</div>
          </div>
        </div>

       {/* ==================== KPI — РЕАЛЬНЫЕ ДАННЫЕ ==================== */}
        <div style={{ 
               display: 'grid', 
               gridTemplateColumns: 'repeat(4, 1fr)', 
               gap: '20px',
               minWidth: '1100px',           // ← Важно! Не даёт сжиматься меньше 4 колонок
               overflowX: 'auto',            // ← Добавляет горизонтальный скролл при необходимости
               paddingBottom: '8px'
         }}>
          
       {/* ==================== ЗАЯВКИ СЕГОДНЯ (точно как Миксеры) ==================== */}
<div style={{ 
  background: '#25334A', 
  borderRadius: '20px', 
  padding: '20px', 
  flex: 1 
}}>
  <div style={{ color: '#94A3B8', fontSize: '15px', marginBottom: '8px' }}>
    Заявки сегодня
  </div>

  {/* Большое число */}
  <div style={{ 
    fontSize: '48px', 
    fontWeight: '700', 
    color: '#60A5FA',
    marginBottom: '4px'
  }}>
    {totalToday}
  </div>

  {/* Дата */}
  <div style={{ 
    color: '#64748B', 
    fontSize: '15px', 
    marginBottom: '12px' 
  }}>
    {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
  </div>

  {/* Статусы в одну строку */}
  <div style={{ 
    display: 'flex', 
    justifyContent: 'space-between', 
    fontSize: '13.5px',
    marginBottom: '12px'
  }}>
    <div>
      <span style={{ color: '#FACC15' }}>🟡</span> Новые: <strong>{todayOrders.filter(o => o.status === 'new').length}</strong>
    </div>
    <div>
      <span style={{ color: '#3B82F6' }}>→</span> В работе: <strong>{todayOrders.filter(o => o.status === 'processing').length}</strong>
    </div>
    <div>
      <span style={{ color: '#10B981' }}>✓</span> Выполнены: <strong>{completedOrders}</strong>
    </div>
  </div>

  {/* Разделитель */}
  <div style={{ height: '1px', background: '#334155', margin: '0 -8px 10px' }} />

  {/* Отменённые — уменьшенный значок */}
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <span style={{ 
        color: '#EF4444', 
        fontSize: '13px',     // ← уменьшили значок
        lineHeight: '1' 
      }}>❌</span>
      <span style={{ color: '#EF4444', fontSize: '15px' }}>Отменены</span>
    </div>
    <strong style={{ color: '#EF4444', fontSize: '17px' }}>
      {todayOrders.filter(o => o.status === 'cancelled').length}
    </strong>
  </div>
</div>

          {/* ==================== ВЫПОЛНЕНИЕ ПЛАНА ==================== */}
<div style={{ 
  background: '#25334A', 
  borderRadius: '20px', 
  padding: '24px', 
  flex: 1 
}}>
  <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
    Выполнение плана
  </div>
  
  <div style={{ fontSize: '42px', fontWeight: '700', marginBottom: '4px' }}>
    {completedVolume} <span style={{ fontSize: '28px', color: '#64748B' }}>/ {planToday}</span> м³
  </div>

  <div style={{ 
    fontSize: '17px', 
    fontWeight: '600',
    color: completionPercent >= 90 ? '#10B981' : 
           completionPercent >= 70 ? '#FACC15' : '#EF4444'
  }}>
    {completionPercent}% от плана
  </div>

  <div style={{ color: '#64748B', fontSize: '14px', marginTop: '6px' }}>
    {completedOrders} из {totalToday} заявок
  </div>
</div>

          {/* ==================== ЗАДЕРЖКИ ОТГРУЗОК ==================== */}
<div style={{ 
  background: '#25334A', 
  borderRadius: '20px', 
  padding: '24px', 
  minHeight: '180px',           // ← фиксированная минимальная высота
  height: 'fit-content',        // ← не растягивается выше нужного
  display: 'flex',
  flexDirection: 'column'
}}>
  <div style={{ color: '#94A3B8', fontSize: '15px', marginBottom: '12px' }}>
    Задержки отгрузок
  </div>

  {delayedOrders.length > 0 ? (
    <>
      <div style={{ 
        fontSize: '48px', 
        fontWeight: '700', 
        color: '#EF4444',
        marginBottom: '8px'
      }}>
        {delayedOrders.length}
      </div>

      <div style={{ color: '#F87171', fontSize: '15px', marginBottom: '16px' }}>
        отгрузка(и) задерживается
      </div>

      {/* Скроллируемая область списка */}
      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        maxHeight: '52px',           // ← ограничение высоты списка
        marginTop: '8px',
        paddingRight: '8px'
      }}>
        {delayedOrders.slice(0, 6).map((order, index) => (
          <div key={index} style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            padding: '8px 0',
            borderBottom: index < delayedOrders.length - 1 ? '1px solid #334155' : 'none'
          }}>
            <div style={{ fontSize: '14px' }}>
              #{order.id} • {order.delivery_time}
            </div>
            <div style={{ 
              color: '#EF4444', 
              fontWeight: '600',
              fontSize: '15px'
            }}>
              +{order.delayMinutes} мин
            </div>
          </div>
        ))}
      </div>
    </>
  ) : (
    <div style={{ 
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#10B981',
      textAlign: 'center'
    }}>
      <div style={{ fontSize: '48px', marginBottom: '12px' }}>✓</div>
      <div style={{ fontSize: '17px' }}>Все отгрузки по графику</div>
    </div>
  )}
</div>

          {/* 4. Миксеры в работе — за выбранный день */}
<div 
  onClick={() => window.location.href = '/adminCifra/mixers'}
  style={{ 
    background: '#1E2937', 
    borderRadius: '20px', 
    padding: '24px', 
    cursor: 'pointer',
    transition: 'all 0.2s'
  }}
  onMouseEnter={e => e.currentTarget.style.background = '#25334A'}
  onMouseLeave={e => e.currentTarget.style.background = '#1E2937'}
>
  <div style={{ color: '#94A3B8', fontSize: '14px' }}>Миксеры в работе</div>
  
  <div style={{ fontSize: '42px', fontWeight: '700', color: '#3B82F6', marginTop: '8px' }}>
    {activeMixersToday.length}
  </div>

  <div style={{ fontSize: '13px', color: '#64748B', marginTop: '4px' }}>
    {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
  </div>

  {/* Статусы в одну строку */}
  <div style={{ 
    marginTop: '16px', 
    display: 'flex', 
    gap: '20px', 
    fontSize: '13.5px',
    flexWrap: 'wrap'
  }}>
    <div>Загрузка: <strong style={{ color: '#FACC15' }}>{activeMixersToday.filter(m => m.status === 'Загрузка').length}</strong></div>
    <div>В пути: <strong style={{ color: '#3B82F6' }}>{activeMixersToday.filter(m => m.status === 'В пути').length}</strong></div>
    <div>На объекте: <strong style={{ color: '#10B981' }}>{activeMixersToday.filter(m => m.status === 'На объекте').length}</strong></div>
  </div>

  {/* Свои / Наёмные — максимально надёжный поиск */}
  <div style={{ 
    marginTop: '12px', 
    paddingTop: '10px', 
    borderTop: '1px solid #334155',
    fontSize: '13.5px'
  }}>
    Свои: <strong style={{ color: '#10B981' }}>
      {activeMixersToday.filter(m => 
        m.type === 'own' || 
        m.type === 'Own' || 
        m.is_own === true ||
        m.mixer_type === 'own' ||
        String(m.number || '').startsWith('К') ||   // временно, если свои начинаются с К
        m.driver?.includes('Свой') 
      ).length}
    </strong> | 
    Наёмные: <strong style={{ color: '#FACC15' }}>
      {activeMixersToday.filter(m => 
        m.type === 'rented' || 
        m.type === 'Rented' || 
        m.is_rented === true ||
        m.mixer_type === 'rented' ||
        String(m.number || '').startsWith('О')
      ).length}
    </strong>
  </div>
</div>
      </div>
      {/* ==================== ТАЙМЛАЙН (УЛУЧШЕННЫЙ — В СТИЛЕ ЦИФРА.AI) ==================== */}
       <div style={{ 
            flex: 1, 
            minWidth: '680px',
            background: '#1E2937', 
            borderRadius: '24px', 
            padding: '24px 28px', 
            border: '1px solid #334155', 
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative'
          }}>
  
  {/* Заголовок + Кнопки */}
  <div style={{ 
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    alignItems: 'center',
    gap: '20px',
    marginBottom: '16px'
  }}>
    <h2 style={{ 
      fontSize: '26px', 
      fontWeight: '700',
      margin: 0,
      color: '#F1F5F9'
    }}>
      График отгрузок на {selectedDate.toLocaleDateString('ru-RU', { 
        day: 'numeric', 
        month: 'long' 
      })}
    </h2>

    {/* Кнопки переключения дней */}
    <div style={{ 
      display: 'flex', 
      gap: '8px' 
    }}>
      <button 
        onClick={() => setSelectedDate(prev => {
          const d = new Date(prev);
          d.setDate(d.getDate() - 1);
          return d;
        })}
        style={{
          padding: '8px 18px',
          background: '#334155',
          color: '#fff',
          border: 'none',
          borderRadius: '9999px',
          fontSize: '14px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'all 0.2s'
        }}
      >
        ← Пред. день
      </button>

      <button 
        onClick={() => setSelectedDate(new Date())}
        style={{
          padding: '8px 22px',
          background: '#3B82F6',
          color: '#fff',
          border: 'none',
          borderRadius: '9999px',
          fontSize: '14px',
          fontWeight: '600',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.3)'
        }}
      >
        Сегодня
      </button>

      <button 
        onClick={() => setSelectedDate(prev => {
          const d = new Date(prev);
          d.setDate(d.getDate() + 1);
          return d;
        })}
        style={{
          padding: '8px 18px',
          background: '#334155',
          color: '#fff',
          border: 'none',
          borderRadius: '9999px',
          fontSize: '14px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'all 0.2s'
        }}
      >
        След. день →
      </button>
    </div>
  </div>

  {/* ==================== УЛУЧШЕННАЯ ШКАЛА ВРЕМЕНИ ==================== */}
<div style={{ marginBottom: '16px', position: 'relative' }}>
  
  {/* Основные метки (каждый час) */}
  <div style={{ 
    display: 'flex', 
    justifyContent: 'space-between', 
    fontSize: '12.5px', 
    color: '#94A3B8', 
    padding: '0 8px',
    userSelect: 'none',
    marginBottom: '4px'
  }}>
    {Array.from({ length: 25 }, (_, i) => (
      <div 
        key={i} 
        style={{ 
          textAlign: 'center', 
          width: '32px',
          fontWeight: i % 4 === 0 ? '600' : '400',
          color: i % 4 === 0 ? '#CBD5E1' : '#64748B'
        }}
      >
        {String(i).padStart(2, '0')}:00
      </div>
    ))}
  </div>

  {/* Основная линия + деления */}
  <div style={{ 
    height: '6px', 
    background: '#334155', 
    position: 'relative', 
    borderRadius: '4px',
    margin: '0 8px'
  }}>
    {/* Тонкие линии каждые 30 минут */}
    {Array.from({ length: 48 }, (_, i) => (
      <div 
        key={i} 
        style={{
          position: 'absolute',
          left: `${i * 2.083}%`,
          top: '-1px',
          width: i % 2 === 0 ? '2px' : '1px',
          height: i % 2 === 0 ? '10px' : '6px',
          background: i % 2 === 0 ? '#475569' : '#334155',
          transform: 'translateX(-50%)'
        }} 
      />
    ))}
  </div>
</div>

  {/* Основная область таймлайна с горизонтальным скроллом */}
  <div 
    id="timeline-container"
    style={{ 
      flex: 1, 
      position: 'relative', 
      overflowX: 'auto',
      overflowY: 'auto',
      paddingRight: '20px',
      paddingBottom: '30px',
      minHeight: '420px',
      scrollbarWidth: 'thin',
      scrollbarColor: '#475569 #1E2937'
    }}
  >
    {todayOrders.length > 0 ? todayOrders.map((order: Order) => {
  const client = (order as any).organization_name || (order as any).full_name || '—';
  const time = order.delivery_time || '00:00';
  const [h, m] = time.split(':').map(Number);
  const startMinutes = h * 60 + m;

  const volume = Number(order.volume) || 10;
  const durationMinutes = volume * MINUTES_PER_CUBIC_METER;
  // ==================== НАСТРОЙКА ЧАСОВОГО ПОЯСА ====================
  const TIMEZONE_OFFSET = 3; // ← твой часовой пояс (CEST = +2). Если Москва — 3, если UTC — 0
  const endMinutes = startMinutes + durationMinutes;

  const leftPercent = (startMinutes / 1440) * 100;
  let widthPercent = (durationMinutes / 1440) * 100;
  let isOverflow = false;
  let overflowMinutes = 0;

  if (endMinutes > 1440) {
    widthPercent = ((1440 - startMinutes) / 1440) * 100;
    isOverflow = true;
    overflowMinutes = Math.round(endMinutes - 1440);
  }

  // ==================== ДИНАМИЧЕСКИЙ ПЛАН НА ДЕНЬ ====================
const planToday = todayOrders.reduce((sum, o) => sum + Number(o.volume || 0), 0);

const completedVolume = todayOrders
  .filter(o => o.status === 'completed')
  .reduce((sum, o) => sum + Number(o.volume || 0), 0);

const completedOrders = todayOrders.filter(o => o.status === 'completed').length;
const totalToday = todayOrders.length;

const completionPercent = planToday > 0 
  ? Math.round((completedVolume / planToday) * 100) 
  : 0;

     // ==================== СТАТУС ЗАКАЗА ====================
    const statusColor = 
    order.status === 'completed' ? '#10B981' : 
    order.status === 'processing' ? '#3B82F6' : 
    order.status === 'new' ? '#FACC15' :
    order.status === 'cancelled' ? '#EF4444' : '#64748B';

    const statusText = 
    order.status === 'completed' ? '✓ Выполнена' : 
    order.status === 'processing' ? '→ В работе' : 
    order.status === 'new' ? '🟡 Новая' :
    order.status === 'cancelled' ? '❌ Отменена' : '—';

  // ==================== РАСЧЁТ ЛОГИСТИКИ ====================
const assignedVolume = mixerAssignments
    .filter(m => String(m.orderId) === String(order.id))   // ← надёжное сравнение
    .reduce((sum, m) => sum + Number(m.volume || 0), 0);

const orderVolume = Number(order.volume || 0);
const isLogisticsReady = assignedVolume >= orderVolume && assignedVolume > 0;
console.log(`Заказ #${order.id}: ${assignedVolume}/${orderVolume} м³ → ${isLogisticsReady ? 'ЗЕЛЁНЫЙ' : assignedVolume > 0 ? 'ОРАНЖЕВЫЙ' : 'СЕРЫЙ'}`);
// Основная логика
const isFullyAssigned = assignedVolume >= orderVolume && assignedVolume > 0;
const isReadyInDB = (order as any).logistics_ready === true;


  return (
    <div 
      key={order.id} 
      onClick={() => setSelectedOrder(order)}
      style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: '8px',
        background: '#25334A',
        borderRadius: '10px',
        padding: '8px 16px',
        position: 'relative',
        minHeight: '46px',
        cursor: 'pointer',
        transition: 'all 0.2s'
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#2A3A52'}
      onMouseLeave={e => e.currentTarget.style.background = '#25334A'}
    >
   {/* ==================== МЕТКА ЛОГИСТИКИ ==================== */}
<div style={{
    width: '20px',
    height: '20px',
    minWidth: '20px',
    borderRadius: '9999px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    marginRight: '14px',
    flexShrink: 0,
    background: isLogisticsReady 
      ? '#10B98120' 
      : (assignedVolume > 0 ? '#F59E0B20' : '#47556920'),
    color: isLogisticsReady 
      ? '#10B981' 
      : (assignedVolume > 0 ? '#F59E0B' : '#E2E8F0'),
    border: `2px solid ${isLogisticsReady 
      ? '#10B981' 
      : (assignedVolume > 0 ? '#F59E0B' : '#64748B')}`
  }}>
    {isLogisticsReady || assignedVolume === 0 ? '✓' : '⚠️'}
  </div>

      {/* Время */}
      <div style={{ width: '100px', fontWeight: '600', color: '#E2E8F0', fontSize: '15px' }}>
        {time}
      </div>
      
      {/* Информация */}
      <div style={{ flex: 1, lineHeight: '1.25' }}>
        <div style={{ fontWeight: '600', color: '#F1F5F9' }}>
          #{order.id} — {client}
        </div>
        <div style={{ color: '#94A3B8', fontSize: '13px' }}>
          {order.grade} • {volume} м³
          {isOverflow && (
            <span style={{ color: '#FACC15', marginLeft: '6px' }}>
              +{overflowMinutes} мин завтра
            </span>
          )}
        </div>
      </div>

      {/* Полоса заказа */}
      <div style={{
        position: 'absolute',
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
        height: '32px',
        background: statusColor,
        borderRadius: '9999px',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '14px',
        color: '#fff',
        fontWeight: '600',
        fontSize: '13px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        zIndex: 10
      }}>

        {statusText}

        {isOverflow && (
          <span style={{ 
            marginLeft: 'auto', 
            marginRight: '10px', 
            background: 'rgba(0,0,0,0.35)',
            padding: '2px 8px',
            borderRadius: '9999px',
            fontSize: '12px'
          }}>
            → завтра
          </span>
        )}
      </div>
    </div>
  );
}) : (
  <div style={{ 
    textAlign: 'center', 
    padding: '80px 40px', 
    color: '#64748B',
    fontSize: '17px'
  }}>
    На выбранный день заказов нет
  </div>
)}

    {/* Вертикальная линия текущего времени */}
<div style={{
  position: 'absolute',
  left: `${currentHourPercent}%`,
  top: '0',
  bottom: '0',
  width: '3px',
  background: 'linear-gradient(180deg, #3B82F6, #60A5FA)',
  boxShadow: '0 0 12px #3B82F6',
  zIndex: 50,
  pointerEvents: 'none'
}} />

{/* Плашка с текущим временем — СНИЗУ линии */}
<div style={{
  position: 'absolute',
  left: `${currentHourPercent}%`,
  bottom: '1px',                    // ← Основной параметр для регулировки
  transform: 'translateX(-50%)',
  background: '#1E40AF',
  color: 'white',
  padding: '5px 14px',
  borderRadius: '9999px',
  fontSize: '13.5px',
  fontWeight: '700',
  zIndex: 60,
  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.5)',
  whiteSpace: 'nowrap',
  border: '2px solid #60A5FA',
  textAlign: 'center',
  minWidth: '62px'
}}>
  {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
</div>
    </div>
   </div>
  </div>
            {/* ==================== МИКСЕРЫ В РАБОТЕ (только по выбранной дате) ==================== */}
      <div style={{ 
            width: '100%', 
            maxWidth: '480px', 
            background: '#1E2937', 
            borderRadius: '24px', 
            padding: '24px', 
            display: 'flex', 
            flexDirection: 'column',
            height: '92vh',                    // ← Основная настройка высоты (в процентах от высоты экрана)
            minHeight: '1000px',                // минимальная высота на маленьких экранах
            alignSelf: 'stretch',
            position: 'sticky',
            top: '20px'
       }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '24px', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img src="/icons/mixer-truck.png" alt="Миксер" style={{ width: '32px', height: '32px', objectFit: 'contain' }} />
            Миксеры в работе
          </h3>

          <div style={{ 
            background: '#10B98120', 
            color: '#10B981', 
            padding: '6px 14px', 
            borderRadius: '9999px', 
            fontSize: '15px',
            fontWeight: '600'
          }}>
            {activeMixersToday.length} на линии
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
          {activeMixersToday.length > 0 ? (
            activeMixersToday.map((mixer: any) => (
              <div key={mixer.id} style={{ 
                background: '#25334A', 
                borderRadius: '18px', 
                padding: '20px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontSize: '18px', fontWeight: '700' }}>
                      {mixer.number || mixer.mixer_name}
                    </div>
                    <div style={{ fontSize: '15px', color: '#60A5FA', marginTop: '2px' }}>
                      Заказ #{mixer.orderId}
                    </div>
                  </div>

                  <select 
                    value={mixer.status || 'Загрузка'}
                    onChange={(e) => handleStatusChange(mixer.id, e.target.value)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '9999px',
                      background: '#1E2937',
                      color: 'white',
                      border: 'none',
                      fontSize: '14px',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="Загрузка">🟡 Загрузка</option>
                    <option value="В пути">🔵 В пути</option>
                    <option value="На объекте">📍 На объекте</option>
                    <option value="Разгружен">🟢 Разгружен</option>
                    <option value="Возврат">↩️ Возврат</option>
                    <option value="Проблема">🔴 Проблема</option>
                  </select>
                </div>

                <div style={{ color: '#CBD5E1', fontSize: '15px', marginBottom: '8px' }}>
                  {mixer.volume} м³ • {mixer.client || '—'}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '15px', color: '#94A3B8' }}>
                  <span>⏱</span>
                  <span style={{ color: '#10B981', fontWeight: '600' }}>{mixer.time}</span>
                </div>
              </div>
            ))
          ) : (
            <div style={{ 
              flex: 1, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: '#64748B',
              fontSize: '17px'
            }}>
              На выбранный день нет активных миксеров
            </div>
          )}
        </div>

        <button style={{ 
          marginTop: '28px',
          padding: '18px', 
          background: '#3B82F6', 
          color: 'white', 
          border: 'none', 
          borderRadius: '9999px', 
          fontSize: '17px', 
          fontWeight: '600',
          cursor: 'pointer'
        }}>
          📍 Показать все миксеры на карте
        </button>
      </div>
   </div>

     {/* ==================== МОДАЛЬНОЕ ОКНО ЗАКАЗА ==================== */}
{selectedOrder && (
  <OrderDetailModal
    key={selectedOrder.id}                    // ← важно для React
    order={selectedOrder}
    onClose={() => setSelectedOrder(null)}
    mixerAssignments={mixerAssignments}
    setMixerAssignments={setMixerAssignments}
    allOrders={allOrders}
    setAllOrders={setAllOrders}
    allMixers={allMixers || []}
    currentUser={modalCurrentUser}
    handleStatusChange={handleStatusChange}
    deleteMixer={deleteMixer}
    completeLogistics={completeLogistics}
    history={history}
    addToHistory={addToHistory}
    getStatusConfig={getStatusConfig}
  />
)}

      {/* Модалка календаря */}
      {showCalendar && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowCalendar(false)}>
          <div onClick={e => e.stopPropagation()}>
            <Calendar onClose={() => setShowCalendar(false)} />
          </div>
        </div>
      )}
    </div>
    </div>
    
  );
}