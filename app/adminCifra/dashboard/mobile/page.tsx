'use client';

import React, { useState, useEffect } from 'react';
import Calendar from '../../Calendar';
import OrderDetailModal from '../../components/OrderDetailModal';

export default function MobileDashboard() {

  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [activeMixers, setActiveMixers] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [loading, setLoading] = useState(true);

  // ==================== ЗАГРУЗКА ====================
  useEffect(() => {
    fetch('/api/adminCifra/all-orders')
      .then(r => r.json())
      .then(data => setAllOrders(data))
      .catch(console.error);

    fetch('/api/adminCifra/active-mixers')
      .then(r => r.json())
      .then(data => setActiveMixers(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const todayOrders = allOrders.filter(o => {
    if (!o?.delivery_date) return false;
    return o.delivery_date.substring(0, 10) === new Date().toISOString().split('T')[0];
  });

  return (
    <div style={{ 
      background: '#0F172A', 
      minHeight: '100vh', 
      color: '#fff',
      padding: '16px'
    }}>
      <h1 style={{ fontSize: '28px', marginBottom: '24px' }}>Дашборд</h1>

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
        <div style={{ background: '#25334A', borderRadius: '18px', padding: '20px' }}>
          <div style={{ color: '#94A3B8' }}>Заявки сегодня</div>
          <div style={{ fontSize: '52px', fontWeight: '700', color: '#60A5FA' }}>
            {todayOrders.length}
          </div>
        </div>

        <div style={{ background: '#25334A', borderRadius: '18px', padding: '20px' }}>
          <div style={{ color: '#94A3B8' }}>Выполнение</div>
          <div style={{ fontSize: '52px', fontWeight: '700', color: '#10B981' }}>
            {Math.round(todayOrders.filter(o => o.status === 'completed').length / todayOrders.length * 100) || 0}%
          </div>
        </div>
      </div>

      {/* Таймлайн и Миксеры */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ background: '#1E2937', borderRadius: '20px', padding: '24px', textAlign: 'center' }}>
          <h2>График отгрузок</h2>
          <p style={{ color: '#94A3B8' }}>В разработке</p>
        </div>

        <div style={{ background: '#1E2937', borderRadius: '20px', padding: '24px', textAlign: 'center' }}>
          <h2>Миксеры в работе</h2>
          <div style={{ fontSize: '52px', fontWeight: '700', color: '#3B82F6' }}>
            {activeMixers.length}
          </div>
        </div>
      </div>

      {/* Модалка */}
      {selectedOrder && (
        <OrderDetailModal 
          order={selectedOrder} 
          onClose={() => setSelectedOrder(null)} 
          mixerAssignments={[]}
          setMixerAssignments={() => {}}
          allOrders={allOrders}
          setAllOrders={setAllOrders}
          allMixers={[]}
          currentUser={{ id: 0, name: '', role: '' }}
          handleStatusChange={() => {}}
          deleteMixer={() => {}}
          completeLogistics={() => {}}
          history={[]}
          addToHistory={() => Promise.resolve()}
          getStatusConfig={() => ({ label: '', color: '', bg: '', final: false })}
          setHistory={() => {}}
          setSelectedOrder={setSelectedOrder}
        />
      )}

      {showCalendar && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999 }} onClick={() => setShowCalendar(false)}>
          <div onClick={e => e.stopPropagation()}>
            <Calendar onClose={() => setShowCalendar(false)} />
          </div>
        </div>
      )}
    </div>
  );
}