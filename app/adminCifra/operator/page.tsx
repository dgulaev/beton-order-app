'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTodayLoadingMixers } from '../hooks/useTodayLoadingMixers';
import { useRealtimeProductionLogs } from '@/hooks/useRealtimeOrders';
import { useUserRole } from '../../providers/UserRoleProvider';
import WarehousePage from '../warehouse/page';
import ReportsPage, { preloadReportsData } from '../reports/page';
import RecipesPage, { type LabTab } from '../recipes/page';
import { CARD_VOLUME_SOFT, MODAL_VOLUME_GLOW, modalCloseButtonStyle, volumeCardSoftStyle, volumeCardStyle, volumeModalStyle } from '../cardStyles';
import { UserCog, ChevronDown } from 'lucide-react';
import ModalSelect from '../components/ModalSelect';
import { appConfirm } from '../components/appDialog';

const LAB_MENU_ITEMS: { key: LabTab; label: string }[] = [
  { key: 'orders', label: 'Заявки' },
  { key: 'specifications', label: 'Спецификации' },
  { key: 'recipes', label: 'Рецептуры' },
  { key: 'tests', label: 'Испытания' },
  { key: 'warehouse', label: 'Склад' },
];

// ==================== ПОДПИСИ РОЛЕЙ ДЛЯ "ОСИРОТЕВШИХ" РЕЙСОВ ====================
// Статус миксера "Разгружен"/"Возврат" может выставить не только диспетчер,
// но и менеджер/админ/водитель через свои интерфейсы, минуя оператора БСУ.
// Реальный автор действия берётся из order_history (см. production-log/route.ts,
// actor_name/actor_role) — здесь только маппинг кода роли в подпись на русском.
const ORPHAN_ACTOR_ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  dispatcher: 'Диспетчер',
  operator: 'Оператор',
  driver: 'Водитель',
  logist: 'Логист',
};

export default function OperatorBSUPage() {
  const [selectedTrip, setSelectedTrip] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'zayavki' | 'warehouse' | 'reports' | 'recipes'>('zayavki');
  const [labTab, setLabTab] = useState<LabTab>('orders');
  const [labMenuOpen, setLabMenuOpen] = useState(false);
  const [labRequisitesKey, setLabRequisitesKey] = useState(0);
  const labMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!labMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!labMenuRef.current?.contains(e.target as Node)) setLabMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLabMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [labMenuOpen]);

  useEffect(() => {
    if (activeTab !== 'recipes') setLabMenuOpen(false);
  }, [activeTab]);

  // ==================== ЧАСЫ РЕАЛЬНОГО ВРЕМЕНИ В ШАПКЕ ====================
  const [clockNow, setClockNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setClockNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  const clockHours = String(clockNow.getHours()).padStart(2, '0');
  const clockMinutes = String(clockNow.getMinutes()).padStart(2, '0');
  const clockSeconds = String(clockNow.getSeconds()).padStart(2, '0');
  const clockDateLabel = clockNow.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  // ==================== КТО СЕЙЧАС НА СМЕНЕ (общая учётка на двоих) ====================
  // За пультом БСУ работают Семён и Максим под одной общей учёткой "Операторы"
  // (сделано намеренно — чтобы не заставлять их логиниться заново на каждой
  // смене). Это переключатель, кто из них сейчас за пультом — хранится ОДНОЙ
  // строкой в operator_shift_settings (см. scripts/operator-shift-settings.sql),
  // переключение — это UPDATE существующей строки, а не новая запись/логин.
  // Список доступных имён редактируется в карточке "Оператор" на странице
  // Клиенты → Стафф (без правки кода) — подтягиваем его отсюда же, вместе с
  // текущей активной сменой.
  const [operatorShiftNames, setOperatorShiftNames] = useState<string[]>(['Семён', 'Максим']);
  const [activeOperatorName, setActiveOperatorName] = useState<string | null>(null);
  const [shiftLoading, setShiftLoading] = useState(false);
  // До первого ответа сервера не знаем, выбрана ли смена — не показываем
  // напоминание, чтобы оно не "мигало" на долю секунды при каждой загрузке.
  const [shiftDataLoaded, setShiftDataLoaded] = useState(false);
  // Разрешаем закрыть напоминание "на потом" (например, если зашли просто
  // проверить данные) — но только на текущую вкладку/до следующей перезагрузки,
  // при новой загрузке страницы оно появится снова, пока смена не выбрана.
  const [shiftReminderDismissed, setShiftReminderDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/adminCifra/operator-shift');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setActiveOperatorName(data?.active_operator_name || null);
        if (Array.isArray(data?.available_names) && data.available_names.length > 0) {
          setOperatorShiftNames(data.available_names);
        }
      } catch (err) {
        console.error('Не удалось загрузить, кто на смене:', err);
      } finally {
        if (!cancelled) setShiftDataLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleShiftOperatorChange = async (name: string) => {
    // Состояние общее для всех, кто открывает страницу (см. showShiftReminder
    // ниже) — значит, админ/менеджер/диспетчер могут кликнуть по имени просто
    // из любопытства и молча поменять реальную смену оператору. Для роли
    // "operator" (общая учётка БСУ) — никаких подтверждений, переключение
    // должно быть мгновенным, в том числе при передаче смены среди дня.
    // Всем остальным — явное подтверждение с предупреждением.
    if (user?.role !== 'operator') {
      const confirmed = await appConfirm(
        `Вы вошли не как оператор БСУ (роль: ${user?.role || 'неизвестна'}).\n\n` +
        `Назначить смену «${name}»? Обычно это делает сам оператор на своём пульте — ` +
        `подтверждайте только если действительно нужно поменять/исправить смену вручную.`
      );
      if (!confirmed) return;
    }

    setActiveOperatorName(name); // оптимистично — переключение должно быть мгновенным
    setShiftLoading(true);
    try {
      const res = await fetch('/api/adminCifra/operator-shift', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_operator_name: name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Не удалось сохранить, кто на смене:', err);
    } finally {
      setShiftLoading(false);
    }
  };

  // ==================== ЗАМЕТНОЕ НАПОМИНАНИЕ "ВЫБЕРИ СЕБЯ" ====================
  // Показывается КАЖДОМУ, кто открывает страницу, пока смена не выбрана —
  // намеренно без привязки к роли залогиненного пользователя: и оператору
  // утром, и админу/менеджеру, если он просто откроет эту страницу проверить —
  // состояние общее для всех, кто на него смотрит.
  const showShiftReminder = shiftDataLoaded && !activeOperatorName && !shiftReminderDismissed && operatorShiftNames.length > 0;

  const pickShiftOperatorFromReminder = (name: string) => {
    handleShiftOperatorChange(name);
    setShiftReminderDismissed(true);
  };

  // ==================== ИДЕНТИЧНОСТЬ ОПЕРАТОРА (для записи в историю) ====================
  // Реальное имя того, кто сейчас на смене (Семён/Максим), приоритетнее
  // обезличенного имени общей учётки — так в истории заявки и логе
  // производства видно, кто конкретно выполнил действие.
  const { user } = useUserRole();
  const operatorName = activeOperatorName || user?.full_name || user?.username || 'Оператор';
  const operatorRole = user?.role || 'operator';

    // ==================== 0. УПРАВЛЕНИЕ ДАТОЙ ====================
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    // Берём локальную дату без времени (как в дашборде)
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

   // ==================== 0.1 РЕАЛЬНЫЕ ДАННЫЕ ====================

  // ==================== 0.1.1 ЧИСТКА "ОСИРОТЕВШИХ" ЗАПИСЕЙ ПРИ УДАЛЕНИИ/ОТКАТЕ СТАТУСА ====================
  // См. подробный комментарий у 1.2.2 ниже про то, что такое "осиротевший"
  // рейс. Раньше для чистки таких синтетических строк использовался диф
  // снапшота `rawMixers` — это оказалось неверным: `rawMixers` (см.
  // /api/adminCifra/active-mixers) изначально НЕ включает миксеры в статусах
  // "Разгружен"/"Возврат", поэтому у миксера, который был в этом статусе ещё
  // до открытия вкладки (и в rawMixers никогда не попадал), диф ошибочно
  // считал его "удалённым" и убирал совершенно рабочую строку другого рейса.
  // Поэтому чистим только по явным realtime-событиям конкретного миксера —
  // DELETE (миксер/заявку удалили) или UPDATE со статусом вне
  // "Разгружен"/"Возврат" (статус откатили назад) — а не по диффу массива.
  const removeOrphanTrip = (mixerId: any) => {
    setCompletedTrips((prev: any[]) =>
      prev.filter((t: any) => !(t.no_operator_record && String(t.order_mixer_id) === String(mixerId)))
    );
  };

  const { allMixers: rawMixers } = useTodayLoadingMixers({
    onMixerDeleted: (oldRecord: any) => removeOrphanTrip(oldRecord?.id),
    onMixerUpdated: (formatted: any) => {
      const orphanStatuses = new Set(['Разгружен', 'Возврат']);
      if (orphanStatuses.has(formatted?.status)) return; // статус всё ещё валиден для осиротевшей записи
      removeOrphanTrip(formatted?.id);
    },
  });

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


  // ==================== 0.3 ФОНОВАЯ ПРЕДЗАГРУЗКА ДАННЫХ ОТЧЁТОВ ====================
  // Запускается сразу при открытии страницы оператора — пока пользователь смотрит
  // на вкладку «Заявки», данные отчётов грузятся в фоне и кешируются.
  // Когда он кликнет «Отчёты» — диаграмма появится мгновенно.
  useEffect(() => {
    preloadReportsData();
  }, []);

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

  // ==================== 1.0A REALTIME-СИНХРОНИЗАЦИЯ ТАЙМЕРОВ ====================
  // Когда rawMixers обновляется по Supabase Realtime (оператор нажал «Начать»
  // на ДРУГОМ устройстве), синхронизируем loadingTrips / tripStartTimes на ЭТОМ
  // устройстве. Без этого менеджеры и администраторы видели кнопку «Начать»
  // вместо «В работе • N мин» и не видели смены статуса без перезагрузки.
  useEffect(() => {
    if (rawMixers.length === 0) return;

    setLoadingTrips(prev => {
      const next = { ...prev };
      let changed = false;
      rawMixers.forEach((m: any) => {
        const startTime = m.loading_started_at || m.loadingStartedAt;
        if (m.status === 'Загрузка' && startTime && !next[m.id]) {
          // Миксер начал загрузку — добавляем таймер
          next[m.id] = true;
          changed = true;
        } else if (m.status !== 'Загрузка' && next[m.id] !== undefined) {
          // Миксер ушёл из «Загрузки» — убираем таймер
          delete next[m.id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setTripStartTimes(prev => {
      const next = { ...prev };
      let changed = false;
      rawMixers.forEach((m: any) => {
        const startTime = m.loading_started_at || m.loadingStartedAt;
        if (m.status === 'Загрузка' && startTime && !next[m.id]) {
          next[m.id] = startTime;
          changed = true;
        } else if (m.status !== 'Загрузка' && next[m.id] !== undefined) {
          delete next[m.id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawMixers]);

    // ==================== 1.1 НАЧАТЬ ЗАГРУЗКУ ====================
  // Заявки в финальном статусе (диспетчер/менеджер уже закрыли или отменили)
  // не должны участвовать в загрузке — иначе сервер всё равно откажет на
  // шаге смены статуса миксера, а до этого момента интерфейс успеет создать
  // мусорную запись в "Отгружено сегодня" (см. историю заявки #604, 18.07.2026).
  const FINAL_ORDER_STATUSES_RU: Record<string, string> = { completed: 'Выполнена', cancelled: 'Отменена' };

  const startLoading = async (trip: any) => {
    if (trip.order_status && FINAL_ORDER_STATUSES_RU[trip.order_status]) {
      alert(`❌ Заявка #${trip.order_id || trip.orderId} уже в статусе "${FINAL_ORDER_STATUSES_RU[trip.order_status]}" — начать загрузку нельзя. Обратитесь к диспетчеру/менеджеру.`);
      return;
    }

    const now = new Date().toISOString();

    try {
      const res = await fetch('/api/adminCifra/order-mixers/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: trip.id, 
          status: 'Загрузка',
          loading_started_at: now,
          userName: operatorName,
          userRole: operatorRole,
          // Строка попадает в очередь только когда её статус "Загрузка" (см.
          // queueTrips выше) — если к моменту обработки запроса статус в БД
          // уже другой (диспетчер успел вручную его сменить), сервер отобьёт
          // явным конфликтом вместо того чтобы молча продолжить.
          expectedStatus: 'Загрузка',
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        if (data?.conflict) {
          alert(`❌ Статус миксера уже изменён (диспетчер/менеджер успел вмешаться) — ${data?.message || ''}`);
        } else {
          alert(`❌ Не удалось начать загрузку: ${data?.message || `HTTP ${res.status}`}`);
        }
        return;
      }

      setLoadingTrips(prev => ({ ...prev, [trip.id]: true }));
      setTripStartTimes(prev => ({ ...prev, [trip.id]: now }));

      // alert удалён — тихое выполнение при успехе
    } catch (err) {
      console.error(err);
      alert('Ошибка начала загрузки'); // оставляем только при ошибке
    }
  };

        // ==================== 1.2 ОТГРУЖЕНО СЕГОДНЯ (загрузка из базы) ====================
  const [completedTrips, setCompletedTrips] = useState<any[]>([]);

  // Загрузка отгруженных рейсов из базы — перезагружается при смене даты.
  // Всегда ?date=YYYY-MM-DD по orders.delivery_date (день заявки), без
  // ?today=true по created_at — иначе ночные рейсы двоились и становились «сиротами».
  useEffect(() => {
    let cancelled = false;
    const fetchCompletedTrips = async () => {
      try {
        const selStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
        const res = await fetch(`/api/adminCifra/production-log?date=${selStr}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setCompletedTrips(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Ошибка загрузки отгруженных рейсов:', err);
      }
    };

    fetchCompletedTrips();
    return () => { cancelled = true; };
  }, [selectedDate]);

  // Live-обновление ленты "Отгружено сегодня" — подхватывает записи от любого оператора
  useRealtimeProductionLogs(setCompletedTrips);

  // ==================== 1.2.1 ДОНАСЫЩЕНИЕ order_volume ДЛЯ ЧУЖИХ РЕЙСОВ ====================
  // Наша собственная оптимистичная запись (см. completeLoading ниже) уже несёт
  // order_volume из trip. Но если рейс завершил ДРУГОЙ оператор (в другой
  // вкладке/браузере) — сюда прилетает "сырая" строка через realtime
  // (postgres_changes), а там только колонки самой таблицы production_logs,
  // без JOIN на orders. Без этого поля колонка "Прогресс" навсегда (до
  // следующей перезагрузки страницы) показывала бы запасной текст "В пути"
  // вместо плашки. Подтягиваем объём заявки отдельным запросом и патчим все
  // строки этой заявки, у которых он ещё не известен.
  const enrichedOrderIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const missingOrderIds = Array.from(new Set(
      completedTrips
        .filter((t: any) => (t.order_id ?? t.orderId) != null && t.order_volume == null)
        .map((t: any) => String(t.order_id ?? t.orderId))
    )).filter(id => !enrichedOrderIdsRef.current.has(id));

    if (missingOrderIds.length === 0) return;

    missingOrderIds.forEach(id => enrichedOrderIdsRef.current.add(id));

    missingOrderIds.forEach(async (orderId) => {
      try {
        const res = await fetch(`/api/adminCifra/orders/${orderId}`);
        if (!res.ok) return;
        const order = await res.json();
        const volume = order?.volume;
        if (volume == null) return;

        setCompletedTrips(prev => prev.map((t: any) => {
          const tOrderId = String(t.order_id ?? t.orderId ?? '');
          return (tOrderId === orderId && t.order_volume == null) ? { ...t, order_volume: volume } : t;
        }));
      } catch (err) {
        console.error(`Не удалось донасытить объём заявки #${orderId} для колонки "Прогресс":`, err);
        enrichedOrderIdsRef.current.delete(orderId); // разрешаем повторную попытку при следующем обновлении
      }
    });
  }, [completedTrips]);

  // ==================== 1.2.2 "ОСИРОТЕВШИЕ" РЕЙСЫ — LIVE-ПОДХВАТ ====================
  // Дублирует ту же логику, что и на сервере (см. /api/adminCifra/production-log),
  // но работает мгновенно, без перезагрузки страницы: если диспетчер (в модалке
  // заявки) или водитель (в своём приложении) переводит миксер в "Разгружен"/
  // "Возврат" напрямую — эта смена статуса НЕ создаёт запись в production_logs
  // (создаёт её только кнопка оператора "Загружен"), но rawMixers (общий
  // realtime-поток по order_mixers, уже используемый очередью) её всё равно
  // получает. Раньше такой рейс был навечно не виден в "Отгружено сегодня", а
  // % отгрузки по заявке никогда не доходил до 100 — при следующей загрузке
  // страницы его подтянет API, а здесь — сразу, пока вкладка открыта.
  //
  // Ограничения (кейс #429):
  // 1) только рейсы дня выбранной заявки (delivery_date === selectedDate);
  // 2) если order_mixer_id уже есть в ленте (в т.ч. как обычный production_log) —
  //    не создавать orphan — иначе «В пути» от оператора + «Разгружен» сегодня
  //    давали ложную пометку сироты.
  useEffect(() => {
    const orphanStatuses = new Set(['Разгружен', 'Возврат']);
    const selectedDateStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
    const knownMixerIds = new Set(
      completedTrips
        .map((t: any) => t.order_mixer_id)
        .filter((id: any) => id != null)
        .map((id: any) => String(id))
    );

    const mixerDeliveryDate = (m: any) =>
      String(m.delivery_date ?? m.deliveryDate ?? '')
        .split('T')[0]
        .substring(0, 10)
        .trim();

    const newOrphans = rawMixers.filter((m: any) => {
      if (!orphanStatuses.has(m.status)) return false;
      if (knownMixerIds.has(String(m.id))) return false;
      const d = mixerDeliveryDate(m);
      // Без даты заявки live-сироту не добавляем — дождёмся ответа API,
      // иначе ночной рейс чужого дня легко попадёт в «сегодня».
      if (!d || d !== selectedDateStr) return false;
      return true;
    });

    if (newOrphans.length === 0) return;

    setCompletedTrips(prev => {
      const existingIds = new Set(
        prev.map((t: any) => String(t.order_mixer_id ?? '')).filter(Boolean)
      );
      const toAdd = newOrphans
        .filter((m: any) => !existingIds.has(String(m.id)))
        .map((m: any) => {
          const timestamp = m.unloadedAt || m.updated_at || m.created_at;
          return {
            id: `orphan-${m.id}`,
            order_id: m.orderId ?? m.order_id,
            order_mixer_id: m.id,
            mixer_name: m.number ?? m.mixer_name,
            concrete_grade: m.concrete_grade,
            volume: m.volume,
            podvizhnost: m.podvizhnost || 'П3',
            start_time: null,
            end_time: timestamp,
            duration_minutes: null,
            created_at: timestamp,
            order_volume: m.order_volume ?? null,
            delivery_date: mixerDeliveryDate(m),
            no_operator_record: true,
            // Статус миксера в момент попадания в этот список — нужен только
            // чтобы ниже (см. 1.2.3) сопоставить запись с order_history и
            // найти реального автора действия. В UI не отображается.
            mixer_status: m.status,
          };
        });

      return toAdd.length > 0 ? [...toAdd, ...prev] : prev;
    });
  }, [rawMixers, completedTrips, selectedDate]);

  // ==================== 1.2.3 АТРИБУЦИЯ АВТОРА "ОСИРОТЕВШЕГО" РЕЙСА ====================
  // Live-подхват выше (1.2.2) создаёт запись мгновенно из rawMixers, но там
  // нет информации о том, кто именно поменял статус (order_mixers это не
  // хранит) — только "Диспетчер" как обезличенный запасной вариант. Реальное
  // имя/роль лежат в order_history (см. production-log/route.ts — там та же
  // атрибуция уже подтягивается при полной перезагрузке страницы). Дотягиваем
  // её и сюда, чтобы не дожидаться перезагрузки вкладки.
  const enrichedOrphanIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = completedTrips.filter(
      (t: any) => t.no_operator_record && t.actor_name == null && t.mixer_status && (t.order_id ?? t.orderId) != null
    ).filter((t: any) => !enrichedOrphanIdsRef.current.has(String(t.id)));

    if (pending.length === 0) return;
    pending.forEach((t: any) => enrichedOrphanIdsRef.current.add(String(t.id)));

    pending.forEach(async (trip: any) => {
      const orderId = String(trip.order_id ?? trip.orderId);
      try {
        const res = await fetch(`/api/adminCifra/order-history?orderId=${orderId}`);
        if (!res.ok) return;
        const history = await res.json();
        const targetMarker = `на "${trip.mixer_status}"`;
        const match = (Array.isArray(history) ? history : []).find(
          (h: any) => h.action?.includes('Изменил статус миксера') && h.action?.includes(trip.mixer_name) && h.action?.includes(targetMarker)
        );
        if (!match) return;

        setCompletedTrips(prev => prev.map((t: any) =>
          String(t.id) === String(trip.id) ? { ...t, actor_name: match.user_name || null, actor_role: match.user_role || null } : t
        ));
      } catch (err) {
        console.error(`Не удалось определить автора осиротевшего рейса заявки #${orderId}:`, err);
        enrichedOrphanIdsRef.current.delete(String(trip.id));
      }
    });
  }, [completedTrips]);

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

    if (trip.order_status && FINAL_ORDER_STATUSES_RU[trip.order_status]) {
      alert(`❌ Заявка #${trip.order_id || trip.orderId} уже в статусе "${FINAL_ORDER_STATUSES_RU[trip.order_status]}" — завершить загрузку нельзя. Обратитесь к диспетчеру/менеджеру.`);
      return;
    }

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
      // Без этого поля колонка "Прогресс" сразу после нажатия "Загружен" на
      // мгновение показывала запасной текст "В пути" вместо плашки — trip
      // (строка из очереди) уже содержит order_volume из active-mixers, дальше
      // тянуть его неоткуда не нужно.
      order_volume: trip.order_volume ?? null,
      // День заявки — чтобы лента не теряла оптимистичную строку и не
      // путала её с чужим календарным днём по UTC created_at.
      delivery_date: String(trip.delivery_date || '')
        .split('T')[0]
        .substring(0, 10)
        .trim() || undefined,
      operator_name: operatorName,
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
  //
  // ⚠️ Постоянные бизнес-ошибки (400/404/409 — заявка уже финальная, конфликт
  // optimistic lock и т.п.) — это НЕ временный сбой сети, повторять их 5-6 раз
  // с нарастающей паузой (до ~80 сек) бессмысленно и только маскирует
  // реальную причину. Для таких статусов возвращаем ответ сразу, не бросая
  // исключение — вызывающий код читает message/conflict из тела и решает,
  // что показать оператору.
  const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

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
        if (!res.ok && NON_RETRYABLE_STATUSES.has(res.status)) return res;
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
          start_time: startTime,
          // Кто из операторов смены реально оформил рейс — для статистики
          // в карточке "Оператор" (Клиенты → Стафф). Не путать с userName в
          // соседнем вызове order-mixers/status — то уходит в order_history,
          // это отдельно в саму запись рейса (нужно для агрегации объёма/м³).
          operator_name: operatorName,
        })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) {
        // Постоянная бизнес-ошибка (заявка уже финальная и т.п.) — рейс НЕ
        // записан на сервере, хотя оптимистично уже показан в "Отгружено
        // сегодня". Раньше это тонуло в console.error и выглядело как успех —
        // теперь явно сообщаем оператору, чтобы запись не считалась "мусорной".
        console.error(`❌ [Оператор] Рейс миксера ${trip.mixer_name || trip.number || trip.id} НЕ записан на сервере: ${json?.message || `HTTP ${res.status}`}`);
        alert(`⚠️ Рейс миксера ${trip.mixer_name || trip.number || trip.id} не удалось записать: ${json?.message || 'ошибка сервера'}. Обратитесь к диспетчеру.`);
      } else {
        const realId = json?.data?.id;
        const gradeFromServer = json?.data?.concrete_grade;
        if (realId || gradeFromServer) {
          setCompletedTrips((prev) =>
            prev.map((l) =>
              l.id === tempId
                ? {
                    ...l,
                    ...(realId ? { id: realId } : {}),
                    // Марка с сервера (актуальная из заявки) — не кэш очереди.
                    ...(gradeFromServer != null && gradeFromServer !== ''
                      ? { concrete_grade: gradeFromServer }
                      : {}),
                  }
                : l
            )
          );
        }
      }
    } catch (err) {
      console.error(`❌ [Оператор] Не удалось записать отгрузку миксера ${trip.mixer_name || trip.number || trip.id} после всех попыток:`, err);
    }

    // Шаг 2: смена статуса миксера на "В пути" — это главное, повторяем настойчивее
    try {
      const res = await fetchWithRetry(
        '/api/adminCifra/order-mixers/status',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: trip.id,
            status: 'В пути',
            userName: operatorName,
            userRole: operatorRole,
            // Мы стартовали загрузку от статуса "Загрузка" — если к моменту
            // завершения он в БД уже другой (диспетчер вручную вмешался в
            // процессе), это конфликт, а не обычная перезапись (см. lib/orderMixers.ts).
            expectedStatus: 'Загрузка',
          })
        },
        { attempts: 6, timeoutMs: 8000, baseDelayMs: 2000 }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || json?.success === false) {
        if (json?.conflict) {
          // Не гонка сети — статус реально сменил кто-то другой (диспетчер/
          // менеджер) пока оператор грузил миксер. Дальше настойчиво повторять
          // нечего: это не должно тихо перезаписывать чужое решение.
          console.error(`⚠️ [Оператор] Конфликт статуса миксера ${trip.mixer_name || trip.number || trip.id}: ${json?.message}`);
          alert(`⚠️ Статус миксера ${trip.mixer_name || trip.number || trip.id} уже изменил диспетчер/менеджер. Ваше "Завершить загрузку" не применено — уточните у диспетчера актуальный статус рейса.`);
        } else {
          throw new Error(json?.message || `HTTP ${res.status}`);
        }
      } else {
        // ✅ подтверждено — снимаем красную точку у соответствующей строки
        setCompletedTrips(prev =>
          prev.map(l => (String(l.order_mixer_id) === String(trip.id) ? { ...l, _pending: false } : l))
        );
      }
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


  // ==================== ФИЛЬТР ЛЕНТЫ ПО ДНЮ ЗАЯВКИ ====================
  // День учёта = orders.delivery_date. Не используем UTC-префикс created_at:
  // загрузка в 01:01 МСК (= 22:01 UTC «вчера») иначе уезжала в чужой день.
  const filteredCompletedTrips = completedTrips
    .filter((trip: any) => {
      if (!trip) return false;

      let tripDateStr = '';
      if (trip.delivery_date) {
        tripDateStr = String(trip.delivery_date).split('T')[0].substring(0, 10).trim();
      } else if (trip.orders?.delivery_date) {
        tripDateStr = String(trip.orders.delivery_date).split('T')[0].substring(0, 10).trim();
      }

      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const selectedDateStr = `${year}-${month}-${day}`;

      // Нет даты (оптимистичная строка / сырой realtime без JOIN) — оставляем:
      // API и live-сироты уже режут по дню заявки. Если дата есть — строго
      // сверяем с выбранным днём.
      if (!tripDateStr) return true;
      return tripDateStr === selectedDateStr;
    })
    .map((trip: any) => ({
      ...trip,
      // У "осиротевших" рейсов (no_operator_record — статус выставлен
      // диспетчером/водителем напрямую) start_time никогда не известен, но
      // время самого действия есть — end_time/created_at (это unloaded_at
      // миксера). Раньше в таком случае колонка "Время" показывала "—",
      // хотя фактическое время у нас есть, просто в другом поле.
      time: trip.start_time 
        ? new Date(trip.start_time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) 
        : trip.time
        ? trip.time
        : (trip.end_time || trip.created_at)
        ? new Date(trip.end_time || trip.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        : '—',
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

  // ==================== 1.3 ПРОГРЕСС ПО ЗАЯВКЕ (для колонки "Прогресс") ====================
  // N/M, где N — сколько рейсов по заявке УЖЕ отгружено сегодня (есть запись
  // в production_logs), а M — оценка ИТОГОВОГО числа рейсов на всю заявку,
  // с учётом общего объёма заявки (order_volume):
  //   остаток объёма = объём заявки − (отгружено + уже стоит в очереди);
  //   средний рейс = средний объём уже известных рейсов этой заявки
  //     (отгруженные + в очереди), а если рейсов пока нет вообще — берём
  //     эмпирику ~9 м³ (так ездит подавляющее большинство рейсов);
  //   ещё рейсов ≈ ceil(остаток объёма / средний рейс).
  // M = отгружено + в очереди + ещё рейсов(оценка).
  // По мере того как диспетчер добавляет в очередь реальные миксеры —
  // "остаток объёма" уменьшается, а "оценка" пересчитывается сама, потому
  // что map зависит от queueTrips/filteredCompletedTrips и пересчитывается
  // при каждом их обновлении.
  const DEFAULT_AVG_TRIP_VOLUME_M3 = 9;

  const orderProgressMap = useMemo(() => {
    const map = new Map<string, {
      dispatchedCount: number;
      dispatchedVolume: number;
      queuedCount: number;
      queuedVolume: number;
      orderVolume: number | null;
    }>();

    const getEntry = (orderId: string) => {
      let entry = map.get(orderId);
      if (!entry) {
        entry = { dispatchedCount: 0, dispatchedVolume: 0, queuedCount: 0, queuedVolume: 0, orderVolume: null };
        map.set(orderId, entry);
      }
      return entry;
    };

    filteredCompletedTrips.forEach((trip: any) => {
      const orderId = String(trip.order_id ?? trip.orderId ?? '');
      if (!orderId) return;
      const entry = getEntry(orderId);
      entry.dispatchedCount += 1;
      entry.dispatchedVolume += parseFloat(trip.volume) || 0;
      if (entry.orderVolume === null && trip.order_volume != null) {
        entry.orderVolume = parseFloat(trip.order_volume) || null;
      }
    });

    queueTrips.forEach((trip: any) => {
      const orderId = String(trip.order_id ?? trip.orderId ?? '');
      if (!orderId) return;
      const entry = getEntry(orderId);
      entry.queuedCount += 1;
      entry.queuedVolume += parseFloat(trip.volume) || 0;
      if (entry.orderVolume === null && trip.order_volume != null) {
        entry.orderVolume = parseFloat(trip.order_volume) || null;
      }
    });

    const result = new Map<string, {
      dispatched: number;
      total: number;
      dispatchedVolume: number;
      orderVolume: number | null;
    }>();
    map.forEach((entry, orderId) => {
      const knownCount = entry.dispatchedCount + entry.queuedCount;
      const knownVolume = entry.dispatchedVolume + entry.queuedVolume;
      const avgTripVolume = knownCount > 0 ? knownVolume / knownCount : DEFAULT_AVG_TRIP_VOLUME_M3;

      let estimatedRemainingTrips = 0;
      if (entry.orderVolume != null && entry.orderVolume > 0) {
        const remainingVolume = Math.max(0, entry.orderVolume - knownVolume);
        estimatedRemainingTrips = remainingVolume > 0 ? Math.ceil(remainingVolume / avgTripVolume) : 0;
      }

      result.set(orderId, {
        dispatched: entry.dispatchedCount,
        total: knownCount + estimatedRemainingTrips,
        // Для колонки "Отгружено сегодня" — фактический объём (без оценки),
        // сколько кубов уже реально уехало по этой заявке к этому моменту.
        dispatchedVolume: entry.dispatchedVolume,
        orderVolume: entry.orderVolume
      });
    });

    return result;
  }, [filteredCompletedTrips, queueTrips]);

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
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      flex: 1,
      minHeight: 0,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxSizing: 'border-box'
    }}>

      {/* ==================== 2. ВЕРХНЯЯ ПАНЕЛЬ ==================== */}
      <div style={{
        backgroundColor: '#1E2937',
        padding: '14px 32px',
        borderRadius: '20px 20px 0 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0
      }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <UserCog size={26} color="#94A3B8" />
            Бетонный завод
          </h1>
          <div style={{ color: '#94A3B8', fontSize: '14px', marginTop: '2px' }}>Оператор БСУ • Реальное время</div>
        </div>

        {/* ==================== ЧАСЫ РЕАЛЬНОГО ВРЕМЕНИ ==================== */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: '#25334A',
            border: '1px solid #334155',
            borderRadius: '16px',
            padding: '6px 26px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '2px',
              fontFamily: "'SF Mono', 'Consolas', 'Menlo', monospace",
              lineHeight: 1
            }}>
              <span style={{ fontSize: '30px', fontWeight: '700', color: '#fff', letterSpacing: '0.5px' }}>
                {clockHours}:{clockMinutes}
              </span>
              <span style={{ fontSize: '16px', fontWeight: '600', color: '#10B981', marginLeft: '4px' }}>
                {clockSeconds}
              </span>
            </div>
            <div style={{ fontSize: '11.5px', color: '#94A3B8', marginTop: '2px', textTransform: 'capitalize' }}>
              {clockDateLabel}
            </div>
          </div>
        </div>

        {/* ==================== ПЕРЕКЛЮЧАТЕЛЬ "КТО НА СМЕНЕ" ==================== */}
        {/* Общая учётка на двоих (Семён/Максим) — выбор здесь не меняет логин,
            только подписывает будущие действия реальным именем и переключает
            одну строку в БД (см. handleShiftOperatorChange выше). */}
        <div
          title="Кто сейчас за пультом — влияет на подпись в истории заявок"
          style={{
            backgroundColor: '#25334A',
            padding: '10px 16px 10px 20px',
            borderRadius: '9999px',
            fontSize: '15px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            opacity: shiftLoading ? 0.7 : 1,
          }}
        >
          Смена:
          <ModalSelect
            value={activeOperatorName || ''}
            onChange={(name) => handleShiftOperatorChange(name)}
            placeholder="Выбрать…"
            chevronColor={activeOperatorName ? '#10B981' : '#94A3B8'}
            minPopupWidth={160}
            triggerStyle={{
              background: 'transparent',
              border: 'none',
              color: activeOperatorName ? '#10B981' : '#94A3B8',
              fontWeight: 600,
              fontSize: 15,
              padding: 0,
              boxShadow: 'none',
            }}
            options={operatorShiftNames.map((name) => ({
              value: name,
              label: name,
              text: name,
            }))}
          />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '14px 32px', boxSizing: 'border-box', overflow: 'hidden' }}>

        {/* ==================== 2. ТАБЫ (выше статистики — не прыгают при переключении) ==================== */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '14px',
          borderBottom: '1px solid #334155',
          paddingBottom: '8px',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', gap: '48px', alignItems: 'center' }}>
            {([
              { key: 'zayavki' as const, label: 'Заявки' },
              { key: 'warehouse' as const, label: 'Склад' },
              { key: 'reports' as const, label: 'Отчеты' },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
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

            {/* Лаборатория — dropdown по клику */}
            <div ref={labMenuRef} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => {
                  if (activeTab !== 'recipes') {
                    setActiveTab('recipes');
                    setLabMenuOpen(true);
                  } else {
                    setLabMenuOpen((v) => !v);
                  }
                }}
                style={{
                  padding: '12px 0',
                  background: 'transparent',
                  border: 'none',
                  fontSize: '17px',
                  fontWeight: '600',
                  color: activeTab === 'recipes' ? '#10B981' : '#64748B',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'color 0.2s',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                Лаборатория
                <ChevronDown
                  size={16}
                  style={{
                    opacity: 0.85,
                    transform: labMenuOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.15s ease',
                  }}
                />
                {activeTab === 'recipes' && (
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

              {labMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 10px)',
                    left: 0,
                    minWidth: '220px',
                    background: '#1E2937',
                    border: '1px solid #334155',
                    borderRadius: '14px',
                    boxShadow: '0 16px 36px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.3)',
                    padding: '8px',
                    zIndex: 40,
                  }}
                >
                  {LAB_MENU_ITEMS.map((item) => {
                    const active = activeTab === 'recipes' && labTab === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setActiveTab('recipes');
                          setLabTab(item.key);
                          setLabMenuOpen(false);
                        }}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 12px',
                          background: active ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                          border: active ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid transparent',
                          borderRadius: '10px',
                          color: active ? '#10B981' : '#E2E8F0',
                          fontSize: '15px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                  <div style={{ height: 1, background: '#334155', margin: '6px 4px' }} />
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('recipes');
                      setLabRequisitesKey((k) => k + 1);
                      setLabMenuOpen(false);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 12px',
                      background: 'transparent',
                      border: '1px solid transparent',
                      borderRadius: '10px',
                      color: '#94A3B8',
                      fontSize: '15px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Реквизиты
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ==================== 3. БЛОК СТАТИСТИКИ (только на вкладке Заявки) ==================== */}
        {activeTab === 'zayavki' && (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
            gap: '14px',
            marginBottom: '14px',
            flexShrink: 0
          }}>
            {stats.map((stat, index) => (
              <div key={index} style={volumeCardStyle({
                borderRadius: 18,
                padding: '14px 18px',
              })}>
                <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '6px' }}>
                  {stat.label}
                </div>
                <div style={{ 
                  fontSize: '26px', 
                  fontWeight: '700', 
                  color: stat.color,
                  marginBottom: '2px'
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

        {/* ==================== 4. ОСНОВНОЙ КОНТЕНТ ==================== */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'zayavki' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 660px', gap: '20px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {/* Правая колонка зафиксирована в 600px (её строкам этого достаточно, см.
                ниже) — левая забирает всё оставшееся место. minmax(0, 1fr) вместо
                просто 1fr обязателен: без него grid-колонка не может стать уже
                контента внутри (умалчиваемый min-width: auto), из-за чего левая
                панель раньше "выталкивалась" за пределы экрана на 1920 и ниже. */}
                                                {/* ==================== 4.1 ОЧЕРЕДЬ НА ЗАГРУЗКУ ==================== */}
            <div style={volumeCardStyle({
              borderRadius: 22,
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflow: 'hidden',
              minWidth: 0,
            })}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexShrink: 0 }}>
                <h2 style={{ fontSize: '19px', fontWeight: '600' }}>
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

              {/* Шапка колонок. white-space: nowrap + overflow: hidden обязательны
                  на каждой ячейке — иначе при недостатке ширины текст либо
                  переносится на 2 строки ("№ заявки"), либо визуально "вылезает"
                  в соседнюю колонку и сливается с её текстом ("Подвижность"
                  наезжала на "Клиент / Организация"). */}
              <div style={{
                display: 'grid',
                // Ширины подобраны замером фактического текста заголовков тем же
                // шрифтом (canvas measureText) — раньше "№ заявки"/"Подвижность"/
                // "Прогресс" не влезали и обрезались "…" прямо в шапке. Колонку
                // "Клиент" сократили здесь до одного слова (полное название всё
                // равно не влезло бы физически — у нас в базе организации по
                // 30-35 символов, — а по наведению есть title с полным именем).
                gridTemplateColumns: '56px 70px 105px 122px 62px 98px 70px 1fr 260px',
                gap: '10px',
                padding: '8px 18px',
                color: '#94A3B8',
                fontSize: '13.5px',
                fontWeight: '500',
                borderBottom: '1px solid #334155',
                marginBottom: '10px',
                flexShrink: 0
              }}>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'left' }}>Время</div>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'center' }}>№ заявки</div>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'center' }}>№ миксера</div>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'left' }}>Марка</div>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'center' }}>Объём</div>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'center' }}>Подвижность</div>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'center' }}>Прогресс</div>
                <div title="Клиент / Организация" style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'left' }}>Клиент</div>
                <div></div>
              </div>

              <div className="scroll-hidden" style={{ display: 'flex', flexDirection: 'column', gap: '9px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
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

                      style={volumeCardSoftStyle({
                        borderRadius: 12,
                        padding: '13px 18px',
                        display: 'grid',
                        gridTemplateColumns: '56px 70px 105px 122px 62px 98px 70px 1fr 260px',
                        gap: '10px',
                        alignItems: 'center',
                        minHeight: '28px',
                        fontSize: '15px',
                        cursor: 'pointer',
                      })}
                    >
                      <div style={{ fontWeight: '600', color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{trip.time || '—'}</div>
                      <div style={{ fontWeight: '700', color: '#60A5FA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        #{trip.order_id || trip.orderId || '—'}
                      </div>
                      <div style={{ fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {trip.mixer_name || trip.number || '—'}
                      </div>
                      {/* Марка может быть длинным текстом (например, "Ц/П смесь М100"),
                          а не только "M400" — title показывает полный текст при
                          наведении, даже если он обрезан "…" из-за нехватки места. */}
                      <div title={trip.concrete_grade || ''} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{trip.concrete_grade || '—'}</div>
                      <div style={{ fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>{trip.volume} м³</div>

                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ justifySelf: 'center', width: 64 }}
                      >
                        <ModalSelect
                          value={podvizhnostOverrides[trip.id] ?? trip.podvizhnost ?? 'П3'}
                          onChange={async (newPodvizhnost) => {
                            try {
                              await fetch('/api/adminCifra/order-mixers/status', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  id: trip.id,
                                  podvizhnost: newPodvizhnost,
                                }),
                              });

                              setPodvizhnostOverrides((prev) => ({
                                ...prev,
                                [trip.id]: newPodvizhnost,
                              }));
                            } catch (err) {
                              console.error('Ошибка сохранения подвижности:', err);
                              alert('Не удалось сохранить подвижность');
                            }
                          }}
                          minPopupWidth={80}
                          chevronColor="#94A3B8"
                          triggerStyle={{
                            padding: '7px 8px',
                            background: '#1E2937',
                            border: 'none',
                            borderRadius: 6,
                            color: '#fff',
                            fontSize: 14,
                            width: 64,
                            boxShadow: 'none',
                          }}
                          options={['П1', 'П2', 'П3', 'П4', 'П5'].map((v) => ({
                            value: v,
                            label: v,
                            text: v,
                          }))}
                        />
                      </div>

                      {/* Прогресс по заявке: N — сколько рейсов уже отгружено сегодня,
                          M — оценка итогового числа рейсов на всю заявку с учётом её
                          общего объёма и среднего объёма уже известных рейсов (см.
                          orderProgressMap выше — там же вся логика расчёта). */}
                      {(() => {
                        const orderId = String(trip.order_id ?? trip.orderId ?? '');
                        const progress = orderProgressMap.get(orderId);
                        const dispatched = progress?.dispatched ?? 0;
                        const total = progress?.total ?? 1;
                        return (
                          <div
                            title={`Отгружено ${dispatched} из ~${total} рейсов по заявке #${orderId} (оценка по объёму, на текущий момент)`}
                            style={{
                              fontSize: '13.5px',
                              fontWeight: '600',
                              color: dispatched > 0 ? '#34D399' : '#64748B',
                              textAlign: 'center',
                              overflow: 'hidden',
                              whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            {dispatched}/{total}
                          </div>
                        );
                      })()}

                      {/* Названия организаций у нас реально доходят до 30-35 символов
                          ("АО «БРЯНСКАВТОДОР» Брянский ДРСУч" и т.п.) — колонка
                          физически не может показать такие целиком при любой разумной
                          ширине, поэтому обрезка "…" здесь неизбежна в любом случае;
                          title — обязательная подсказка с полным названием. */}
                      <div title={client} style={{ 
                        fontSize: '14.5px', 
                        color: '#E2E8F0',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        textAlign: 'left'
                      }}>
                        {client}
                      </div>

                      <div style={{ display: 'flex', gap: '5px', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'nowrap', overflow: 'hidden' }}>
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            startLoading(trip); 
                          }} 
                          disabled={loadingTrips[trip.id]}
                          style={{ 
                            padding: '6px 11px', 
                            background: loadingTrips[trip.id] ? '#475569' : '#10B981', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '9999px', 
                            fontSize: '12.5px', 
                            fontWeight: '600',
                            cursor: loadingTrips[trip.id] ? 'not-allowed' : 'pointer',
                            minWidth: '90px',
                            whiteSpace: 'nowrap',
                            flexShrink: 0
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
                            padding: '6px 11px', 
                            background: loadingTrips[trip.id] && !completingTripIds.has(trip.id) ? '#3B82F6' : '#475569', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '9999px', 
                            fontSize: '12.5px', 
                            fontWeight: '600',
                            cursor: loadingTrips[trip.id] && !completingTripIds.has(trip.id) ? 'pointer' : 'not-allowed',
                            whiteSpace: 'nowrap',
                            flexShrink: 0
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
            <div style={volumeCardStyle({
              borderRadius: 22,
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflow: 'hidden',
            })}>
              <h2 style={{ fontSize: '19px', fontWeight: '600', marginBottom: '14px', color: '#10B981', flexShrink: 0 }}>
                🚚 Отгружено сегодня ({filteredCompletedTrips.length})
              </h2>

              {/* Раньше у этой панели не было шапки колонок вовсе — цифры прогресса
                  в последней колонке ("22/22 м³") показывались без каких-либо
                  подписей и выглядели как "просто числа" без контекста. Добавили
                  шапку с той же сеткой колонок, что и у строк ниже. */}
              <div style={{
                display: 'grid',
                // Объём 56px: «6.5 м³» не влезало в 40px и обрезалось до «6.5…»
                gridTemplateColumns: '48px 40px 88px 96px 56px 154px 1fr',
                gap: '8px',
                padding: '0 16px 8px',
                color: '#94A3B8',
                fontSize: '11.5px',
                fontWeight: '500',
                borderBottom: '1px solid #334155',
                marginBottom: '10px',
                flexShrink: 0
              }}>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>Время</div>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>№</div>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>Миксер</div>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>Марка</div>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>Объём</div>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', borderRight: '1px solid #334155', paddingRight: '10px' }}>Статус</div>
                <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', textAlign: 'right' }}>Прогресс</div>
              </div>

              <div className="scroll-hidden" style={{ display: 'flex', flexDirection: 'column', gap: '9px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {filteredCompletedTrips.length > 0 ? filteredCompletedTrips.map((trip) => (
                  <div 
                    key={trip.id}
                    title={trip.no_operator_record
                      ? `Статус выставлен ${
                          trip.actor_name
                            ? `«${trip.actor_name}»${trip.actor_role ? ` (${ORPHAN_ACTOR_ROLE_LABELS[trip.actor_role] || trip.actor_role})` : ''}`
                            : 'диспетчером/менеджером/водителем'
                        } напрямую, минуя кнопку "Загружен" у оператора БСУ — точного времени загрузки нет`
                      : undefined}
                    style={volumeCardSoftStyle({
                      borderRadius: 12,
                      padding: '12px 16px',
                      display: 'grid',
                      // Фиксированные колонки вместо flex+space-between — иначе на
                      // широких экранах (4K) панель просто "растягивала" пустое
                      // место между блоком данных и статусом справа, визуально
                      // выглядя чрезмерно широкой. Ширины подобраны так, чтобы
                      // всё гарантированно помещалось в одну строку без переноса
                      // при фиксированной ширине самой панели (660px, см. grid
                      // родителя выше).
                      gridTemplateColumns: '48px 40px 88px 96px 56px 154px 1fr',
                      gap: '8px',
                      alignItems: 'center',
                      minHeight: '28px',
                      fontSize: '13.5px',
                      // Рейс, никогда не прошедший через кнопку оператора "Загружен"
                      // (статус выставлен диспетчером/водителем напрямую) — выделяем
                      // янтарной полосой слева, чтобы это было заметно с первого взгляда.
                      ...(trip.no_operator_record
                        ? { boxShadow: `${CARD_VOLUME_SOFT}, inset 3px 0 0 #F59E0B` }
                        : {}),
                    })}
                  >
                      <div style={{ fontWeight: '600', color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {trip.time || '—'}
                      </div>
                      <div style={{ fontWeight: '700', color: '#60A5FA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        #{trip.order_id || trip.orderId}
                      </div>
                      <div style={{ fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden' }}>
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
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {trip.mixer_name || trip.number || '—'}
                        </span>
                      </div>
                      
                      {/* ==================== ОТОБРАЖЕНИЕ ПОДВИЖНОСТИ ==================== */}
                      {/* Марка может быть длинным текстом ("Ц/П смесь М100" и т.п.) —
                          title показывает полный текст при наведении, даже если
                          он обрезан "…" из-за нехватки места в колонке. */}
                      <div title={trip.concrete_grade || ''} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {trip.concrete_grade || '—'} 
                        <span style={{ 
                          color: '#10B981', 
                          fontWeight: '600', 
                          marginLeft: '6px' 
                        }}>
                          {podvizhnostOverrides[trip.id] || trip.podvizhnost || 'П3'}
                        </span>
                      </div>
                      {/* ======================================================== */}

                      <div style={{ fontWeight: '600', whiteSpace: 'nowrap' }}>
                        {trip.volume} м³
                      </div>
                      {/* alignSelf: 'stretch' — растягиваем ячейку на всю высоту строки
                          (у самой строки alignItems: 'center', из-за чего ячейки по
                          умолчанию только по размеру контента), иначе тонкая серая
                          линия-разделитель перед колонкой "Прогресс" была бы всего в
                          пару пикселей высотой вместо всей строки. */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        alignSelf: 'stretch',
                        borderRight: '1px solid #334155',
                        paddingRight: '10px',
                        overflow: 'hidden'
                      }}>
                        {trip._pending ? (
                          <div style={{ color: '#F59E0B', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="Сохраняется, статус миксера подтверждается">
                            ⏳ Сохранение…
                          </div>
                        ) : trip.no_operator_record ? (
                          <div
                            style={{ color: '#F59E0B', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title={trip.actor_name || (trip.actor_role && ORPHAN_ACTOR_ROLE_LABELS[trip.actor_role]) || undefined}
                          >
                            🖊️ {trip.actor_name || (trip.actor_role && ORPHAN_ACTOR_ROLE_LABELS[trip.actor_role]) || 'Диспетчер'}
                          </div>
                        ) : (
                          <div style={{ color: '#10B981', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            ✓ Загружен • {trip.loadedTime || '—'}
                          </div>
                        )}
                      </div>
                    {/* Последняя колонка узкая (~58-90px в зависимости от разрешения) —
                        расширять саму панель ради неё нельзя, это отъедает место у
                        левой панели (см. общий grid родителя). Раньше тут всегда был
                        статичный текст "В пути" — он одинаков для КАЖДОЙ строки этого
                        списка (это данные из production_logs, статус после отгрузки
                        уже не отслеживается), т.е. не нёс никакой информации. Ставим
                        на его место более полезный прогресс по объёму заявки, а "В
                        пути" оставляем как запасной вариант, если объём заявки
                        неизвестен (чтобы ячейка не была пустой). */}
                    {(() => {
                      const orderId = String(trip.order_id ?? trip.orderId ?? '');
                      const progress = orderProgressMap.get(orderId);
                      if (!progress || progress.orderVolume == null || progress.orderVolume <= 0) {
                        return (
                          <div style={{ color: '#64748B', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>В пути</div>
                        );
                      }

                      const delivered = Math.round(progress.dispatchedVolume * 10) / 10;
                      const total = Math.round(progress.orderVolume * 10) / 10;
                      const isComplete = delivered >= total;
                      const percent = Math.min(100, Math.round((delivered / total) * 100));

                      // Показываем % вместо "N из M м³" — дробная запись у крупных
                      // заявок (например, 635 из 635 м³) физически не влезает ни в
                      // одну разумную ширину колонки, а процент всегда занимает
                      // максимум 4 символа ("100%") при любом объёме заявки. Точные
                      // кубы — в подсказке по наведению.
                      return (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
                          <div
                            title={`По заявке #${orderId} отгружено ${delivered} из ${total} м³ (${percent}%)`}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '3px',
                              padding: '3px 7px',
                              borderRadius: '9999px',
                              background: isComplete ? 'rgba(16, 185, 129, 0.16)' : 'rgba(148, 163, 184, 0.14)',
                              maxWidth: '100%'
                            }}
                          >
                            <span style={{
                              fontSize: '11px',
                              fontWeight: '600',
                              color: isComplete ? '#34D399' : '#94A3B8',
                              whiteSpace: 'nowrap',
                              textAlign: 'center'
                            }}>
                              {percent}%
                            </span>
                            <div style={{ width: '30px', height: '3px', borderRadius: '2px', background: 'rgba(148, 163, 184, 0.25)', overflow: 'hidden' }}>
                              <div style={{
                                width: `${percent}%`,
                                height: '100%',
                                background: isComplete ? '#10B981' : '#3B82F6',
                                borderRadius: '2px'
                              }} />
                            </div>
                          </div>
                        </div>
                      );
                    })()}
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
        {/* Скролл только если контент выше экрана — карточки силосов/добавок
            держим крупными, без искусственного растягивания. */}
        {activeTab === 'warehouse' && (
          <div className="scroll-hidden" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <WarehousePage
              recipes={recipes}
              // Смену Семён/Максим передаём только общей учётке оператора.
              // Админ/менеджер на этой вкладке должны писаться своим ФИО.
              actorName={user?.role === 'operator' ? operatorName : null}
            />
          </div>
        )}
        {/* ==================== ОТЧЕТЫ ==================== */}
        {/* Без скролла — ReportsPage сама умещает всё содержимое в доступную
            высоту (адаптивно под 4K/1920/меньшие разрешения). */}
        {activeTab === 'reports' && (
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <ReportsPage />
          </div>
        )}
        {/* ==================== РЕЦЕПТЫ ==================== */}
        {activeTab === 'recipes' && (
          <div className="scroll-hidden" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <RecipesPage
              embedded
              tab={labTab}
              onTabChange={setLabTab}
              openRequisitesKey={labRequisitesKey}
            />
          </div>
        )}
        </div>
      </div>    

   {/* ==================== 5. МОДАЛЬНОЕ ОКНО ==================== */}
      {selectedTrip && (
        <div 
          style={{
            position: 'fixed', 
            inset: 0, 
            backgroundColor: 'rgba(0,0,0,0.82)', 
            zIndex: 1000,
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center'
          }} 
          onClick={() => setSelectedTrip(null)}
        >
          <div 
            className="scroll-hidden"
            style={volumeModalStyle({ 
              padding: '32px', 
              borderRadius: 24, 
              width: '100%',
              maxWidth: '680px',
              maxHeight: '90vh',
              overflowY: 'auto',
              color: '#fff',
              margin: '0 16px',
            })} 
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '28px', fontWeight: '700', margin: 0 }}>
                Рейс #{selectedTrip.id || selectedTrip.orderId}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedTrip(null)}
                title="Закрыть"
                style={modalCloseButtonStyle()}
              >
                ×
              </button>
            </div>

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
              <div style={volumeCardSoftStyle({
                padding: '18px',
                borderRadius: 12,
                fontSize: '15px',
                lineHeight: '1.65',
              })}>
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
              <div style={volumeCardSoftStyle({
                padding: '16px',
                borderRadius: 12,
                fontSize: '16px',
                fontWeight: '600',
              })}>
                {selectedTrip.organization_name || selectedTrip.client_name || selectedTrip.client || '—'}
              </div>
            </div>

                                                {/* ==================== КОММЕНТАРИЙ КЛИЕНТА ==================== */}
            <div style={{ marginBottom: '32px' }}>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>КОММЕНТАРИЙ КЛИЕНТА</div>
              <div style={volumeCardSoftStyle({
                padding: '20px',
                borderRadius: 12,
                fontSize: '15px',
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
                minHeight: '90px',
              })}>
                {selectedTrip.comment || 'Комментариев от клиента нет'}
              </div>
            </div>

            {/* ИСТОРИЯ */}
            <div style={{ marginBottom: '32px' }}>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '10px' }}>ИСТОРИЯ ИЗМЕНЕНИЙ</div>
              <div style={volumeCardSoftStyle({
                padding: '16px',
                borderRadius: 12,
                fontSize: '14.5px',
                lineHeight: '1.7',
                maxHeight: '220px',
                overflowY: 'auto',
              })}>
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
                style={volumeCardSoftStyle({
                  flex: 1,
                  padding: '16px',
                  color: '#fff',
                  borderRadius: 9999,
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                })}
              >
                Закрыть
              </button>
              
            </div>
          </div>
        </div>
      )}

      {/* ==================== 6. НАПОМИНАНИЕ "КТО НА СМЕНЕ" ==================== */}
      {/* Показывается ЛЮБОМУ, кто открывает страницу, пока смена не выбрана —
          и оператору утром, и админу/менеджеру, если тот просто заглянул
          проверить страницу (см. showShiftReminder выше). zIndex выше, чем у
          модалки рейса (1000), чтобы напоминание было видно первым делом. */}
      {showShiftReminder && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setShiftReminderDismissed(true)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={volumeModalStyle({
              border: '1px solid #F59E0B',
              boxShadow: `${MODAL_VOLUME_GLOW}, 0 0 0 4px rgba(245, 158, 11, 0.12)`,
              padding: '36px 40px',
              borderRadius: 24,
              width: '100%',
              maxWidth: '480px',
              margin: '0 16px',
              color: '#fff',
              textAlign: 'center',
            })}
          >
            <div style={{ fontSize: '40px', marginBottom: '10px' }}>👋</div>
            <div style={{ fontSize: '21px', fontWeight: '700', marginBottom: '8px' }}>
              Доброе утро! Кто сегодня на смене?
            </div>
            <div style={{ color: '#94A3B8', fontSize: '14.5px', marginBottom: '26px', lineHeight: 1.5 }}>
              Выберите себя — все ваши действия будут подписаны вашим именем
              в истории заявок.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
              {operatorShiftNames.map((name) => (
                <button
                  key={name}
                  onClick={() => pickShiftOperatorFromReminder(name)}
                  disabled={shiftLoading}
                  style={{
                    padding: '16px',
                    background: '#10B981',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '14px',
                    fontSize: '17px',
                    fontWeight: '700',
                    cursor: shiftLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {name}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShiftReminderDismissed(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748B',
                fontSize: '14px',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Напомнить позже
            </button>
          </div>
        </div>
      )}
    </div>
  );
}