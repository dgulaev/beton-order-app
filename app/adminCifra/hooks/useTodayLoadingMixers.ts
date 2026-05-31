'use client';

import { useState, useEffect } from 'react';

export const useTodayLoadingMixers = () => {
  const [allMixers, setAllMixers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMixers = async () => {
      try {
        // Важно: withOrders=true — чтобы подтягивать delivery_date
        const res = await fetch('/api/adminCifra/active-mixers?withOrders=true');
        
        if (!res.ok) throw new Error('Failed to fetch');

        const data = await res.json();
        
        console.log(`[useTodayLoadingMixers] Загружено ${data.length} записей`);
        console.log('Пример первой записи:', data[0]);
        
        setAllMixers(data || []);
      } catch (err) {
        console.error('Ошибка загрузки миксеров для оператора БСУ:', err);
        setAllMixers([]);
      } finally {
        setLoading(false);
      }
    };

    fetchMixers();
    const interval = setInterval(fetchMixers, 8000);

    return () => clearInterval(interval);
  }, []);

  return { allMixers, loading };
};