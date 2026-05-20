'use client';

import { useCallback } from 'react';

export const useUpdateOrderStatus = () => {
  const updateOrderStatus = useCallback(async (orderId: number, newStatus: string) => {
    try {
      const res = await fetch('/api/adminCifra/orders/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, status: newStatus })
      });

      const data = await res.json();
      return data.success === true;
    } catch (err) {
      console.error('Ошибка смены статуса:', err);
      return false;
    }
  }, []);

  return { updateOrderStatus };
};