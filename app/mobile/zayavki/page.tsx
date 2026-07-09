'use client';

import React, { useState, useEffect } from 'react';
import MobileLayout from '@/app/mobile/layout';
import MobileNewOrderModal from '../components/MobileNewOrderModal';
import MobileOrderDetailModal from '../components/MobileOrderDetailModal';
import { Package, Plus, MapPin } from 'lucide-react';
import { useUserRole } from '../../providers/UserRoleProvider';

export default function MobileZayavkiPage() {
const { user } = useUserRole();   // ← Берём роль из провайдера

  // ==================== 1. СТАТУСЫ ====================
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [newOrderInitialData, setNewOrderInitialData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'processing' | 'completed' | 'cancelled'>('all');

  // ==================== 2. ДАТА ====================
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });


    // ==================== 3. РЕЦЕПТЫ + РОЛЬ ====================
  const [recipes, setRecipes] = useState<any[]>([]);

  // Роль и имя берём из UserRoleProvider
  const currentRole = user?.role || 'admin';
  const userFullName = user?.full_name || user?.username || 'Сотрудник';

  // ==================== 4. ЗАГРУЗКА ДАННЫХ (один useEffect) ====================
  useEffect(() => {
    const fetchAllData = async () => {
      try {
        const [ordersRes, recipesRes] = await Promise.all([
          fetch('/api/adminCifra/all-orders', { cache: 'no-store' }),
          fetch('/api/adminCifra/recipes')
        ]);

        if (ordersRes.ok) {
          const ordersData = await ordersRes.json();
          setAllOrders(Array.isArray(ordersData) ? ordersData : []);
        }

        if (recipesRes.ok) {
          const recipesData = await recipesRes.json();
          setRecipes(recipesData);
        }
      } catch (err) {
        console.error('Ошибка загрузки данных:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAllData();
  }, []);

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

  const filteredOrders = dayOrders.filter(order => {
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    return matchesStatus;
  });

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
      setAllOrders(prev => [newOrder, ...prev]);
    }
    setShowNewOrderModal(false);
    setNewOrderInitialData(null);
  };

  return (
    <MobileLayout>
      <div style={{ padding: '16px', paddingBottom: '100px' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ fontSize: '26px', fontWeight: '700', margin: 0 }}>Заявки</h1>
          <button 
            onClick={() => setShowNewOrderModal(true)}
            style={{
              background: '#10B981',
              color: 'white',
              border: 'none',
              borderRadius: '9999px',
              padding: '12px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: '600'
            }}
          >
            <Plus size={20} /> Новая
          </button>
        </div>

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
    background: '#1E2937', 
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
    background: '#1E2937', 
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
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          background: '#1E2937',
          padding: '12px 16px',
          borderRadius: '16px',
          marginBottom: '20px'
        }}>
          <button 
            onClick={() => {
              const prev = new Date(selectedDate);
              prev.setDate(prev.getDate() - 1);
              setSelectedDate(prev);
            }} 
            style={{ fontSize: '28px', background: 'none', border: 'none', color: '#94A3B8' }}
          >
            ←
          </button>
          
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: '700', fontSize: '17px' }}>
              {selectedDate.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>

          <button 
            onClick={() => {
              const next = new Date(selectedDate);
              next.setDate(next.getDate() + 1);
              setSelectedDate(next);
            }} 
            style={{ fontSize: '28px', background: 'none', border: 'none', color: '#94A3B8' }}
          >
            →
          </button>
        </div>

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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: '700', fontSize: '18px' }}>
                    #{order.id} — {order.delivery_time || '—'}
                  </div>
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

                <div style={{ fontSize: '16px', fontWeight: '600' }}>
                  {order.organization_name || order.full_name || '—'}
                </div>

                <div style={{ display: 'flex', gap: '12px', fontSize: '15px', color: '#94A3B8' }}>
                  <div>{order.grade}</div>
                  <div>{Number(order.volume || 0).toFixed(1)} м³</div>
                </div>

                <div style={{ color: '#94A3B8', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <MapPin size={16} /> {order.address?.substring(0, 45)}...
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
      />
    </MobileLayout>
  );
}