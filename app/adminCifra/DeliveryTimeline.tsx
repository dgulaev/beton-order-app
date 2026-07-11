'use client';

import { useState, useEffect } from 'react';
import { useCalendarOrders, Order } from './hooks/useCalendarOrders';

export default function DeliveryTimeline() {
  const today = new Date().toISOString().split('T')[0];

  const { orders: allOrders = [], loading = false } = useCalendarOrders(
    new Date().getFullYear(),
    new Date().getMonth()
  );

  const todayOrders = allOrders
    .filter((order: any) => order.delivery_date === today)
    .sort((a: any, b: any) => (a.delivery_time || '00:00').localeCompare(b.delivery_time || '00:00'));

  if (loading) {
    return (
      <div style={{ backgroundColor: '#1E2937', borderRadius: '16px', padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
        Загрузка графика отгрузок...
      </div>
    );
  }

  if (todayOrders.length === 0) {
    return (
      <div style={{ backgroundColor: '#1E2937', borderRadius: '16px', padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
        На сегодня заказов нет
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: '#1E2937', borderRadius: '16px', padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#fff' }}>График отгрузок на сегодня</h3>
        <div style={{ fontSize: '14px', color: '#94A3B8' }}>
          {todayOrders.length} заказов
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {todayOrders.map((order: any) => {
          const client = order.organization_name || order.full_name || '—';
          const statusColor = order.status === 'new' ? '#fef9c3' :
                             order.status === 'processing' ? '#dbeafe' :
                             order.status === 'completed' ? '#dcfce7' : '#fee2e2';
          const statusTextColor = order.status === 'new' ? '#854d0e' :
                                 order.status === 'processing' ? '#1e40af' :
                                 order.status === 'completed' ? '#166534' : '#b91c1c';

          return (
            <div
              key={order.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: '#334155',
                borderRadius: '12px',
                padding: '14px 20px',
                gap: '16px'
              }}
            >
              <div style={{ width: '80px', fontSize: '15px', fontWeight: '600', color: '#fff' }}>
                {order.delivery_time || '—'}
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{ fontWeight: '600', color: '#fff' }}>#{order.id}</span>
                  <span style={{ color: '#94A3B8' }}>{client}</span>
                </div>
                <div style={{ fontSize: '14px', color: '#CBD5E1', marginTop: '2px' }}>
                  {order.grade || '—'} • {order.volume} м³
                </div>
              </div>

              <div style={{
                padding: '6px 18px',
                borderRadius: '9999px',
                fontSize: '13px',
                fontWeight: '600',
                backgroundColor: statusColor,
                color: statusTextColor,
                whiteSpace: 'nowrap'
              }}>
                {order.status === 'new' && 'Новая'}
                {order.status === 'processing' && 'В работе'}
                {order.status === 'completed' && 'Выполнена'}
                {order.status === 'cancelled' && 'Отменена'}
              </div>

              <div style={{ fontSize: '16px', fontWeight: '600', color: '#10B981', width: '70px', textAlign: 'right' }}>
                {order.volume} м³
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}