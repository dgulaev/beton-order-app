'use client';

import React, { useState, useEffect, useMemo } from 'react';
import MobileDashboardOrderModal from './components/MobileDashboardOrderModal';
import MobileCalendar from './components/MobileCalendar';
import MobileExitButton from './components/MobileExitButton';
import { ChevronLeft, ChevronRight, CalendarDays, X, Truck } from 'lucide-react';
import Link from 'next/link';

// 🔥 Подключаем хуки авторизации и real-time
import { useUserRole } from '../providers/UserRoleProvider';
import { useRealtimeOrders } from '@/hooks/useRealtimeOrders';
import { useWakeRefresh } from '@/hooks/useWakeReload';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

export default function MobileDashboard() {
  // ==================== 1. СТАТУСЫ И СОСТОЯНИЯ ====================
  // 🔥 Убираем локальные стейты для userId/userRole — берем всё из провайдера
  const { user, loading: roleLoading } = useUserRole();
  // 🔥 localStorage недоступен на сервере — читаем его только после маунта,
  // иначе будет ReferenceError при SSR/первом рендере
  const [userId, setUserId] = useState<number | null>(null);
  useEffect(() => {
    const stored = parseInt(localStorage.getItem('userId') || '');
    setUserId(Number.isNaN(stored) ? null : stored);
  }, []);
  const userRole = user?.role || '';

  // 🔥 Оставляем только нужные стейты
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [activeMixers, setActiveMixers] = useState<any[]>([]);
  const [allMixersList, setAllMixersList] = useState<any[]>([]);
  const [mixerAssignments, setMixerAssignments] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showMixerSheet, setShowMixerSheet] = useState(false);
  const [showOrdersSheet, setShowOrdersSheet] = useState(false);
  const [showPlanSheet, setShowPlanSheet] = useState(false);
  // Тик для обновления линии «сейчас» каждую минуту
  const [, forceNowTick] = useState(0);
  useBodyScrollLock(showCalendar || showMixerSheet || showOrdersSheet || showPlanSheet);

  // ==================== 2. ВЫБОР ДАТЫ ====================
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

  // ==================== 3. КОРРЕКЦИЯ TIMEZONE (оптимизировано) ====================
  useEffect(() => {
    const now = new Date();
    const localToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (selectedDate.getFullYear() !== localToday.getFullYear() || 
        selectedDate.getMonth() !== localToday.getMonth() || 
        selectedDate.getDate() !== localToday.getDate()) {
      console.log('🔄 Исправляем дату на сегодняшнюю!');
      setSelectedDate(localToday);
    }
  }, []);

  // Обновляем линию «сейчас» каждую минуту
  useEffect(() => {
    const id = setInterval(() => forceNowTick(n => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

 // ==================== 5. ЗАГРУЗКА ДАННЫХ (REAL-TIME + FETCH) ====================

  const selectedYearNum = selectedDate.getFullYear();
  const selectedMonthNum = selectedDate.getMonth() + 1; // 1-12, как ждёт API

  // 🔥 Границы месяца — используются и для fetch, и для realtime-фильтра,
  // чтобы оба источника данных всегда были синхронизированы по диапазону.
  const monthStart = `${selectedYearNum}-${String(selectedMonthNum).padStart(2, '0')}-01`;
  const daysInMonth = new Date(selectedYearNum, selectedMonthNum, 0).getDate();
  const monthEnd = `${selectedYearNum}-${String(selectedMonthNum).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  // 🔥 Realtime подключаем ТОЛЬКО после того, как основные данные (заявки за
  // месяц) уже отрисованы обычным fetch'ем — иначе на слабой мобильной сети
  // WebSocket-подключение конкурирует за канал/CPU с самим первым рендером и
  // подгрузкой данных, усугубляя подвисание при заходе в приложение.
  // Once=true — далее остаётся включённым постоянно (в т.ч. при смене
  // месяца), просто НЕ участвует в самой первой, самой критичной загрузке.
  const [initialOrdersLoaded, setInitialOrdersLoaded] = useState(false);

  // 🔥 Подписка на все изменения в таблице ORDERS через broadcast (топик orders:all).
  // Клиентский фильтр ограничивает INSERT текущим месяцем (тем же, что и в fetch).
  const { status: ordersRealtimeStatus } = useRealtimeOrders(
    setAllOrders,
    {
      clientFilter: (o: any) => {
        const d = String(o.delivery_date || '').slice(0, 10);
        return d >= monthStart && d <= monthEnd;
      },
      enabled: Boolean(userId) && initialOrdersLoaded
    }
  );

  // 🔥 Реалтайм присылает ТОЛЬКО будущие изменения (INSERT/UPDATE/DELETE),
  // он никогда не отдаёт уже существующие строки. Без этого fetch страница
  // при открытии/смене даты будет пустой, пока кто-то не изменит заказ.
  // Используем существующий рабочий роут — он уже принимает year/month.
  const [ordersLoading, setOrdersLoading] = useState(true);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setOrdersLoading(true);

    fetch(`/api/adminCifra/orders?year=${selectedYearNum}&month=${selectedMonthNum}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Orders fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setAllOrders(data);
      })
      .catch((err) => {
        console.error('Initial orders fetch failed:', err);
      })
      .finally(() => {
        if (!cancelled) {
          setOrdersLoading(false);
          setInitialOrdersLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedYearNum, selectedMonthNum, userId]);

// 🔥 Active Mixers — единоразовая загрузка на выбранную дату.
// Поллинг убран, так как real-time уже обеспечивает обновления
useEffect(() => {
  const dateStr = selectedDate.toISOString().split('T')[0];

  fetch(`/api/adminCifra/active-mixers?date=${dateStr}`)
    .then((res) => {
      if (!res.ok) throw new Error(`Active mixers error: ${res.status}`);
      return res.json();
    })
    .then((mixers) => setActiveMixers(mixers))
    .catch((err) => {
      console.error('Initial data fetch failed:', err);
      // 🔥 Можно показать баннер "Нет связи с сервером"
    });
}, [selectedDate]);

// Мягкое восстановление данных при пробуждении вкладки (без перезагрузки) —
// подтягиваем свежие заявки и активные миксеры. Сокет realtime поднимает layout.
useWakeRefresh(() => {
  if (!userId) return;
  fetch(`/api/adminCifra/orders?year=${selectedYearNum}&month=${selectedMonthNum}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => { if (data) setAllOrders(data); })
    .catch(() => {});

  const dateStr = selectedDate.toISOString().split('T')[0];
  fetch(`/api/adminCifra/active-mixers?date=${dateStr}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((mixers) => { if (mixers) setActiveMixers(mixers); })
    .catch(() => {});
});

// Список всех миксеров — нужен для определения типа (свой/наёмный) в виджете
useEffect(() => {
  fetch('/api/adminCifra/mixers')
    .then(r => r.ok ? r.json() : [])
    .then(setAllMixersList)
    .catch(() => {});
}, []);

// 🔥 Назначенные миксеры — раньше грузили ВСЮ таблицу order_mixers (за всё
// время работы завода — сотни КБ и постоянно растёт), хотя на дашборде
// нужны назначения только для заявок ТЕКУЩЕГО МЕСЯЦА (allOrders уже
// отфильтрован по месяцу выше). Ограничиваем запрос конкретными orderId.
const orderIdsKey = useMemo(
  () => allOrders.map((o: any) => o.id).join(','),
  [allOrders]
);

useEffect(() => {
  let cancelled = false;

  if (!orderIdsKey) {
    // setState — внутри микротаска, а не прямо в теле эффекта (та же
    // причина, что и у остальных асинхронных обновлений здесь).
    Promise.resolve().then(() => {
      if (!cancelled) setMixerAssignments([]);
    });
    return () => {
      cancelled = true;
    };
  }

  fetch(`/api/adminCifra/order-mixers?orderIds=${orderIdsKey}`)
    .then((res) => {
      if (!res.ok) throw new Error(`Assignments error: ${res.status}`);
      return res.json();
    })
    .then((assignments) => {
      if (!cancelled) setMixerAssignments(assignments);
    })
    .catch((err) => {
      console.error('Assignments fetch failed:', err);
    });

  return () => {
    cancelled = true;
  };
}, [orderIdsKey]);


  // ==================== 6. РАСЧЁТЫ И ФИЛЬТРЫ ====================
  const selectedYear = selectedDate.getFullYear();
  const selectedMonth = String(selectedDate.getMonth() + 1).padStart(2, '0');
  const selectedDay = String(selectedDate.getDate()).padStart(2, '0');
  const selectedDateStr = `${selectedYear}-${selectedMonth}-${selectedDay}`;

  // 🔥 Мемоизация фильтров (это повысит плавность скролла)
  const todayOrders = useMemo(() => {
    return allOrders
      .filter((o: any) => {
        if (!o?.delivery_date) return false;

        let orderDateStr = '';

        if (typeof o.delivery_date === 'string') {
          orderDateStr = o.delivery_date.substring(0, 10);
        } else {
          try {
            const date = new Date(o.delivery_date);
            orderDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          } catch (e) {
            orderDateStr = String(o.delivery_date).substring(0, 10);
          }
        }

        return orderDateStr === selectedDateStr;
      })
      .sort((a: any, b: any) => 
        (a.delivery_time || '00:00').localeCompare(b.delivery_time || '00:00')
      );
  }, [allOrders, selectedDateStr]);

  // 🔥 Мемоизация миксеров (чтобы не пересчитывать при каждом рендере)
  const activeMixersForDate = useMemo(() => {
    return activeMixers.filter(m => {
      if (!m.delivery_date && !m.order_delivery_date) return true;
      const mixerDate = (m.delivery_date || m.order_delivery_date || '').substring(0, 10);
      return mixerDate === selectedDateStr;
    });
  }, [activeMixers, selectedDateStr]);

  // ── Статистика «В рейсе сегодня» — всегда за СЕГОДНЯ (не зависит от выбранной даты) ──
  const realTodayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const todayActiveTrips = useMemo(() =>
    activeMixers.filter(m => (m.delivery_date || '').slice(0, 10) === realTodayStr),
  [activeMixers, realTodayStr]);

  // Дедупликация по номеру миксера (один миксер = один рейс в виджете)
  const uniqueTodayMixers = useMemo(() =>
    Array.from(new Map(todayActiveTrips.map((m: any) => [m.number, m])).values()),
  [todayActiveTrips]);

  const mixerStatusCounts = useMemo(() => ({
    loading:   uniqueTodayMixers.filter((m: any) => m.status === 'Загрузка').length,
    inTransit: uniqueTodayMixers.filter((m: any) => m.status === 'В пути').length,
    onSite:    uniqueTodayMixers.filter((m: any) => m.status === 'На объекте').length,
    problem:   uniqueTodayMixers.filter((m: any) => m.status === 'Проблема').length,
  }), [uniqueTodayMixers]);

  const totalActiveMixers = uniqueTodayMixers.length;
  const volumeInTransit = useMemo(() =>
    todayActiveTrips.reduce((s: number, m: any) => s + Number(m.volume || 0), 0),
  [todayActiveTrips]);

  const problemMixers = useMemo(() =>
    uniqueTodayMixers.filter((m: any) => m.status === 'Проблема'),
  [uniqueTodayMixers]);

  const hasProblems = problemMixers.length > 0;

  // Сегодняшний плановый объём (не отменённые)
  const todayPlannedVolume = useMemo(() =>
    allOrders
      .filter((o: any) => (o.delivery_date || '').slice(0, 10) === realTodayStr && o.status !== 'cancelled')
      .reduce((s: number, o: any) => s + Number(o.volume || 0), 0),
  [allOrders, realTodayStr]);

  // ── KPI: план/факт по объёму ──────────────────────────────────────────────────
  const kpiPlanToday = useMemo(() =>
    todayOrders.reduce((s: number, o: any) => s + Number(o.volume || 0), 0),
  [todayOrders]);

  const kpiCompletedVolume = useMemo(() =>
    todayOrders.filter((o: any) => o.status === 'completed')
               .reduce((s: number, o: any) => s + Number(o.volume || 0), 0),
  [todayOrders]);

  const kpiCompletedOrders  = useMemo(() => todayOrders.filter((o: any) => o.status === 'completed').length, [todayOrders]);
  const kpiNewOrders        = useMemo(() => todayOrders.filter((o: any) => o.status === 'new').length, [todayOrders]);
  const kpiInWorkOrders     = useMemo(() => todayOrders.filter((o: any) => o.status === 'processing').length, [todayOrders]);
  const kpiCancelledOrders  = useMemo(() => todayOrders.filter((o: any) => o.status === 'cancelled').length, [todayOrders]);
  const kpiCompletionPct    = kpiPlanToday > 0 ? Math.round((kpiCompletedVolume / kpiPlanToday) * 100) : 0;

  // ── KPI: задержки (упрощённая версия без road_time кэша) ──────────────────────
  const kpiDelayedOrders = useMemo(() => {
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    const todayDateStr = new Date().toISOString().slice(0, 10);
    // Задержки считаем только за сегодня
    if (selectedDateStr !== todayDateStr) return [];

    return todayOrders
      .filter((o: any) => o.status === 'new' || o.status === 'processing')
      .filter((o: any) => {
        const orderMixers = activeMixersForDate.filter((m: any) => String(m.orderId) === String(o.id));
        const hasMoving = orderMixers.some((m: any) => ['В пути', 'На объекте', 'Разгружен', 'Возврат'].includes(m.status));
        if (hasMoving) return false;
        const assignedVol = orderMixers.reduce((s: number, m: any) => s + Number(m.volume || 0), 0);
        if (Number(o.volume || 0) > 0 && assignedVol >= Number(o.volume || 0)) return false;
        return true;
      })
      .map((o: any) => {
        const [h, m] = (o.delivery_time || '00:00').split(':').map(Number);
        const plannedStart = h * 60 + m;
        const loadingTime = Number(o.volume || 0) * 2;
        const travelTime = 30; // fallback без кэша
        const expectedDeparture = plannedStart - travelTime - loadingTime;
        const delay = Math.round(Math.max(0, nowMins - expectedDeparture));
        return { ...o, delayMinutes: delay };
      })
      .filter((o: any) => o.delayMinutes > 15)
      .sort((a: any, b: any) => b.delayMinutes - a.delayMinutes);
  }, [todayOrders, activeMixersForDate, selectedDateStr]);

  // Разбивка свои/наёмные по реестру миксеров
  const { ownActive, rentedActive } = useMemo(() => {
    let own = 0; let rented = 0;
    uniqueTodayMixers.forEach((trip: any) => {
      const mx = allMixersList.find((m: any) => m.number === trip.number);
      if (mx?.type === 'own') own++; else rented++;
    });
    return { ownActive: own, rentedActive: rented };
  }, [uniqueTodayMixers, allMixersList]);

  // ==============================================
  // return (продолжение файла)
  // ==============================================

  return (
    <div style={{
        backgroundColor: '#162032',
        minHeight: '100vh',
        width: '100%',
        maxWidth: '100vw',
        margin: '0 auto',
        padding: '16px 16px 90px 16px',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        overscrollBehaviorY: 'auto',
        scrollBehavior: 'smooth',
        boxSizing: 'border-box',
        position: 'relative'
      }} id="dashboard-scroll">

                {/* Полоса в цвет фона — почти невидима */}
        <style jsx global>{`
          #dashboard-scroll::-webkit-scrollbar {
            width: 3px !important;
            background: #162032 !important;
          }
          #dashboard-scroll::-webkit-scrollbar-thumb {
            background: #162032 !important;   /* тот же цвет что и фон */
            border-radius: 10px !important;
          }
          #dashboard-scroll::-webkit-scrollbar-track {
            background: #162032 !important;
          }
        `}</style>

     {/* Заголовок + Календарь */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '24px',
        padding: '0 4px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-tradecom-white.png"
            alt="TradeCom"
            style={{ height: '64px', width: 'auto', objectFit: 'contain', display: 'block' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setShowCalendar(true)}
            style={{ background: '#334155', border: '1px solid #334155', borderRadius: '10px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            title="Открыть календарь"
          >
            <CalendarDays size={17} color="#60A5FA" />
          </button>
          <MobileExitButton />
        </div>
      </div>

        {/* KPI */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>

          {/* Заявки сегодня */}
          <div
            onClick={() => setShowOrdersSheet(true)}
            style={{ background: '#25334A', borderRadius: '16px', padding: '18px', textAlign: 'center', cursor: 'pointer' }}
          >
            <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '4px' }}>Заявки сегодня</div>
            <div style={{ fontSize: '48px', fontWeight: 700, color: '#60A5FA', lineHeight: 1, marginBottom: '10px' }}>
              {todayOrders.length}
            </div>
            {/* Цветные цифры без подписей */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', fontSize: '15px', fontWeight: 700 }}>
              {kpiNewOrders > 0      && <span style={{ color: '#FACC15' }}>{kpiNewOrders}</span>}
              {kpiInWorkOrders > 0   && <span style={{ color: '#60A5FA' }}>{kpiInWorkOrders}</span>}
              {kpiCompletedOrders > 0 && <span style={{ color: '#10B981' }}>{kpiCompletedOrders}</span>}
              {kpiCancelledOrders > 0 && <span style={{ color: '#EF4444' }}>{kpiCancelledOrders}</span>}
              {todayOrders.length === 0 && <span style={{ color: '#475569', fontWeight: 400, fontSize: '13px' }}>—</span>}
            </div>
          </div>

          {/* Выполнение плана */}
          <div
            onClick={() => setShowPlanSheet(true)}
            style={{ background: '#25334A', borderRadius: '16px', padding: '18px', textAlign: 'center', cursor: 'pointer' }}
          >
            <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '4px' }}>Выполнение</div>
            <div style={{ fontSize: '48px', fontWeight: 700, color: '#10B981', lineHeight: 1, marginBottom: '10px' }}>
              {kpiCompletionPct}%
            </div>
            {/* Факт / план без подписей */}
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#64748B' }}>
              <span style={{ color: '#E2E8F0' }}>{Math.round(kpiCompletedVolume)}</span>
              <span style={{ color: '#475569' }}> / {Math.round(kpiPlanToday)}</span>
              <span style={{ color: '#64748B', fontSize: '12px', fontWeight: 400 }}> м³</span>
            </div>
          </div>
        </div>

               {/* Таймлайн с переключением дней */}
        <div style={{ marginBottom: '30px' }}>
          {/* ── НАВИГАЦИЯ ПО ДАТАМ ── */}
          {(() => {
            const today = new Date();
            const isToday =
              selectedDate.getFullYear() === today.getFullYear() &&
              selectedDate.getMonth() === today.getMonth() &&
              selectedDate.getDate() === today.getDate();

            const dayName = selectedDate.toLocaleDateString('ru-RU', { weekday: 'short' });
            const dayNum = selectedDate.getDate();
            const monthName = selectedDate.toLocaleDateString('ru-RU', { month: 'short' });
            const year = selectedDate.getFullYear();

            const navBtn = (dir: 'prev' | 'next') => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() + (dir === 'next' ? 1 : -1));
              setSelectedDate(d);
            };

            return (
              <div style={{
                background: '#25334A',
                borderRadius: '14px',
                padding: '8px 10px',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <button
                  onClick={() => navBtn('prev')}
                  style={{ background: '#334155', border: 'none', borderRadius: '8px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                >
                  <ChevronLeft size={16} color="#64748B" />
                </button>

                <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: isToday ? '#10B981' : '#E2E8F0', whiteSpace: 'nowrap' }}>
                    {dayName}, {dayNum} {monthName}{year !== today.getFullYear() ? ` ${year}` : ''}
                  </span>
                </div>

                {!isToday && (
                  <button
                    onClick={() => setSelectedDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()))}
                    style={{ background: 'transparent', border: '1px solid #334155', borderRadius: '7px', padding: '4px 9px', color: '#64748B', fontSize: '11px', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
                  >
                    Сегодня
                  </button>
                )}

                <button
                  onClick={() => navBtn('next')}
                  style={{ background: '#334155', border: 'none', borderRadius: '8px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
                >
                  <ChevronRight size={16} color="#64748B" />
                </button>
              </div>
            );
          })()}

          {/* ── Вертикальный таймлайн заявок ── */}
          {todayOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>
              На выбранный день заказов нет
            </div>
          ) : (() => {
            const STATUS_COLOR: Record<string, string> = {
              new:        '#FACC15',
              processing: '#3B82F6',
              completed:  '#10B981',
              cancelled:  '#EF4444',
            };
            const STATUS_LABEL: Record<string, string> = {
              new:        'Новая',
              processing: 'В работе',
              completed:  'Выполнена',
              cancelled:  'Отменена',
            };
            const MIXER_STATUS_COLOR: Record<string, string> = {
              'В пути': '#3B82F6', 'На объекте': '#10B981',
              'Загрузка': '#FACC15', 'Проблема': '#EF4444',
              'Разгружен': '#64748B', 'Возврат': '#64748B',
            };

            const now = new Date();
            const nowMins = now.getHours() * 60 + now.getMinutes();
            const toMins = (t: string) => {
              const [h, m] = (t || '00:00').split(':').map(Number);
              return h * 60 + (m || 0);
            };
            const isToday = selectedDateStr === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

            // ── Группируем заявки с одинаковым временем ──────
            type OGroup = { time: number; orders: any[] };
            const groups: OGroup[] = [];
            todayOrders.forEach((o: any) => {
              const t = toMins(o.delivery_time);
              if (groups.length > 0 && groups[groups.length - 1].time === t) {
                groups[groups.length - 1].orders.push(o);
              } else {
                groups.push({ time: t, orders: [o] });
              }
            });

            // ── Логарифмическая шкала зазоров ────────────────
            // gap = min(cardHeight + 4 + log(1 + dt/5)*10, MAX_GAP)
            // Маленькие промежутки (~5мин) дают +7px сверх минимума,
            // большие (1ч+) дают +25px — рост быстро замедляется.
            const MAX_GAP    = 94;
            const TOP_PAD    = 6;

            const gPos: number[] = [];
            groups.forEach((g, i) => {
              if (i === 0) { gPos.push(TOP_PAD); return; }
              const prevMaxH = Math.max(...groups[i - 1].orders.map((o: any) =>
                mixerAssignments.some((m: any) => String(m.order_id) === String(o.id)) ? 90 : 66
              ));
              const dt     = g.time - groups[i - 1].time;
              const logAdd = Math.log(1 + dt / 5) * 10;
              const gap    = Math.min(prevMaxH + 4 + logAdd, MAX_GAP);
              gPos.push(gPos[i - 1] + gap);
            });

            const lastPos = gPos[gPos.length - 1] ?? TOP_PAD;

            // ── Позиция линии «сейчас» ────────────────────────
            // После последней заявки — фиксируем под ней (не уплывает дальше).
            let nowVisualY: number | null = null;
            if (isToday) {
              const afterIdx = groups.findIndex(g => g.time > nowMins);
              if (afterIdx === -1) {
                // Позже всех заявок — фиксируем под последней карточкой
                const lastGroupMaxH = Math.max(...groups[groups.length - 1].orders.map((o: any) =>
                  mixerAssignments.some((m: any) => String(m.order_id) === String(o.id)) ? 90 : 66
                ));
                nowVisualY = lastPos + lastGroupMaxH + 14;
              } else if (afterIdx === 0) {
                // Раньше всех заявок
                nowVisualY = Math.max(0, gPos[0] - Math.min((groups[0].time - nowMins) * 0.5, TOP_PAD));
              } else {
                // Между двумя группами — линейная интерполяция
                const r = (nowMins - groups[afterIdx - 1].time) / (groups[afterIdx].time - groups[afterIdx - 1].time);
                nowVisualY = gPos[afterIdx - 1] + r * (gPos[afterIdx] - gPos[afterIdx - 1]);
              }
            }

            // Высота последней группы карточек (нужна чтобы они не выходили за контейнер)
            const lastGroupMaxH = groups.length > 0
              ? Math.max(...groups[groups.length - 1].orders.map((o: any) =>
                  mixerAssignments.some((m: any) => String(m.order_id) === String(o.id)) ? 90 : 66
                ))
              : 66;

            // totalHeight = позиция последней карточки + её высота + отступ
            // (иначе карточка вылезает за контейнер и перекрывает следующий блок)
            const totalHeight = Math.max(
              lastPos + lastGroupMaxH + 12,
              nowVisualY !== null ? nowVisualY + 24 : 0
            );

            // ── Геометрия колонок ─────────────────────────────
            // dot_center = TIME_W + DOT_GAP + dot_radius
            //            = 30    + 7       + 3.5 = 40.5 ≈ RAIL_X
            // 0–30px : текст времени (right-align)
            // 30–37px: зазор (DOT_GAP = 7px)
            // 37–44px: точка (7px, центр на 40.5 ≈ RAIL_X)
            // 41px   : рельс (проходит через центр точки)
            // 44–52px: зазор
            // 52px+  : карточки
            const TIME_W   = 30; // ширина колонки времени
            const DOT_GAP  = 7;  // зазор текст→точка (left edge точки = TIME_W + DOT_GAP = 37)
            const RAIL_X   = 41; // x рельса ≈ TIME_W + DOT_GAP + dot_radius = 40.5
            const CARD_X   = 52; // x начала карточек (правее правого края точки + отступ)
            const TIME_TOP = 9;  // вертикальный отступ от верха группы до текста

            const nowTimeStr = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

            return (
              <div style={{ position: 'relative', height: `${totalHeight}px`, marginBottom: '20px' }}>

                {/* Вертикальный рельс */}
                <div style={{
                  position: 'absolute',
                  left: `${RAIL_X}px`,
                  top: `${gPos[0] + TIME_TOP + 5}px`,
                  width: '1px',
                  height: `${Math.max(0, lastPos - gPos[0])}px`,
                  background: '#374E65',
                  zIndex: 1,
                }} />

                {/* Метки времени — отдельный слой */}
                {groups.map((group, gi) => {
                  const firstOrder = group.orders[0];
                  const isPast = isToday && firstOrder.status !== 'completed' && firstOrder.status !== 'cancelled' && group.time < nowMins;
                  const hiddenByNow = isToday && nowVisualY !== null && Math.abs(nowVisualY - gPos[gi]) < 8;
                  const timeStr = (firstOrder.delivery_time || '').slice(0, 5) || '—';
                  return (
                    <span key={`lbl${gi}`} style={{
                      position: 'absolute',
                      left: 0, top: `${gPos[gi] + TIME_TOP}px`,
                      width: `${TIME_W}px`, textAlign: 'right',
                      fontSize: '10px', fontWeight: 700, lineHeight: 1,
                      color: isPast ? '#2D3C50' : '#607A93',
                      opacity: hiddenByNow ? 0 : 1,
                      transition: 'opacity 0.2s',
                      userSelect: 'none', pointerEvents: 'none', zIndex: 4,
                    }}>
                      {timeStr}
                    </span>
                  );
                })}

                {/* Карточки заявок */}
                {groups.map((group, gi) => {
                  const top  = gPos[gi];
                  const cols = group.orders.length;
                  return group.orders.map((order, col) => {
                    const color       = STATUS_COLOR[order.status] || '#64748B';
                    const volume      = Number(order.volume || 0);
                    const isPast      = isToday && order.status !== 'completed' && order.status !== 'cancelled' && group.time < nowMins;
                    const isCompleted = order.status === 'completed';
                    const isCancelled = order.status === 'cancelled';
                    const orderMixers = mixerAssignments.filter((m: any) => String(m.order_id) === String(order.id));

                    return (
                      <div
                        key={order.id}
                        style={{
                          position: 'absolute',
                          top: `${top}px`,
                          left: `calc(${CARD_X}px + ${col} * ((100% - ${CARD_X + 4}px) / ${cols}))`,
                          width: `calc((100% - ${CARD_X + 4}px) / ${cols} - 4px)`,
                          zIndex: 2,
                        }}
                      >
                        <div
                          onClick={() => setSelectedOrder(order)}
                          style={{
                            background: '#25334A',
                            borderRadius: '12px',
                            padding: '10px 12px',
                            marginBottom: '4px',
                            cursor: 'pointer',
                            border: `1px solid ${isCancelled ? '#334155' : color + '30'}`,
                            borderLeft: `3px solid ${isCancelled ? '#334155' : color}`,
                            opacity: isPast ? 0.5 : 1,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px', gap: '6px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {order.organization_name || order.full_name || '—'}
                            </span>
                            <span style={{ fontSize: '10px', fontWeight: 700, flexShrink: 0, color: isCancelled ? '#64748B' : color }}>
                              {STATUS_LABEL[order.status] || order.status}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#64748B' }}>
                            <span>#{order.id}</span>
                            <span>·</span>
                            <span style={{ color: isCompleted ? '#10B981' : '#94A3B8', fontWeight: 600 }}>
                              {volume % 1 === 0 ? volume : volume.toFixed(1)} м³
                            </span>
                            {order.grade && <><span>·</span><span>{order.grade}</span></>}
                          </div>

                          {orderMixers.length > 0 && (
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                              {orderMixers.map((mx: any) => {
                                const mc = MIXER_STATUS_COLOR[mx.status] || '#64748B';
                                return (
                                  <span key={mx.id} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                                    padding: '2px 6px', borderRadius: '9999px',
                                    background: `${mc}18`, border: `1px solid ${mc}40`,
                                    fontSize: '10px', fontWeight: 600, color: mc,
                                  }}>
                                    <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: mc, flexShrink: 0 }} />
                                    {mx.mixer_name}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  });
                })}

                {/* Линия «сейчас»:
                    - текст (left: 0, width: TIME_W) точно совпадает с метками заявок
                    - зелёный фон перекрывает метку заявки при наезде
                    - точка сидит на рельсе (x = RAIL_X), линия идёт правее */}
                {isToday && nowVisualY !== null && (
                  /* Одна flex-строка: текст | отступ | точка | линия */
                  <div style={{
                    position: 'absolute',
                    top: `${nowVisualY + TIME_TOP}px`,
                    left: 0, right: 0,
                    display: 'flex', alignItems: 'center',
                    zIndex: 10, pointerEvents: 'none',
                  }}>
                    <span style={{
                      width: `${TIME_W}px`, textAlign: 'right', flexShrink: 0,
                      fontSize: '10px', fontWeight: 800, color: '#10B981',
                      lineHeight: 1,
                      background: '#162032', padding: '0 2px',
                    }}>
                      {nowTimeStr}
                    </span>
                    {/* зазор = DOT_GAP, центр точки попадает точно на RAIL_X */}
                    <div style={{ width: `${DOT_GAP}px`, flexShrink: 0 }} />
                    <div style={{
                      width: '7px', height: '7px', borderRadius: '50%',
                      background: '#10B981', boxShadow: '0 0 6px #10B981',
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, height: '1.5px', background: 'linear-gradient(90deg, #10B981, #10B98140)' }} />
                  </div>
                )}
              </div>
            );
          })()}
        </div>

      {/* ── Миксеры в работе (сегодня) ── */}
      <div
        onClick={() => totalActiveMixers > 0 && setShowMixerSheet(true)}
        style={{
          background: '#25334A',
          borderRadius: '16px',
          border: hasProblems ? '1.5px solid #EF444470' : '1px solid #334155',
          overflow: 'hidden',
          cursor: totalActiveMixers > 0 ? 'pointer' : 'default',
          boxShadow: hasProblems ? '0 0 18px rgba(239,68,68,0.15)' : 'none',
          marginTop: '12px',
        }}
      >
        {/* Красный баннер проблем */}
        {hasProblems && (
          <div style={{
            background: 'rgba(239,68,68,0.12)',
            borderBottom: '1px solid #EF444440',
            padding: '8px 16px',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#EF4444', boxShadow: '0 0 6px #EF4444', animation: 'pulse 1.5s infinite', flexShrink: 0 }} />
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#EF4444' }}>
              Проблема: {problemMixers.map((m: any) => m.number).join(', ')}
            </span>
          </div>
        )}

        <div style={{ padding: '16px' }}>
          {/* Заголовок */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '8px', height: '8px', borderRadius: '50%', background: '#10B981',
                boxShadow: '0 0 6px rgba(16,185,129,0.8)', flexShrink: 0,
                animation: totalActiveMixers > 0 ? 'pulse 2s infinite' : 'none',
              }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#E2E8F0' }}>Миксеры сегодня</span>
              {totalActiveMixers > 0 && (
                <span style={{ padding: '1px 8px', borderRadius: '9999px', fontSize: '12px', fontWeight: 700, background: '#10B98120', color: '#10B981' }}>
                  {totalActiveMixers}
                </span>
              )}
            </div>
            <Link
              href="/mobile/mixers"
              onClick={e => e.stopPropagation()}
              style={{ fontSize: '12px', color: '#60A5FA', textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}
            >
              Все миксеры →
            </Link>
          </div>

          {totalActiveMixers === 0 ? (
            <div style={{ textAlign: 'center', padding: '16px 0', color: '#475569', fontSize: '14px' }}>
              Нет активных рейсов сегодня
            </div>
          ) : (
            <>
              {/* Статусные плашки */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
                {[
                  { label: 'Загрузка',   count: mixerStatusCounts.loading,   color: '#FACC15' },
                  { label: 'В пути',     count: mixerStatusCounts.inTransit, color: '#3B82F6' },
                  { label: 'На объекте', count: mixerStatusCounts.onSite,    color: '#10B981' },
                  { label: 'Проблема',   count: mixerStatusCounts.problem,   color: '#EF4444' },
                ].filter(s => s.count > 0).map(s => (
                  <div key={s.label} style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 12px', borderRadius: '10px',
                    background: `${s.color}12`, border: `1px solid ${s.color}30`,
                  }}>
                    <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: s.color, boxShadow: s.label !== 'Проблема' ? `0 0 5px ${s.color}` : undefined, flexShrink: 0 }} />
                    <span style={{ fontSize: '15px', fontWeight: 700, color: s.color }}>{s.count}</span>
                    <span style={{ fontSize: '13px', color: '#94A3B8' }}>{s.label}</span>
                  </div>
                ))}
              </div>

              {/* Объём в пути + свои/наёмные */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                  <span style={{ fontSize: '28px', fontWeight: 700, color: '#E2E8F0', lineHeight: 1 }}>
                    {volumeInTransit % 1 === 0 ? volumeInTransit : volumeInTransit.toFixed(1)}
                  </span>
                  <span style={{ fontSize: '14px', color: '#64748B' }}>м³ в движении</span>
                </div>
                {(ownActive > 0 || rentedActive > 0) && (
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#64748B', textAlign: 'right' }}>
                    {ownActive > 0 && <span style={{ color: '#10B981' }}>{ownActive} св.</span>}
                    {ownActive > 0 && rentedActive > 0 && <span style={{ color: '#475569' }}> · </span>}
                    {rentedActive > 0 && <span style={{ color: '#FACC15' }}>{rentedActive} наём.</span>}
                  </div>
                )}
              </div>

              {/* Прогресс-бар: объём в движении / плановый объём сегодня */}
              {todayPlannedVolume > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#475569', marginBottom: '6px' }}>
                    <span>Загрузка парка сегодня</span>
                    <span style={{ color: '#94A3B8', fontWeight: 600 }}>
                      {volumeInTransit % 1 === 0 ? volumeInTransit : volumeInTransit.toFixed(1)} / {todayPlannedVolume % 1 === 0 ? todayPlannedVolume : todayPlannedVolume.toFixed(1)} м³
                    </span>
                  </div>
                  <div style={{ height: '8px', borderRadius: '9999px', background: '#334155', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, (volumeInTransit / todayPlannedVolume) * 100)}%`,
                      borderRadius: '9999px',
                      background: 'linear-gradient(90deg, #3B82F6, #10B981)',
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

                  {/* Модалка заказа */}
      {selectedOrder && (
        <MobileDashboardOrderModal
          order={selectedOrder} 
          onClose={() => setSelectedOrder(null)} 
          mixerAssignments={mixerAssignments}
          setMixerAssignments={setMixerAssignments}
          allOrders={allOrders}
          setAllOrders={setAllOrders}
          allMixers={activeMixers}
          currentUser={{ id: userId || 0, name: user?.full_name || '', role: userRole }}
          handleStatusChange={() => {}}
          deleteMixer={() => {}}
          history={[]}
          addToHistory={async () => {}}
          getStatusConfig={() => ({ label: '', color: '', bg: '', final: false })}
          setHistory={() => {}}
          setSelectedOrder={setSelectedOrder}
        />
      )}

      {/* ==================== ШТОРКА: ЗАЯВКИ СЕГОДНЯ ==================== */}
      {showOrdersSheet && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000 }} onClick={() => setShowOrdersSheet(false)} />
          <div style={{ position: 'fixed', bottom: '74px', left: 0, right: 0, zIndex: 10001, background: '#25334A', borderRadius: '20px 20px 0 0', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
              <div style={{ width: '40px', height: '4px', background: '#334155', borderRadius: '9999px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 16px' }}>
              <span style={{ fontSize: '17px', fontWeight: 700, color: '#E2E8F0' }}>Заявки сегодня</span>
              <button onClick={() => setShowOrdersSheet(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} color="#64748B" />
              </button>
            </div>
            <div style={{ padding: '0 20px 28px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Итого */}
              <div style={{ textAlign: 'center', paddingBottom: '12px', borderBottom: '1px solid #334155' }}>
                <span style={{ fontSize: '56px', fontWeight: 700, color: '#60A5FA', lineHeight: 1 }}>{todayOrders.length}</span>
                <div style={{ color: '#64748B', fontSize: '13px', marginTop: '4px' }}>заявок на {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>
              </div>
              {/* Детализация */}
              {[
                { label: 'Новые',     count: kpiNewOrders,       color: '#FACC15', icon: '🟡' },
                { label: 'В работе',  count: kpiInWorkOrders,    color: '#60A5FA', icon: '→'  },
                { label: 'Выполнены', count: kpiCompletedOrders, color: '#10B981', icon: '✓'  },
                { label: 'Отменены',  count: kpiCancelledOrders, color: '#EF4444', icon: '✕'  },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#1E2D40', borderRadius: '12px' }}>
                  <span style={{ color: '#94A3B8', fontSize: '15px' }}>{row.icon} {row.label}</span>
                  <span style={{ fontSize: '22px', fontWeight: 700, color: row.color }}>{row.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ==================== ШТОРКА: ВЫПОЛНЕНИЕ ПЛАНА ==================== */}
      {showPlanSheet && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000 }} onClick={() => setShowPlanSheet(false)} />
          <div style={{ position: 'fixed', bottom: '74px', left: 0, right: 0, zIndex: 10001, background: '#25334A', borderRadius: '20px 20px 0 0', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
              <div style={{ width: '40px', height: '4px', background: '#334155', borderRadius: '9999px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 16px' }}>
              <span style={{ fontSize: '17px', fontWeight: 700, color: '#E2E8F0' }}>Выполнение плана</span>
              <button onClick={() => setShowPlanSheet(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} color="#64748B" />
              </button>
            </div>
            <div style={{ padding: '0 20px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Процент */}
              <div style={{ textAlign: 'center', paddingBottom: '16px', borderBottom: '1px solid #334155' }}>
                <div style={{
                  fontSize: '64px', fontWeight: 700, lineHeight: 1,
                  color: kpiCompletionPct >= 90 ? '#10B981' : kpiCompletionPct >= 60 ? '#FACC15' : '#EF4444',
                }}>{kpiCompletionPct}%</div>
                <div style={{ color: '#64748B', fontSize: '14px', marginTop: '6px' }}>выполнение плана</div>
              </div>
              {/* Объём */}
              {[
                { label: 'Выполнено',    value: `${Math.round(kpiCompletedVolume)} м³`, color: '#10B981' },
                { label: 'Запланировано', value: `${Math.round(kpiPlanToday)} м³`,       color: '#E2E8F0' },
                { label: 'Осталось',     value: `${Math.max(0, Math.round(kpiPlanToday - kpiCompletedVolume))} м³`, color: '#64748B' },
                { label: 'Заявок выполнено', value: `${kpiCompletedOrders} из ${todayOrders.length}`, color: '#60A5FA' },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#1E2D40', borderRadius: '12px' }}>
                  <span style={{ color: '#94A3B8', fontSize: '15px' }}>{row.label}</span>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: row.color }}>{row.value}</span>
                </div>
              ))}
              {/* Прогресс-бар */}
              {kpiPlanToday > 0 && (
                <div>
                  <div style={{ height: '10px', borderRadius: '9999px', background: '#334155', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, kpiCompletionPct)}%`,
                      borderRadius: '9999px',
                      background: kpiCompletionPct >= 90 ? '#10B981' : kpiCompletionPct >= 60 ? '#FACC15' : '#EF4444',
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ==================== ШТОРКА: МИКСЕРЫ В РЕЙСЕ ==================== */}
      {showMixerSheet && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000 }}
            onClick={() => setShowMixerSheet(false)}
          />
          <div style={{
            position: 'fixed', bottom: '74px', left: 0, right: 0, zIndex: 10001,
            background: '#25334A', borderRadius: '20px 20px 0 0',
            maxHeight: 'calc(85vh - 74px)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            {/* Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0', flexShrink: 0 }}>
              <div style={{ width: '40px', height: '4px', background: '#334155', borderRadius: '9999px' }} />
            </div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 10px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10B981', boxShadow: '0 0 6px rgba(16,185,129,0.8)', animation: 'pulse 2s infinite' }} />
                <span style={{ fontSize: '17px', fontWeight: 700, color: '#E2E8F0' }}>В рейсе сегодня</span>
                <span style={{ padding: '1px 8px', borderRadius: '9999px', fontSize: '12px', fontWeight: 700, background: '#10B98120', color: '#10B981' }}>
                  {totalActiveMixers}
                </span>
              </div>
              <button onClick={() => setShowMixerSheet(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} color="#64748B" />
              </button>
            </div>

            {/* List */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(() => {
                const STATUS_ORDER = ['Проблема', 'Загрузка', 'В пути', 'На объекте'];
                const STATUS_COLORS: Record<string, string> = {
                  'В пути': '#3B82F6', 'Загрузка': '#FACC15', 'На объекте': '#10B981', 'Проблема': '#EF4444',
                };
                const sorted = [...uniqueTodayMixers].sort((a: any, b: any) =>
                  (STATUS_ORDER.indexOf(a.status) === -1 ? 99 : STATUS_ORDER.indexOf(a.status)) -
                  (STATUS_ORDER.indexOf(b.status) === -1 ? 99 : STATUS_ORDER.indexOf(b.status))
                );
                return sorted.map((trip: any) => {
                  const color = STATUS_COLORS[trip.status] || '#64748B';
                  const mx = allMixersList.find((m: any) => m.number === trip.number);
                  const isOwn = mx?.type === 'own';
                  const driver = mx?.driver || trip.driver || '—';
                  const ini = driver.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                  return (
                    <div key={trip.number} style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '12px 14px', background: '#1E2D40',
                      borderRadius: '12px', border: `1px solid ${color}40`,
                    }}>
                      {/* Полоска слева */}
                      <div style={{ width: '3px', alignSelf: 'stretch', borderRadius: '9999px', background: color, flexShrink: 0 }} />
                      {/* Аватар */}
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '9999px', flexShrink: 0,
                        background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '13px', fontWeight: 700, color,
                      }}>
                        {ini}
                      </div>
                      {/* Инфо */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                          <span style={{ fontSize: '15px', fontWeight: 700, color: '#E2E8F0' }}>{trip.number}</span>
                          <span style={{
                            fontSize: '11px', fontWeight: 600, padding: '1px 7px', borderRadius: '9999px',
                            background: isOwn ? '#10B98118' : '#FACC1518',
                            color: isOwn ? '#10B981' : '#FACC15',
                          }}>
                            {isOwn ? 'Свой' : 'Наёмный'}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {driver}
                        </div>
                      </div>
                      {/* Статус + объём */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'flex-end', marginBottom: '3px' }}>
                          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, boxShadow: `0 0 4px ${color}` }} />
                          <span style={{ fontSize: '12px', fontWeight: 700, color }}>{trip.status}</span>
                        </div>
                        {trip.volume > 0 && (
                          <span style={{ fontSize: '11px', color: '#64748B' }}>{trip.volume} м³</span>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </>
      )}

      {/* ==================== МОДАЛКА КАЛЕНДАРЯ ==================== */}
      {showCalendar && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 99999, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => setShowCalendar(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', background: '#0D1520', borderRadius: '24px 24px 0 0', paddingBottom: '32px', boxShadow: '0 -8px 40px rgba(0,0,0,0.6)' }}
          >
            {/* Ручка */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '12px', paddingBottom: '4px' }}>
              <div style={{ width: '36px', height: '4px', borderRadius: '2px', background: '#334155' }} />
            </div>

            {/* Шапка */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px 16px' }}>
              <span style={{ fontSize: '18px', fontWeight: 700, color: '#E2E8F0' }}>Планирование</span>
              <button
                onClick={() => setShowCalendar(false)}
                style={{ background: '#334155', border: 'none', borderRadius: '9999px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <X size={16} color="#64748B" />
              </button>
            </div>

            <MobileCalendar
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              allOrders={allOrders}
              onClose={() => setShowCalendar(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}