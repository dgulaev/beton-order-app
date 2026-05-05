'use client';

import { createPortal } from 'react-dom';
import { Order } from '@/app/adminCifra/hooks/useCalendarOrders';

interface StatusButtonsProps {
  order: Order;
  onStatusChange: (orderId: string, newStatus: string) => void;
}

export default function StatusButtons({ order, onStatusChange }: StatusButtonsProps) {
  const statuses = [
    { value: 'new', label: 'Новый', bg: '#fef9c3', color: '#854d0e' },
    { value: 'processing', label: 'В работе', bg: '#dbeafe', color: '#1e40af' },
    { value: 'completed', label: 'Выполнена', bg: '#dcfce7', color: '#166534' },
    { value: 'cancelled', label: 'Отменена', bg: '#fee2e2', color: '#b91c1c' },
  ];

  const buttons = (
    <div style={{ display: 'flex', gap: '6px', marginTop: '14px', flexWrap: 'wrap' }}>
      {statuses.map(({ value, label, bg, color }) => (
        <button
          key={value}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onStatusChange(order.id, value);
          }}
          style={{
            padding: '6px 14px',
            fontSize: '13px',
            borderRadius: '9999px',
            background: order.status === value ? bg : '#f1f5f9',
            color: order.status === value ? color : '#666',
            border: order.status === value ? `2px solid ${color}` : '1px solid #ddd',
            fontWeight: order.status === value ? '700' : '500',
            cursor: 'pointer',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // Рендерим через Portal — вне карточки
  return createPortal(buttons, document.body);
}