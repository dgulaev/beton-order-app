'use client';

// Просмотр кабинета водителя глазами администратора/диспетчера.
// Рендерит тот же DriverDashboard что видит водитель, но в режиме readOnly:
// - кнопки смены статуса скрыты
// - кнопка «Назад» вместо «Выход»
// Доступ: только сотрудники (redirect на /mobile если нет сессии).

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUserRole } from '@/app/providers/UserRoleProvider';
import DriverDashboard from '@/app/mobile/driver/components/DriverDashboard';
import { DriverMixerInfo, DriverTrip } from '@/app/mobile/driver/driverClient';

export default function DriverViewPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: roleLoading } = useUserRole();

  const mixerId = params?.id as string;
  const [mixer, setMixer] = useState<DriverMixerInfo | null>(null);
  const [loadingMixer, setLoadingMixer] = useState(true);

  // Защита: не сотрудник — уводим на /mobile
  useEffect(() => {
    if (!roleLoading && !user) {
      router.replace('/mobile');
    }
  }, [user, roleLoading, router]);

  // Загружаем данные миксера (один раз при монтировании)
  useEffect(() => {
    if (!user || !mixerId) return;
    const userId = localStorage.getItem('userId');
    if (!userId) return;

    (async () => {
      try {
        const res = await fetch(`/api/admin/mixer-trips?mixerId=${mixerId}&scope=today`, {
          headers: { 'x-user-id': userId },
          cache: 'no-store',
        });
        if (res.status === 403) { router.replace('/mobile'); return; }
        const data = await res.json();
        if (data.success && data.mixer) setMixer(data.mixer);
      } finally {
        setLoadingMixer(false);
      }
    })();
  }, [user, mixerId, router]);

  // Фетчер рейсов через admin API (передаётся в DriverDashboard)
  const tripsFetcher = useCallback(async (
    scope: 'today' | 'history',
    offset = 0,
    limit = 21,
  ): Promise<DriverTrip[]> => {
    const userId = localStorage.getItem('userId');
    if (!userId) return [];
    const url = `/api/admin/mixer-trips?mixerId=${mixerId}&scope=${scope}&offset=${offset}&limit=${limit}`;
    const res = await fetch(url, {
      headers: { 'x-user-id': userId },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.success ? (data.trips as DriverTrip[]) : [];
  }, [mixerId]);

  if (roleLoading || loadingMixer) {
    return (
      <div style={{ minHeight: '100vh', background: '#162032', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}>
        Загрузка...
      </div>
    );
  }

  if (!mixer) {
    return (
      <div style={{ minHeight: '100vh', background: '#162032', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B' }}>
        Миксер не найден
      </div>
    );
  }

  return (
    <DriverDashboard
      mixer={mixer}
      onLogout={() => router.push('/mobile/mixers')}
      readOnly
      onBack={() => router.push('/mobile/mixers')}
      tripsFetcher={tripsFetcher}
    />
  );
}
