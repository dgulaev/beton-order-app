'use client';

import React, { useState, useEffect } from 'react';
import MobileLayout from '@/app/mobile/layout';
import MobileDashboardOrderModal from './components/MobileDashboardOrderModal';
import MobileCalendar from './components/MobileCalendar';


export default function MobileDashboard() {
  // ==================== 1. СТАТУСЫ И СОСТОЯНИЯ ====================
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

  // ==================== 3. КОРРЕКЦИЯ TIMEZONE ====================
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


  // ==================== 5. ЗАГРУЗКА ДАННЫХ ====================
  useEffect(() => {
    const dateStr = selectedDate.toISOString().split('T')[0];

    fetch('/api/adminCifra/all-orders')
      .then(r => r.json())
      .then(data => setAllOrders(data))
      .catch(console.error);

    fetch(`/api/adminCifra/active-mixers?date=${dateStr}`)
      .then(r => r.json())
      .then(data => setActiveMixers(data || []))
      .catch(console.error);

    fetch('/api/adminCifra/order-mixers')
      .then(r => r.json())
      .then(data => setMixerAssignments(data))
      .catch(console.error);
  }, [selectedDate]);

  // ==================== 6. РАСЧЁТЫ И ФИЛЬТРЫ ====================
  const selectedYear = selectedDate.getFullYear();
  const selectedMonth = String(selectedDate.getMonth() + 1).padStart(2, '0');
  const selectedDay = String(selectedDate.getDate()).padStart(2, '0');
  const selectedDateStr = `${selectedYear}-${selectedMonth}-${selectedDay}`;

  // Фильтрация заказов на выбранный день (для таймлайна)
  const todayOrders = allOrders
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

  // Фильтрация активных миксеров
  const activeMixersForDate = activeMixers.filter(m => {
    if (!m.delivery_date && !m.order_delivery_date) return true;
    const mixerDate = (m.delivery_date || m.order_delivery_date || '').substring(0, 10);
    return mixerDate === selectedDateStr;
  });

  // ==================== 7. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
  const completeLogistics = (order: any) => {
    alert(`Логистика по заявке #${order.id} завершена`); // временно
    setSelectedOrder(null);
  };

  // ==============================================
  // return (продолжение файла)
  // ==============================================

  return (
    <MobileLayout>
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
          color: '#ffffff'
        }}>
          Дашборд
        </h1>

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

            // ==================== СТИЛЬ ТОЛЬКО ДЛЯ ИКОНКИ ====================
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
                  background: '#25334A',        // ← единый фон для всех
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
        



       {/* Закрывающий диф контейнера */}
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
          allMixers={[]}
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

      {/* ==================== УЛУЧШЕННАЯ МОДАЛКА КАЛЕНДАРЯ (без изменения Calendar.tsx) ==================== */}
      {/* Кнопка открытия календаря */}
      <div style={{ textAlign: 'center', margin: '20px 0 28px 0' }}>
      </div>

      {/* Модалка календаря */}
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
    </MobileLayout>
  );
}