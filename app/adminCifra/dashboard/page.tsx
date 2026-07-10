'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Calendar from '../Calendar';
import { Order } from '../hooks/useCalendarOrders';
import { createClient } from '@/app/utils/supabase/client';
import { useRealtimeOrders } from '../../../hooks/useRealtimeOrders';
import OrderDetailModal from '../components/OrderDetailModal';
import Image from 'next/image';

// ==================== 0. SUPABASE CLIENT ====================
const supabase = createClient();

export default function AdminCifraDashboard() {

   // ==================== 1. ВСЕ СОСТОЯНИЯ ===========================================
  const [userId, setUserId] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [userFullName, setUserFullName] = useState<string>('');

  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const MINUTES_PER_CUBIC_METER = 2;

  // ==================== 2. СТАТУСЫ ЗАКАЗОВ (глобальная функция) ====================
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

    // ==================== 3. ДОБАВЛЕНИЕ В ИСТОРИЮ (финальная улучшенная версия) ====================
const addToHistory = async (action: string, details?: any) => {
  if (!selectedOrder?.id) return;

  const userName = userFullName || localStorage.getItem('userName') || 'Сотрудник';
  const userRole = localStorage.getItem('userRole') || 'admin';

  let finalAction = action.trim();

  // === СПЕЦИАЛЬНАЯ ОБРАБОТКА ДЛЯ ДЕТАЛЬНЫХ ИЗМЕНЕНИЙ ===
  if (details?.fieldName || details?.field_name) {
    const field = details.fieldName || details.field_name;
    const oldVal = details.oldValue || details.old_value || '—';
    const newVal = details.newValue || details.new_value || '—';

    if (field === 'organization_name') {
      finalAction = `Изменил название организации с "${oldVal}" на "${newVal}"`;
    } else if (field === 'status') {
      const oldRus = getStatusRussian(oldVal);
      const newRus = getStatusRussian(newVal);
      finalAction = `Изменил статус заявки с "${oldRus}" на "${newRus}"`;
    }
  }
  // === СПЕЦИАЛЬНАЯ ОБРАБОТКА СМЕНЫ СТАТУСА (если details не передан) ===
  else if (details?.oldStatus || details?.newStatus || finalAction.toLowerCase().includes('status')) {
    const oldStatus = details?.oldStatus || '—';
    const newStatus = details?.newStatus || '—';
    
    const oldRus = getStatusRussian(oldStatus);
    const newRus = getStatusRussian(newStatus);
    finalAction = `Изменил статус заявки с "${oldRus}" на "${newRus}"`;
  } 
  // === ДРУГИЕ СПЕЦИАЛЬНЫЕ ДЕЙСТВИЯ ===
  else if (finalAction.toLowerCase().includes('логистик')) {
    finalAction = finalAction.replace('логистики', 'логистику');
  } 
  else if (finalAction.toLowerCase().includes('delivery_time') || finalAction.toLowerCase().includes('время')) {
    finalAction = 'Изменил время доставки';
  } 
  else if (finalAction.toLowerCase().includes('volume') || finalAction.toLowerCase().includes('объём')) {
    finalAction = 'Изменил объём';
  } 
  else if (finalAction.toLowerCase().includes('address') || finalAction.toLowerCase().includes('адрес')) {
    finalAction = 'Изменил адрес доставки';
  }

  try {
    const payload = {
      order_id: selectedOrder.id,
      action: finalAction,
      user_name: userName,
      user_role: userRole,
      details: details || {},
      // Дополнительно сохраняем для детального отображения в истории
      field_name: details?.fieldName || details?.field_name || null,
      old_value: details?.oldValue || details?.old_value || null,
      new_value: details?.newValue || details?.new_value || null
    };

    console.log('📝 [addToHistory] →', payload);

    const res = await fetch('/api/adminCifra/order-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      // Обновляем историю сразу
      const histRes = await fetch(`/api/adminCifra/order-history?orderId=${selectedOrder.id}`);
      if (histRes.ok) {
        const data = await histRes.json();
        setHistory(data);
      }
    }
  } catch (err) {
    console.error('❌ Не удалось добавить в историю:', err);
  }
};

// ==================== 3.1 ПЕРЕВОД СТАТУСОВ ====================
const getStatusRussian = (status: string): string => {
  const map: Record<string, string> = {
    'new': 'Новый',
    'processing': 'В работе',
    'completed': 'Выполнен',
    'cancelled': 'Отменён',
    'loading': 'Загрузка',
    'on_way': 'В пути',
    'ready': 'Готов',
    '': '—'
  };
  return map[status?.toLowerCase()] || status || '—';
};

    // ==================== 4. ЗАГРУЗКА НАЗНАЧЕННЫХ МИКСЕРОВ ====================
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

    // ==================== 5. РЕАКТИВНЫЙ МАСШТАБ =================================
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

  // ==================== 5.1 СОХРАНЁННЫЙ ОТЧЁТ =====================================
  const [savedReport, setSavedReport] = useState<string>('');

 // ==================== 6. УВЕДОМЛЕНИЯ О ВЫВОДЕ НАЛИЧНЫХ ==========================
const fetchNotifications = async () => {
  if (!['admin', 'manager'].includes(userRole || '')) {
    setNotifications([]);
    return;
  }

  try {
    const res = await fetch(`/api/adminCifra/withdrawals?userId=${userId}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(15000) // 15 секунд таймаут
    });

    if (!res.ok) {
      console.warn(`Withdrawals API: HTTP ${res.status}`);
      setNotifications([]);
      return;
    }

    const data = await res.json();

    // Оставляем только pending
    const pending = (data.withdrawals || data || []).filter((w: any) => w.status !== 'completed');
    
    setNotifications(pending);
    console.log(`🔔 Активных запросов на вывод: ${pending.length}`);
  } catch (err: any) {
    console.warn('Ошибка загрузки уведомлений о выводах:', err.message || err);
    setNotifications([]); // ← важно, чтобы не ломало дашборд
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

// ==================== 6.1 ЗАГРУЗКА УВЕДОМЛЕНИЙ ====================
useEffect(() => {
  fetchNotifications(); // первая загрузка

  const handleRefresh = () => fetchNotifications();
  window.addEventListener('refreshNotifications', handleRefresh);

  return () => {
    window.removeEventListener('refreshNotifications', handleRefresh);
  };
}, [userRole, userId]);

  // ==================== 7. ЗАГРУЗКА ВСЕХ ЗАКАЗОВ ====================
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

    // ==================== 8. ЗАГРУЗКА АКТИВНЫХ МИКСЕРОВ ====================
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

  // ==================== 9. ФИНАЛЬНЫЙ РАСЧЁТ ЗАКАЗОВ (учёт timezone) =========
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

// console.log(`Выбрана дата: ${selectedDateStr} | Найдено заказов: ${todayOrders.length}`);

// ==================== 10. РАСЧЁТ ЗАДЕРЖЕК ОТГРУЗОК (реал-тайм) ====================
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

  // ==================== 11. МИКСЕРЫ ЗА ДЕНЬ =========================================
  const activeMixersToday = activeMixers.filter((mixer: any) => {
    return todayOrders.some(order => String(order.id) === String(mixer.orderId));
  });

  // ==================== 12. ГРУППИРОВКА МИКСЕРОВ ====================================
  const groupedMixers = React.useMemo(() => {
    const groups: Array<{
      orderId: number | string;
      client: string;
      deliveryTime: string;
      mixers: any[];
    }> = [];

    const sortedOrders = [...todayOrders].sort((a, b) => 
      (a.delivery_time || '00:00').localeCompare(b.delivery_time || '00:00')
    );

    sortedOrders.forEach(order => {
      const mixersForOrder = activeMixersToday
        .filter(m => String(m.orderId) === String(order.id))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

      if (mixersForOrder.length > 0) {
        groups.push({
          orderId: order.id,
          client: order.organization_name || order.full_name || '—',
          deliveryTime: order.delivery_time || '—',
          mixers: mixersForOrder
        });
      }
    });

    return groups;
  }, [todayOrders, activeMixersToday]);

// ==================== 13. ДИНАМИЧЕСКИЕ KPI ==============================================
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

  // ==================== 14. ЗАГРУЗКА USER ID / ROLE / CURRENT USER ====================
  useEffect(() => {
    const saved = localStorage.getItem('userId');
    if (saved) setUserId(parseInt(saved, 10));
  }, []);

 // ==================== 14.1 ЗАГРУЗКА РОЛИ + ИМЕНИ ====================
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
    .then(data => {
      console.log('📥 Данные от /api/user/role:', data); // ← для отладки

      setUserRole(data.role || 'client');
      
      // Берём имя из full_name
      if (data.full_name) {
        setUserFullName(data.full_name);
      } else if (data.username) {
        setUserFullName(data.username);
      } else {
        setUserFullName('Сотрудник');
      }
    })
    .catch((err) => {
      console.error('Ошибка загрузки роли:', err);
      setUserRole('client');
      setUserFullName('Сотрудник');
    })
    .finally(() => setLoadingRole(false));
}, [userId]);

  // ==================== 14.2 ЗАГРУЗКА CURRENT USER ====================
  useEffect(() => {
    if (userId && userRole) {
      setCurrentUser({
        id: userId,
        name: 'Администратор',     // потом можно взять из профиля
        role: userRole
      });
    }
  }, [userId, userRole]);

// ==================== 15. ЗАГРУЗКА МИКСЕРОВ ====================
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

    // ==================== 16. ЗАГРУЗКА АКТИВНЫХ МИКСЕРОВ ====================
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

      // ==================== 17. СМЕНА СТАТУСА МИКСЕРА ====================
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

  // ==================== 18. ТАЙМЛАЙН ==============================================
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

    // ==================== 19. АВТО-ОБНОВЛЕНИЕ ТАЙМЛАЙНА ============================
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
    }, 20000); // каждые 20 секунд

    return () => clearInterval(interval);
  }, []);

  // ==================== 20. REALTIME ==================================================
   // useRealtimeOrders(setAllOrders);

      // ==================== 21. АВТО-ОБНОВЛЕНИЕ ДАННЫХ ================================
useEffect(() => {
  const refreshData = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 секунд таймаут

      const [ordersRes, mixersRes] = await Promise.all([
        fetch('/api/adminCifra/all-orders', { 
          signal: controller.signal,
          cache: 'no-store' 
        }),
        fetch('/api/adminCifra/active-mixers', { 
          signal: controller.signal,
          cache: 'no-store' 
        })
      ]);

      clearTimeout(timeoutId);

      if (ordersRes.ok) {
        const freshOrders = await ordersRes.json();
        setAllOrders(Array.isArray(freshOrders) ? freshOrders : freshOrders.orders || freshOrders || []);
      }

      if (mixersRes.ok) {
        const freshMixers = await mixersRes.json();
        setActiveMixers(freshMixers);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.warn('Auto-refresh: запрос превысил таймаут (25 сек)');
      } else {
        console.error('Ошибка автообновления:', err);
      }
    }
  };

  refreshData();                    // сразу при загрузке

  const interval = setInterval(refreshData, 20000); // каждые 20 секунд

  return () => clearInterval(interval);
}, []);

    // ==================== 22. ГЛОБАЛЬНАЯ ЗАГРУЗКА ВСЕХ НАЗНАЧЕННЫХ МИКСЕРОВ ===============
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

    // ============ 23. ВОССТАНОВЛЕНИЕ ГЛОБАЛЬНОГО СОСТОЯНИЯ ПРИ ЗАКРЫТИИ МОДАЛКИ ============
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

  // ==================== 24. ЗАГРУЗКА МИКСЕРОВ ДЛЯ ОТКРЫТОЙ МОДАЛКИ ==========================
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

  // ==================== 25. ЗАГРУЗКА ИСТОРИИ ПРИ ОТКРЫТИИ МОДАЛКИ ============================
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

  // ==================== 26. СЛУШАТЕЛЬ ДЛЯ ОБНОВЛЕНИЯ ПОСЛЕ ДОБАВЛЕНИЯ МИКСЕРА ====================
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

    // ================================= 27. КРАСИВЫЕ НАЗВАНИЯ РОЛЕЙ =================================
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

    // ========================== 28. УДАЛЕНИЕ МИКСЕРА + ЗАПИСЬ В ИСТОРИЮ =============================
const deleteMixer = async (mixerId: number | string, index: number) => {
  if (!mixerId) return;

  const mixerToDelete = mixerAssignments.find(m => String(m.id) === String(mixerId));
  if (!mixerToDelete) return;

  const mixerName = mixerToDelete.mixerName || mixerToDelete.number || mixerToDelete.mixer_name || 'Миксер';
  const currentStatus = mixerToDelete.status || 'Загрузка';

  // ====================28.1  ЗАПРЕЩЁННЫЕ СТАТУСЫ ====================
  const forbiddenStatuses = ['В пути', 'На объекте', 'Разгружен', 'Возврат', 'Проблема'];

  if (forbiddenStatuses.includes(currentStatus)) {
    alert(`❌ Невозможно удалить миксер ${mixerName}.\n\n`
        + `Рейс уже в статусе "${currentStatus}".\n`
        + `Удаление возможно только для рейсов со статусом "Загрузка".`);
    return;
  }

  // Оптимистическое удаление
  const previousState = [...mixerAssignments];
  setMixerAssignments(prev => prev.filter(m => String(m.id) !== String(mixerId)));

  try {
    const res = await fetch('/api/adminCifra/order-mixers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: mixerId })
    });

    const data = await res.json();

    if (res.ok && (data.success || !data.error)) {
      console.log(`🗑️ Миксер ${mixerName} успешно удалён`);

      if (typeof addToHistory === 'function') {
        await addToHistory(`Удалил миксер ${mixerName} (статус: ${currentStatus})`);
      }
    } else {
      throw new Error(data.error || data.message || 'Не удалось удалить');
    }
  } catch (err: any) {
    console.error('Ошибка удаления миксера:', err);

    // Откат при ошибке
    setMixerAssignments(previousState);
    alert(`Не удалось удалить миксер ${mixerName}.\n\nОшибка: ${err.message || err}`);
  }
};

  // ==================== 29. DRAG & DROP МИКСЕРОВ ВНУТРИ ЗАКАЗА ========================================
const handleMixerDrop = (e: React.DragEvent, orderId: number | string) => {
  const data = e.dataTransfer.getData('text/plain');
  const [fromOrderId, fromIndexStr] = data.split('-');
  const fromIndex = parseInt(fromIndexStr);

  if (String(fromOrderId) !== String(orderId)) return; // нельзя перемещать между заказами

  const group = groupedMixers.find(g => String(g.orderId) === String(orderId));
  if (!group) return;

  const newMixers = [...group.mixers];
  const [moved] = newMixers.splice(fromIndex, 1);
  newMixers.splice(fromIndex, 0, moved); // просто меняем порядок

  // Обновляем глобальный массив
  setMixerAssignments(prev => 
    prev.map(item => {
      if (String(item.orderId) === String(orderId)) {
        const updated = newMixers.find(m => m.id === item.id);
        return updated ? { ...item, sortOrder: newMixers.indexOf(updated) } : item;
      }
      return item;
    })
  );
};

    // ==================== 30. ЗАВЕРШЕНИЕ ЛОГИСТИКИ + АВТО-СМЕНА СТАТУСА =================================
const completeLogistics = async (selectedOrderParam?: Order) => {
  const targetOrder = selectedOrderParam || selectedOrder;
  if (!targetOrder) return;

  const assignedVolume = mixerAssignments
    .filter(m => String(m.orderId) === String(targetOrder.id))
    .reduce((sum, m) => sum + Number(m.volume || 0), 0);

  const orderVolume = Number(targetOrder.volume || 0);
  const isFullyReady = assignedVolume >= orderVolume && assignedVolume > 0;

  // Новое строгое условие — не меняем статус, если уже финальный
  const isFinalStatus = targetOrder.status === 'completed' || targetOrder.status === 'cancelled';
  const newStatus = isFullyReady && !isFinalStatus ? 'processing' : targetOrder.status;

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
      const actionText = isFullyReady
        ? `Завершил логистику: ${assignedVolume}/${orderVolume} м³ (полностью)`
        : `Сохранил частичную логистику: ${assignedVolume}/${orderVolume} м³`;

      if (typeof addToHistory === 'function') {
        await addToHistory(actionText);
      }

      alert(isFullyReady
        ? `✅ Полная логистика (${assignedVolume}/${orderVolume} м³)`
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

  // ==================== 31. ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ ДЛЯ МОДАЛКИ =================================
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

        {/* ==================== 32. ОСНОВНОЙ GRID ==================== */}
        <div style={{ 
          display: 'grid',
          gridTemplateColumns: 'minmax(820px, 1fr) minmax(430px, 510px)', 
          gap: '32px',
          maxWidth: '100%', 
          width: '100%', 
          margin: '0 auto',
          minHeight: 'calc(100vh - 80px)'
        }}>

      {/* ==================== 33. ЛЕВАЯ КОЛОНКА ( KPI) ==================== */}
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
      Дашборд
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

  {/* Имя сотрудника из full_name */}
  <div style={{ 
    color: '#60A5FA', 
    fontWeight: '500',
    background: 'rgba(96, 165, 250, 0.1)',
    padding: '8px 16px',
    borderRadius: '9999px'
  }}>
    👤 {userFullName || 'Сотрудник'}
  </div>
</div>
</div>

       {/* ==================== 34. KPI — РЕАЛЬНЫЕ ДАННЫЕ ==================== */}
        <div style={{ 
               display: 'grid', 
               gridTemplateColumns: 'repeat(4, 1fr)', 
               gap: '20px',
               minWidth: '1100px',           // ← Важно! Не даёт сжиматься меньше 4 колонок
               overflowX: 'auto',            // ← Добавляет горизонтальный скролл при необходимости
               paddingBottom: '8px'
         }}>
          
       {/* ==================== 35. ЗАЯВКИ СЕГОДНЯ (точно как Миксеры) ==================== */}
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

  {/* ==================== 36. ВЫПОЛНЕНИЕ ПЛАНА ==================== */}
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
    {Math.round(completedVolume)} <span style={{ fontSize: '28px', color: '#64748B' }}>/ {Math.round(planToday)}</span> м³
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

   {/* ==================== 37.  ЗАДЕРЖКИ ОТГРУЗОК ==================== */}
<div style={{ 
  background: '#25334A', 
  borderRadius: '20px', 
  padding: '24px', 
  minHeight: '180px',           
  height: 'fit-content',        
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
        maxHeight: '52px',           
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
      {/* ==================== 38. ТАЙМЛАЙН (УЛУЧШЕННЫЙ — В СТИЛЕ ЦИФРА.AI) ==================== */}
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

  {/* ==================== 39. УЛУЧШЕННАЯ ШКАЛА ВРЕМЕНИ ==================== */}
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

  // ==================== 39. НАСТРОЙКА ЧАСОВОГО ПОЯСА ====================
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

  // ==================== 40. ДИНАМИЧЕСКИЙ ПЛАН НА ДЕНЬ ====================
const planToday = todayOrders.reduce((sum, o) => sum + Number(o.volume || 0), 0);

const completedVolume = todayOrders
  .filter(o => o.status === 'completed')
  .reduce((sum, o) => sum + Number(o.volume || 0), 0);

const completedOrders = todayOrders.filter(o => o.status === 'completed').length;
const totalToday = todayOrders.length;

const completionPercent = planToday > 0 
  ? Math.round((completedVolume / planToday) * 100) 
  : 0;

     // ==================== 41. СТАТУС ЗАКАЗА ====================
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

  // ==================== 42. РАСЧЁТ ЛОГИСТИКИ ====================
const assignedVolume = mixerAssignments
    .filter(m => String(m.orderId) === String(order.id))   // ← надёжное сравнение
    .reduce((sum, m) => sum + Number(m.volume || 0), 0);

const orderVolume = Number(order.volume || 0);
const isLogisticsReady = assignedVolume >= orderVolume && assignedVolume > 0;
//  console.log(`Заказ #${order.id}: ${assignedVolume}/${orderVolume} м³ → ${isLogisticsReady ? 'ЗЕЛЁНЫЙ' : assignedVolume > 0 ? 'ОРАНЖЕВЫЙ' : 'СЕРЫЙ'}`);
// Основная логика
const isFullyAssigned = assignedVolume >= orderVolume && assignedVolume > 0;
const isReadyInDB = (order as any).logistics_ready === true;

// ==================== 43. ГЕНЕРАЦИЯ ОТЧЁТА ДЛЯ МЕССЕНДЖЕРА ====================
const generateDailyReport = () => {
  if (groupedMixers.length === 0) {
    alert('На выбранный день нет активных заявок');
    return;
  }

  let report = `📋 Планирование на ${selectedDate.toLocaleDateString('ru-RU', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long' 
  })}\n\n`;

  groupedMixers.forEach((group, index) => {
    const totalVol = group.mixers.reduce((sum, m) => sum + Number(m.volume || 0), 0);
    
    report += `${index + 1}) Заявка #${group.orderId} — ${group.client || '—'}\n`;
    report += `   Время: ${group.deliveryTime || '—'} • ${totalVol} м³\n`;

    group.mixers.forEach((mixer, i) => {
      report += `   ${i+1}) ${mixer.number || mixer.mixer_name} — ${mixer.time || '—'} • ${mixer.volume} м³\n`;
    });
    report += `\n`;
  });

  report += `Всего на линии: ${activeMixersToday.length} миксеров\n`;

  const win = window.open('', '_blank', 'width=850,height=780');
  if (win) {
    win.document.write(`
      <html><head><title>Отчёт</title>
      <style>body{font-family:Arial,sans-serif;padding:30px;line-height:1.8;font-size:15.5px;} pre{white-space:pre-wrap;}</style>
      </head><body>
      <h2>Отчёт на ${selectedDate.toLocaleDateString('ru-RU')}</h2>
      <pre>${report}</pre>
      <button onclick="navigator.clipboard.writeText(document.body.innerText).then(()=>alert('Отчёт скопирован!'))">📋 Скопировать</button>
      </body></html>
    `);
  } else {
    navigator.clipboard.writeText(report).then(() => alert('✅ Отчёт скопирован!'));
  }
};


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
   {/* ==================== 44. МЕТКА ЛОГИСТИКИ ==================== */}
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
            {/* ==================== 45. МИКСЕРЫ В РАБОТЕ ==================== */}
<div style={{ 
  width: '100%', 
  maxWidth: '480px', 
  background: '#1E2937', 
  borderRadius: '24px', 
  padding: '24px', 
  display: 'flex', 
  flexDirection: 'column',
  height: 'auto',
  maxHeight: '92vh',
  minHeight: '1400px',
  overflow: 'hidden'
}}>
  
  {/* Заголовок + счётчик */}
  <div style={{ 
    display: 'flex', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: '24px',
    flexWrap: 'wrap',
    gap: '12px'
  }}>
    
    <h3 style={{ 
      fontSize: '24px', 
      margin: 0, 
      display: 'flex', 
      alignItems: 'center', 
      gap: '12px',
      color: 'white'
    }}>
      <img 
        src="/icons/mixer-truck.png" 
        alt="Миксер" 
        style={{ width: '32px', height: '32px', objectFit: 'contain' }} 
      />
      Миксеры в работе
    </h3>

    {/* Отдельный блок со счётчиком */}
    <div style={{ 
      background: 'rgba(255,255,255,0.1)', 
      padding: '8px 16px',
      borderRadius: '9999px',
      fontSize: '17px',
      fontWeight: '600',
      color: '#60A5FA',
      whiteSpace: 'nowrap',
      marginTop: '5px'
    }}>
      {activeMixersToday.length} на линии
    </div>
  </div>

  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
    {groupedMixers.length > 0 ? (
      groupedMixers.map((group) => (
        <div key={group.orderId} style={{ 
          background: '#25334A', 
          borderRadius: '18px', 
          overflow: 'hidden'
        }}>
          {/* Шапка заказа */}
          <div style={{ 
            background: '#1E2937', 
            padding: '14px 20px', 
            borderBottom: '1px solid #334155',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <div style={{ fontWeight: '700', fontSize: '16px' }}>
                Заказ #{group.orderId}
              </div>
              <div style={{ color: '#94A3B8', fontSize: '14px' }}>
                {group.client} • {group.deliveryTime}
              </div>
            </div>
            <div style={{ color: '#60A5FA', fontSize: '15px' }}>
              {group.mixers.length} миксеров
            </div>
          </div>

         {/* Строки миксеров внутри заказа */}
         <div style={{ padding: '8px' }}>
           {/* === ИСПРАВЛЕНИЕ: СОРТИРОВКА МИКСЕРОВ ПО ВРЕМЕНИ (самый ранний сверху) === */}
           {[...group.mixers]
             .sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'))
             .map((mixer: any, index: number) => (
               <div 
                 key={mixer.id}
                 draggable
                 onDragStart={(e) => e.dataTransfer.setData('text/plain', `${group.orderId}-${index}`)}
                 onDragOver={(e) => {
                   e.preventDefault();
                   e.currentTarget.style.background = '#2A3A52';
                 }}
                 onDragLeave={(e) => {
                   e.currentTarget.style.background = '#1E2937';
                 }}
                 onDrop={(e) => {
                   e.preventDefault();
                   e.currentTarget.style.background = '#1E2937';
                   handleMixerDrop(e, group.orderId);
                 }}
                 style={{ 
                   background: '#1E2937', 
                   padding: '6px 12px',
                   borderRadius: '10px',
                   marginBottom: '5px',
                   display: 'flex',
                   alignItems: 'center',
                   gap: '12px',
                   minHeight: '34px',
                   cursor: 'grab',
                   userSelect: 'none'
                 }}
               >
                 {/* Порядковый номер */}
                 <div style={{
                   width: '24px',
                   height: '24px',
                   background: '#334155',
                   borderRadius: '9999px',
                   display: 'flex',
                   alignItems: 'center',
                   justifyContent: 'center',
                   fontWeight: '700',
                   color: '#94A3B8',
                   fontSize: '13px',
                   flexShrink: 0
                 }}>
                   {index + 1}
                 </div>

                 {/* Номер миксера */}
                 <div style={{ fontWeight: '700', fontSize: '14.5px', minWidth: '120px' }}>
                   {mixer.number || mixer.mixer_name}
                 </div>

                 {/* ==================== 46. ВРЕМЯ + ОБЪЁМ (в одну строку справа) ==================== */}
                 <div style={{ 
                   color: '#94A3B8', 
                   fontSize: '13px',
                   flex: 1,
                   textAlign: 'left'
                 }}>
                   {mixer.time && mixer.time !== '—' ? mixer.time : '—'} • {mixer.volume} м³
                 </div>

                 {/* Статус */}
                 <select 
                   value={mixer.status || 'Загрузка'}
                   onChange={(e) => handleStatusChange(mixer.id, e.target.value)}
                   style={{
                     padding: '4px 8px',
                     borderRadius: '9999px',
                     background: '#0F172A',
                     color: 'white',
                     border: 'none',
                     fontSize: '13px',
                     minWidth: '125px'
                   }}
                 >
                   <option value="Загрузка">🟡 Загрузка</option>
                   <option value="В пути">🔵 В пути</option>
                   <option value="На объекте">📍 На объекте</option>
                   <option value="Разгружен">🟢 Разгружен</option>
                   <option value="Возврат">↩️ Возврат</option>
                   <option value="Проблема">🔴 Проблема</option>
                 </select>

                 <button 
                   onClick={() => deleteMixer(mixer.id, index)}
                   style={{ 
                     color: '#EF4444', 
                     background: 'none', 
                     border: 'none', 
                     cursor: 'pointer', 
                     fontSize: '17px',
                     padding: '2px 6px'
                   }}
                 >
                   ✕
                 </button>
               </div>
             ))
           }
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

{/* ==================== 47. КНОПКА СФОРМИРОВАТЬ ОТЧЁТ ==================== */}
<button 
  onClick={() => {
    const dateKey = selectedDate.toISOString().split('T')[0];
    const editedKey = `dailyReport_${dateKey}`;
    const autoKey = `dailyReport_auto_${dateKey}`;

    // Генерируем свежий отчёт
    const sortedGroups = [...groupedMixers].sort((a, b) => 
      (a.deliveryTime || '00:00').localeCompare(b.deliveryTime || '00:00')
    );

    let autoReport = `📋 ПЛАНИРОВАНИЕ НА ${selectedDate.toLocaleDateString('ru-RU', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long' 
    })}\n\n`;

    sortedGroups.forEach((group, index) => {
      const totalVol = group.mixers.reduce((sum, m) => sum + Number(m.volume || 0), 0);
      
      const concreteGrade = 
        (group as any).grade || 
        (group as any).concrete_grade || 
        ((group as any).mixers?.[0]?.grade) || 
        ((group as any).mixers?.[0]?.concrete_grade) || 
        '—';

      autoReport += `${index + 1}) Заявка #${group.orderId} — ${group.client || '—'}\n`;
      autoReport += `   Бетон: ${concreteGrade} • Время: ${group.deliveryTime || '—'} • ${totalVol} м³\n`;

      const sortedMixers = [...group.mixers].sort((a, b) => 
        (a.time || '00:00').localeCompare(b.time || '00:00')
      );

      sortedMixers.forEach((mixer, i) => {
        autoReport += `   ${i+1}) ${mixer.number || mixer.mixer_name} — ${mixer.time || '—'} • ${mixer.volume} м³\n`;
      });
      autoReport += `\n`;
    });

    autoReport += `Всего на линии: ${activeMixersToday.length} миксеров\n`;

    localStorage.setItem(autoKey, autoReport);

    let report = localStorage.getItem(editedKey) || autoReport;

    // Модальное окно — твои размеры
    const modal = document.createElement('div');
    modal.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:10000;display:flex;align-items:center;justify-content:center;`;

    modal.innerHTML = `
      <div style="background:#1E2937;width:820px;max-width:80%;border-radius:16px;padding:25px; height:1400px; max-height:100vh;overflow:auto;">
        <h2 style="margin-top:0;color:#60A5FA;text-align:center;">Отчёт на ${selectedDate.toLocaleDateString('ru-RU')}</h2>
        <textarea id="reportText" style="width:96%;height:1200px;font-size:15.2px;padding:15px;font-family:monospace;background:#0F172A;color:#E2E8F0;border:1px solid #475569;border-radius:8px;resize:vertical;">${report}</textarea>
        
        <div style="text-align:center;margin-top:20px;">
          <button id="refreshBtn" style="padding:14px 32px;background:#475569;color:white;border:none;border-radius:12px;font-size:16px;cursor:pointer;margin-right:12px;">🔄 Обновить до свежих данных</button>
          <button id="copyBtn" style="padding:14px 32px;background:#10B981;color:white;border:none;border-radius:12px;font-size:16px;cursor:pointer;">📋 Скопировать отчёт</button>
          <button id="closeBtn" style="padding:14px 32px;background:#475569;color:white;border:none;border-radius:12px;font-size:16px;cursor:pointer;margin-left:12px;">Закрыть</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    setTimeout(() => {
      const textArea = document.getElementById('reportText') as HTMLTextAreaElement;
      const refreshBtn = document.getElementById('refreshBtn');
      const copyBtn = document.getElementById('copyBtn');
      const closeBtn = document.getElementById('closeBtn');

      if (textArea) {
        textArea.addEventListener('input', () => {
          localStorage.setItem(editedKey, textArea.value);
        });
      }

      if (refreshBtn && textArea) {
        refreshBtn.addEventListener('click', () => {
          if (confirm('Загрузить свежие данные? Ваши правки будут потеряны.')) {
            textArea.value = autoReport;
            localStorage.setItem(editedKey, autoReport);
          }
        });
      }

      if (copyBtn && textArea) {
        copyBtn.addEventListener('click', () => {
          textArea.select();
          document.execCommand('copy');
          alert('✅ Отчёт скопирован!');
        });
      }

      if (closeBtn && textArea) {
        closeBtn.addEventListener('click', () => {
          localStorage.setItem(editedKey, textArea.value);
          modal.remove();
        });
      }
    }, 100);
  }}
  style={{
    marginTop: '24px',
    width: '100%',
    padding: '16px',
    background: '#6366F1',
    color: 'white',
    border: 'none',
    borderRadius: '16px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer'
  }}
>
  📋 Сформировать отчёт за день
</button>

</div>
</div>

     {/* ==================== 48. МОДАЛЬНОЕ ОКНО ЗАКАЗА ==================== */}
{selectedOrder && (
  <OrderDetailModal
    key={selectedOrder.id}                    
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
    setHistory={setHistory}
    setSelectedOrder={setSelectedOrder}
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