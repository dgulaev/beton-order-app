'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Calendar from '../Calendar';
import { Order } from '../hooks/useCalendarOrders';
import { useRealtimeOrders, useRealtimeOrderMixers, formatOrderMixer } from '../../../hooks/useRealtimeOrders';
import OrderDetailModal from '../components/OrderDetailModal';
import NewOrderModal from '../components/NewOrderModal';
import Image from 'next/image';
import { Home, LayoutList, AlignJustify, X } from 'lucide-react';
import VerticalTimelinePanel from '../components/VerticalTimelinePanel';
import { sortMixersByLogisticsTime } from '@/lib/mixerTimeSort';
import { CARD_BORDER, modalCloseButtonStyle, volumeCardSoftStyle, volumeCardStyle, volumeModalStyle } from '../cardStyles';
import ModalSelect from '../components/ModalSelect';
import { appConfirm } from '../components/appDialog';

export default function AdminCifraDashboard() {

   // ==================== 1. ВСЕ СОСТОЯНИЯ ===========================================
  const [userId, setUserId] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);
  const [userFullName, setUserFullName] = useState<string>('');

  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const MINUTES_PER_CUBIC_METER = 1;

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
 const lastWithdrawalsLogCount = useRef<number | null>(null);
 const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
 const [mixerAssignments, setMixerAssignments] = useState<any[]>([]); // для текущего заказа
 const [allMixers, setAllMixers] = useState<any[]>([]);
 const [activeMixers, setActiveMixers] = useState<any[]>([]);
 const [currentHourPercent, setCurrentHourPercent] = useState(42);
 const [showCalendar, setShowCalendar] = useState(false);
 const [showPlanModal, setShowPlanModal] = useState(false);
 const [showOrdersModal, setShowOrdersModal] = useState(false);
 const [showDelaysModal, setShowDelaysModal] = useState(false);
 // Быстрое создание заявки на конкретную дату (ПКМ / долгое нажатие на день в календаре)
 const [showQuickNewOrder, setShowQuickNewOrder] = useState(false);
 const [quickNewOrderDate, setQuickNewOrderDate] = useState<string | undefined>(undefined);
 const [timelineMode, setTimelineMode] = useState<'horizontal' | 'vertical'>('horizontal');
 const [history, setHistory] = useState<any[]>([]);
 const [currentUser, setCurrentUser] = useState<{ id: number; name?: string; role: string } | null>(null);
 // road_time_min: Map orderId → минут в пути (кэш, заполняется фоново)
 const [roadTimes, setRoadTimes] = useState<Record<string, number>>({});

 // ==================== СВОЙ ИНДИКАТОР СКРОЛЛА ТАЙМЛАЙНА (серый, полупрозрачный) ====================
 // Нативный скролл на macOS/Chrome — "overlay" и гаснет через секунду после остановки,
 // из-за чего сотрудники могут не заметить, что заявки не влезли. Рисуем свою полосу,
 // которая видна постоянно, пока список не влезает целиком.
 const timelineScrollRef = useRef<HTMLDivElement>(null);
 const [timelineThumb, setTimelineThumb] = useState<{ top: number; height: number } | null>(null);

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
    'new': 'Новая',
    'processing': 'В работе',
    'completed': 'Выполнена',
    'cancelled': 'Отменена',
    'loading': 'Загрузка',
    'on_way': 'В пути',
    'ready': 'Готов',
    '': '—'
  };
  return map[status?.toLowerCase()] || status || '—';
};

    // ==================== 4. (убрано) Дублировало блок 22 — начальная загрузка mixerAssignments уже там ====================

    // ==================== 5. (убрано) Масштаб уже применяется в layout.tsx ====================

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
    // Не broadcast: обычный GET /api/adminCifra/withdrawals при загрузке дашборда
    // и по событию refreshNotifications. Лог — только при реальном изменении счёта.
    if (
      lastWithdrawalsLogCount.current !== pending.length &&
      (pending.length > 0 || (lastWithdrawalsLogCount.current ?? 0) > 0)
    ) {
      console.log(`🔔 Активных запросов на вывод: ${pending.length}`);
    }
    lastWithdrawalsLogCount.current = pending.length;
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

  // ==================== 7. ЗАГРУЗКА ЗАКАЗОВ ЗА МЕСЯЦ ====================
  // Загружаем только текущий месяц вместо всей истории — на Vercel это
  // в 10–50x быстрее из-за cold start serverless + latency до Supabase.
  const fetchOrdersForMonth = useCallback(async (year: number, month: number) => {
    try {
      const res = await fetch(`/api/adminCifra/orders?year=${year}&month=${month}`);
      if (!res.ok) return;
      const data: any[] = await res.json();
      setAllOrders(prev => {
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        const others = prev.filter((o: any) => !String(o.delivery_date || '').startsWith(prefix));
        return [...others, ...data].sort((a: any, b: any) =>
          String(a.delivery_date || '').localeCompare(String(b.delivery_date || ''))
        );
      });
      // Подгружаем миксеры только для этих заказов (П2)
      const ids = data.map((o: any) => o.id).join(',');
      if (ids) {
        const mr = await fetch(`/api/adminCifra/order-mixers?orderIds=${ids}`);
        if (mr.ok) {
          const mixers: any[] = await mr.json();
          setMixerAssignments(prev => {
            const orderIdSet = new Set(data.map((o: any) => String(o.id)));
            const others2 = prev.filter((m: any) => !orderIdSet.has(String(m.orderId)));
            return [...others2, ...mixers];
          });
        }
      }
    } catch (err) {
      console.error('Ошибка загрузки заказов за месяц:', err);
    }
  }, []);

  useEffect(() => {
    const now = new Date();
    setLoadingOrders(true);
    fetchOrdersForMonth(now.getFullYear(), now.getMonth() + 1).finally(() =>
      setLoadingOrders(false)
    );
  }, [fetchOrdersForMonth]);

  // Колбэк для Calendar — загружает данные когда пользователь листает на другой месяц
  const handleCalendarMonthChange = useCallback((year: number, month: number) => {
    fetchOrdersForMonth(year, month);
  }, [fetchOrdersForMonth]);

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

  // ==================== REALTIME: ЗАЯВКИ ====================
  const { status: ordersRealtimeStatus } = useRealtimeOrders(setAllOrders);

  // ==================== REALTIME: АКТИВНЫЕ МИКСЕРЫ ====================
  const { status: mixersRealtimeStatus } = useRealtimeOrderMixers(setActiveMixers, {
    activeOnly: true,
    orders: allOrders,
  });

  // ==================== REALTIME: ВСЕ НАЗНАЧЕНИЯ МИКСЕРОВ ====================
  useRealtimeOrderMixers(setMixerAssignments, { orders: allOrders });

  // Обогащаем миксеры данными заказа при обновлении allOrders
  useEffect(() => {
    if (!allOrders.length) return;
    setActiveMixers((prev) => prev.map((m) => formatOrderMixer(m, allOrders)));
    setMixerAssignments((prev) => prev.map((m) => formatOrderMixer(m, allOrders)));
  }, [allOrders]);

  const today = new Date().toISOString().split('T')[0];

  // ==================== 9. ФИНАЛЬНЫЙ РАСЧЁТ ЗАКАЗОВ (учёт timezone) =========
const selectedYear = selectedDate.getFullYear();
const selectedMonth = String(selectedDate.getMonth() + 1).padStart(2, '0');
const selectedDay = String(selectedDate.getDate()).padStart(2, '0');
const selectedDateStr = `${selectedYear}-${selectedMonth}-${selectedDay}`;

  // ==================== 7b. ФОНОВЫЙ РАСЧЁТ ВРЕМЕНИ В ПУТИ ДЛЯ СЕГОДНЯШНИХ ЗАКАЗОВ ====================
  // П3: используем selectedDateStr как триггер (не allOrders!) — иначе каждый
  // realtime-апдейт заявки перезапускал storm из N последовательных POST-запросов.
  // AbortController отменяет незавершённые запросы при смене даты или unmount.
  const allOrdersRef = useRef<any[]>([]);
  useEffect(() => { allOrdersRef.current = allOrders; }, [allOrders]);

  useEffect(() => {
    const controller = new AbortController();

    const calcMissing = async () => {
      const orders = allOrdersRef.current;
      if (!orders.length) return;
      const activeOrders = orders.filter(
        (o: any) => o.delivery_date === selectedDateStr && (o.status === 'new' || o.status === 'processing')
      );
      for (const order of activeOrders) {
        if (controller.signal.aborted) break;
        const orderId = String(order.id);
        if (roadTimes[orderId] !== undefined) continue;
        if ((order as any).road_time_min !== null && (order as any).road_time_min !== undefined) {
          setRoadTimes(prev => ({ ...prev, [orderId]: (order as any).road_time_min }));
          continue;
        }
        try {
          const res = await fetch('/api/adminCifra/travel-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id, address: (order as any).address || '' }),
            signal: controller.signal,
          });
          if (res.ok) {
            const { road_time_min } = await res.json();
            if (typeof road_time_min === 'number') {
              setRoadTimes(prev => ({ ...prev, [orderId]: road_time_min }));
            }
          }
        } catch (e: any) {
          if (e?.name === 'AbortError') break;
        }
      }
    };

    const timer = setTimeout(calcMissing, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDateStr]);

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

// ==================== РАСЧЁТ ПОЛОЖЕНИЯ СВОЕГО ИНДИКАТОРА СКРОЛЛА ====================
useEffect(() => {
  const el = timelineScrollRef.current;
  if (!el) return;

  const MIN_THUMB_HEIGHT = 32;

  const updateThumb = () => {
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) {
      setTimelineThumb(null);
      return;
    }
    const rawHeight = (clientHeight / scrollHeight) * clientHeight;
    const height = Math.max(rawHeight, MIN_THUMB_HEIGHT);
    const maxTop = clientHeight - height;
    const top = Math.min(maxTop, (scrollTop / (scrollHeight - clientHeight)) * maxTop);
    setTimelineThumb({ top, height });
  };

  updateThumb();
  el.addEventListener('scroll', updateThumb);
  window.addEventListener('resize', updateThumb);

  // Пересчитываем ещё раз на следующий тик — высота контента могла измениться
  // после рендера (новые строки заявок), а ResizeObserver надёжнее ловит это сразу.
  const ro = new ResizeObserver(updateThumb);
  ro.observe(el);

  return () => {
    el.removeEventListener('scroll', updateThumb);
    window.removeEventListener('resize', updateThumb);
    ro.disconnect();
  };
}, [todayOrders.length, selectedDateStr]);

// ==================== 10. РАСЧЁТ ЗАДЕРЖЕК ОТГРУЗОК (реал-тайм) ====================
const now = new Date();
const currentMinutes = now.getHours() * 60 + now.getMinutes();

// Статусы миксеров, при которых бетон уже в движении — заявка исполняется
const ACTIVE_MIXER_STATUSES = ['В пути', 'На объекте', 'Разгружен', 'Возврат'];

// Задержка — понятие "отстаём от текущего момента". Если открыт не сегодняшний
// день (вчера/завтра), currentMinutes всё равно берётся из реального "сейчас" —
// без этой проверки, например, переключившись на завтра, все заявки с утренним
// временем доставки ошибочно считались "задержанными на 1000+ минут".
const delayedOrders = selectedDateStr !== today ? [] : todayOrders
  // Выполненные и отменённые заказы не считаются задержанными
  .filter((order: Order) => order.status === 'new' || order.status === 'processing')
  .filter((order: Order) => {
    const orderMixers = activeMixers.filter(
      (m: any) => String(m.orderId) === String(order.id)
    );
    // Если хотя бы один миксер уже в пути/на объекте/разгружается/возвращается — не задержка
    const hasMovingMixer = orderMixers.some((m: any) => ACTIVE_MIXER_STATUSES.includes(m.status));
    if (hasMovingMixer) return false;

    // Если весь объём уже назначен на миксеры (даже в статусе Загрузка) — процесс идёт
    const assignedVol = orderMixers.reduce((sum: number, m: any) => sum + Number(m.volume || 0), 0);
    const orderVol = Number(order.volume || 0);
    if (orderVol > 0 && assignedVol >= orderVol) return false;

    return true;
  })
  .map((order: Order) => {
    const orderMixers = activeMixers.filter(
      (m: any) => String(m.orderId) === String(order.id)
    );
    const [h, m] = (order.delivery_time || '00:00').split(':').map(Number);
    const plannedStart = h * 60 + m;
    const volume = Number(order.volume || 0);
    // Время загрузки: ~2 мин/м³ (≈20 мин на миксер 10 м³)
    const loadingTime = volume * 2;
    // Время в пути: из кэша road_time_min, иначе fallback 30 мин
    const travelTime = roadTimes[String(order.id)] ?? (order as any).road_time_min ?? 30;
    const travelTimeIsEstimate = !(String(order.id) in roadTimes) && !(order as any).road_time_min;

    // Ожидаемое время начала загрузки = delivery_time − путь − загрузка
    // Чтобы доставить в 09:00 при 30 мин пути и 20 мин загрузки — грузить с 08:10.
    const expectedLoadStart = plannedStart - travelTime - loadingTime;
    const delayMinutes = Math.round(Math.max(0, currentMinutes - expectedLoadStart));
    const assignedVol = orderMixers.reduce((sum: number, m: any) => sum + Number(m.volume || 0), 0);
    const loadingMixers = orderMixers.filter((mx: any) => mx.status === 'Загрузка').length;

    const reasons: string[] = [];
    if (orderMixers.length === 0) {
      reasons.push('Миксеры на заявку ещё не назначены');
    } else if (assignedVol < volume) {
      reasons.push(`Назначено только ${assignedVol % 1 === 0 ? assignedVol : assignedVol.toFixed(1)} из ${volume % 1 === 0 ? volume : volume.toFixed(1)} м³`);
    }
    if (loadingMixers > 0 && assignedVol < volume) {
      reasons.push(`${loadingMixers} миксер(а) в статусе «Загрузка», но объём ещё не закрыт`);
    }
    if (orderMixers.length > 0 && !orderMixers.some((mx: any) => ACTIVE_MIXER_STATUSES.includes(mx.status))) {
      reasons.push('Нет миксеров в движении (в пути / на объекте)');
    }
    if (reasons.length === 0) {
      reasons.push('Отстаём от расчётного времени начала загрузки');
    }

    return {
      ...order,
      delayMinutes,
      travelTime,
      travelTimeIsEstimate,
      loadingTime,
      expectedLoadStart,
      plannedStart,
      assignedVol,
      mixerCount: orderMixers.length,
      reasons,
      delayText: delayMinutes > 0 ? `+${delayMinutes} мин` : '',
    };
  })
  .filter(order => order.delayMinutes > 15)
  .sort((a, b) => b.delayMinutes - a.delayMinutes);

const fmtClockMins = (mins: number) => {
  const normalized = ((Math.round(mins) % 1440) + 1440) % 1440;
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
const fmtDelayMins = (mins: number) =>
  mins >= 60
    ? `${Math.floor(mins / 60)}ч ${mins % 60}м`
    : `${mins} мин`;

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
const newOrders = todayOrders.filter(o => o.status === 'new').length;
const inWorkOrders = todayOrders.filter(o => o.status === 'processing').length;
const cancelledOrders = todayOrders.filter(o => o.status === 'cancelled').length;
const activeOrdersCount = newOrders + inWorkOrders;

const totalToday = todayOrders.length;
const completedOrders = todayOrders.filter(o => o.status === 'completed').length;

// План дня — без отменённых
const planToday = todayOrders
  .filter(o => o.status !== 'cancelled')
  .reduce((sum, o) => sum + Number(o.volume || 0), 0);

const todayOrderIds = useMemo(
  () => new Set(todayOrders.map(o => String(o.id))),
  [todayOrders]
);

// Выполнение плана = разгруженные м³ / план (не только закрытые заявки —
// иначе днём карточка почти всегда 0%, пока заявки не переведут в «Выполнена»).
const unloadedVolume = useMemo(
  () => mixerAssignments
    .filter((m: any) =>
      todayOrderIds.has(String(m.orderId ?? m.order_id)) && m.status === 'Разгружен'
    )
    .reduce((sum: number, m: any) => sum + Number(m.volume || 0), 0),
  [mixerAssignments, todayOrderIds]
);

// Суммы по статусам рейсов всех заявок дня (из полных назначений, не только «живых»)
const dayMixerTrips = useMemo(
  () => mixerAssignments.filter((m: any) =>
    todayOrderIds.has(String(m.orderId ?? m.order_id))
  ),
  [mixerAssignments, todayOrderIds]
);

const volumeByStatus = useMemo(() => {
  const FLOW = [
    { status: 'Загрузка', label: 'загрузка', color: '#FACC15', showCount: false },
    { status: 'В пути', label: 'в пути', color: '#60A5FA', showCount: false },
    { status: 'На объекте', label: 'на объекте', color: '#34D399', showCount: false },
    { status: 'Разгружен', label: 'разгружено', color: '#10B981', showCount: true },
  ] as const;
  const vols: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const m of dayMixerTrips) {
    const s = String(m.status || '');
    vols[s] = (vols[s] || 0) + Number(m.volume || 0);
    counts[s] = (counts[s] || 0) + 1;
  }
  return FLOW
    .map((cfg) => ({
      ...cfg,
      volume: vols[cfg.status] || 0,
      count: counts[cfg.status] || 0,
    }))
    .filter((x) => x.volume > 0 || x.count > 0);
}, [dayMixerTrips]);

const factVolume = unloadedVolume;
const completionPercent = planToday > 0
  ? Math.min(100, Math.round((factVolume / planToday) * 100))
  : 0;
const remainingVolume = Math.max(0, planToday - factVolume);
const coveredVolume = useMemo(
  () => dayMixerTrips.reduce((s: number, m: any) => s + Number(m.volume || 0), 0),
  [dayMixerTrips]
);
const completedOrdersVolume = useMemo(
  () => todayOrders
    .filter((o) => o.status === 'completed')
    .reduce((s, o) => s + Number(o.volume || 0), 0),
  [todayOrders]
);
const planOrdersCount = todayOrders.filter((o) => o.status !== 'cancelled').length;

// Детализация по заявкам дня — для модалки выполнения плана
const planOrdersDetail = useMemo(() => {
  return todayOrders
    .filter((o) => o.status !== 'cancelled')
    .map((o) => {
      const trips = dayMixerTrips.filter(
        (m: any) => String(m.orderId ?? m.order_id) === String(o.id)
      );
      const planVol = Number(o.volume || 0);
      const byStatus = {
        loading: 0,
        inTransit: 0,
        onSite: 0,
        unloaded: 0,
      };
      let unloadedCount = 0;
      for (const m of trips) {
        const v = Number(m.volume || 0);
        if (m.status === 'Загрузка') byStatus.loading += v;
        else if (m.status === 'В пути') byStatus.inTransit += v;
        else if (m.status === 'На объекте') byStatus.onSite += v;
        else if (m.status === 'Разгружен') {
          byStatus.unloaded += v;
          unloadedCount += 1;
        }
      }
      const pct = planVol > 0
        ? Math.min(100, Math.round((byStatus.unloaded / planVol) * 100))
        : 0;
      return {
        id: o.id,
        client: (o as any).organization_name || (o as any).full_name || '—',
        time: o.delivery_time || '—',
        status: o.status,
        planVol,
        unloadedCount,
        ...byStatus,
        pct,
      };
    })
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}, [todayOrders, dayMixerTrips]);

const fmtM3 = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1));
const completionColor =
  completionPercent >= 90 ? '#10B981' :
  completionPercent >= 50 ? '#FACC15' : '#94A3B8';
const completionBarBg =
  completionPercent >= 90
    ? 'linear-gradient(90deg, #10B981, #34D399)'
    : completionPercent >= 50
      ? 'linear-gradient(90deg, #F59E0B, #FACC15)'
      : 'linear-gradient(90deg, #3B82F6, #60A5FA)';

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
        // Реальное имя сотрудника (из профиля, см. 14.1), а не заглушка по роли —
        // иначе в истории изменений заявки все действия подписывались "Администратор".
        name: userFullName || undefined,
        role: userRole
      });
    }
  }, [userId, userRole, userFullName]);

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

      // ==================== 17. СМЕНА СТАТУСА МИКСЕРА ====================
  const handleStatusChange = async (mixerId: number | string, newStatus: string) => {
    console.log(`🔄 Меняем статус миксера ${mixerId} → ${newStatus}`);

    // Статус, который мы видели в списке до отправки запроса — если в БД он
    // уже другой (например, оператор в этот момент нажал "Начать"/"Загружен"),
    // сервер отобьёт явным конфликтом вместо тихой перезаписи чужого действия.
    const oldStatus = activeMixers.find(m => String(m.id) === String(mixerId))?.status;

    try {
      const res = await fetch('/api/adminCifra/order-mixers/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mixerId,
          status: newStatus,
          userName: userFullName || 'Диспетчер',
          userRole: userRole || 'admin',
          expectedStatus: oldStatus,
        })
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
  // Позиция линии/точки текущего времени на шкале 00:00–24:00. Раньше здесь
  // стоял искусственный порог (min 3%, max 97%) — видимо, чтобы плашка с
  // временем не обрезалась у самого края контейнера. Но этот порог сдвигал
  // саму ЛИНИЮ: 3% от суток = 43 минуты, поэтому в 00:12 линия рисовалась
  // так, будто время 00:43 (визуально почти у засечки 01:00 — ровно то, что
  // и было на скриншоте). Теперь здесь только точный процент от суток без
  // искажений; защиту от обрезания плашки с текстом времени переносим в её
  // собственный стиль через CSS clamp() (см. рендер ниже) — линия и точка
  // на шкале при этом остаются математически точными.
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      setCurrentHourPercent(Math.min(Math.max((minutes / 1440) * 100, 0), 100));
    };
    updateTime();
    // Обновление раз в минуту — это НЕ сетевой полинг, а чисто локальный
    // таймер: пересчитываем позицию из часов браузера, без единого запроса
    // к серверу. Раз в минуту достаточно, т.к. точность шкалы — минута.
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

    // ==================== 22. ЗАГРУЗКА НАЗНАЧЕННЫХ МИКСЕРОВ ====================
  // Начальная загрузка встроена в fetchOrdersForMonth (П1+П2 оптимизация).
  // Этот блок удалён — больше не делаем полный дамп order_mixers.

    // ==================== 24. ЗАГРУЗКА МИКСЕРОВ ДЛЯ ОТКРЫТОЙ МОДАЛКИ ==========================
    // ⚠️ mixerAssignments — ОБЩИЙ список назначений всех заказов (нужен для меток
    // логистики в таймлайне). Модалка фильтрует его по order.id, поэтому здесь
    // НЕЛЬЗЯ затирать список миксерами одного заказа и НЕЛЬЗЯ очищать при закрытии —
    // иначе после любого открытия/закрытия заявки все метки логистики гаснут (серые).
    // Вместо этого подмешиваем свежие данные выбранного заказа, не трогая остальные.
        useEffect(() => {
    if (!selectedOrder?.id) return;   // при закрытии модалки общий список не трогаем

    const loadOrderMixers = async () => {
      try {
        const res = await fetch(`/api/adminCifra/order-mixers?orderId=${selectedOrder.id}`);
        if (res.ok) {
          const data = await res.json();
          setMixerAssignments((prev) => {
            const others = prev.filter((m) => String(m.orderId) !== String(selectedOrder.id));
            return [...others, ...data];
          });
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

  // ==================== 26. (убрано) 'mixerAdded' больше не нужен — INSERT в order_mixers ====================
  // теперь прилетает через useRealtimeOrderMixers(setMixerAssignments, ...) выше автоматически

  // ==================== 26.1 СИНХРОНИЗАЦИЯ ОТКРЫТОЙ МОДАЛКИ С REALTIME-ОБНОВЛЕНИЯМИ ====================
  // Статус заявки теперь меняется на сервере (авто-правила), поэтому открытая
  // модалка должна подхватывать свежий статус из allOrders (обновляется через realtime).
  useEffect(() => {
    if (!selectedOrder?.id) return;
    const fresh = allOrders.find(o => String(o.id) === String(selectedOrder.id));
    if (fresh && (fresh.status !== selectedOrder.status || (fresh as any).logistics_ready !== (selectedOrder as any).logistics_ready)) {
      setSelectedOrder(prev => prev ? { ...prev, ...fresh } : prev);
    }
    // Заявку удалили (например, тестовую #604) пока её модалка была открыта —
    // realtime DELETE уже убрал её из allOrders, но сама модалка хранит
    // отдельный стейт selectedOrder и без этой проверки продолжала бы
    // показывать замороженные старые данные до перезагрузки страницы.
    if (!fresh && allOrders.length > 0) {
      setSelectedOrder(null);
    }
  }, [allOrders, selectedOrder?.id]);

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

  // ==================== 31. ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ ДЛЯ МОДАЛКИ =================================
  const modalCurrentUser = currentUser || {
    id: userId || 0,
    name: getRoleDisplayName(userRole) || 'Сотрудник',
    role: userRole || 'admin'
  };


  return (
      <div style={{ 
        background: '#0F172A', 
        color: '#fff',
        flex: 1,
        minHeight: 0,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxSizing: 'border-box'
      }}>

        {/* ==================== 32. ОСНОВНОЙ GRID ==================== */}
        <div style={{ 
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 480px)', 
          gridTemplateRows: 'minmax(0, 1fr)',
          gap: '32px',
          maxWidth: '100%', 
          width: '100%', 
          flex: 1,
          margin: '0 auto',
          alignItems: 'stretch',
          minHeight: 0
        }}>

      {/* ==================== 33. ЛЕВАЯ КОЛОНКА ( KPI) ==================== */}
      <div style={{ 
          minWidth: 0,
          minHeight: 0,
          display: 'flex', 
          flexDirection: 'column', 
          gap: '16px',
          height: '100%'
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
      fontSize: '26px',
      fontWeight: 700, 
      color: '#fff',
      margin: 0,
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }}>
      <Home size={26} color="#94A3B8" />
      Дашборд
    </h1>
    
    <div 
      onClick={() => setShowCalendar(true)}
      style={volumeCardSoftStyle({ 
        padding: '10px 20px', 
        borderRadius: 9999, 
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '14.5px',
        whiteSpace: 'nowrap',
      })}
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pb-2">
          
       {/* ==================== 35. ЗАЯВКИ СЕГОДНЯ ==================== */}
<div
  onClick={() => setShowOrdersModal(true)}
  style={volumeCardStyle({
    borderRadius: 18,
    padding: '16px 20px',
    flex: 1,
    cursor: 'pointer',
    transition: 'filter 0.2s',
  })}
  onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
  onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
>
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
    <div style={{ color: '#94A3B8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      Заявки сегодня
    </div>
    <span style={{ color: '#475569', fontSize: '12px' }}>подробнее →</span>
  </div>

  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
    <div style={{ fontSize: '52px', fontWeight: '700', color: '#60A5FA', lineHeight: 1 }}>
      {totalToday}
    </div>
    <div style={{ color: '#64748B', fontSize: '13px' }}>
      {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
    </div>
  </div>

  <div style={{ height: '1px', background: '#334155', margin: '10px 0' }} />

  {/* Два блока: активные | закрытые */}
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
    <div style={volumeCardSoftStyle({
      borderRadius: 12,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    })}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ color: '#94A3B8', fontSize: '12px' }}>🟡 Новые</span>
        <strong style={{ color: '#FACC15', fontSize: '24px', fontWeight: 700, lineHeight: 1 }}>{newOrders}</strong>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ color: '#94A3B8', fontSize: '12px' }}>→ В работе</span>
        <strong style={{ color: '#60A5FA', fontSize: '24px', fontWeight: 700, lineHeight: 1 }}>{inWorkOrders}</strong>
      </div>
    </div>
    <div style={volumeCardSoftStyle({
      borderRadius: 12,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    })}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ color: '#94A3B8', fontSize: '12px' }}>✓ Выполнены</span>
        <strong style={{ color: '#10B981', fontSize: '24px', fontWeight: 700, lineHeight: 1 }}>{completedOrders}</strong>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ color: '#94A3B8', fontSize: '12px' }}>✕ Отменены</span>
        <strong style={{ color: '#EF4444', fontSize: '24px', fontWeight: 700, lineHeight: 1 }}>{cancelledOrders}</strong>
      </div>
    </div>
  </div>
</div>

  {/* ==================== 36. ВЫПОЛНЕНИЕ ПЛАНА ==================== */}
<div
  onClick={() => setShowPlanModal(true)}
  style={volumeCardStyle({ 
  borderRadius: 18, 
  padding: '16px 20px', 
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  cursor: 'pointer',
  transition: 'filter 0.2s',
})}
  onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
  onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
>
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
    <div style={{ color: '#94A3B8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      Выполнение плана
    </div>
    <span style={{ color: '#475569', fontSize: '12px' }}>подробнее →</span>
  </div>

  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0 }}>
      <span style={{ fontSize: '40px', fontWeight: '700', lineHeight: 1, color: completionColor }}>
        {fmtM3(factVolume)}
      </span>
      <span style={{ fontSize: '18px', color: '#64748B', whiteSpace: 'nowrap' }}>
        / {fmtM3(planToday)} м³
      </span>
    </div>
    <span style={{ fontSize: '28px', fontWeight: '700', lineHeight: 1, color: completionColor, flexShrink: 0 }}>
      {completionPercent}%
    </span>
  </div>

  <div style={{ height: '8px', borderRadius: '9999px', background: '#334155', overflow: 'hidden', marginBottom: '10px' }}>
    <div style={{
      height: '100%',
      width: `${completionPercent}%`,
      borderRadius: '9999px',
      background: completionBarBg,
      transition: 'width 0.4s ease',
    }} />
  </div>

  {volumeByStatus.length > 0 ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {volumeByStatus.map((item) => (
        <span
          key={item.status}
          style={{
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: '4px',
            padding: '3px 9px',
            borderRadius: '9999px',
            background: `${item.color}18`,
            border: `1px solid ${item.color}40`,
            color: item.color,
            fontSize: '12px',
            fontWeight: 600,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
          }}
        >
          {item.showCount ? (
            <>
              <span style={{ fontWeight: 700 }}>{item.count}</span>
              <span style={{ opacity: 0.75 }}>·</span>
              <span style={{ fontWeight: 700 }}>{fmtM3(item.volume)} м³</span>
            </>
          ) : (
            <span style={{ fontWeight: 700 }}>{fmtM3(item.volume)} м³</span>
          )}
          <span style={{ opacity: 0.9, fontWeight: 500 }}>{item.label}</span>
        </span>
      ))}
    </div>
  ) : (
    <div style={{ color: '#64748B', fontSize: '13px' }}>нет рейсов за день</div>
  )}
  {completedOrders > 0 && (
    <div style={{ color: '#64748B', fontSize: '12px', marginTop: '8px' }}>
      {completedOrders} заявки закрыты
    </div>
  )}
</div>

   {/* ==================== 37. ЗАДЕРЖКИ ОТГРУЗОК ==================== */}
{/* Логика: заявки new/processing, у которых НЕТ миксеров в движении (В пути/На объекте/
    Разгружен/Возврат) и НЕ покрыт весь объём назначенными миксерами, при этом
    прошло > 15 мин от расчётного старта загрузки. */}
<div
  onClick={() => setShowDelaysModal(true)}
  style={volumeCardStyle({ 
  borderRadius: 18, 
  padding: '16px 20px', 
  display: 'flex',
  flexDirection: 'column',
  cursor: 'pointer',
  transition: 'filter 0.2s',
})}
  onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
  onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
>
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
    <div style={{ color: '#94A3B8', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      Задержки отгрузок
    </div>
    <span style={{ color: '#475569', fontSize: '12px' }}>подробнее →</span>
  </div>

  {delayedOrders.length > 0 ? (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' }}>
        <span style={{ fontSize: '52px', fontWeight: '700', color: '#EF4444', lineHeight: 1 }}>
          {delayedOrders.length}
        </span>
        <span style={{ color: '#F87171', fontSize: '13px' }}>
          {delayedOrders.length === 1 ? 'заявка' : delayedOrders.length <= 4 ? 'заявки' : 'заявок'}
        </span>
      </div>

      <div style={{ height: '1px', background: '#334155', margin: '10px 0' }} />

      {/* Список задержанных — компактный */}
      <div className="scroll-hidden" style={{ overflowY: 'auto', maxHeight: '80px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {delayedOrders.slice(0, 5).map((order, index) => (
          <div key={index} style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            fontSize: '12.5px',
          }}>
            <span style={{ color: '#CBD5E1', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              #{order.id} · {order.delivery_time}
              {(order as any).travelTime ? (
                <span style={{ color: '#475569', marginLeft: '4px', fontWeight: '400' }}>
                  ~{(order as any).travelTime}м пути
                </span>
              ) : null}
            </span>
            <span style={{ 
              color: order.delayMinutes > 60 ? '#F87171' : '#FCA5A5', 
              fontWeight: '600',
              flexShrink: 0,
              marginLeft: '6px',
            }}>
              +{fmtDelayMins(order.delayMinutes)}
            </span>
          </div>
        ))}
        {delayedOrders.length > 5 && (
          <div style={{ color: '#64748B', fontSize: '11px', textAlign: 'right' }}>
            ещё {delayedOrders.length - 5}...
          </div>
        )}
      </div>
    </>
  ) : (
    <div style={{ 
      paddingTop: '8px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      color: '#10B981',
    }}>
      <span style={{ fontSize: '28px' }}>✓</span>
      <span style={{ fontSize: '14px', fontWeight: '500' }}>Все по графику</span>
    </div>
  )}
</div>

   {/* 4. Миксеры в работе — за выбранный день */}
<div 
  onClick={() => window.location.href = '/adminCifra/mixers'}
  style={volumeCardStyle({ 
    borderRadius: 18, 
    padding: '16px 20px', 
    cursor: 'pointer',
    transition: 'filter 0.2s',
  })}
  onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
  onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
>
  <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Миксеры в работе</div>
  
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' }}>
    <span style={{ fontSize: '52px', fontWeight: '700', color: '#60A5FA', lineHeight: 1 }}>
      {activeMixersToday.length}
    </span>
    <span style={{ fontSize: '13px', color: '#64748B' }}>
      {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
    </span>
  </div>

  <div style={{ height: '1px', background: '#334155', margin: '10px 0' }} />

  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '13px' }}>
    {([
      { status: 'Загрузка', label: '🟡 Загрузка', color: '#FACC15', showCount: false },
      { status: 'В пути', label: '→ В пути', color: '#60A5FA', showCount: false },
      { status: 'На объекте', label: '📍 На объекте', color: '#34D399', showCount: false },
      { status: 'Разгружен', label: '✓ Разгружено', color: '#10B981', showCount: true },
    ] as const).map((row) => {
      const trips = dayMixerTrips.filter((m: any) => m.status === row.status);
      const vol = trips.reduce((s: number, m: any) => s + Number(m.volume || 0), 0);
      const cnt = trips.length;
      if (vol <= 0 && cnt <= 0) return null;
      return (
        <div key={row.status} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <span style={{ color: '#94A3B8' }}>{row.label}</span>
          <strong style={{ color: row.color, whiteSpace: 'nowrap' }}>
            {row.showCount
              ? `${cnt} · ${fmtM3(vol)} м³`
              : `${fmtM3(vol)} м³`}
          </strong>
        </div>
      );
    })}
  </div>
</div>      </div>
      {/* ==================== 38. ТАЙМЛАЙН (УЛУЧШЕННЫЙ — В СТИЛЕ ЦИФРА.AI) ==================== */}
       <div style={volumeCardStyle({ 
            flex: 1, 
            minWidth: 0,
            minHeight: 0,
            borderRadius: 22, 
            padding: '24px 28px', 
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
          })}>
  
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
          padding: '6px 16px',
          background: 'transparent',
          color: '#94A3B8',
          border: 'none',
          borderRadius: '9999px',
          fontSize: '14px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'color 0.2s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
        onMouseLeave={e => (e.currentTarget.style.color = '#94A3B8')}
      >
        ← Пред. день
      </button>

      <button 
        onClick={() => setSelectedDate(new Date())}
        style={{
          padding: '6px 16px',
          background: 'transparent',
          color: '#4ADE80',
          border: 'none',
          borderRadius: '9999px',
          fontSize: '14px',
          fontWeight: '600',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'color 0.2s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#86EFAC')}
        onMouseLeave={e => (e.currentTarget.style.color = '#4ADE80')}
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
          padding: '6px 16px',
          background: 'transparent',
          color: '#94A3B8',
          border: 'none',
          borderRadius: '9999px',
          fontSize: '14px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'color 0.2s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
        onMouseLeave={e => (e.currentTarget.style.color = '#94A3B8')}
      >
        След. день →
      </button>

      {/* Переключатель режима таймлайна */}
      <div style={{
        display: 'flex',
        background: '#1A2740',
        borderRadius: '10px',
        padding: '3px',
        gap: '2px',
      }}>
        <button
          onClick={() => setTimelineMode('horizontal')}
          title="Горизонтальный таймлайн"
          style={{
            width: '32px', height: '32px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: timelineMode === 'horizontal' ? '#2D4060' : 'transparent',
            border: 'none',
            borderRadius: '7px',
            color: timelineMode === 'horizontal' ? '#93C5FD' : '#4A6080',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          <AlignJustify size={15} />
        </button>
        <button
          onClick={() => setTimelineMode('vertical')}
          title="Вертикальный таймлайн"
          style={{
            width: '32px', height: '32px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: timelineMode === 'vertical' ? '#2D4060' : 'transparent',
            border: 'none',
            borderRadius: '7px',
            color: timelineMode === 'vertical' ? '#93C5FD' : '#4A6080',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          <LayoutList size={15} />
        </button>
      </div>
    </div>
  </div>

  {/* ==================== 39. ТОЧНАЯ ШКАЛА ВРЕМЕНИ (только горизонтальный режим) ====================
      paddingRight: 20px совпадает с контейнером заказов.
      left: (i/24)*100% = точное совпадение с leftPercent плашек. */}
{timelineMode === 'horizontal' && <div style={{ marginBottom: '10px', paddingRight: '20px', userSelect: 'none' }}>
  <div style={{ display: 'contents' }}>
    <div style={{ position: 'relative', height: '42px' }}>

      {/* Базовая линия шкалы */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '2px',
        background: '#2D3F55',
        borderRadius: '1px',
      }} />

      {/* Зелёная точка — текущее время */}
      <div style={{
        position: 'absolute',
        bottom: '-3px',
        left: `${currentHourPercent}%`,
        width: '8px',
        height: '8px',
        background: '#4ADE80',
        borderRadius: '50%',
        transform: 'translateX(-50%)',
        boxShadow: '0 0 8px rgba(74,222,128,0.9)',
        zIndex: 5,
      }} />

      {/* Деления и подписи 0..24 */}
      {Array.from({ length: 25 }, (_, i) => {
        const isMajor = i % 6 === 0;                      // 0 6 12 18 24
        const isMedium = i % 3 === 0 && !isMajor;         // 3 9 15 21
        const isMinor = !isMajor && !isMedium;             // каждый час
        const pct = `${(i / 24) * 100}%`;
        return (
          <div key={i} style={{ position: 'absolute', left: pct, bottom: 0, transform: 'translateX(-50%)' }}>
            {/* Засечка */}
            <div style={{
              position: 'absolute',
              bottom: '2px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: isMajor ? '2px' : '1px',
              height: isMajor ? '16px' : isMedium ? '10px' : '5px',
              background: isMajor ? '#64748B' : isMedium ? '#4A6080' : '#3D5268',
            }} />
            {/* Подпись */}
            {isMajor && (
              <div style={{
                position: 'absolute',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: '12px',
                fontWeight: '700',
                color: '#94A3B8',
                whiteSpace: 'nowrap',
                lineHeight: 1,
              }}>
                {String(i).padStart(2, '0')}:00
              </div>
            )}
            {isMedium && (
              <div style={{
                position: 'absolute',
                bottom: '13px',
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: '10.5px',
                fontWeight: '600',
                color: '#56708A',
                whiteSpace: 'nowrap',
                lineHeight: 1,
              }}>
                {String(i).padStart(2, '0')}
              </div>
            )}
            {isMinor && i < 24 && (
              <div style={{
                position: 'absolute',
                bottom: '9px',
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: '9.5px',
                fontWeight: '500',
                color: '#3E5470',
                whiteSpace: 'nowrap',
                lineHeight: 1,
              }}>
                {String(i).padStart(2, '0')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
</div>} {/* end timelineMode === 'horizontal' ruler */}

  {/* Горизонтальный: область заказов (скролл) + фиксированная линия времени */}
  {timelineMode === 'horizontal' && <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
  <div 
    id="timeline-container"
    ref={timelineScrollRef}
    className="scroll-hidden"
    style={{ 
      height: '100%',
      position: 'relative', 
      overflowX: 'auto',
      overflowY: 'auto',
      paddingRight: '20px',
      paddingBottom: '26px', // запас для подписи текущего времени внизу
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
  // Логарифмическое сжатие длины плашки: для малых объёмов полоса не исчезает,
  // для больших не «съедает» весь таймлайн. log(1+x)/log(1+maxX) × maxWidth.
  // Минимальная ширина 5% = ~72 мин экранных = всегда читаемый статус.
  const MAX_DURATION = 240; // минут — «насыщение» шкалы при ~120 м³
  const logWidth = (Math.log(1 + Math.min(durationMinutes, MAX_DURATION)) / Math.log(1 + MAX_DURATION)) * 30;
  let widthPercent = Math.max(logWidth, 5); // минимум 5% (~72px на Full HD) чтобы влезал текст
  let isOverflow = false;
  let overflowMinutes = 0;

  if (endMinutes > 1440) {
    const linearW = ((1440 - startMinutes) / 1440) * 100;
    widthPercent = Math.max(linearW, 5);
    isOverflow = true;
    overflowMinutes = Math.round(endMinutes - 1440);
  }

  const overflowLabel = overflowMinutes >= 60
    ? `+${Math.floor(overflowMinutes / 60)}ч ${overflowMinutes % 60 > 0 ? `${overflowMinutes % 60}м` : ''} завтра`
    : `+${overflowMinutes}м завтра`;

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

// Процент отгрузки — только для "В работе" имеет смысл: у "Новой" отгрузок
// заведомо 0%, у "Выполненной" заведомо 100%, показывать нечего.
const dispatchedPercent = orderVolume > 0 ? Math.min(100, Math.round((assignedVolume / orderVolume) * 100)) : 0;
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

    sortMixersByLogisticsTime(group.mixers).forEach((mixer, i) => {
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


  {/* Плашка перекрывает текст если leftPercent мал (ранние заказы).
      Порог ~33% ≈ 08:00. Ниже — полупрозрачная плашка, текст просвечивает.
      Чем раньше заказ, тем прозрачнее: от 0.35 (00:00) до 0.88 (порог). */}
  const pillAlpha = leftPercent < 33
    ? Math.round((0.35 + (leftPercent / 33) * 0.53) * 255).toString(16).padStart(2, '0')
    : 'CC';
  const pillShadowAlpha = leftPercent < 33 ? '22' : '55';

  return (
    <div 
      key={order.id} 
      onClick={() => setSelectedOrder(order)}
      // ⚠️ Подсказка с точными кубами специально висит на всей строке, а не
      // на самом бейджике "%" внутри плашки: у "Информации" (z-index: 15)
      // z-index выше, чем у плашки статуса (z-index: 10) — это сделано
      // намеренно, чтобы текст заявки не терялся, когда плашка "наезжает"
      // на него. Из-за этого именно над бейджиком курсор физически попадает
      // в невидимую область блока "Информация", а не в сам бейджик — title
      // там просто не всплывал. На уровне всей строки такой конфликт
      // невозможен (это общий родитель обоих слоёв).
      title={order.status === 'processing'
        ? `Отгружено ${Math.round(assignedVolume * 10) / 10} из ${Math.round(orderVolume * 10) / 10} м³ (${dispatchedPercent}%)`
        : undefined}
      style={volumeCardSoftStyle({
        display: 'flex',
        alignItems: 'center',
        marginBottom: '7px',
        borderRadius: 10,
        padding: '7px 14px',
        position: 'relative',
        minHeight: '44px',
        cursor: 'pointer',
        transition: 'filter 0.15s',
      })}
      onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
      onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
    >
      {/* Метка логистики */}
      <div style={{
        width: '20px', height: '20px', minWidth: '20px',
        borderRadius: '9999px', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: '13px', marginRight: '14px', flexShrink: 0,
        background: isLogisticsReady ? '#10B98120' : (assignedVolume > 0 ? '#F59E0B20' : '#47556920'),
        color: isLogisticsReady ? '#10B981' : (assignedVolume > 0 ? '#F59E0B' : '#E2E8F0'),
        border: `2px solid ${isLogisticsReady ? '#10B981' : (assignedVolume > 0 ? '#F59E0B' : '#64748B')}`,
        zIndex: 15,
      }}>
        {isLogisticsReady || assignedVolume === 0 ? '✓' : '⚠️'}
      </div>

      {/* Время */}
      <div style={{ width: '100px', fontWeight: '600', color: '#E2E8F0', fontSize: '15px', flexShrink: 0, zIndex: 15 }}>
        {time}
      </div>

      {/* Информация (z-index выше плашки — текст всегда читаем) */}
      <div style={{ flex: 1, lineHeight: '1.25', zIndex: 15, minWidth: 0 }}>
        <div style={{ fontWeight: '600', color: '#F1F5F9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          #{order.id} — {client}
        </div>
        <div style={{ color: '#94A3B8', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>{order.grade} • {volume} м³</span>
          {isOverflow && (
            <span style={{ color: '#FACC15', fontWeight: '600' }}>{overflowLabel}</span>
          )}
        </div>
      </div>

      {/* Плашка заказа — автопрозрачность при наезде на текст */}
      <div style={{
        position: 'absolute',
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
        height: '28px',
        background: `${statusColor}${pillAlpha}`,
        borderRadius: isOverflow ? '9999px 4px 4px 9999px' : '9999px',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '12px',
        paddingRight: '6px',
        color: '#fff',
        fontWeight: '600',
        fontSize: '12px',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        boxShadow: `0 0 10px ${statusColor}${pillShadowAlpha}, 0 2px 6px rgba(0,0,0,0.25)`,
        zIndex: 10,
        minWidth: '90px',
        transition: 'background 0.3s',
        ...(isOverflow ? {
          backgroundImage: `linear-gradient(to right, ${statusColor}${pillAlpha}, ${statusColor}${pillAlpha} 70%, rgba(0,0,0,0))`,
        } : {}),
      }}>
        {statusText}
        {/* Метка «Под вопросом» — заметный бейдж на пилюле */}
        {(order as any).is_questionable && (
          <span
            title="Под вопросом"
            style={{
              marginLeft: '7px',
              flexShrink: 0,
              height: '18px',
              padding: '0 7px',
              borderRadius: '9999px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              background: '#EF4444',
              color: '#fff',
              fontSize: '10px',
              fontWeight: 800,
              letterSpacing: '0.02em',
              lineHeight: 1,
              boxShadow: '0 0 0 1px rgba(255,255,255,0.25), 0 0 8px rgba(239,68,68,0.55)',
            }}
          >
            ?
          </span>
        )}
        {/* Процент отгрузки — только для "В работе", прижат к правому краю
            плашки (marginLeft: auto). Если плашка узкая (маленький объём/
            короткая продолжительность), бейдж просто уедет за overflow:hidden
            — как и текст статуса в таких случаях, это ожидаемо. */}
        {order.status === 'processing' && (
          <span
            style={{
              marginLeft: 'auto',
              marginRight: isOverflow ? '6px' : 0,
              flexShrink: 0,
              background: 'rgba(255,255,255,0.24)',
              padding: '1px 7px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: '700',
            }}
          >
            {dispatchedPercent}%
          </span>
        )}
        {isOverflow && (
          <span style={{
            marginLeft: order.status === 'processing' || (order as any).is_questionable ? 0 : 'auto', marginRight: '6px', flexShrink: 0,
            color: '#FDE68A',
            fontSize: '11px', fontWeight: '700',
            letterSpacing: '0.02em',
          }}>→→</span>
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

  </div>

    {/* Вертикальная линия и плашка времени — фиксированы, не скроллятся */}
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: '20px',
      bottom: 0,
      pointerEvents: 'none',
      zIndex: 50,
    }}>
      {/* Линия не доходит до подписи времени — bottom: 22px оставляет место под текст */}
      <div style={{
        position: 'absolute',
        left: `${currentHourPercent}%`,
        top: 0,
        bottom: '22px',
        width: '2px',
        background: 'linear-gradient(180deg, #4ADE80, #86EFAC)',
        boxShadow: '0 0 10px rgba(74,222,128,0.7)',
        transform: 'translateX(-50%)',
      }} />
      {/* Просто время, без плашки-пилюли — светящийся текст в цвет линии.
          left через CSS clamp(): сама линия остаётся на математически точном
          currentHourPercent, а у текста свой минимальный отступ от краёв
          (в px), чтобы он не срезался на самой границе суток (00:00 / 24:00). */}
      <div style={{
        position: 'absolute',
        left: `clamp(20px, ${currentHourPercent}%, calc(100% - 20px))`,
        bottom: 0,
        transform: 'translateX(-50%)',
        color: '#86EFAC',
        fontSize: '13px',
        fontWeight: '700',
        letterSpacing: '0.3px',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        whiteSpace: 'nowrap',
        textShadow: '0 0 10px rgba(74,222,128,0.75)',
        zIndex: 60,
      }}>
        {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>

    {/* Свой ненавязчивый серый индикатор скролла — лежит в самом гаттере (paddingRight
        контейнера), а не над строками заказов, поэтому не перекрывает статус-плашки.
        Виден постоянно, пока список не влезает, тонкий и прижат к правому краю. */}
    {timelineThumb && (
      <>
        <div style={{
          position: 'absolute',
          right: '5px',
          top: 0,
          bottom: 0,
          width: '4px',
          borderRadius: '9999px',
          background: 'rgba(148, 163, 184, 0.12)',
          pointerEvents: 'none',
          zIndex: 50,
        }} />
        <div style={{
          position: 'absolute',
          right: '5px',
          top: `${timelineThumb.top}px`,
          height: `${timelineThumb.height}px`,
          width: '4px',
          borderRadius: '9999px',
          background: 'rgba(148, 163, 184, 0.55)',
          pointerEvents: 'none',
          zIndex: 50,
        }} />
      </>
    )}
  </div>} {/* end timelineMode === 'horizontal' order area */}

  {/* Вертикальный таймлайн */}
  {timelineMode === 'vertical' && (
    <div className="timeline-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '4px' }}>
      <VerticalTimelinePanel
        orders={todayOrders}
        mixerAssignments={mixerAssignments}
        selectedDateStr={selectedDateStr}
        onOrderClick={(order) => setSelectedOrder(order)}
        delayedOrders={delayedOrders.map((o: any) => ({ id: o.id, delayMinutes: o.delayMinutes, delayText: o.delayText }))}
      />
    </div>
  )}
    </div>
   </div>
            {/* ==================== 45. МИКСЕРЫ В РАБОТЕ ==================== */}
<div style={volumeCardStyle({ 
  width: '100%', 
  maxWidth: '480px', 
  borderRadius: 22, 
  padding: '24px', 
  display: 'flex', 
  flexDirection: 'column',
  height: '100%',
  alignSelf: 'stretch',
  minHeight: 0,
  overflow: 'hidden',
})}>
  
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

  <div className="scroll-hidden" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', minHeight: 0 }}>
    {groupedMixers.length > 0 ? (
      groupedMixers.map((group) => (
        <div key={group.orderId} style={volumeCardSoftStyle({ 
          borderRadius: 18, 
          overflow: 'hidden',
          padding: 0,
        })}>
          {/* Шапка заказа */}
          <div style={{ 
            background: 'rgba(15, 23, 42, 0.55)', 
            padding: '14px 20px', 
            borderBottom: '1px solid #334155',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: '700', fontSize: '16px' }}>
                Заказ #{group.orderId}
              </div>
              {/* Длинное название клиента (частая ситуация — юрлица вроде «АО
                  «БРЯНСКАВТОДОР» Брянский ДРСУч») переносится на свою строку —
                  это нормально, но раньше из-за display:flex без ограничений
                  ширины оно "тянуло" за собой и счётчик миксеров справа,
                  из-за чего "N миксеров" сам разрывался на 2 строки. */}
              <div style={{ color: '#94A3B8', fontSize: '14px' }}>
                {group.client} • {group.deliveryTime}
              </div>
            </div>
            <div style={{ color: '#60A5FA', fontSize: '15px', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {group.mixers.length} миксеров
            </div>
          </div>

         {/* Строки миксеров внутри заказа */}
         <div style={{ padding: '8px' }}>
           {/* === ИСПРАВЛЕНИЕ: СОРТИРОВКА МИКСЕРОВ ПО ВРЕМЕНИ (самый ранний сверху) === */}
           {sortMixersByLogisticsTime(group.mixers)
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
                   padding: '4px 10px',
                   borderRadius: '8px',
                   marginBottom: '4px',
                   display: 'flex',
                   alignItems: 'center',
                   gap: '8px',
                   minHeight: '30px',
                   cursor: 'grab',
                   userSelect: 'none',
                 }}
               >
                 {/* Порядковый номер */}
                 <div style={{
                   width: '20px',
                   height: '20px',
                   background: '#334155',
                   borderRadius: '9999px',
                   display: 'flex',
                   alignItems: 'center',
                   justifyContent: 'center',
                   fontWeight: '600',
                   color: '#94A3B8',
                   fontSize: '11px',
                   flexShrink: 0
                 }}>
                   {index + 1}
                 </div>

                 {/* Номер миксера */}
                 <div style={{ fontWeight: '700', fontSize: '13px', minWidth: '100px', whiteSpace: 'nowrap' }}>
                   {mixer.number || mixer.mixer_name}
                 </div>

                 {/* ==================== 46. ВРЕМЯ + ОБЪЁМ (в одну строку, nowrap) ==================== */}
                 <div style={{ 
                   color: '#94A3B8', 
                   fontSize: '12.5px',
                   flex: 1,
                   whiteSpace: 'nowrap',
                   overflow: 'hidden',
                   textOverflow: 'ellipsis',
                 }}>
                   {mixer.time && mixer.time !== '—' ? mixer.time : '—'} • {mixer.volume} м³
                 </div>

                 {/* Статус — кастомный select с цветом по статусу */}
                 {(() => {
                   const st = mixer.status || 'Загрузка';
                   const stColor =
                     st === 'В пути' ? '#60A5FA' :
                     st === 'На объекте' ? '#10B981' :
                     st === 'Разгружен' ? '#34D399' :
                     st === 'Возврат' ? '#94A3B8' :
                     st === 'Проблема' ? '#EF4444' : '#FACC15';
                   return (
                     <ModalSelect
                       value={st}
                       onChange={(status) => handleStatusChange(mixer.id, status)}
                       chevronColor={stColor}
                       minPopupWidth={160}
                       triggerStyle={{
                         padding: '3px 8px',
                         borderRadius: 9999,
                         background: `${stColor}18`,
                         color: stColor,
                         border: `1px solid ${stColor}55`,
                         fontSize: 12,
                         minWidth: 110,
                         fontWeight: 500,
                       }}
                       options={[
                         { value: 'Загрузка', label: '🟡 Загрузка', text: '🟡 Загрузка' },
                         { value: 'В пути', label: '🔵 В пути', text: '🔵 В пути' },
                         { value: 'На объекте', label: '📍 На объекте', text: '📍 На объекте' },
                         { value: 'Разгружен', label: '🟢 Разгружен', text: '🟢 Разгружен' },
                         { value: 'Возврат', label: '↩️ Возврат', text: '↩️ Возврат' },
                         { value: 'Проблема', label: '🔴 Проблема', text: '🔴 Проблема' },
                       ]}
                     />
                   );
                 })()}

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

      const sortedMixers = sortMixersByLogisticsTime(group.mixers);

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
    modal.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.82);z-index:10000;display:flex;align-items:center;justify-content:center;`;

    modal.innerHTML = `
      <div style="background:linear-gradient(165deg,#1E2937 0%,#0F172A 72%,#0B1220 100%);border:1px solid rgba(148,163,184,0.28);width:820px;max-width:80%;border-radius:16px;padding:25px;height:1400px;max-height:100vh;overflow:auto;box-shadow:0 12px 28px rgba(0,0,0,0.34),0 3px 8px rgba(0,0,0,0.2),inset 0 1px 0 rgba(255,255,255,0.12),inset 0 -10px 22px rgba(0,0,0,0.16),0 0 0 1px rgba(148,163,184,0.12),0 0 48px rgba(148,163,184,0.22),0 0 110px rgba(148,163,184,0.12),0 40px 100px rgba(0,0,0,0.55);">
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
        refreshBtn.addEventListener('click', async () => {
          if (await appConfirm('Загрузить свежие данные? Ваши правки будут потеряны.')) {
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
    marginTop: '16px',
    width: '100%',
    padding: '10px 16px',
    background: 'rgba(99,102,241,0.15)',
    color: '#A5B4FC',
    border: '1px solid rgba(99,102,241,0.35)',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background 0.2s, color 0.2s',
    letterSpacing: '0.01em',
  }}
  onMouseEnter={e => {
    e.currentTarget.style.background = 'rgba(99,102,241,0.28)';
    e.currentTarget.style.color = '#C7D2FE';
  }}
  onMouseLeave={e => {
    e.currentTarget.style.background = 'rgba(99,102,241,0.15)';
    e.currentTarget.style.color = '#A5B4FC';
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
    history={history}
    addToHistory={addToHistory}
    getStatusConfig={getStatusConfig}
    setHistory={setHistory}
    setSelectedOrder={setSelectedOrder}
  />
)}

      {/* ==================== МОДАЛКА: ЗАЯВКИ СЕГОДНЯ ==================== */}
      {showOrdersModal && (() => {
        const groups: { key: string; label: string; color: string; items: Order[] }[] = [
          { key: 'new', label: 'Новые', color: '#FACC15', items: todayOrders.filter((o) => o.status === 'new') },
          { key: 'processing', label: 'В работе', color: '#60A5FA', items: todayOrders.filter((o) => o.status === 'processing') },
          { key: 'completed', label: 'Выполнены', color: '#10B981', items: todayOrders.filter((o) => o.status === 'completed') },
          { key: 'cancelled', label: 'Отменены', color: '#EF4444', items: todayOrders.filter((o) => o.status === 'cancelled') },
        ];
        const volOf = (list: Order[]) => list.reduce((s, o) => s + Number(o.volume || 0), 0);
        return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.82)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
          onClick={() => setShowOrdersModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={volumeModalStyle({
              width: 'min(920px, 100%)',
              maxHeight: 'min(860px, calc(100vh - 48px))',
              borderRadius: 22,
              border: CARD_BORDER,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            })}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '18px 24px',
              borderBottom: CARD_BORDER,
              flexShrink: 0,
            }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#E2E8F0' }}>
                  Заявки сегодня
                </div>
                <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
                  {selectedDate.toLocaleDateString('ru-RU', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOrdersModal(false)}
                style={modalCloseButtonStyle()}
              >
                <X size={18} color="#94A3B8" />
              </button>
            </div>

            <div className="scroll-hidden" style={{ overflowY: 'auto', padding: '22px 24px 28px' }}>
              <div style={volumeCardSoftStyle({
                textAlign: 'center',
                padding: '22px 20px',
                marginBottom: '16px',
                borderRadius: 16,
              })}>
                <div style={{ fontSize: '64px', fontWeight: 700, lineHeight: 1, color: '#60A5FA' }}>
                  {totalToday}
                </div>
                <div style={{ color: '#94A3B8', fontSize: '14px', marginTop: '6px' }}>
                  заявок · {fmtM3(volOf(todayOrders))} м³
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                marginBottom: '22px',
              }}>
                {groups.map((g) => (
                  <div
                    key={g.key}
                    style={volumeCardSoftStyle({
                      padding: '14px 16px',
                      borderRadius: 12,
                      borderLeft: `3px solid ${g.color}`,
                    })}
                  >
                    <div style={{ color: '#64748B', fontSize: '12px', marginBottom: '4px' }}>{g.label}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ fontSize: '28px', fontWeight: 700, color: g.color, lineHeight: 1 }}>
                        {g.items.length}
                      </span>
                      <span style={{ fontSize: '13px', color: '#94A3B8', fontWeight: 600 }}>
                        {fmtM3(volOf(g.items))} м³
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {todayOrders.length === 0 ? (
                <div style={volumeCardSoftStyle({
                  padding: '28px',
                  textAlign: 'center',
                  color: '#64748B',
                  borderRadius: 14,
                })}>
                  Нет заявок на этот день
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  {groups.filter((g) => g.items.length > 0).map((g) => (
                    <div key={g.key}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '10px',
                      }}>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: g.color }}>
                          {g.label}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748B' }}>
                          {g.items.length} · {fmtM3(volOf(g.items))} м³
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {[...g.items]
                          .sort((a, b) => String(a.delivery_time || '').localeCompare(String(b.delivery_time || '')))
                          .map((order) => {
                            const statusCfg = getStatusConfig(order.status);
                            const client = (order as any).organization_name || (order as any).full_name || '—';
                            return (
                              <button
                                key={order.id}
                                type="button"
                                onClick={() => {
                                  setSelectedOrder(order);
                                  setShowOrdersModal(false);
                                }}
                                style={volumeCardSoftStyle({
                                  display: 'block',
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '12px 14px',
                                  borderRadius: 12,
                                  cursor: 'pointer',
                                  color: 'inherit',
                                  borderLeft: `3px solid ${statusCfg.color}`,
                                })}
                                onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
                              >
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  justifyContent: 'space-between',
                                  gap: '12px',
                                }}>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{
                                      fontSize: '14px',
                                      fontWeight: 600,
                                      color: '#E2E8F0',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}>
                                      #{order.id} · {order.delivery_time || '—'} · {client}
                                    </div>
                                    <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '4px' }}>
                                      {(order as any).grade || '—'} · {fmtM3(Number(order.volume || 0))} м³
                                      {(order as any).address ? ` · ${(order as any).address}` : ''}
                                    </div>
                                  </div>
                                  <span style={{
                                    flexShrink: 0,
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    padding: '2px 8px',
                                    borderRadius: '9999px',
                                    color: statusCfg.color,
                                    background: statusCfg.bg,
                                  }}>
                                    {statusCfg.label}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* ==================== МОДАЛКА: ВЫПОЛНЕНИЕ ПЛАНА ==================== */}
      {showPlanModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.82)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
          onClick={() => setShowPlanModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={volumeModalStyle({
              width: 'min(920px, 100%)',
              maxHeight: 'min(860px, calc(100vh - 48px))',
              borderRadius: 22,
              border: CARD_BORDER,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            })}
          >
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '18px 24px',
              borderBottom: CARD_BORDER,
              flexShrink: 0,
            }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#E2E8F0' }}>
                  Выполнение плана
                </div>
                <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
                  {selectedDate.toLocaleDateString('ru-RU', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPlanModal(false)}
                style={modalCloseButtonStyle()}
              >
                <X size={18} color="#94A3B8" />
              </button>
            </div>

            <div className="scroll-hidden" style={{ overflowY: 'auto', padding: '22px 24px 28px' }}>
              {/* Сводка % */}
              <div style={volumeCardSoftStyle({
                textAlign: 'center',
                padding: '22px 20px',
                marginBottom: '16px',
                borderRadius: 16,
              })}>
                <div style={{
                  fontSize: '64px',
                  fontWeight: 700,
                  lineHeight: 1,
                  color: completionColor,
                }}>
                  {completionPercent}%
                </div>
                <div style={{ color: '#94A3B8', fontSize: '14px', marginTop: '6px' }}>
                  разгружено от плана дня · {fmtM3(factVolume)} / {fmtM3(planToday)} м³
                </div>
                {planToday > 0 && (
                  <div style={{
                    margin: '16px auto 0',
                    maxWidth: '420px',
                    height: '10px',
                    borderRadius: '9999px',
                    background: '#0F172A',
                    overflow: 'hidden',
                    border: CARD_BORDER,
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${completionPercent}%`,
                      borderRadius: '9999px',
                      background: completionBarBg,
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                )}
              </div>

              {/* Метрики дня */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '10px',
                marginBottom: '22px',
              }}>
                {[
                  { label: 'План на день', value: `${fmtM3(planToday)} м³`, color: '#E2E8F0' },
                  { label: 'Осталось разгрузить', value: `${fmtM3(remainingVolume)} м³`, color: '#94A3B8' },
                  { label: 'Покрыто рейсами', value: `${fmtM3(coveredVolume)} м³`, color: '#94A3B8' },
                  ...volumeByStatus.map((item) => ({
                    label: item.status === 'Разгружен' ? 'Разгружено' : item.status,
                    value: item.showCount
                      ? `${item.count} · ${fmtM3(item.volume)} м³`
                      : `${fmtM3(item.volume)} м³`,
                    color: item.color,
                  })),
                  {
                    label: 'Заявки закрыты',
                    value: `${completedOrders} из ${planOrdersCount}`,
                    color: '#10B981',
                  },
                  {
                    label: 'Объём закрытых заявок',
                    value: `${fmtM3(completedOrdersVolume)} м³`,
                    color: '#64748B',
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    style={volumeCardSoftStyle({
                      padding: '12px 14px',
                      borderRadius: 12,
                    })}
                  >
                    <div style={{ color: '#64748B', fontSize: '12px', marginBottom: '4px' }}>
                      {row.label}
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: row.color }}>
                      {row.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Разбивка по заявкам */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
              }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#E2E8F0' }}>
                  По заявкам
                </div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>
                  {planOrdersDetail.length} заявок
                </div>
              </div>

              {planOrdersDetail.length === 0 ? (
                <div style={volumeCardSoftStyle({
                  padding: '28px',
                  textAlign: 'center',
                  color: '#64748B',
                  borderRadius: 14,
                })}>
                  Нет заявок на этот день
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {planOrdersDetail.map((row) => {
                    const statusCfg = getStatusConfig(row.status);
                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => {
                          const order = todayOrders.find((o) => String(o.id) === String(row.id));
                          if (order) {
                            setSelectedOrder(order);
                            setShowPlanModal(false);
                          }
                        }}
                        style={volumeCardSoftStyle({
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '12px 14px',
                          borderRadius: 12,
                          cursor: 'pointer',
                          color: 'inherit',
                        })}
                        onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
                      >
                        <div style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: '12px',
                          marginBottom: '8px',
                        }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{
                              fontSize: '14px',
                              fontWeight: 600,
                              color: '#E2E8F0',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              #{row.id} · {row.time} · {row.client}
                            </div>
                          </div>
                          <span style={{
                            flexShrink: 0,
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            color: statusCfg.color,
                            background: statusCfg.bg,
                          }}>
                            {statusCfg.label}
                          </span>
                        </div>

                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '10px',
                          marginBottom: '6px',
                        }}>
                          <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                            <span style={{ color: '#10B981', fontWeight: 700 }}>
                              {fmtM3(row.unloaded)}
                            </span>
                            {' / '}{fmtM3(row.planVol)} м³
                            {row.unloadedCount > 0 ? (
                              <span style={{ color: '#94A3B8' }}>
                                {' '}· {row.unloadedCount} разгружен
                              </span>
                            ) : null}
                          </span>
                          <span style={{
                            fontSize: '13px',
                            fontWeight: 700,
                            color: row.pct >= 90 ? '#10B981' : row.pct >= 50 ? '#FACC15' : '#94A3B8',
                          }}>
                            {row.pct}%
                          </span>
                        </div>

                        <div style={{
                          height: '6px',
                          borderRadius: '9999px',
                          background: '#0F172A',
                          overflow: 'hidden',
                          border: CARD_BORDER,
                          marginBottom: (row.loading + row.inTransit + row.onSite) > 0 ? '8px' : 0,
                        }}>
                          <div style={{
                            height: '100%',
                            width: `${row.pct}%`,
                            borderRadius: '9999px',
                            background: row.pct >= 90
                              ? '#10B981'
                              : row.pct >= 50
                                ? '#FACC15'
                                : '#3B82F6',
                          }} />
                        </div>

                        {(row.loading + row.inTransit + row.onSite) > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {row.loading > 0 && (
                              <span style={{ fontSize: '11px', color: '#FACC15', fontWeight: 600 }}>
                                {fmtM3(row.loading)} м³ загрузка
                              </span>
                            )}
                            {row.inTransit > 0 && (
                              <span style={{ fontSize: '11px', color: '#60A5FA', fontWeight: 600 }}>
                                {fmtM3(row.inTransit)} м³ в пути
                              </span>
                            )}
                            {row.onSite > 0 && (
                              <span style={{ fontSize: '11px', color: '#34D399', fontWeight: 600 }}>
                                {fmtM3(row.onSite)} м³ на объекте
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== МОДАЛКА: ЗАДЕРЖКИ ОТГРУЗОК ==================== */}
      {showDelaysModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
          onClick={() => setShowDelaysModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={volumeModalStyle({
              width: 'min(860px, 100%)',
              maxHeight: 'min(860px, calc(100vh - 48px))',
              borderRadius: 20,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            })}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '18px 24px',
              borderBottom: CARD_BORDER,
              flexShrink: 0,
            }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#E2E8F0' }}>
                  Задержки отгрузок
                </div>
                <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
                  {selectedDateStr !== today
                    ? 'Задержки считаются только за сегодняшний день'
                    : `Сейчас ${fmtClockMins(currentMinutes)} · порог опоздания > 15 мин`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDelaysModal(false)}
                style={modalCloseButtonStyle()}
              >
                <X size={18} color="#94A3B8" />
              </button>
            </div>

            <div className="scroll-hidden" style={{ overflowY: 'auto', padding: '20px 24px 28px' }}>
              {/* Как считаем */}
              <div style={volumeCardSoftStyle({
                padding: '14px 16px',
                borderRadius: 12,
                marginBottom: '18px',
                fontSize: '13px',
                color: '#94A3B8',
                lineHeight: 1.55,
              })}>
                <div style={{ color: '#E2E8F0', fontWeight: 600, marginBottom: '6px' }}>
                  Как считаем задержку
                </div>
                Заявка попадает сюда, если статус «Новая» или «В работе», нет миксеров
                в движении, объём ещё не полностью назначен, и с расчётного времени
                начала загрузки прошло больше 15 минут.
                <br />
                Расчёт старта: время доставки − путь − загрузка (~2 мин/м³).
              </div>

              {delayedOrders.length === 0 ? (
                <div style={volumeCardSoftStyle({
                  padding: '36px 20px',
                  textAlign: 'center',
                  borderRadius: 14,
                })}>
                  <div style={{ fontSize: '36px', marginBottom: '8px' }}>✓</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: '#10B981', marginBottom: '4px' }}>
                    Все по графику
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748B' }}>
                    {selectedDateStr !== today
                      ? 'На выбранный день задержки не отслеживаются'
                      : 'Сейчас нет заявок с опозданием больше 15 минут'}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: '10px',
                    marginBottom: '2px',
                  }}>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#E2E8F0' }}>
                      Проблемные заявки
                    </div>
                    <div style={{ fontSize: '13px', color: '#F87171', fontWeight: 600 }}>
                      {delayedOrders.length}{' '}
                      {delayedOrders.length === 1 ? 'заявка' : delayedOrders.length <= 4 ? 'заявки' : 'заявок'}
                    </div>
                  </div>

                  {delayedOrders.map((order: any) => {
                    const client = order.organization_name || order.full_name || '—';
                    const statusCfg = getStatusConfig(order.status);
                    const severity = order.delayMinutes > 60 ? '#EF4444' : '#F59E0B';
                    return (
                      <button
                        key={order.id}
                        type="button"
                        onClick={() => {
                          setSelectedOrder(order);
                          setShowDelaysModal(false);
                        }}
                        style={volumeCardSoftStyle({
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '14px 16px',
                          borderRadius: 14,
                          border: `1px solid ${severity}40`,
                          cursor: 'pointer',
                          color: 'inherit',
                        })}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = severity; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${severity}40`; }}
                      >
                        <div style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: '12px',
                          marginBottom: '10px',
                        }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{
                              fontSize: '15px',
                              fontWeight: 700,
                              color: '#E2E8F0',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              #{order.id} · {order.delivery_time || '—'} · {client}
                            </div>
                            <div style={{ marginTop: '4px' }}>
                              <span style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: '9999px',
                                color: statusCfg.color,
                                background: statusCfg.bg,
                              }}>
                                {statusCfg.label}
                              </span>
                            </div>
                          </div>
                          <div style={{
                            flexShrink: 0,
                            textAlign: 'right',
                          }}>
                            <div style={{
                              fontSize: '22px',
                              fontWeight: 700,
                              color: severity,
                              lineHeight: 1,
                            }}>
                              +{fmtDelayMins(order.delayMinutes)}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748B', marginTop: '3px' }}>
                              опоздание
                            </div>
                          </div>
                        </div>

                        {/* Таймлайн расчёта */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, 1fr)',
                          gap: '8px',
                          marginBottom: '12px',
                        }}>
                          <div style={volumeCardSoftStyle({
                            padding: '8px 10px',
                            borderRadius: 10,
                          })}>
                            <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '2px' }}>
                              Начать грузить
                            </div>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#FCA5A5' }}>
                              {fmtClockMins(order.expectedLoadStart)}
                            </div>
                          </div>
                          <div style={volumeCardSoftStyle({
                            padding: '8px 10px',
                            borderRadius: 10,
                          })}>
                            <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '2px' }}>
                              Доставка
                            </div>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#E2E8F0' }}>
                              {fmtClockMins(order.plannedStart)}
                            </div>
                          </div>
                          <div style={volumeCardSoftStyle({
                            padding: '8px 10px',
                            borderRadius: 10,
                          })}>
                            <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '2px' }}>
                              Путь / загрузка
                            </div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#94A3B8' }}>
                              {order.travelTime}м{order.travelTimeIsEstimate ? '*' : ''}
                              {' · '}{order.loadingTime}м
                            </div>
                          </div>
                        </div>

                        <div style={{
                          fontSize: '12px',
                          color: '#64748B',
                          marginBottom: '8px',
                        }}>
                          Назначено{' '}
                          <span style={{ color: '#E2E8F0', fontWeight: 600 }}>
                            {fmtM3(Number(order.assignedVol || 0))}
                          </span>
                          {' / '}{fmtM3(Number(order.volume || 0))} м³
                          {' · '}миксеров: {order.mixerCount}
                          {order.travelTimeIsEstimate ? (
                            <span style={{ color: '#475569' }}> · *путь ≈ оценка 30 мин</span>
                          ) : null}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {(order.reasons || []).map((reason: string) => (
                            <div
                              key={reason}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                fontSize: '13px',
                                color: '#FCA5A5',
                                lineHeight: 1.35,
                              }}
                            >
                              <span style={{ color: severity, flexShrink: 0, marginTop: '1px' }}>●</span>
                              <span>{reason}</span>
                            </div>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Модалка календаря */}
      {showCalendar && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowCalendar(false)}>
          <div onClick={e => e.stopPropagation()}>
            <Calendar
              orders={allOrders}
              onClose={() => setShowCalendar(false)}
              onSelectOrder={(order) => setSelectedOrder(order)}
              onQuickCreateOrder={(dateStr) => {
                setQuickNewOrderDate(dateStr);
                setShowQuickNewOrder(true);
              }}
              getStatusConfig={getStatusConfig}
              onViewMonthChange={handleCalendarMonthChange}
            />
          </div>
        </div>
      )}

      {/* Быстрое создание заявки на дату, выбранную ПКМ/долгим нажатием в календаре */}
      {showQuickNewOrder && (
        <NewOrderModal
          isOpen={showQuickNewOrder}
          onClose={() => {
            setShowQuickNewOrder(false);
            setQuickNewOrderDate(undefined);
          }}
          onSuccess={(newOrder) => {
            if (newOrder) {
              setAllOrders(prev => {
                if (prev.some(o => String(o.id) === String(newOrder.id))) return prev;
                return [newOrder, ...prev];
              });
            }
          }}
          defaultDeliveryDate={quickNewOrderDate}
          currentRole={userRole || 'admin'}
          currentUserName={userFullName || 'Сотрудник'}
        />
      )}
    </div>
    
  );
}