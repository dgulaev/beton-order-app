'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTodayLoadingMixers } from '../hooks/useTodayLoadingMixers';
import { useRealtimeProductionLogs } from '@/hooks/useRealtimeOrders';
import { useUserRole } from '../../providers/UserRoleProvider';
import WarehousePage from '../warehouse/page';
import ReportsPage from '../reports/page';
import RecipesPage from '../recipes/page';



export default function OperatorBSUPage() {
  const [currentShift] = useState('Дневная');
  const [selectedTrip, setSelectedTrip] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'zayavki' | 'warehouse' | 'reports' | 'recipes'>('zayavki');

  // ==================== ИДЕНТИЧНОСТЬ ОПЕРАТОРА (для записи в историю) ====================
  const { user } = useUserRole();
  const operatorName = user?.full_name || user?.username || 'Оператор';
  const operatorRole = user?.role || 'operator';

    // ==================== 0. УПРАВЛЕНИЕ ДАТОЙ ====================
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    // Берём локальную дату без времени (как в дашборде)
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

   // ==================== 0.1 РЕАЛЬНЫЕ ДАННЫЕ ====================
  const { allMixers: rawMixers } = useTodayLoadingMixers();

  // ==================== 0.2 ФИЛЬТРАЦИЯ + ОПТИМИСТИЧНОЕ СКРЫТИЕ ====================
  // ⚠️ ID миксеров, которые мы только что сами перевели в "В пути" (кнопка
  // "Загружен"). Скрываем их из очереди немедленно, не дожидаясь тика
  // realtime-обновления order_mixers — иначе возможна гонка: если между нашим
  // обновлением и приходом его realtime-события успевает прилететь ЛЮБОЕ
  // другое realtime-событие по order_mixers (например, дежурный статус другого
  // миксера), `queueTrips` пересчитывается из ещё не обновившегося rawMixers и
  // строка "телепортируется" обратно в очередь — это и была причина жалобы
  // оператора. Как только сам realtime подтвердит новый статус, id убирается
  // из этого набора (см. эффект ниже).
  const [optimisticallyRemovedIds, setOptimisticallyRemovedIds] = useState<Set<string>>(new Set());

  const queueTrips = useMemo(() => {
    return rawMixers
      .filter((trip: any) => {
        if (!trip || trip.status !== 'Загрузка') return false;
        if (optimisticallyRemovedIds.has(String(trip.id))) return false;

        let tripDateStr = '';

        if (trip.delivery_date) {
          tripDateStr = String(trip.delivery_date).split('T')[0].substring(0, 10).trim();
        } else if (trip.created_at) {
          tripDateStr = String(trip.created_at).split('T')[0].substring(0, 10).trim();
        } else if (trip.updated_at) {
          tripDateStr = String(trip.updated_at).split('T')[0].substring(0, 10).trim();
        } else {
          tripDateStr = new Date().toISOString().split('T')[0];
        }

        const year = selectedDate.getFullYear();
        const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
        const day = String(selectedDate.getDate()).padStart(2, '0');
        const selectedDateStr = `${year}-${month}-${day}`;

        return tripDateStr === selectedDateStr;
      })
      .sort((a: any, b: any) => {
        const timeA = a.time || '00:00';
        const timeB = b.time || '00:00';
        return timeA.localeCompare(timeB);
      });
  }, [rawMixers, selectedDate, optimisticallyRemovedIds]);

  // Как только rawMixers по realtime подтвердит, что миксер и правда больше
  // не "Загрузка" — снимаем принудительное скрытие (оно уже не нужно, а
  // держать id вечно в Set смысла нет).
  useEffect(() => {
    if (optimisticallyRemovedIds.size === 0) return;

    setOptimisticallyRemovedIds(prev => {
      let changed = false;
      const next = new Set(prev);

      prev.forEach(id => {
        const mixer = rawMixers.find((m: any) => String(m.id) === id);
        // Миксер пропал из rawMixers или сменил статус — realtime подтвердил.
        if (!mixer || mixer.status !== 'Загрузка') {
          next.delete(id);
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [rawMixers, optimisticallyRemovedIds]);


  // ==================== 0.4 ЗАГРУЗКА РЕЦЕПТОВ ИЗ БАЗЫ ====================
  const [recipes, setRecipes] = useState<any[]>([]);

  useEffect(() => {
    const fetchRecipes = async () => {
      try {
        const res = await fetch('/api/adminCifra/recipes');
        if (res.ok) {
          const data = await res.json();
          setRecipes(data);
          console.log(`[Recipes] Загружено ${data.length} рецептов`);
        }
      } catch (err) {
        console.error('Ошибка загрузки рецептов:', err);
      }
    };

    fetchRecipes();
  }, []);

      // ==================== 1. ДЕЙСТВИЯ ОПЕРАТОРА ====================
  const [loadingTrips, setLoadingTrips] = useState<Record<number, boolean>>({});
  const [tripStartTimes, setTripStartTimes] = useState<Record<number, string>>({});

  // ⚠️ ФИКС ТАЙМЕРА: getLoadingDuration() считает разницу от new Date().getTime()
  // ПРЯМО В РЕНДЕРЕ, но ничто не заставляло компонент перерисовываться каждую
  // секунду/минуту — надпись на кнопке "В работе • N мин" обновлялась только
  // случайно, если рендер происходил по другой причине (поэтому "таймер не
  // всегда срабатывает"). tick форсирует регулярный перерендер, пока есть
  // хотя бы одна активная загрузка.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (Object.keys(loadingTrips).length === 0) return;
    const interval = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [loadingTrips]);

    // ==================== 1.0 ЗАГРУЗКА СОСТОЯНИЯ ЗАГРУЗКИ ПРИ СТАРТЕ ====================
  useEffect(() => {
    const loadLoadingState = async () => {
      try {
        const res = await fetch('/api/adminCifra/active-mixers');
        if (!res.ok) return;

        const data = await res.json();
        const newLoading: Record<number, boolean> = {};
        const newStartTimes: Record<number, string> = {};

        data.forEach((trip: any) => {
          // Таймер идёт только у миксеров со статусом "Загрузка"
          // ("В работе" — это статус заявки, а не миксера, тут был лишний
          // мёртвый кейс, который никогда не мог сработать для order_mixers).
          if (trip.status === 'Загрузка' && (trip.loading_started_at || trip.loadingStartedAt)) {
            newLoading[trip.id] = true;
            newStartTimes[trip.id] = trip.loading_started_at || trip.loadingStartedAt;
          }
        });

        setLoadingTrips(newLoading);
        setTripStartTimes(newStartTimes);

        console.log(`[Loading State] Восстановлено ${Object.keys(newLoading).length} активных загрузок`);
      } catch (err) {
        console.error('Ошибка загрузки состояния загрузки:', err);
      }
    };

    loadLoadingState();
  }, []);

    // ==================== 1.1 НАЧАТЬ ЗАГРУЗКУ ====================
  const startLoading = async (trip: any) => {
    const now = new Date().toISOString();

    try {
      await fetch('/api/adminCifra/order-mixers/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: trip.id, 
          status: 'Загрузка',
          loading_started_at: now,
          userName: operatorName,
          userRole: operatorRole
        })
      });

      setLoadingTrips(prev => ({ ...prev, [trip.id]: true }));
      setTripStartTimes(prev => ({ ...prev, [trip.id]: now }));

      // alert удалён — тихое выполнение
    } catch (err) {
      console.error(err);
      alert('Ошибка начала загрузки'); // оставляем только при ошибке
    }
  };

        // ==================== 1.2 ОТГРУЖЕНО СЕГОДНЯ (загрузка из базы) ====================
  const [completedTrips, setCompletedTrips] = useState<any[]>([]);

  // Загрузка отгруженных рейсов из базы
  useEffect(() => {
    const fetchCompletedTrips = async () => {
      try {
        const res = await fetch('/api/adminCifra/production-log');
        if (res.ok) {
          const data = await res.json();
          setCompletedTrips(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Ошибка загрузки отгруженных рейсов:', err);
      }
    };

    fetchCompletedTrips();
  }, []);

  // Live-обновление ленты "Отгружено сегодня" — подхватывает записи от любого оператора
  useRealtimeProductionLogs(setCompletedTrips);

       // ==================== 1.2 ЗАВЕРШИТЬ ЗАГРУЗКУ ====================
  // ⚠️ ГАРАНТИРОВАННЫЙ ПЕРЕНОС: строка сразу и безусловно переезжает в
  // "Отгружено сегодня" и мгновенно скрывается из очереди — не дожидаясь
  // ответа сервера. Так оператор никогда не видит "зависшую" строку в
  // очереди и не может нажать на неё повторно (именно это было причиной
  // дублей 13-14.07 — строка временно "телепортировалась" обратно из-за
  // задержки записи в базе, и оператор жал "Начать"/"Загружен" второй раз).
  // Реальное сохранение (production_logs + смена статуса миксера на
  // "В пути") идёт в фоне с повторами — пока статус не подтверждён сервером,
  // на строке горит красная точка (см. _pending).
  const [completingTripIds, setCompletingTripIds] = useState<Set<number>>(new Set());

  const completeLoading = (trip: any) => {
    if (completingTripIds.has(trip.id)) return; // защита от двойного клика в первый момент

    const startTime = tripStartTimes[trip.id] || trip.loading_started_at;
    if (!startTime) {
      alert('❗ Сначала нажмите кнопку "Начать"');
      return;
    }

    setCompletingTripIds(prev => new Set(prev).add(trip.id));

    const endTime = new Date().toISOString();
    const durationMinutes = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
    // Отрицательный временный id — чтобы не пересекаться с реальными id из базы,
    // до тех пор пока production-log не ответит настоящим id записи.
    const tempId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));

    const optimisticLog = {
      id: tempId,
      order_id: trip.order_id || trip.orderId,
      order_mixer_id: trip.id,
      mixer_name: trip.mixer_name || trip.number,
      concrete_grade: trip.concrete_grade,
      volume: trip.volume,
      podvizhnost: trip.podvizhnost || 'П3',
      start_time: startTime,
      end_time: endTime,
      duration_minutes: durationMinutes,
      created_at: endTime,
      _pending: true, // статус миксера ещё не подтверждён сервером — красная точка на строке
    };

    // 1) Мгновенно и безусловно — в "Отгружено сегодня"
    setCompletedTrips(prev => [optimisticLog, ...prev]);

    // 2) Мгновенно и безусловно — прочь из "Очередь на загрузку"
    const tripIdStr = String(trip.id);
    setOptimisticallyRemovedIds(prev => new Set(prev).add(tripIdStr));

    setLoadingTrips(prev => {
      const copy = { ...prev };
      delete copy[trip.id];
      return copy;
    });

    // 3) Фоновое сохранение с повторами — интерфейс это не блокирует
    void persistCompletion(trip, tempId, startTime, tripIdStr);
  };

  // Отдельный таймаут на каждую попытку (не ждём "вечно" зависший запрос к
  // Supabase — именно так выглядела сегодняшняя задержка с heartbeat) плюс
  // растущая пауза между попытками. Обе ручки ниже безопасны для повтора:
  // у production-log есть сервер-side дедуп по order_mixer_id за последнюю
  // минуту, а order-mixers/status просто перезапишет тот же статус повторно
  // без лишней записи в историю (см. lib/orderMixers.ts — история пишется
  // только если статус реально меняется).
  const fetchWithRetry = async (
    url: string,
    init: RequestInit,
    opts: { attempts?: number; timeoutMs?: number; baseDelayMs?: number } = {}
  ): Promise<Response> => {
    const { attempts = 5, timeoutMs = 8000, baseDelayMs = 1500 } = opts;
    let lastError: any;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;
        if (attempt < attempts - 1) {
          await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(1.8, attempt)));
        }
      }
    }

    throw lastError;
  };

  const persistCompletion = async (trip: any, tempId: number, startTime: string, tripIdStr: string) => {
    // Шаг 1: запись рейса в production_logs
    try {
      const res = await fetchWithRetry('/api/adminCifra/production-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: trip.order_id || trip.orderId,
          order_mixer_id: trip.id,
          mixer_name: trip.mixer_name || trip.number,
          concrete_grade: trip.concrete_grade,
          volume: parseFloat(trip.volume || 0),
          podvizhnost: trip.podvizhnost || 'П3',
          start_time: startTime
        })
      });
      const json = await res.json().catch(() => null);
      const realId = json?.data?.id;
      if (realId) {
        setCompletedTrips(prev => prev.map(l => (l.id === tempId ? { ...l, id: realId } : l)));
      }
    } catch (err) {
      console.error(`❌ [Оператор] Не удалось записать отгрузку миксера ${trip.mixer_name || trip.number || trip.id} после всех попыток:`, err);
    }

    // Шаг 2: смена статуса миксера на "В пути" — это главное, повторяем настойчивее
    try {
      await fetchWithRetry(
        '/api/adminCifra/order-mixers/status',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: trip.id,
            status: 'В пути',
            userName: operatorName,
            userRole: operatorRole
          })
        },
        { attempts: 6, timeoutMs: 8000, baseDelayMs: 2000 }
      );

      // ✅ подтверждено — снимаем красную точку у соответствующей строки
      setCompletedTrips(prev =>
        prev.map(l => (String(l.order_mixer_id) === String(trip.id) ? { ...l, _pending: false } : l))
      );
    } catch (err) {
      console.error(`🔴 [Оператор] Статус миксера ${trip.mixer_name || trip.number || trip.id} НЕ подтверждён после всех попыток — нужна ручная проверка:`, err);

      // Все повторы исчерпаны — это уже не гонка, а настоящий сигнал "нужно
      // вмешательство". Возвращаем строку в очередь, чтобы её было видно и
      // можно было провести заново, но красная точка в "Отгружено сегодня"
      // остаётся — рейс не потерян, просто не подтверждён.
      setOptimisticallyRemovedIds(prev => {
        if (!prev.has(tripIdStr)) return prev;
        const next = new Set(prev);
        next.delete(tripIdStr);
        return next;
      });
    } finally {
      setCompletingTripIds(prev => {
        const next = new Set(prev);
        next.delete(trip.id);
        return next;
      });
    }
  };

  // Доп. страховка: если статус миксера подтвердился по realtime (пришло
  // обновление order_mixers с новым статусом) — снимаем красную точку, даже
  // если наш собственный fetch-ответ потерялся в сети (запрос мог выполниться
  // на сервере, а ответ до клиента не долетел).
  useEffect(() => {
    setCompletedTrips(prev => {
      let changed = false;
      const next = prev.map(l => {
        if (!l._pending) return l;
        const mixer = rawMixers.find((m: any) => String(m.id) === String(l.order_mixer_id));
        if (mixer && mixer.status && mixer.status !== 'Загрузка') {
          changed = true;
          return { ...l, _pending: false };
        }
        return l;
      });
      return changed ? next : prev;
    });
  }, [rawMixers]);

    // ==================== 1.3 ЛОКАЛЬНЫЕ ИЗМЕНЕНИЯ ПОДВИЖНОСТИ ====================
 const [podvizhnostOverrides, setPodvizhnostOverrides] = useState<Record<number, string>>({});

  // ==================== ИСТОРИЯ ИЗМЕНЕНИЙ ЗАЯВКИ (для модалки рейса) ====================
  const [tripHistory, setTripHistory] = useState<any[]>([]);

  useEffect(() => {
    const orderId = selectedTrip?.order_id || selectedTrip?.orderId;
    if (!orderId) {
      setTripHistory([]);
      return;
    }

    const loadTripHistory = async () => {
      try {
        const res = await fetch(`/api/adminCifra/order-history?orderId=${orderId}`);
        if (res.ok) setTripHistory(await res.json());
      } catch (err) {
        console.error('Ошибка загрузки истории заявки:', err);
        setTripHistory([]);
      }
    };

    loadTripHistory();
  }, [selectedTrip?.order_id, selectedTrip?.orderId]);


  // ==================== МАКСИМАЛЬНО СТРОГАЯ ФИЛЬТРАЦИЯ ====================
  const filteredCompletedTrips = completedTrips
    .filter((trip: any) => {
      if (!trip) return false;

      let tripDateStr = '';

      // ПРИОРИТЕТ 1: Дата фактического выполнения (самое важное)
      if (trip.production_created_at) {
        tripDateStr = String(trip.production_created_at).substring(0, 10).trim();
      } else if (trip.created_at) {
        tripDateStr = String(trip.created_at).substring(0, 10).trim();
      } 
      // ПРИОРИТЕТ 2: delivery_date
      else if (trip.delivery_date) {
        tripDateStr = String(trip.delivery_date).substring(0, 10).trim();
      } else if (trip.orders?.delivery_date) {
        tripDateStr = String(trip.orders.delivery_date).substring(0, 10).trim();
      }

      // Локальная выбранная дата (без UTC сдвига)
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const selectedDateStr = `${year}-${month}-${day}`;

      const shouldShow = tripDateStr === selectedDateStr;

      return shouldShow;
    })
    .map((trip: any) => ({
      ...trip,
      time: trip.start_time 
        ? new Date(trip.start_time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) 
        : (trip.time || '—'),
      loadedTime: trip.duration_minutes 
        ? `${trip.duration_minutes} мин` 
        : '—',
      order_id: trip.order_id || trip.orderId,
      mixer_name: trip.mixer_name || trip.number,
      concrete_grade: trip.concrete_grade || trip.grade,
      volume: trip.volume,
      // ✅ БЕРЁМ ПОДВИЖНОСТЬ ИЗ order_mixers (приоритет)
      podvizhnost: trip.podvizhnost || 'П3'
    }));

    // ==================== 2. СТАТИСТИКА ОПЕРАТОРА ====================
  const totalTrips = filteredCompletedTrips.length;
  const totalVolume = filteredCompletedTrips.reduce((sum, trip) => sum + (parseFloat(trip.volume) || 0), 0);
  
  const avgLoadingTime = filteredCompletedTrips.length > 0 
    ? Math.round(
        filteredCompletedTrips.reduce((sum, trip) => sum + (trip.duration_minutes || 0), 0) / filteredCompletedTrips.length
      ) 
    : 0;

  const activeMixers = queueTrips.length;

  // Самая частая марка
  const gradeCount = filteredCompletedTrips.reduce((acc: any, trip) => {
    const grade = trip.concrete_grade || '—';
    acc[grade] = (acc[grade] || 0) + 1;
    return acc;
  }, {});

  const mostFrequentGrade = Object.keys(gradeCount).reduce((a, b) => 
    gradeCount[a] > gradeCount[b] ? a : b, '—'
  );

  // ==================== 2.1 БЛОК СТАТИСТИКИ ====================
  const stats = [
    { 
      label: "Рейсы сегодня", 
      value: totalTrips, 
      unit: "шт", 
      color: "#10B981" 
    },
    { 
      label: "Объём бетона", 
      value: totalVolume.toFixed(1), 
      unit: "м³", 
      color: "#60A5FA" 
    },
    { 
      label: "Среднее время", 
      value: avgLoadingTime, 
      unit: "мин", 
      color: "#FACC15" 
    },
    { 
      label: "Активные миксеры", 
      value: activeMixers, 
      unit: "в очереди", 
      color: "#8B5CF6" 
    },
    { 
      label: "Самая частая марка", 
      value: mostFrequentGrade, 
      unit: "", 
      color: "#EC4899" 
    }
  ];

  // ==================== 1.3 ПЕРЕКЛЮЧЕНИЕ ДАТ ====================
  const goToPrevDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    setSelectedDate(prev);
  };

  const goToNextDay = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    setSelectedDate(next);
  };

    // ==================== 1.4 РАСЧЁТ ВРЕМЕНИ ЗАГРУЗКИ ====================
  const getLoadingDuration = (tripId: number) => {
    const startTime = tripStartTimes[tripId];
    if (!startTime) return '—';

    const start = new Date(startTime).getTime();
    const minutes = Math.floor((tick - start) / 60000);

    return minutes > 0 ? `${minutes} мин` : '1 мин';
  };

  return (
    <div style={{ 
      backgroundColor: '#0F172A', 
      minHeight: '100vh', 
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>

      {/* ==================== 2. ВЕРХНЯЯ ПАНЕЛЬ ==================== */}
      <div style={{
        backgroundColor: '#1E2937',
        padding: '20px 40px',
        borderBottom: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>Бетонный завод</div>
          <div style={{ color: '#94A3B8', fontSize: '15px' }}>Оператор БСУ • Реальное время</div>
        </div>
        <div style={{ backgroundColor: '#25334A', padding: '12px 24px', borderRadius: '9999px', fontSize: '16px' }}>
          Смена: <span style={{ color: '#10B981', fontWeight: '600' }}>{currentShift}</span>
        </div>
      </div>

      <div style={{ padding: '20px 40px 40px 40px' }}>

             {/* ==================== 2. БЛОК СТАТИСТИКИ (только на вкладке Заявки) ==================== */}
{activeTab === 'zayavki' && (
  <div style={{ 
    display: 'grid', 
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
    gap: '16px',
    marginBottom: '24px'
  }}>
    {stats.map((stat, index) => (
      <div key={index} style={{
        backgroundColor: '#1E2937',
        borderRadius: '20px',
        padding: '20px 24px',
        border: '1px solid #334155'
      }}>
        <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
          {stat.label}
        </div>
        <div style={{ 
          fontSize: '32px', 
          fontWeight: '700', 
          color: stat.color,
          marginBottom: '4px'
        }}>
          {stat.value}
        </div>
        <div style={{ color: '#64748B', fontSize: '15px' }}>
          {stat.unit}
        </div>
      </div>
    ))}
  </div>
)}

                              {/* ==================== 3. ТАБЫ + КНОПКА ЗАГРУЗКИ ==================== */}
<div style={{ 
  display: 'flex', 
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '32px',
  borderBottom: '1px solid #334155',
  paddingBottom: '8px'
}}>
  
  {/* Табы слева */}
  <div style={{ display: 'flex', gap: '48px' }}>
    {[
      { key: 'zayavki',   label: 'Заявки',    action: () => setActiveTab('zayavki') },
      { key: 'warehouse', label: 'Склад',     action: () => setActiveTab('warehouse') },
      { key: 'reports',   label: 'Отчеты',    action: () => setActiveTab('reports') },
      { key: 'recipes',   label: 'Рецепты',   action: () => setActiveTab('recipes') }
    ].map((tab) => (
      <button
        key={tab.key}
        onClick={tab.action}
        style={{
          padding: '12px 0',
          background: 'transparent',
          border: 'none',
          fontSize: '17px',
          fontWeight: '600',
          color: activeTab === tab.key ? '#10B981' : '#64748B',
          cursor: 'pointer',
          position: 'relative',
          transition: 'color 0.2s'
        }}
      >
        {tab.label}
        {activeTab === tab.key && (
          <div style={{
            position: 'absolute',
            bottom: '-6px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '5px',
            height: '5px',
            backgroundColor: '#10B981',
            borderRadius: '50%',
            boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.3)'
          }} />
        )}
      </button>
    ))}
  </div>
</div>
  

        {/* ==================== 4. ОСНОВНОЙ КОНТЕНТ ==================== */}
        {activeTab === 'zayavki' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 750px', gap: '24px' }}>
            
                                                {/* ==================== 4.1 ОЧЕРЕДЬ НА ЗАГРУЗКУ ==================== */}
            <div style={{ backgroundColor: '#1E2937', borderRadius: '24px', padding: '24px' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '21px', fontWeight: '600' }}>
                  📋 Очередь на загрузку ({queueTrips.length})
                </h2>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button onClick={goToPrevDay} style={{ padding: '6px 14px', background: '#334155', border: 'none', borderRadius: '8px', color: '#fff' }}>←</button>
                  <div style={{ fontWeight: '600', minWidth: '160px', textAlign: 'center' }}>
                    {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                  </div>
                  <button onClick={goToNextDay} style={{ padding: '6px 14px', background: '#334155', border: 'none', borderRadius: '8px', color: '#fff' }}>→</button>
                </div>
              </div>

              {/* Шапка колонок */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '72px 85px 120px 95px 78px 105px 220px 1fr',
                gap: '8px',
                padding: '8px 18px',
                color: '#94A3B8',
                fontSize: '13.5px',
                fontWeight: '500',
                borderBottom: '1px solid #334155',
                marginBottom: '10px'
              }}>
                <div>Время</div>
                <div>№ заявки</div>
                <div>№ миксера</div>
                <div>Марка</div>
                <div>Объём</div>
                <div>Подвижность</div>
                <div>Клиент / Организация</div>
                <div></div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                {queueTrips.map((trip) => {
                  const client = trip.organization_name || trip.client_name || '—';
                  const isLoading = loadingTrips[trip.id];

                  return (
                    <div 
                      key={trip.id} 
                      onClick={async () => {
                  try {
                  const res = await fetch(`/api/adminCifra/orders/${trip.order_id || trip.orderId}`);
                  if (res.ok) {
                  const fullOrder = await res.json();
                  setSelectedTrip({
                  ...trip,
                  comment: fullOrder.comment,           // ← главное
                  orders: fullOrder
                });
                } else {
                  setSelectedTrip(trip);
                }
                } catch (e) {
                  setSelectedTrip(trip);
                }
                }}

                      style={{
                        backgroundColor: '#25334A',
                        borderRadius: '12px',
                        padding: '13px 18px',
                        display: 'grid',
                        gridTemplateColumns: '72px 85px 120px 95px 78px 105px 220px 1fr',
                        gap: '8px',
                        alignItems: 'center',
                        minHeight: '28px',
                        fontSize: '15px',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ fontWeight: '600', color: '#94A3B8' }}>{trip.time || '—'}</div>
                      <div style={{ fontWeight: '700', color: '#60A5FA' }}>
                        #{trip.order_id || trip.orderId || '—'}
                      </div>
                      <div style={{ fontWeight: '700' }}>
                        {trip.mixer_name || trip.number || '—'}
                      </div>
                      <div>{trip.concrete_grade || '—'}</div>
                      <div style={{ fontWeight: '600' }}>{trip.volume} м³</div>

                      <select 
  value={podvizhnostOverrides[trip.id] ?? trip.podvizhnost ?? 'П3'}
  onChange={async (e) => {
    const newPodvizhnost = e.target.value;
    
    try {
      await fetch('/api/adminCifra/order-mixers/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: trip.id, 
          podvizhnost: newPodvizhnost 
        })
      });

      setPodvizhnostOverrides(prev => ({
        ...prev,
        [trip.id]: newPodvizhnost
      }));

    } catch (err) {
      console.error('Ошибка сохранения подвижности:', err);
      alert('Не удалось сохранить подвижность');
    }
  }}
  onClick={(e) => e.stopPropagation()}
  style={{ 
    padding: '7px 10px', 
    background: '#1E2937', 
    border: 'none', 
    borderRadius: '6px', 
    color: '#fff', 
    fontSize: '14px' 
  }}
>
  <option value="П1">П1</option>
  <option value="П2">П2</option>
  <option value="П3">П3</option>
  <option value="П4">П4</option>
  <option value="П5">П5</option>
</select>

                      <div style={{ 
                        fontSize: '14.5px', 
                        color: '#E2E8F0',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {client}
                      </div>

                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            startLoading(trip); 
                          }} 
                          disabled={loadingTrips[trip.id]}
                          style={{ 
                            padding: '7px 14px', 
                            background: loadingTrips[trip.id] ? '#475569' : '#10B981', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '9999px', 
                            fontSize: '13px', 
                            fontWeight: '600',
                            cursor: loadingTrips[trip.id] ? 'not-allowed' : 'pointer',
                            minWidth: '110px'
                          }}
                        >
                          {loadingTrips[trip.id] 
                            ? `В работе • ${getLoadingDuration(trip.id)}` 
                            : 'Начать'}
                        </button>
                        
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            completeLoading(trip); 
                          }} 
                          disabled={!loadingTrips[trip.id] || completingTripIds.has(trip.id)}   // ← Активна только когда начата загрузка и не в процессе завершения (защита от дублей по двойному клику)
                          style={{ 
                            padding: '7px 14px', 
                            background: loadingTrips[trip.id] && !completingTripIds.has(trip.id) ? '#3B82F6' : '#475569', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '9999px', 
                            fontSize: '13px', 
                            fontWeight: '600',
                            cursor: loadingTrips[trip.id] && !completingTripIds.has(trip.id) ? 'pointer' : 'not-allowed'
                          }}
                        >
                          {completingTripIds.has(trip.id) ? 'Сохранение…' : 'Загружен'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

                        {/* ==================== 4.2 ОТГРУЖЕНО СЕГОДНЯ ==================== */}
            <div style={{ backgroundColor: '#1E2937', borderRadius: '24px', padding: '24px' }}>
              <h2 style={{ fontSize: '21px', fontWeight: '600', marginBottom: '20px', color: '#10B981' }}>
                🚚 Отгружено сегодня ({filteredCompletedTrips.length})
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                {filteredCompletedTrips.length > 0 ? filteredCompletedTrips.map((trip) => (
                  <div 
                    key={trip.id}
                    style={{
                      backgroundColor: '#25334A',
                      borderRadius: '12px',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      minHeight: '28px',
                      fontSize: '14.5px'
                    }}
                  >
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flex: 1 }}>
                      <div style={{ fontWeight: '600', color: '#94A3B8', minWidth: '70px' }}>
                        {trip.time || '—'}
                      </div>
                      <div style={{ fontWeight: '700', color: '#60A5FA', minWidth: '70px' }}>
                        #{trip.order_id || trip.orderId}
                      </div>
                      <div style={{ fontWeight: '700', minWidth: '120px', display: 'flex', alignItems: 'center', gap: '7px' }}>
                        {trip._pending && (
                          <span
                            title="Статус миксера пока не подтверждён сервером — рейс не потерян, идёт сохранение"
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: '#EF4444',
                              display: 'inline-block',
                              flexShrink: 0,
                              animation: 'pulse 1.4s ease-in-out infinite'
                            }}
                          />
                        )}
                        {trip.mixer_name || trip.number || '—'}
                      </div>
                      
                      {/* ==================== ОТОБРАЖЕНИЕ ПОДВИЖНОСТИ ==================== */}
                      <div>
                        {trip.concrete_grade || '—'} 
                        <span style={{ 
                          color: '#10B981', 
                          fontWeight: '600', 
                          marginLeft: '8px' 
                        }}>
                          {podvizhnostOverrides[trip.id] || trip.podvizhnost || 'П3'}
                        </span>
                      </div>
                      {/* ======================================================== */}

                      <div style={{ fontWeight: '600' }}>
                        {trip.volume} м³
                      </div>
                      {trip._pending ? (
                        <div style={{ color: '#F59E0B', fontWeight: '600' }} title="Сохраняется, статус миксера подтверждается">
                          ⏳ Сохранение…
                        </div>
                      ) : (
                        <div style={{ color: '#10B981', fontWeight: '600' }}>
                          ✓ Загружен • {trip.loadedTime || '—'}
                        </div>
                      )}
                    </div>
                    <div style={{ color: '#64748B' }}>В пути</div>
                  </div>
                )) : (
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '70px 20px', 
                    color: '#64748B',
                    fontSize: '15px'
                  }}>
                    Пока нет отгруженных рейсов на выбранную дату
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {/* ==================== СКЛАД ==================== */}
        {activeTab === 'warehouse' && <WarehousePage recipes={recipes} />}
        {/* ==================== ОТЧЕТЫ ==================== */}
        {activeTab === 'reports' && <ReportsPage />}
        {/* ==================== РЕЦЕПТЫ ==================== */}
        {activeTab === 'recipes' && <RecipesPage />}
      </div>    

   {/* ==================== 5. МОДАЛЬНОЕ ОКНО ==================== */}
      {selectedTrip && (
        <div 
          style={{
            position: 'fixed', 
            inset: 0, 
            backgroundColor: 'rgba(0,0,0,0.94)', 
            zIndex: 1000,
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center'
          }} 
          onClick={() => setSelectedTrip(null)}
        >
          <div 
            style={{ 
              background: '#1E2937', 
              padding: '32px', 
              borderRadius: '24px', 
              width: '680px',
              maxHeight: '92vh',
              overflowY: 'auto',
              color: '#fff'
            }} 
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '24px' }}>
              Рейс #{selectedTrip.id || selectedTrip.orderId}
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '28px' }}>
              <div>
                <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>МИКСЕР</div>
                <div style={{ fontSize: '20px', fontWeight: '700' }}>
                  {selectedTrip.mixer_name || selectedTrip.number || '—'}
                </div>
              </div>
              <div>
                <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>ОБЪЁМ</div>
                <div style={{ fontSize: '20px', fontWeight: '700' }}>
                  {selectedTrip.volume} м³
                </div>
              </div>
            </div>

            {/* РЕЦЕПТ БЕТОНА */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>РЕЦЕПТ БЕТОНА</div>
              <div style={{ 
                background: '#25334A', 
                padding: '18px', 
                borderRadius: '12px',
                fontSize: '15px',
                lineHeight: '1.65'
              }}>
                {(() => {
                  const grade = (selectedTrip.concrete_grade || '').toUpperCase().trim();
                  const recipe = recipes.find((r: any) => 
                    (r.name && r.name.toUpperCase().includes(grade)) || 
                    (r.code && r.code.toUpperCase().includes(grade))
                  );
                  const podvizhnost = selectedTrip.podvizhnost || 'П3';

                  if (recipe) {
                    return (
                      <>
                        <strong>{selectedTrip.concrete_grade} {podvizhnost}</strong><br/>
                        Цемент: {recipe.cement} кг • 
                        Песок: {recipe.sand} кг • 
                        {recipe.gravel > 0 && `Щебень: ${recipe.gravel} кг • `}
                        Вода: {recipe.water} кг
                        {recipe.additive > 0 && ` • Добавка: ${recipe.additive} кг`}
                      </>
                    );
                  }
                  return `${selectedTrip.concrete_grade} ${podvizhnost} • Рецепт не найден`;
                })()}
              </div>
            </div>

            {/* КЛИЕНТ */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>КЛИЕНТ</div>
              <div style={{ 
                background: '#25334A', 
                padding: '16px', 
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: '600'
              }}>
                {selectedTrip.organization_name || selectedTrip.client_name || selectedTrip.client || '—'}
              </div>
            </div>

                                                {/* ==================== КОММЕНТАРИЙ КЛИЕНТА ==================== */}
            <div style={{ marginBottom: '32px' }}>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>КОММЕНТАРИЙ КЛИЕНТА</div>
              <div style={{ 
                background: '#25334A', 
                padding: '20px', 
                borderRadius: '12px',
                fontSize: '15px',
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
                minHeight: '90px'
              }}>
                {selectedTrip.comment || 'Комментариев от клиента нет'}
              </div>
            </div>

            {/* ИСТОРИЯ */}
            <div style={{ marginBottom: '32px' }}>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '10px' }}>ИСТОРИЯ ИЗМЕНЕНИЙ</div>
              <div style={{ 
                background: '#25334A', 
                padding: '16px', 
                borderRadius: '12px',
                fontSize: '14.5px',
                lineHeight: '1.7',
                maxHeight: '220px',
                overflowY: 'auto'
              }}>
                {tripHistory.length > 0 ? tripHistory.map((entry: any, i: number) => (
                  <div key={i} style={{ marginBottom: '8px' }}>
                    • {new Date(entry.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} —{' '}
                    {entry.user_role === 'system' ? '🤖 Система (автоматически): ' : `${entry.user_name || 'Сотрудник'}: `}
                    {entry.action}
                  </div>
                )) : (
                  <div style={{ color: '#64748B', textAlign: 'center', padding: '10px 0' }}>
                    История изменений пуста
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setSelectedTrip(null)}
                style={{ 
                  flex: 1,
                  padding: '16px',
                  background: '#334155',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Закрыть
              </button>
              
            </div>
          </div>
        </div>
      )}
    </div>
  );
}