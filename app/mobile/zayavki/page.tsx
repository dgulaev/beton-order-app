'use client';

import React, { useState, useEffect } from 'react';
import MobileNewOrderModal from '../components/MobileNewOrderModal';
import MobileOrderDetailModal from '../components/MobileOrderDetailModal';
import MobileExitButton from '../components/MobileExitButton';
import { Plus, MapPin, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { useUserRole } from '../../providers/UserRoleProvider';
import { useRealtimeOrders } from '@/hooks/useRealtimeOrders';
import { useWakeRefresh } from '@/hooks/useWakeReload';
import { CARD_BORDER, volumeCardSoftStyle, volumeCardStyle } from '@/app/adminCifra/cardStyles';
import { appConfirm } from '@/app/adminCifra/components/appDialog';

export default function MobileZayavkiPage() {
const { user } = useUserRole();   // ← Берём роль из провайдера

  // ==================== 1. СТАТУСЫ ====================
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [newOrderInitialData, setNewOrderInitialData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [initialOrdersLoaded, setInitialOrdersLoaded] = useState(false);

  // ==================== 2. ДАТА ====================
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });


    // ==================== 3. РЕЦЕПТЫ + КЛИЕНТЫ + РОЛЬ ====================
  const [recipes, setRecipes] = useState<any[]>([]);
  const [allClients, setAllClients] = useState<any[]>([]);

  // Роль и имя берём из UserRoleProvider
  const currentRole = user?.role || 'admin';
  const userFullName = user?.full_name || user?.username || 'Сотрудник';

  // ==================== 4. ЗАГРУЗКА ДАННЫХ ====================
  // Рецепты грузим один раз — справочник маленький и не меняется от даты.
  useEffect(() => {
    fetch('/api/adminCifra/recipes')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setRecipes(data))
      .catch((err) => console.error('Ошибка загрузки рецептов:', err));
  }, []);

  useEffect(() => {
    const userId = localStorage.getItem('userId');
    fetch('/api/adminCifra/clients', {
      headers: userId ? { 'x-user-id': userId } : {},
    })
      .then(r => r.ok ? r.json() : [])
      .then(data => setAllClients(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Заявки — грузим только за МЕСЯЦ выбранной даты (как на дашборде), а не
  // все заявки за всё время (раньше /api/adminCifra/all-orders отдавал
  // сотни КБ и рос с каждым днём — именно это было одной из причин
  // подвисаний мобильной версии). Перезагружаем при переходе в другой месяц.
  const selectedYearNum = selectedDate.getFullYear();
  const selectedMonthNum = selectedDate.getMonth() + 1;
  const monthStart = `${selectedYearNum}-${String(selectedMonthNum).padStart(2, '0')}-01`;
  const daysInMonth = new Date(selectedYearNum, selectedMonthNum, 0).getDate();
  const monthEnd = `${selectedYearNum}-${String(selectedMonthNum).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/adminCifra/orders?year=${selectedYearNum}&month=${selectedMonthNum}`, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`Orders fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setAllOrders(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        console.error('Ошибка загрузки заявок:', err);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setInitialOrdersLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedYearNum, selectedMonthNum]);

  // Live-обновление списка заявок (как на десктопе /adminCifra/zayavki)
  useRealtimeOrders(setAllOrders, {
    clientFilter: (o: any) => {
      const d = String(o.delivery_date || '').slice(0, 10);
      return d >= monthStart && d <= monthEnd;
    },
    enabled: initialOrdersLoaded,
  });

  useWakeRefresh(() => {
    fetch(`/api/adminCifra/orders?year=${selectedYearNum}&month=${selectedMonthNum}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (Array.isArray(data)) setAllOrders(data); })
      .catch(() => {});
  });

  // Синхронизация открытой модалки с realtime-обновлениями allOrders
  useEffect(() => {
    if (!selectedOrder?.id) return;
    const fresh = allOrders.find((o) => String(o.id) === String(selectedOrder.id));
    if (
      fresh &&
      (fresh.status !== selectedOrder.status ||
        fresh.logistics_ready !== selectedOrder.logistics_ready ||
        !!fresh.is_questionable !== !!selectedOrder.is_questionable)
    ) {
      setSelectedOrder((prev: any) => (prev ? { ...prev, ...fresh } : prev));
    }
    if (!fresh && allOrders.length > 0) {
      setSelectedOrder(null);
    }
  }, [allOrders, selectedOrder?.id]);

  // ==================== 5. ФИЛЬТР ЗАКАЗОВ НА ВЫБРАННЫЙ ДЕНЬ ====================
  const selectedYear = selectedDate.getFullYear();
  const selectedMonth = String(selectedDate.getMonth() + 1).padStart(2, '0');
  const selectedDay = String(selectedDate.getDate()).padStart(2, '0');
  const selectedDateStr = `${selectedYear}-${selectedMonth}-${selectedDay}`;

  const dayOrders = allOrders
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

  // Фильтра по статусу в UI пока нет (см. рекомендации) — список за день без изменений.
  const filteredOrders = dayOrders;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'new': return '#FACC15';
      case 'processing': return '#3B82F6';
      case 'completed': return '#10B981';
      case 'cancelled': return '#EF4444';
      default: return '#94A3B8';
    }
  };

    // ==================== KPI (с исключением отменённых заявок) ====================
  const activeOrders = dayOrders.filter((o: any) => o.status !== 'cancelled');

  const totalVolume = activeOrders.reduce((sum: number, o: any) => 
    sum + (Number(o.volume) || 0), 0);

  const completedVolume = activeOrders
    .filter((o: any) => o.status === 'completed')
    .reduce((sum: number, o: any) => sum + (Number(o.volume) || 0), 0);

  // ==================== РАСЧЁТ ЦЕМЕНТА (только активные + выполненные) ====================
  const calculateCementNeeded = (onlyCompleted: boolean = false) => {
    let orders = dayOrders.filter((o: any) => o.status !== 'cancelled');
    
    if (onlyCompleted) {
      orders = orders.filter((o: any) => o.status === 'completed');
    }

    let totalKg = 0;

    orders.forEach((order: any) => {
      const grade = String(order.grade || '').trim();
      const volume = Number(order.volume || 0);
      if (volume <= 0 || !grade) return;

      let recipe = recipes.find((r: any) => r.code === grade);
      if (!recipe) recipe = recipes.find((r: any) => r.code === grade.replace(/и$/, ''));
      if (!recipe) recipe = recipes.find((r: any) => grade.includes(r.code));

      if (recipe && recipe.cement) {
        totalKg += volume * Number(recipe.cement);
      }
    });

    return (totalKg / 1000).toFixed(1);
  };

  // ==================== ОБРАБОТЧИКИ ====================
  const handleOrderUpdate = (updatedOrder: any) => {
    setAllOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
    setSelectedOrder(updatedOrder);
  };

  const handleDeleteOrder = async (orderId: number) => {
    if (!(await appConfirm('Удалить заявку? Действие необратимо.', {
      title: 'Удаление заявки',
      okLabel: 'Удалить',
      cancelLabel: 'Отмена',
      variant: 'danger',
    }))) return;

    try {
      const res = await fetch(`/api/adminCifra/orders/${orderId}`, { method: 'DELETE' });
      if (res.ok) {
        setAllOrders(prev => prev.filter(o => o.id !== orderId));
        setSelectedOrder(null);
        alert('✅ Заявка успешно удалена');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения');
    }
  };

  const handleCopyToNewOrder = (copiedData: any) => {
    setNewOrderInitialData(null);
    setTimeout(() => {
      setNewOrderInitialData(copiedData);
      setShowNewOrderModal(true);
    }, 100);
  };

  const handleNewOrderSubmit = (newOrder?: any) => {
    if (newOrder) {
      setAllOrders(prev => {
        if (prev.some(o => String(o.id) === String(newOrder.id))) return prev;
        return [newOrder, ...prev];
      });
    }
    setShowNewOrderModal(false);
    setNewOrderInitialData(null);
  };

  return (
    <>
      <div style={{ padding: '16px', paddingBottom: '100px', minHeight: '100vh', background: '#0F172A', color: '#fff' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ fontSize: '26px', fontWeight: 700, margin: 0, color: '#F1F5F9' }}>Заявки</h1>
          <MobileExitButton />
        </div>

        {/* FAB — создать заявку */}
        {!showNewOrderModal && !selectedOrder && (
          <button
            onClick={() => setShowNewOrderModal(true)}
            style={volumeCardSoftStyle({
              position: 'fixed',
              bottom: '90px',
              right: '20px',
              zIndex: 9000,
              width: 48,
              height: 48,
              borderRadius: 9999,
              background: 'linear-gradient(165deg, #10B981 0%, #059669 100%)',
              border: '1px solid rgba(110,231,183,0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
            })}
            aria-label="Новая заявка"
          >
            <Plus size={22} color="#fff" strokeWidth={2.5} />
          </button>
        )}

       {/* ==================== KPI КАРТОЧКИ ==================== */}
<div style={{ 
  display: 'flex', 
  gap: '12px', 
  marginBottom: '24px',
  flexWrap: 'wrap'
}}>
  {/* Выполнение (Бетон) */}
  <div style={volumeCardStyle({ 
    flex: 1, 
    borderRadius: 16, 
    padding: '16px 18px',
    minWidth: 0,
  })}>
    <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '6px', fontWeight: 600, letterSpacing: '0.02em' }}>Выполнение</div>
    <div style={{ fontSize: '26px', fontWeight: 700, display: 'flex', alignItems: 'baseline', gap: '6px', color: '#E2E8F0' }}>
      {Math.round(completedVolume)} 
      <span style={{ color: '#94A3B8', fontSize: '16px', fontWeight: 600 }}>
        / {Math.round(totalVolume)} м³
      </span>
    </div>
  </div>

  {/* Цемент */}
  <div style={volumeCardStyle({ 
    flex: 1, 
    borderRadius: 16, 
    padding: '16px 18px',
    minWidth: 0,
  })}>
    <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '6px', fontWeight: 600, letterSpacing: '0.02em' }}>Цемент</div>
    <div style={{ fontSize: '26px', fontWeight: 700, color: '#60A5FA', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
      {calculateCementNeeded(true)} 
      <span style={{ color: '#94A3B8', fontSize: '16px', fontWeight: 600 }}>
        / {calculateCementNeeded(false)} т.
      </span>
    </div>
  </div>
</div>

        {/* ==================== НАВИГАЦИЯ ПО ДАТАМ ==================== */}
        {(() => {
          const today = new Date();
          const isToday =
            selectedDate.getFullYear() === today.getFullYear() &&
            selectedDate.getMonth() === today.getMonth() &&
            selectedDate.getDate() === today.getDate();

          const dayName = selectedDate.toLocaleDateString('ru-RU', { weekday: 'short' });
          const dayNum = selectedDate.getDate();
          const monthName = selectedDate.toLocaleDateString('ru-RU', { month: 'long' });
          const year = selectedDate.getFullYear();

          const navBtn = (dir: 'prev' | 'next') => {
            const d = new Date(selectedDate);
            d.setDate(d.getDate() + (dir === 'next' ? 1 : -1));
            setSelectedDate(d);
          };

          return (
            <div style={volumeCardStyle({
              borderRadius: 18,
              padding: '14px 16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            })}>
              {/* Стрелка влево */}
              <button
                onClick={() => navBtn('prev')}
                style={volumeCardSoftStyle({
                  borderRadius: 10,
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                  padding: 0,
                })}
              >
                <ChevronLeft size={18} color="#94A3B8" />
              </button>

              {/* Центр: иконка + дата + пилюля */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <CalendarDays size={18} color={isToday ? '#4ADE80' : '#64748B'} style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#E2E8F0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {dayName}, {dayNum} {monthName} {year !== today.getFullYear() ? year : ''}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748B', marginTop: '1px' }}>
                    {filteredOrders.length > 0
                      ? `${filteredOrders.length} заявок · ${totalVolume.toFixed(1)} м³`
                      : 'Нет заявок'}
                  </div>
                </div>
              </div>

              {/* Кнопка «Сегодня» */}
              {!isToday && (
                <button
                  onClick={() => setSelectedDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()))}
                  style={volumeCardSoftStyle({
                    borderRadius: 8,
                    padding: '5px 10px',
                    color: '#94A3B8',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    flexShrink: 0,
                  })}
                >
                  Сегодня
                </button>
              )}
              {isToday && (
                <span style={volumeCardSoftStyle({
                  borderRadius: 8,
                  padding: '5px 10px',
                  color: '#4ADE80',
                  fontSize: '12px',
                  fontWeight: 600,
                  flexShrink: 0,
                  border: '1px solid rgba(74,222,128,0.4)',
                })}>
                  Сегодня
                </span>
              )}

              {/* Стрелка вправо */}
              <button
                onClick={() => navBtn('next')}
                style={volumeCardSoftStyle({
                  borderRadius: 10,
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                  padding: 0,
                })}
              >
                <ChevronRight size={18} color="#94A3B8" />
              </button>
            </div>
          );
        })()}

        {/* ==================== СПИСОК ЗАЯВОК ==================== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {loading ? (
            <div style={volumeCardSoftStyle({ textAlign: 'center', padding: '48px 20px', color: '#64748B', borderRadius: 16 })}>
              Загрузка...
            </div>
          ) : filteredOrders.length > 0 ? (
            filteredOrders.map((order: any) => (
              <div
                key={order.id}
                onClick={() => setSelectedOrder(order)}
                style={volumeCardSoftStyle({
                  borderRadius: 16,
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  cursor: 'pointer',
                  border: CARD_BORDER,
                })}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontWeight: 700, fontSize: '18px', color: '#F1F5F9' }}>
                    #{order.id} — {order.delivery_time ? String(order.delivery_time).slice(0, 5) : '—'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    {order.is_questionable && (
                      <span
                        title="Под вопросом"
                        style={{
                          height: '22px', padding: '0 8px', borderRadius: '9999px',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          background: '#EF4444', color: '#fff',
                          fontSize: '12px', fontWeight: 800,
                          boxShadow: '0 0 0 1px rgba(255,255,255,0.25), 0 0 8px rgba(239,68,68,0.45)',
                        }}
                      >
                        ?
                      </span>
                    )}
                    <div style={volumeCardSoftStyle({ 
                      padding: '6px 14px', 
                      borderRadius: 9999, 
                      background: getStatusColor(order.status) + '22', 
                      border: `1px solid ${getStatusColor(order.status)}55`,
                      color: getStatusColor(order.status),
                      fontSize: '13px',
                      fontWeight: 700,
                      boxShadow: 'none',
                    })}>
                      {order.status === 'new' && 'Новый'}
                      {order.status === 'processing' && 'В работе'}
                      {order.status === 'completed' && 'Выполнен'}
                      {order.status === 'cancelled' && 'Отменён'}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: '16px', fontWeight: 600, color: '#E2E8F0' }}>
                  {order.organization_name || order.full_name || '—'}
                </div>

                <div style={{ display: 'flex', gap: '12px', fontSize: '15px', color: '#94A3B8' }}>
                  <div>{order.grade}</div>
                  <div>{Number(order.volume || 0).toFixed(1)} м³</div>
                </div>

                <div style={{ color: '#94A3B8', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <MapPin size={16} />
                  {(order.address?.length || 0) > 45 ? `${order.address.substring(0, 45)}...` : (order.address || '—')}
                </div>
              </div>
            ))
          ) : (
            <div style={volumeCardSoftStyle({
              textAlign: 'center',
              padding: '56px 20px',
              color: '#64748B',
              borderRadius: 16,
            })}>
              Заявок на этот день нет
            </div>
          )}
        </div>
      </div>

      {/* МОДАЛКИ */}
      <MobileNewOrderModal
        key={showNewOrderModal ? 'new-order-modal-open' : 'closed'}
        isOpen={showNewOrderModal}
        onClose={() => {
          setShowNewOrderModal(false);
          setNewOrderInitialData(null);
        }}
        onSuccess={handleNewOrderSubmit}
        initialData={newOrderInitialData || {}}
        defaultDeliveryDate={selectedDateStr}
        currentRole={currentRole}
        currentUserName={userFullName}
      />

      <MobileOrderDetailModal
        isOpen={!!selectedOrder}
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onUpdate={handleOrderUpdate}
        onDelete={handleDeleteOrder}
        onCopyOrder={handleCopyToNewOrder}
        currentRole={currentRole}
        currentUserName={userFullName}
        recipes={recipes}
        clients={allClients}
      />
    </>
  );
}