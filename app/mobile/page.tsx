'use client';

import React, { useState, useEffect, useMemo } from 'react';
import MobileDashboardOrderModal from './components/MobileDashboardOrderModal';
import MobileCalendar from './components/MobileCalendar';
import MobileExitButton from './components/MobileExitButton';

// 🔥 Подключаем хуки авторизации и real-time
import { useUserRole } from '../providers/UserRoleProvider';
import { useRealtimeOrders } from '@/hooks/useRealtimeOrders';

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
  const [mixerAssignments, setMixerAssignments] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showCalendar, setShowCalendar] = useState(false);

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

 // ==================== 5. ЗАГРУЗКА ДАННЫХ (REAL-TIME + FETCH) ====================

  const selectedYearNum = selectedDate.getFullYear();
  const selectedMonthNum = selectedDate.getMonth() + 1; // 1-12, как ждёт API

  // 🔥 Границы месяца — используются и для fetch, и для realtime-фильтра,
  // чтобы оба источника данных всегда были синхронизированы по диапазону.
  const monthStart = `${selectedYearNum}-${String(selectedMonthNum).padStart(2, '0')}-01`;
  const daysInMonth = new Date(selectedYearNum, selectedMonthNum, 0).getDate();
  const monthEnd = `${selectedYearNum}-${String(selectedMonthNum).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  // Realtime поддерживает несколько условий через запятую (AND), поэтому можно
  // ограничить канал тем же месяцем, что и в /api/adminCifra/orders
  const deliveryDateFilter = `delivery_date=gte.${monthStart},delivery_date=lte.${monthEnd}`;

  // 🔥 Подписка на все изменения в таблице ORDERS.
  // Хук возвращает только { status } — сам список заказов приходит через setAllOrders,
  // поэтому деструктурировать orders/loading отсюда было ошибкой (их там никогда не было).
  const { status: ordersRealtimeStatus } = useRealtimeOrders(
    setAllOrders,
    {
      filter: deliveryDateFilter,
      enabled: Boolean(userId)
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
        if (!cancelled) setOrdersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedYearNum, selectedMonthNum, userId]);

// 🔥 Active Mixers и Assignments — единоразовая загрузка
// Поллинг убран, так как real-time уже обеспечивает обновления
useEffect(() => {
  const dateStr = selectedDate.toISOString().split('T')[0];

  const fetchActiveMixers = async () => {
    const res = await fetch(`/api/adminCifra/active-mixers?date=${dateStr}`);
    if (!res.ok) {
      console.error('Active mixers error:', res.status);
      return [];
    }
    return res.json();
  };

  const fetchAssignments = async () => {
    const res = await fetch('/api/adminCifra/order-mixers');
    if (!res.ok) {
      console.error('Assignments error:', res.status);
      return [];
    }
    return res.json();
  };

  // 🔥 Защита от race-condition: ждём завершения обоих запросов
  Promise.all([fetchActiveMixers(), fetchAssignments()])
    .then(([mixers, assignments]) => {
      setActiveMixers(mixers);
      setMixerAssignments(assignments);
    })
    .catch((err) => {
      console.error('Initial data fetch failed:', err);
      // 🔥 Можно показать баннер "Нет связи с сервером"
    });

  // 🔥 Больше никакого setInterval — real-time сам подтянет изменения
}, [selectedDate]);


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

  // ==================== 7. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
  const completeLogistics = (order: any) => {
    alert(`Логистика по заявке #${order.id} завершена`); // временно
    setSelectedOrder(null);
  };
  // ==============================================
  // return (продолжение файла)
  // ==============================================

  return (
    <div style={{
        backgroundColor: '#0F172A',
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
            background: #0F172A !important;
          }
          #dashboard-scroll::-webkit-scrollbar-thumb {
            background: #0F172A !important;   /* тот же цвет что и фон */
            border-radius: 10px !important;
          }
          #dashboard-scroll::-webkit-scrollbar-track {
            background: #0F172A !important;
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
        <h1 style={{ 
          fontSize: '28px', 
          fontWeight: '700', 
          margin: 0,
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          Дашборд
          <span
            title={
              ordersRealtimeStatus === 'SUBSCRIBED'
                ? 'Реалтайм подключен'
                : ordersRealtimeStatus === 'ERROR'
                ? 'Нет связи, переподключение...'
                : 'Подключение...'
            }
            style={{
              width: '9px',
              height: '9px',
              borderRadius: '50%',
              display: 'inline-block',
              background:
                ordersRealtimeStatus === 'SUBSCRIBED'
                  ? '#10B981'
                  : ordersRealtimeStatus === 'ERROR'
                  ? '#EF4444'
                  : '#FACC15'
            }}
          />
        </h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => setShowCalendar(true)}
            style={{
              background: '#1E2937',
              color: '#60A5FA',
              border: '1px solid #334155',
              borderRadius: '12px',
              padding: '8px 16px',
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
            }}
          >
            📅 {selectedDate.toLocaleDateString('ru-RU', { 
              weekday: 'short', 
              day: '2-digit', 
              month: 'short' 
            })}
          </button>
          <MobileExitButton />
        </div>
      </div>

        {/* KPI */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: '12px',
          marginBottom: '28px'
        }}>
          <div style={{ background: '#25334A', borderRadius: '16px', padding: '18px', textAlign: 'center' }}>
            <div style={{ color: '#94A3B8', fontSize: '14px' }}>Заявки сегодня</div>
            <div style={{ fontSize: '48px', fontWeight: '700', color: '#60A5FA' }}>
              {todayOrders.length}
            </div>
          </div>

          <div style={{ background: '#25334A', borderRadius: '16px', padding: '18px', textAlign: 'center' }}>
            <div style={{ color: '#94A3B8', fontSize: '14px' }}>Выполнение</div>
            <div style={{ fontSize: '48px', fontWeight: '700', color: '#10B981' }}>
              {Math.round(todayOrders.filter((o: any) => o.status === 'completed').length / (todayOrders.length || 1) * 100)}%
            </div>
          </div>
        </div>

               {/* Таймлайн с переключением дней */}
        <div style={{ marginBottom: '30px' }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '16px',
            marginBottom: '18px'
          }}>
            <button 
              onClick={() => {
                const prevDay = new Date(selectedDate);
                prevDay.setDate(prevDay.getDate() - 1);
                setSelectedDate(prevDay);
              }}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '32px',
                color: '#94A3B8',
                padding: '4px 14px',
                cursor: 'pointer',
                lineHeight: 1
              }}
            >
              ←
            </button>

            <div style={{ textAlign: 'center' }}>
              <div style={{ 
                fontSize: '19px', 
                fontWeight: '700', 
                color: '#ffffff',
                marginBottom: '4px'
              }}>
                График отгрузок
              </div>
              <div style={{ 
                fontSize: '15.5px', 
                color: '#60A5FA',
                fontWeight: '500'
              }}>
                {selectedDate.toLocaleDateString('ru-RU', { 
                  weekday: 'long', 
                  day: '2-digit', 
                  month: 'long' 
                })}
              </div>
            </div>

            <button 
              onClick={() => {
                const nextDay = new Date(selectedDate);
                nextDay.setDate(nextDay.getDate() + 1);
                setSelectedDate(nextDay);
              }}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '32px',
                color: '#94A3B8',
                padding: '4px 14px',
                cursor: 'pointer',
                lineHeight: 1
              }}
            >
              →
            </button>
          </div>

                    {/* Фильтрация заказов на выбранный день */}
          {todayOrders.length > 0 ? todayOrders.map((order: any) => {
            const time = order.delivery_time || '—';
            const volume = Number(order.volume || 0);

            const getOrderIcon = (status: string) => {
              switch (status) {
                case 'cancelled':
                  return { icon: '✕', color: '#EF4444' };
                case 'completed':
                  return { icon: '✓', color: '#10B981' };
                case 'processing':
                  return { icon: '→', color: '#3B82F6' };
                default: // new
                  return { icon: '→', color: '#FACC15' };
              }
            };

            const iconStyle = getOrderIcon(order.status);

            return (
              <div 
                key={order.id}
                onClick={() => setSelectedOrder(order)}
                style={{
                  background: '#25334A',
                  padding: '14px 16px',
                  borderRadius: '12px',
                  marginBottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                  color: '#ffffff',
                  opacity: order.status === 'cancelled' ? 0.9 : 1
                }}
              >
                <div style={{ fontWeight: '700', minWidth: '68px', fontSize: '15.5px' }}>
                  {time}
                </div>

                <div style={{ flex: 1, lineHeight: '1.25' }}>
                  <div>#{order.id} — {order.organization_name || order.full_name || '—'}</div>
                  <div style={{ fontSize: '13.5px', color: '#94A3B8' }}>
                    {volume.toFixed(1)} м³ • {order.grade || '—'}
                  </div>
                </div>

                <div style={{ 
                  color: iconStyle.color, 
                  fontSize: '20px', 
                  fontWeight: 'bold',
                  minWidth: '28px',
                  textAlign: 'center'
                }}>
                  {iconStyle.icon}
                </div>
              </div>
            );
          }) : (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>
              На выбранный день заказов нет
            </div>
          )}
        </div>

     {/* Миксеры в работе */}
        <div style={{ 
          background: '#1E2937', 
          padding: '24px 16px', 
          borderRadius: '16px',
          color: '#ffffff'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '19px', color: '#ffffff' }}>
              Миксеры в работе
            </h2>
            <div style={{ 
              background: '#334155', 
              color: '#60A5FA', 
              padding: '6px 14px', 
              borderRadius: '9999px',
              fontSize: '14px',
              fontWeight: '600'
            }}>
              {activeMixersForDate.length} на линии
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', gap: '20px' }}>
            
            <div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#FBBF24' }}>
                {activeMixersForDate.filter(m => 
                  !m.status || 
                  String(m.status).toLowerCase().includes('load') || 
                  String(m.status).toLowerCase().includes('загр')
                ).length}
              </div>
              <div style={{ fontSize: '14px', color: '#94A3B8' }}>Загрузка</div>
            </div>

            <div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#60A5FA' }}>
                {activeMixersForDate.filter(m => 
                  !m.status || 
                  String(m.status).toLowerCase().includes('way') || 
                  String(m.status).toLowerCase().includes('пут')
                ).length}
              </div>
              <div style={{ fontSize: '14px', color: '#94A3B8' }}>В пути</div>
            </div>
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
          currentUser={{ id: 0, name: '', role: '' }}
          handleStatusChange={() => {}}
          deleteMixer={() => {}}
          completeLogistics={completeLogistics || (() => {})}
          history={[]}
          addToHistory={async () => {}}
          getStatusConfig={() => ({ label: '', color: '', bg: '', final: false })}
          setHistory={() => {}}
          setSelectedOrder={setSelectedOrder}
        />
      )}

      {/* ==================== УЛУЧШЕННАЯ МОДАЛКА КАЛЕНДАРЯ ==================== */}
      {showCalendar && (
        <div 
          style={{ 
            position: 'fixed', 
            inset: 0, 
            background: 'rgba(0,0,0,0.94)', 
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }} 
          onClick={() => setShowCalendar(false)}
        >
          <div 
            onClick={e => e.stopPropagation()} 
            style={{ 
              width: '94%', 
              maxWidth: '420px',
              background: '#1E2937',
              borderRadius: '20px',
              padding: '20px 16px',
              boxShadow: '0 20px 50px rgba(0,0,0,0.7)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: '#ffffff', fontSize: '21px', fontWeight: '700' }}>Планирование</h3>
              <button 
                onClick={() => setShowCalendar(false)}
                style={{ background: 'none', border: 'none', fontSize: '30px', color: '#94A3B8', lineHeight: 1 }}
              >
                ✕
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