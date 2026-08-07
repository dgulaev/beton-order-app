'use client';

import { useCallback } from 'react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';

export const useUpdateOrderStatus = () => {
  const updateOrderStatus = useCallback(async (orderId: number, newStatus: string) => {
    try {
      const userName =
        typeof window !== 'undefined'
          ? localStorage.getItem('userName') || undefined
          : undefined;

      const res = await fetch('/api/adminCifra/orders/status', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ orderId, status: newStatus, userName }),
      });

      const data = await res.json().catch(() => ({}));
      return res.ok && data.success === true;
    } catch (err) {
      console.error('Ошибка смены статуса:', err);
      return false;
    }
  }, []);

  return { updateOrderStatus };
};
