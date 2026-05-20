import { useState, useEffect } from 'react';

export interface Order {
  id: string;
  user_id?: number | null;
  grade?: string;
  volume: number;
  delivery_date: string;
  delivery_time?: string;
  address?: string;
  status: string;
  total_price?: number;
  organization_name?: string;
  full_name?: string;
  phone?: string;
  comment?: string;
}

export function useCalendarOrders(year: number, month: number) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchOrders = async () => {
      setLoading(true);
      console.log(`🔍 useCalendarOrders → Запрос за ${year}-${String(month + 1).padStart(2, '0')}`);

      try {
        const res = await fetch(
          `/api/adminCifra/orders?year=${year}&month=${month}`
        );

        if (!res.ok) {
          console.error(`❌ HTTP ${res.status} при запросе заказов`);
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        setOrders(data || []);
        console.log(`✅ useCalendarOrders → Загружено ${data?.length || 0} заказов`);
      } catch (err: any) {
        console.error('❌ Ошибка загрузки заказов через API:', err.message);
        setOrders([]);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, [year, month]);

  return { orders, loading };
}