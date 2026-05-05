import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5odWRuemRndGlkb2N3d3pwcWdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzA1MDcsImV4cCI6MjA5MzA0NjUwN30.aj0rKVOatvtGtYFC2EqaHF5mdPNgeVsl-5NQd2WAvoc';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Order {
  id: string;
  client_name: string;
  volume: number;
  delivery_date: string;
  status: string;
  address?: string;
}

export function useCalendarOrders(year: number, month: number) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchOrders = async () => {
      setLoading(true);
      console.log(`🔍 Запрос заказов за ${year}-${month + 1}`);

      const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`;

      const { data, error } = await supabase
        .from('orders')
        .select('*')                    // ← выбрали все поля для диагностики
        .gte('delivery_date', startDate)
        .lte('delivery_date', endDate)
        .order('delivery_date', { ascending: true });

      if (error) {
        console.error('❌ Supabase error object:', error);
        console.error('❌ Error code:', error.code);
        console.error('❌ Error message:', error.message);
        console.error('❌ Error details:', error.details);
        console.error('❌ Error hint:', error.hint);
      } else {
        console.log(`✅ Успешно загружено ${data?.length || 0} заказов`);
        console.table(data?.slice(0, 5)); // покажет первые 5 заказов
        setOrders(data || []);
      }

      setLoading(false);
    };

    fetchOrders();
  }, [year, month]);

  return { orders, loading };
}