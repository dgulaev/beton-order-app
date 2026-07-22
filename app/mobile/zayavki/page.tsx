'use client';

import React, { useState, useEffect } from 'react';
import MobileNewOrderModal from '../components/MobileNewOrderModal';
import MobileOrderDetailModal from '../components/MobileOrderDetailModal';
import MobileExitButton from '../components/MobileExitButton';
import { Plus, MapPin, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { useUserRole } from '../../providers/UserRoleProvider';

export default function MobileZayavkiPage() {
const { user } = useUserRole();   // ← Берём роль из провайдера

  // ==================== 1. СТАТУСЫ ====================
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [newOrderInitialData, setNewOrderInitialData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedYearNum, selectedMonthNum]);

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
    if (!confirm('Удалить заявку? Действие необратимо.')) return;

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
      <div style={{ padding: '16px', paddingBottom: '100px', minHeight: '100vh', background: '#162032' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ fontSize: '26px', fontWeight: '700', margin: 0 }}>Заявки</h1>
          <MobileExitButton />
        </div>

        {/* FAB — создать заявку */}
        {!showNewOrderModal && !selectedOrder && (
          <button
            onClick={() => setShowNewOrderModal(true)}
            style={{
              position: 'fixed',
              bottom: '90px',
              right: '20px',
              zIndex: 9000,
              width: '42px',
              height: '42px',
              borderRadius: '9999px',
              background: 'rgba(16,185,129,0.35)',
              border: '1.5px solid rgba(16,185,129,0.55)',
              backdropFilter: 'blur(6px)',
              boxShadow: '0 2px 12px rgba(16,185,129,0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Новая заявка"
          >
            <Plus size={20} color="#10B981" strokeWidth={2.5} />
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
  <div style={{ 
    flex: 1, 
    background: '#334155', 
    borderRadius: '16px', 
    padding: '16px 18px' 
  }}>
    <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '6px' }}>Выполнение</div>
    <div style={{ fontSize: '26px', fontWeight: '700', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
      {Math.round(completedVolume)} 
      <span style={{ opacity: 0.5, fontSize: '20px' }}>
        / {Math.round(totalVolume)} м³
      </span>
    </div>
  </div>

  {/* Цемент */}
  <div style={{ 
    flex: 1, 
    background: '#334155', 
    borderRadius: '16px', 
    padding: '16px 18px' 
  }}>
    <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '6px' }}>Цемент</div>
    <div style={{ fontSize: '26px', fontWeight: '700', color: '#60A5FA', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
      {calculateCementNeeded(true)} 
      <span style={{ opacity: 0.5, fontSize: '20px' }}>
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
            <div style={{
              background: '#25334A',
              borderRadius: '18px',
              padding: '14px 16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              {/* Стрелка влево */}
              <button
                onClick={() => navBtn('prev')}
                style={{ background: '#334155', border: 'none', borderRadius: '10px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
              >
                <ChevronLeft size={18} color="#64748B" />
              </button>

              {/* Центр: иконка + дата + пилюля */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <CalendarDays size={18} color={isToday ? '#10B981' : '#475569'} style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#E2E8F0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {dayName}, {dayNum} {monthName} {year !== today.getFullYear() ? year : ''}
                  </div>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '1px' }}>
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
                  style={{ background: 'transparent', border: '1px solid #334155', borderRadius: '8px', padding: '5px 10px', color: '#64748B', fontSize: '12px', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
                >
                  Сегодня
                </button>
              )}
              {isToday && (
                <span style={{ background: '#10B98118', border: '1px solid #10B98140', borderRadius: '8px', padding: '5px 10px', color: '#10B981', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>
                  Сегодня
                </span>
              )}

              {/* Стрелка вправо */}
              <button
                onClick={() => navBtn('next')}
                style={{ background: '#334155', border: 'none', borderRadius: '10px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
              >
                <ChevronRight size={18} color="#64748B" />
              </button>
            </div>
          );
        })()}

        {/* ==================== СПИСОК ЗАЯВОК ==================== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#64748B' }}>Загрузка...</div>
          ) : filteredOrders.length > 0 ? (
            filteredOrders.map((order: any) => (
              <div
                key={order.id}
                onClick={() => setSelectedOrder(order)}
                style={{
                  background: '#25334A',
                  borderRadius: '16px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontWeight: '700', fontSize: '18px' }}>
                    #{order.id} — {order.delivery_time || '—'}
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
                    <div style={{ 
                      padding: '6px 14px', 
                      borderRadius: '9999px', 
                      background: getStatusColor(order.status) + '20', 
                      color: getStatusColor(order.status),
                      fontSize: '14px',
                      fontWeight: '600'
                    }}>
                      {order.status === 'new' && 'Новый'}
                      {order.status === 'processing' && 'В работе'}
                      {order.status === 'completed' && 'Выполнен'}
                      {order.status === 'cancelled' && 'Отменён'}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: '16px', fontWeight: '600' }}>
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
            <div style={{ textAlign: 'center', padding: '80px 20px', color: '#64748B' }}>
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