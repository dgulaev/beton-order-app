'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Order } from '../hooks/useCalendarOrders';
import { useMapRouteLinks } from '@/lib/yandexRoute';
import { OrderHistoryTimeline } from '@/lib/orderHistoryDisplay';
import { sortMixersByLogisticsTime } from '@/lib/mixerTimeSort';
import OrderRouteMap from './OrderRouteMap';
import ModalTimeInput from './ModalTimeInput';
import ModalSelect from './ModalSelect';
import { CARD_BORDER, modalFieldStyle, volumeCardSoftStyle, volumeModalStyle } from '../cardStyles';

interface OrderDetailModalProps {
  order: Order | null;
  onClose: () => void;
  mixerAssignments: any[];
  setMixerAssignments: React.Dispatch<React.SetStateAction<any[]>>;
  allOrders: Order[];
  setAllOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  allMixers: any[];
  currentUser?: { id: number; name?: string; role: string };
  handleStatusChange: (mixerId: number, newStatus: string) => void;
  deleteMixer: (mixerId: number, index: number) => void;
  history: any[];
  addToHistory: (action: string) => Promise<void>;
  getStatusConfig: (status: string) => any;
  setHistory: React.Dispatch<React.SetStateAction<any[]>>;
  setSelectedOrder: React.Dispatch<React.SetStateAction<Order | null>>;
}

export default function OrderDetailModal({
  order,
  onClose,
  mixerAssignments,
  setMixerAssignments,
  allOrders,
  setAllOrders,
  allMixers,
  currentUser,
  handleStatusChange,
  deleteMixer,
  history,           
  addToHistory,
  getStatusConfig,
  setHistory,  
  setSelectedOrder,    
}: OrderDetailModalProps) {

  if (!order) return null;

    // ==================== 0. ЗАГРУЗКА МИКСЕРОВ ДЛЯ МОДАЛКИ ====================
const loadData = async () => {
  if (!order?.id) {
    setMixerAssignments([]);
    setHistory([]);
    return;
  }

  try {
    const timestamp = Date.now();
    const res = await fetch(`/api/adminCifra/order-mixers?orderId=${order.id}&_t=${timestamp}`, {
      cache: 'no-store',
      headers: { 
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });

    if (res.ok) {
      let data = await res.json();
      setMixerAssignments(sortMixersByLogisticsTime(data));
    }

    // История
    const histRes = await fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${timestamp}`);
    if (histRes.ok) {
      setHistory(await histRes.json());
    }
  } catch (err) {
    console.error('Ошибка загрузки данных модалки:', err);
  }
};

  // ==================== 1. ЛОКАЛЬНОЕ СОСТОЯНИЕ ЗАКАЗА ====================
  const [localOrder, setLocalOrder] = useState(order);
  const questionableSavingRef = useRef(false);
  const [questionableSaving, setQuestionableSaving] = useState(false);
  const [newMixerTime, setNewMixerTime] = useState('');
  const [newMixerPick, setNewMixerPick] = useState('');

  // Синхронизация при смене заказа
  useEffect(() => {
    setLocalOrder(order);
  }, [order]);

  // Ссылка на маршрут в Яндекс.Картах — "дозревает" в фоне до координат,
  // как только геокодирование адреса доставки вернётся с сервера (см. lib/yandexRoute.ts).
  const { yandexHref: yandexRouteHref, googleHref: googleRouteHref } = useMapRouteLinks(order.address);

  // ==================== 2. HELPER ДЛЯ ОПРЕДЕЛЕНИЯ РОЛИ ====================
  const getCurrentRole = () => {
    return currentUser?.role?.toLowerCase().trim() || 'unknown';
  };

  const getCurrentUserName = () => {
    return currentUser?.name || 
           (getCurrentRole() === 'admin' ? 'Администратор' :
            getCurrentRole() === 'manager' ? 'Менеджер' :
            getCurrentRole() === 'dispatcher' ? 'Диспетчер' :
            getCurrentRole() === 'logist' ? 'Логист' : 'Пользователь');
  };

  // ==================== 3. ФУНКЦИИ СМЕНЫ ОЧЕРЕДИ ====================
const moveMixerUp = async (mixerId: number) => {
  const mixer = mixerAssignments.find(m => m.id === mixerId);
  const mixerName = mixer?.mixerName || mixer?.number || mixer?.mixer_name || 'Миксер';

  setMixerAssignments(prev => {
    const newList = [...prev];
    const index = newList.findIndex(m => m.id === mixerId);
    if (index <= 0) return prev;

    [newList[index], newList[index - 1]] = [newList[index - 1], newList[index]];

    newList.forEach((m, i) => {
      if (String(m.orderId) === String(order.id)) m.sortOrder = i;
    });

    return newList;
  });

  await saveSortOrderToDB();
};

const moveMixerDown = async (mixerId: number) => {
  const mixer = mixerAssignments.find(m => m.id === mixerId);
  const mixerName = mixer?.mixerName || mixer?.number || mixer?.mixer_name || 'Миксер';

  setMixerAssignments(prev => {
    const newList = [...prev];
    const index = newList.findIndex(m => m.id === mixerId);
    if (index === -1 || index === newList.length - 1) return prev;

    [newList[index], newList[index + 1]] = [newList[index + 1], newList[index]];

    newList.forEach((m, i) => {
      if (String(m.orderId) === String(order.id)) m.sortOrder = i;
    });

    return newList;
  });

  await saveSortOrderToDB();
};

// ==================== 4. СОХРАНЕНИЕ ПОРЯДКА В БАЗУ (улучшенная версия) ====================
const saveSortOrderToDB = async () => {
  const currentMixers = mixerAssignments
    .filter(m => String(m.orderId) === String(order.id))
    .sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0));

  console.log('💾 Сохраняем порядок:', currentMixers.map(m => ({id: m.id, sortOrder: m.sortOrder})));

  for (let i = 0; i < currentMixers.length; i++) {
    const mixer = currentMixers[i];
    if (!mixer.id) continue;

    const res = await fetch('/api/adminCifra/order-mixers/sort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: mixer.id,
        sortOrder: i
      })
    });

    const data = await res.json();
    console.log(`   → Миксер ${mixer.id} → sortOrder=${i} | success: ${data.success}`);
  }
};

  // ==================== 5. ОБНОВЛЕНИЕ СТАТУСА МИКСЕРА ====================
  // Запись в историю и авто-смена статуса заявки (Рейд 2: В работе → Выполнена)
  // теперь выполняются централизованно на сервере в /api/adminCifra/order-mixers/status,
  // чтобы поведение было одинаковым для всех источников (модалка, сайдбар, оператор).
const handleStatusChangeLocal = async (mixerId: number, newStatus: string) => {
  const oldMixer = mixerAssignments.find(m => m.id === mixerId);
  const oldStatus = oldMixer?.status || 'Загрузка';

  if (oldStatus === newStatus) return;

  // Оптимистическое обновление
  setMixerAssignments(prev =>
    prev.map(m => m.id === mixerId ? { ...m, status: newStatus } : m)
  );

  try {
    const res = await fetch('/api/adminCifra/order-mixers/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: mixerId,
        status: newStatus,
        userName: getCurrentUserName(),
        userRole: getCurrentRole(),
        // Статус, который мы видели на экране перед отправкой — если в БД к
        // моменту обработки он уже другой (кто-то успел изменить его первым,
        // например оператор нажал "Начать"/"Загружен"), сервер отобьёт явным
        // конфликтом вместо тихой перезаписи (см. lib/orderMixers.ts).
        expectedStatus: oldStatus,
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Не удалось изменить статус миксера');
    }

    // Подтягиваем фактическое время на объекте / простой, посчитанные сервером
    if (data.data) {
      setMixerAssignments(prev =>
        prev.map(m => m.id === mixerId ? {
          ...m,
          onSiteAt: data.data.onSiteAt ?? m.onSiteAt,
          unloadedAt: data.data.unloadedAt ?? m.unloadedAt,
          downtimeMinutes: data.data.downtimeMinutes ?? m.downtimeMinutes,
        } : m)
      );
    }

    // Обновляем историю сразу — сервер уже записал нужные записи
    if (typeof setHistory === 'function' && order?.id) {
      const histRes = await fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${Date.now()}`);
      if (histRes.ok) setHistory(await histRes.json());
    }

  } catch (err: any) {
    console.error('Ошибка обновления статуса миксера:', err);

    // Откат
    setMixerAssignments(prev =>
      prev.map(m => m.id === mixerId ? { ...m, status: oldStatus } : m)
    );
    alert(err.message || 'Не удалось изменить статус миксера.');
  }
};

  // ==================== 6.1 ПОЛУЧЕНИЕ МИКСЕРОВ ТЕКУЩЕГО ЗАКАЗА (новые внизу) ====================
const currentMixers = mixerAssignments
  .filter(m => String(m.orderId) === String(order.id))
  .sort((a, b) => {
    const timeA = new Date(a.updated_at || a.created_at).getTime();
    const timeB = new Date(b.updated_at || b.created_at).getTime();
    return timeA - timeB;   // ← новые внизу
  });

// ==================== 6.2 ПРОСТОЙ: ПО РЕЙСАМ И ИТОГО ПО ЗАЯВКЕ ====================
const totalDowntimeMinutes = currentMixers.reduce((sum, m) => sum + Number(m.downtimeMinutes || 0), 0);

// ==================== 6.3 "СПИСОК УШЁЛ ВНИЗ" — ПОДСКАЗКА СО СТРЕЛКОЙ ====================
// Показываем стрелку ↓ поверх списка назначенных миксеров, только пока в
// списке реально есть скрытый снизу контент (список не докручен до конца).
// Пересчитываем: (а) при скролле, (б) когда список миксеров меняется
// (добавили/удалили миксер — новая строка может как раз вызвать переполнение).
const mixerListRef = useRef<HTMLDivElement>(null);
const [mixerListHasMore, setMixerListHasMore] = useState(false);

const recomputeMixerListOverflow = () => {
  const el = mixerListRef.current;
  if (!el) { setMixerListHasMore(false); return; }
  const hasMore = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
  setMixerListHasMore(hasMore);
};

const handleMixerListScroll = () => recomputeMixerListOverflow();

useEffect(() => {
  // rAF — даём браузеру применить новую строку миксера перед замером высоты.
  const raf = requestAnimationFrame(recomputeMixerListOverflow);
  return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [currentMixers.length]);

const formatOnSiteDuration = (mixer: any): string | null => {
  if (!mixer.onSiteAt) return null;
  const endTime = mixer.unloadedAt ? new Date(mixer.unloadedAt) : new Date();
  const minutes = Math.round((endTime.getTime() - new Date(mixer.onSiteAt).getTime()) / 60000);
  if (minutes < 0) return null;
  return `${minutes} мин`;
};

  // ==================== 7. ИЗМЕНЕНИЕ ВРЕМЕНИ ЗАГРУЗКИ ====================
const handleMixerTimeChange = async (mixerId: number, newTime: string) => {
  // Оптимистическое обновление
  setMixerAssignments(prev =>
    prev.map(item =>
      item.id === mixerId ? { ...item, time: newTime } : item
    )
  );

  try {
    const res = await fetch('/api/adminCifra/order-mixers/time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: mixerId, time: newTime })
    });

    const data = await res.json();

    if (data.success) {
      // Небольшая задержка перед перезагрузкой данных
      setTimeout(() => loadData(), 400);
    }
  } catch (err) {
    console.error('Ошибка сохранения времени:', err);
  }
};

// Правка объёма уже назначенного миксера — инструмент для исправления
// ситуаций постфактум (напр. заявка #589: заявку закрыли по факту 7=7 м³,
// а позже выяснилось, что реально привезли 8 м³). Разрешена даже на уже
// "Выполненной" заявке — сервер сам решит, нужно ли что-то пересчитать.
const handleMixerVolumeChange = async (mixerId: number, newVolume: number) => {
  const oldMixer = mixerAssignments.find(m => m.id === mixerId);
  const oldVolume = oldMixer?.volume;

  setMixerAssignments(prev =>
    prev.map(item => item.id === mixerId ? { ...item, volume: newVolume } : item)
  );

  try {
    const res = await fetch('/api/adminCifra/order-mixers/volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: mixerId,
        volume: newVolume,
        userName: getCurrentUserName(),
        userRole: getCurrentRole(),
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Не удалось изменить объём миксера');
    }

    setTimeout(() => loadData(), 400);
  } catch (err) {
    console.error('Ошибка сохранения объёма миксера:', err);
    // Откат
    setMixerAssignments(prev =>
      prev.map(item => item.id === mixerId ? { ...item, volume: oldVolume } : item)
    );
    alert('Не удалось сохранить объём миксера: ' + (err instanceof Error ? err.message : ''));
  }
};

// Форматирование объёма без лишних нулей
const formatVolume = (value: number | string) => {
  const num = Number(value);
  if (isNaN(num)) return '0';
  
  return num.toFixed(2).replace(/\.?0+$/, '');
};



  return (
  <>
  <style>{`
    @keyframes mixerListBounce {
      0%, 100% { transform: translateY(0); opacity: 0.7; }
      50%      { transform: translateY(3px); opacity: 1; }
    }
  `}</style>
  <div 
    style={{ 
      position: 'fixed', 
      inset: 0, 
      background: 'rgba(0,0,0,0.82)', 
      // Выше, чем модалка календаря (zIndex 9999) — детальную карточку заказа,
      // открытую кликом из календаря, всегда должно быть видно поверх него.
      zIndex: 10000, 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center' 
    }} 
    onClick={onClose}
  >
    <div 
    className="w-full max-w-[1650px] max-h-[90vh] overflow-auto mx-auto my-10 scroll-hidden"
  style={volumeModalStyle({
    borderRadius: 24,
    // Небольшой доп. отступ сверху относительно боковых/нижнего —
    // раньше эту "воздушную подушку" сверху давал отдельный header со
    // заголовком заявки, теперь заголовок переехал в шапки колонок,
    // поэтому добавляем чуть больше паддинга сверху, чтобы не смотрелось,
    // будто контент прилипает к скруглённому верхнему краю модалки.
    padding: '38px 32px 32px 32px',
    border: CARD_BORDER,
  })}
        onClick={e => e.stopPropagation()}
      >
        {/* ==================== ТЕЛО МОДАЛКИ: КАРТА СЛЕВА (НА ВСЮ ВЫСОТУ) + ОСТАЛЬНОЙ КОНТЕНТ ==================== */}
        <div style={{ display: 'flex', gap: '28px', alignItems: 'stretch' }}>

        <div style={{ width: '340px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <OrderRouteMap address={order.address} routeHref={yandexRouteHref} />
          </div>
          {/* Google Карты — запасной вариант, если геокодирование адреса не сработало.
              Тот же нормализованный адрес/координаты (см. useMapRouteLinks). */}
          <a
            href={googleRouteHref}
            target="_blank"
            rel="noopener noreferrer"
            style={volumeCardSoftStyle({
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '9px 12px',
              color: '#94A3B8',
              textAlign: 'center',
              borderRadius: 10,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '13px',
              flexShrink: 0,
            })}
          >
            🗺️ Открыть в Google Картах
          </a>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>

        {/* ==================== GRID 1fr 1fr ==================== */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
          
          {/* ==================== ЛЕВАЯ КОЛОНКА — ИНФОРМАЦИЯ ==================== */}
          <div>
            {/* ==================== ЗАГОЛОВОК ЗАЯВКИ + СТАТУС-ПИЛЮЛЯ (на месте бывшей "Информация о заказе") ==================== */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '22px', color: '#F1F5F9', whiteSpace: 'nowrap' }}>
                Заявка #{order.id}
              </h2>

              {/* ==================== СТАТУС ЗАКАЗА (компактная пилюля) ==================== */}
              {getStatusConfig(localOrder.status).final ? (
                // Финальные статусы менять нельзя — просто цветная пилюля
                <div style={{
                  backgroundColor: getStatusConfig(localOrder.status).bg,
                  color: getStatusConfig(localOrder.status).color,
                  border: `1px solid ${getStatusConfig(localOrder.status).color}40`,
                  padding: '7px 16px',
                  borderRadius: '9999px',
                  fontWeight: '600',
                  fontSize: '13px',
                  letterSpacing: '0.2px',
                  whiteSpace: 'nowrap'
                }}>
                  {getStatusConfig(localOrder.status).label}
                </div>
              ) : (
                // Можно менять — сама пилюля и есть select (клик открывает меню статусов).
                // Обёртка нужна, чтобы поверх нативного select нарисовать свой шеврон —
                // у select убран стандартный вид (appearance: none), иначе на разных ОС/
                // браузерах он выглядит по-разному и не вписывается в дизайн пилюли.
                <ModalSelect
                  value={localOrder.status || 'new'}
                  title="Сменить статус заявки"
                  chevronColor={getStatusConfig(localOrder.status).color}
                  triggerStyle={{
                    background: getStatusConfig(localOrder.status).bg,
                    color: getStatusConfig(localOrder.status).color,
                    border: `1px solid ${getStatusConfig(localOrder.status).color}40`,
                    borderRadius: '9999px',
                    padding: '7px 14px 7px 16px',
                    fontSize: '13px',
                    fontWeight: 600,
                    letterSpacing: '0.2px',
                  }}
                  options={[
                    { value: 'new', label: 'Новая', text: 'Новая' },
                    { value: 'processing', label: 'В работе', text: 'В работе' },
                    { value: 'completed', label: 'Выполнена', text: 'Выполнена' },
                    { value: 'cancelled', label: 'Отменена', text: 'Отменена' },
                  ]}
                  onChange={async (newStatus) => {
                    if (newStatus === localOrder.status) return;

                    const oldStatus = localOrder.status;
                    const oldQuestionable = !!(localOrder as any).is_questionable;
                    const clearQuestionable = newStatus === 'processing' && oldStatus !== 'processing';

                    setLocalOrder(prev => ({
                      ...prev,
                      status: newStatus,
                      ...(clearQuestionable ? { is_questionable: false } : {}),
                    } as any));
                    setAllOrders(prev => prev.map(o =>
                      o.id === order.id
                        ? ({ ...o, status: newStatus, ...(clearQuestionable ? { is_questionable: false } : {}) } as any)
                        : o
                    ));

                    try {
                      const res = await fetch('/api/adminCifra/orders/update', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          id: order.id,
                          status: newStatus,
                          userName: getCurrentUserName(),
                          userRole: getCurrentRole()
                        })
                      });

                      const data = await res.json();

                      if (data.success) {
                        if (typeof setHistory === 'function') {
                          const histRes = await fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${Date.now()}`);
                          if (histRes.ok) setHistory(await histRes.json());
                        }
                      } else {
                        setLocalOrder(prev => ({
                          ...prev,
                          status: oldStatus,
                          is_questionable: oldQuestionable,
                        } as any));
                        setAllOrders(prev => prev.map(o =>
                          o.id === order.id
                            ? ({ ...o, status: oldStatus, is_questionable: oldQuestionable } as any)
                            : o
                        ));
                        alert('Ошибка сохранения: ' + (data.message || ''));
                      }
                    } catch (err) {
                      console.error(err);
                      setLocalOrder(prev => ({
                        ...prev,
                        status: oldStatus,
                        is_questionable: oldQuestionable,
                      } as any));
                      setAllOrders(prev => prev.map(o =>
                        o.id === order.id
                          ? ({ ...o, status: oldStatus, is_questionable: oldQuestionable } as any)
                          : o
                      ));
                      alert('Не удалось связаться с сервером');
                    }
                  }}
                />
              )}

              {/* Метка «Под вопросом» — тот же toggle, что в модалке Заявок; CAS на сервере + lock здесь */}
              {['admin', 'manager', 'dispatcher', 'logist'].includes(getCurrentRole()) && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    borderRadius: '9999px',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    background: (localOrder as any).is_questionable ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                    fontSize: '13px',
                    cursor: questionableSaving ? 'wait' : 'pointer',
                    userSelect: 'none',
                    opacity: questionableSaving ? 0.7 : 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!(localOrder as any).is_questionable}
                    disabled={questionableSaving}
                    onChange={async (e) => {
                      if (questionableSavingRef.current) return;
                      questionableSavingRef.current = true;
                      setQuestionableSaving(true);

                      const newValue = e.target.checked;
                      const prevValue = !!(localOrder as any).is_questionable;

                      setLocalOrder(prev => ({ ...prev, is_questionable: newValue } as any));
                      setAllOrders(prev => prev.map(o =>
                        o.id === order.id ? { ...o, is_questionable: newValue } as any : o
                      ));
                      if (typeof setSelectedOrder === 'function') {
                        setSelectedOrder(prev => prev ? ({ ...prev, is_questionable: newValue } as any) : prev);
                      }

                      try {
                        const res = await fetch('/api/adminCifra/orders/update', {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            id: order.id,
                            is_questionable: newValue,
                            userName: getCurrentUserName(),
                            userRole: getCurrentRole(),
                          }),
                        });
                        if (!res.ok) {
                          setLocalOrder(prev => ({ ...prev, is_questionable: prevValue } as any));
                          setAllOrders(prev => prev.map(o =>
                            o.id === order.id ? { ...o, is_questionable: prevValue } as any : o
                          ));
                        } else if (typeof setHistory === 'function') {
                          const histRes = await fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${Date.now()}`);
                          if (histRes.ok) setHistory(await histRes.json());
                        }
                      } catch {
                        setLocalOrder(prev => ({ ...prev, is_questionable: prevValue } as any));
                        setAllOrders(prev => prev.map(o =>
                          o.id === order.id ? { ...o, is_questionable: prevValue } as any : o
                        ));
                      } finally {
                        questionableSavingRef.current = false;
                        setQuestionableSaving(false);
                      }
                    }}
                    style={{ width: '14px', height: '14px', accentColor: '#EF4444' }}
                  />
                  <span style={{ color: '#F87171', fontWeight: 600 }}>Под вопросом</span>
                </label>
              )}
            </div>

            <div style={volumeCardSoftStyle({ borderRadius: 16, padding: '16px 20px', lineHeight: '1.45' })}>
              <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '6px 12px', alignItems: 'baseline' }}>
                <div style={{ color: '#94A3B8' }}>Клиент</div>
                <div style={{ fontWeight: '600' }}>{(order as any).organization_name || (order as any).full_name || '—'}</div>

                <div style={{ color: '#94A3B8' }}>Телефон</div>
                <div>{order.phone || '—'}</div>

                <div style={{ color: '#94A3B8' }}>Марка бетона</div>
                <div style={{ fontWeight: '600', color: '#60A5FA' }}>{order.grade}</div>

                <div style={{ color: '#94A3B8' }}>Объём</div>
                <div style={{ fontSize: '20px', fontWeight: '700', color: '#10B981' }}>{order.volume} м³</div>

                <div style={{ color: '#94A3B8' }}>Дата и время</div>
                <div>{order.delivery_date} • {order.delivery_time}</div>

                <div style={{ color: '#94A3B8' }}>Адрес доставки</div>
                <div style={{ fontWeight: '600', fontSize: '15px' }}>{order.address}</div>
              </div>
            </div>

            {order.comment && (
              <div style={{ marginTop: '16px' }}>
                <h4 style={{ color: '#94A3B8', marginBottom: '6px' }}>Комментарий клиента</h4>
                <div style={volumeCardSoftStyle({
                  padding: '12px 16px',
                  borderRadius: 16,
                  whiteSpace: 'pre-wrap',
                  // clamp вместо фикс-px — на 4K (больше реальной высоты
                  // окна) блок пропорционально вырастает и показывает
                  // больше текста без обрезки, а на 1920 остаётся как был.
                  // До 1080px высоты вьюпорта (весь диапазон 1920×1080, в т.ч.
                  // с браузерной панелью/таскбаром) формула даёт ровно 76px —
                  // поведение на 1920 не меняется. Выше 1080px (4K и крупнее)
                  // блок начинает расти дальше, до потолка в 240px.
                  maxHeight: 'clamp(76px, calc(76px + (100vh - 1080px) * 0.15), 240px)',
                  overflowY: 'auto',
                  fontSize: '14px',
                  lineHeight: '1.5',
                })}>
                  {order.comment}
                </div>
              </div>
            )}
          </div>

                    {/* ==================== ПРАВАЯ КОЛОНКА — ЛОГИСТИКА ==================== */}
          <div>
            {/* ==================== ЗАГОЛОВОК + КНОПКА ЗАКРЫТИЯ (крестик перенесён с бывшего header) ==================== */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
              <h3 style={{ margin: 0, color: '#94A3B8' }}>Выстраивание логистики</h3>
              <button
                onClick={onClose}
                title="Закрыть"
                style={volumeCardSoftStyle({
                  fontSize: '22px',
                  lineHeight: 1,
                  color: '#94A3B8',
                  cursor: 'pointer',
                  width: 36,
                  height: 36,
                  padding: 0,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                })}
              >
                ×
              </button>
            </div>
            
            {(() => {
              const assignedVolume = mixerAssignments
                .filter(m => m.orderId === order.id)
                .reduce((sum, m) => sum + Number(m.volume || 0), 0);

              const orderVolume = Number(order.volume || 0);
              const isFullyReady = assignedVolume >= orderVolume && assignedVolume > 0;

              return (
                <div style={volumeCardSoftStyle({ borderRadius: 16, padding: '18px' })}>
                  {/* Сумма по миксерам */}
<div style={volumeCardSoftStyle({
  borderRadius: 12,
  padding: '12px',
  textAlign: 'center',
  marginBottom: '14px',
})}>
  <div style={{ color: '#94A3B8', fontSize: '13px' }}>Назначено бетона</div>
  <div style={{ fontSize: '25px', fontWeight: '700', color: '#10B981', margin: '4px 0' }}>
    {formatVolume(assignedVolume)} / {formatVolume(orderVolume)} м³
  </div>
  <div style={{ fontSize: '13px', color: isFullyReady ? '#10B981' : '#F59E0B' }}>
    {isFullyReady 
      ? '✅ Полностью укомплектовано' 
      : `Осталось ${formatVolume(orderVolume - assignedVolume)} м³`
    }
  </div>

  <div style={{
    marginTop: '10px',
    paddingTop: '10px',
    borderTop: CARD_BORDER,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px'
  }}>
    <span style={{ color: '#94A3B8', fontSize: '13px' }}>Общий простой по заявке:</span>
    <span style={{ color: totalDowntimeMinutes > 0 ? '#F97316' : '#10B981', fontWeight: '700', fontSize: '15px' }}>{totalDowntimeMinutes} мин</span>
  </div>
</div>

                  {/* ==================== СПИСОК НАЗНАЧЕННЫХ МИКСЕРОВ ==================== */}
<div>
  <div style={{ color: '#94A3B8', fontSize: '15px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between' }}>
    <span>Назначенные миксеры ({currentMixers.length})</span>
    <span style={{ fontSize: '13px', color: '#64748B' }}>Изменяй время — список пересортируется (с учётом суток)</span>
  </div>
  
  <div style={{ position: 'relative' }}>
  <div 
    ref={mixerListRef}
    onScroll={handleMixerListScroll}
    style={{ 
    // Тот же принцип: до 1080px высоты вьюпорта — ровно 128px (как на 1920),
    // на 4K и выше — растёт дальше, до потолка в 430px.
    maxHeight: 'clamp(128px, calc(128px + (100vh - 1080px) * 0.28), 430px)',
    overflowY: 'auto',
    paddingRight: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  }}>
    {currentMixers.length > 0 ? (
      sortMixersByLogisticsTime(currentMixers)
        .map((mixer, index) => (
        <div 
          key={mixer.id || index}
          style={volumeCardSoftStyle({
            padding: '6px 12px',
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            minHeight: '36px',
            userSelect: 'none',
          })}
        >
          {/* Порядковый номер */}
          <div style={{
            width: '22px',
            height: '22px',
            background: '#334155',
            borderRadius: '9999px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '700',
            color: '#94A3B8',
            fontSize: '13px',
            flexShrink: 0
          }}>
            {index + 1}
          </div>

          {/* Номер миксера */}
          <div style={{ fontWeight: '700', fontSize: '14.5px', minWidth: '120px' }}>
            {mixer.mixerName || mixer.number}
          </div>

          {/* Время загрузки — РЕДАКТИРУЕМОЕ */}
          <ModalTimeInput
            value={mixer.time || ''}
            onChange={(time) => handleMixerTimeChange(mixer.id, time)}
            style={{
              color: '#94A3B8',
              borderRadius: 8,
              padding: '4px 8px',
              fontSize: '13px',
              width: '92px',
            }}
          />

          {/* Объём — РЕДАКТИРУЕМОЕ (напр. чтобы поправить факт постфактум) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', minWidth: '78px' }}>
            <input
              type="number"
              step="0.1"
              min="0.1"
              defaultValue={Number(mixer.volume)}
              onBlur={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next) && next > 0 && Math.abs(next - Number(mixer.volume)) > 0.001) {
                  handleMixerVolumeChange(mixer.id, next);
                } else {
                  e.target.value = String(Number(mixer.volume));
                }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              title="Фактический объём этого миксера — можно исправить постфактум"
              style={{
                background: '#0F172A',
                color: '#94A3B8',
                border: '1px solid #475569',
                borderRadius: '8px',
                padding: '4px 4px',
                fontSize: '13px',
                width: '46px'
              }}
            />
            <span style={{ color: '#64748B', fontSize: '12px' }}>м³</span>
          </div>

          {/* Статус */}
          <ModalSelect
            value={mixer.status || 'Загрузка'}
            onChange={(status) => handleStatusChangeLocal(mixer.id, status)}
            minPopupWidth={160}
            triggerStyle={{
              padding: '4px 10px',
              borderRadius: 9999,
              background: '#0F172A',
              color: 'white',
              border: '1px solid rgba(148,163,184,0.25)',
              fontSize: '13px',
              minWidth: 120,
            }}
            options={[
              { value: 'Загрузка', label: '🟡 Загрузка', text: '🟡 Загрузка' },
              { value: 'В пути', label: '🔵 В пути', text: '🔵 В пути' },
              { value: 'На объекте', label: '📍 На объекте', text: '📍 На объекте' },
              { value: 'Разгружен', label: '🟢 Разгружен', text: '🟢 Разгружен' },
              { value: 'Возврат', label: '↩️ Возврат', text: '↩️ Возврат' },
              { value: 'Проблема', label: '🔴 Проблема', text: '🔴 Проблема' },
            ]}
          />

          {/* Время на объекте / простой — видно всегда; до "На объекте" данных нет, показываем 0 */}
          <div style={{
            fontSize: '12px',
            padding: '3px 9px',
            borderRadius: '6px',
            whiteSpace: 'nowrap',
            background: Number(mixer.downtimeMinutes) > 0 ? 'rgba(249, 115, 22, 0.15)' : 'rgba(148, 163, 184, 0.15)',
            color: Number(mixer.downtimeMinutes) > 0 ? '#F97316' : '#94A3B8'
          }}
            title="Время на объекте / простой сверх нормы"
          >
            ⏱ {formatOnSiteDuration(mixer) || '0 мин'}
            {mixer.status === 'Разгружен' && ` (простой ${Number(mixer.downtimeMinutes || 0)} мин)`}
          </div>

          <button 
            onClick={() => deleteMixer(mixer.id, index)} 
            style={{ 
              color: '#EF4444', 
              background: 'none', 
              border: 'none', 
              cursor: 'pointer', 
              fontSize: '17px',
              padding: '2px 6px'
            }}
          >
            ✕
          </button>
        </div>
      ))
    ) : (
      <div style={{ color: '#64748B', textAlign: 'center', padding: '30px 0', fontStyle: 'italic' }}>
        Пока нет назначенных миксеров
      </div>
    )}
  </div>

  {/* Подсказка "список ушёл вниз" — стрелка + мягкая тень снизу,
      видна только пока список реально скроллится и не докручен до конца. */}
  {mixerListHasMore && (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: '8px',
      height: '28px',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      paddingBottom: '2px',
      background: 'linear-gradient(to bottom, rgba(37,51,74,0), rgba(37,51,74,0.95))',
      borderRadius: '0 0 12px 12px',
      pointerEvents: 'none',
    }}>
      <span style={{
        color: '#94A3B8',
        fontSize: '13px',
        lineHeight: 1,
        animation: 'mixerListBounce 1.4s ease-in-out infinite',
      }}>
        ▼
      </span>
    </div>
  )}
  </div>
</div>

                </div>
              );
            })()}
          </div>
          </div>

                       {/* ==================== ФОРМА ДОБАВЛЕНИЯ МИКСЕРА ==================== */}
        <div style={{ borderTop: CARD_BORDER, paddingTop: '10px', marginTop: '10px' }}>
          <h4 style={{ color: '#94A3B8', marginBottom: '10px' }}>Добавить миксер</h4>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '2.6fr 1.8fr 1.4fr 1.1fr auto', 
            gap: '16px', 
            alignItems: 'end' 
          }}>
    
            {/* Выбор миксера из базы */}
            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
                Миксер
              </label>
              <ModalSelect
                value={newMixerPick}
                placeholder="— Выберите миксер —"
                style={{ padding: '14px', borderRadius: 12, fontSize: '15px' }}
                onChange={(val) => {
                  setNewMixerPick(val);
                  const nameEl = document.getElementById('mixerName') as HTMLInputElement | null;
                  if (!nameEl) return;
                  if (val === 'custom' || !val) {
                    nameEl.value = '';
                    return;
                  }
                  const selected = allMixers.find(m => m.id === Number(val));
                  if (selected) nameEl.value = selected.number;
                }}
                options={[
                  ...allMixers.map((mixer) => ({
                    value: String(mixer.id),
                    label: `${mixer.number} — ${mixer.model} (${mixer.volume} м³)${mixer.driver ? ` · ${mixer.driver}` : ''}`,
                    text: `${mixer.number} — ${mixer.model}`,
                  })),
                  { value: 'custom', label: 'Другой (ввести вручную)', text: 'Другой (ввести вручную)' },
                ]}
              />
            </div>

            {/* Номер / Название */}
            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
                Номер / Название
              </label>
              <input 
                type="text" 
                id="mixerName"
                placeholder="Например: О021УХ32"
                style={volumeCardSoftStyle({
                  width: '80%',
                  padding: '14px',
                  borderRadius: 12,
                  color: 'white',
                })}
              />
            </div>

            {/* ==================== ВРЕМЯ ПОГРУЗКИ (ОБЯЗАТЕЛЬНОЕ) ==================== */}
<div>
  <label style={{ display: 'block', color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
    Время погрузки <span style={{ color: '#EF4444' }}>*</span>
  </label>
  <ModalTimeInput
    value={newMixerTime}
    onChange={setNewMixerTime}
    style={{
      width: '80%',
      padding: '14px',
      borderRadius: 12,
      color: '#E2E8F0',
    }}
  />
</div>

            {/* Объём */}
            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
                м³
              </label>
              <input 
                type="number" 
                id="mixerVolume"
                placeholder="8"
                step="0.01"
                style={volumeCardSoftStyle({
                  width: '80%',
                  padding: '14px',
                  borderRadius: 12,
                  color: 'white',
                })}
              />
            </div>

            {/* Кнопки действий (рядом справа) */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'end' }}>

              {/* ==================== КНОПКА ДОБАВЛЕНИЯ МИКСЕРА ==================== */}
               <button 
               onClick={async () => {
                 const name = (document.getElementById('mixerName') as HTMLInputElement).value.trim();
                 const time = newMixerTime;
                 const vol = parseFloat((document.getElementById('mixerVolume') as HTMLInputElement).value || '0');

              // ← Обязательная проверка времени
                 if (!name || !time || vol <= 0) {
                 alert('Пожалуйста, заполните все обязательные поля:\n• Название миксера\n• Время погрузки\n• Объём');
                 return;
              }

    // Находим максимальный sortOrder среди уже существующих миксеров этого заказа
    const existingMixers = mixerAssignments.filter(m => String(m.orderId) === String(order.id));
    const maxSortOrder = existingMixers.length > 0 
      ? Math.max(...existingMixers.map(m => Number(m.sortOrder) || 0)) 
      : -1;

    const newSortOrder = maxSortOrder + 1;

    // === 1. Сохраняем миксер в базу ===
    // Сервер сам: (а) проверит, что заявка не в финальном статусе,
    // (б) запишет историю добавления миксера,
    // (в) при необходимости автоматически переведёт заявку "Новая → В работе"
    // и тоже запишет это в историю — от имени "Системы", а не сотрудника.
    const res = await fetch('/api/adminCifra/order-mixers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id,
        mixerName: name,
        time: time,
        volume: vol,
        sortOrder: newSortOrder,
        status: 'Загрузка',
        userName: getCurrentUserName(),
        userRole: getCurrentRole()
      })
    });

    if (res.ok) {
      const result = await res.json();
      const savedId = result.data?.id || result.id || Date.now();

      // === 2. Создаём объект нового миксера ===
      const newMixer = {
        id: savedId,
        orderId: order.id,
        mixerName: name,
        number: name,
        time: time,
        volume: vol,
        status: 'Загрузка',
        sortOrder: newSortOrder
      };

      // === 3. Добавляем в конец списка и сортируем по sortOrder (маленькие сверху) ===
      // ⚠️ Защита от задвоения: realtime-подписка (useRealtimeOrderMixers в
      // dashboard/page.tsx) слушает INSERT в order_mixers и может добавить
      // эту же строку в mixerAssignments раньше, чем сюда придёт ответ fetch
      // (событие по realtime иногда приходит быстрее HTTP-ответа). Без проверки
      // на существующий id миксер добавлялся дважды — эту гонку и наблюдал
      // диспетчер (после переоткрытия модалки дубль пропадал, т.к. loadData()
      // заново тянет данные с сервера, где дубля никогда не было).
      setMixerAssignments(prev => {
        if (prev.some(m => String(m.id) === String(savedId))) return prev;
        const updated = [...prev, newMixer];
        return updated.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      });

      // === 4. Если сервер перевёл заявку в "В работе" — обновляем локальный список
      // заказов и снимаем метку «Под вопросом» (то же делает API).
      if (result.newOrderStatus) {
        const clearQ = result.newOrderStatus === 'processing';
        setLocalOrder(prev => ({
          ...prev,
          status: result.newOrderStatus,
          ...(clearQ ? { is_questionable: false } : {}),
        } as any));
        setAllOrders(prev => prev.map(o =>
          o.id === order.id
            ? ({ ...o, status: result.newOrderStatus, ...(clearQ ? { is_questionable: false } : {}) } as any)
            : o
        ));
        if (typeof setSelectedOrder === 'function') {
          setSelectedOrder(prev => prev && String(prev.id) === String(order.id)
            ? ({ ...prev, status: result.newOrderStatus, ...(clearQ ? { is_questionable: false } : {}) } as any)
            : prev
          );
        }
        if (typeof setHistory === 'function') {
          const histRes = await fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${Date.now()}`);
          if (histRes.ok) setHistory(await histRes.json());
        }
      }

      // === 5. Обновляем историю сразу ===
      if (typeof setHistory === 'function') {
        const histRes = await fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${Date.now()}`);
        if (histRes.ok) setHistory(await histRes.json());
      }

      // 🔥 window.dispatchEvent('mixerAdded') убран — дашборд получает INSERT
      // через realtime-подписку на order_mixers, ручной рефетч больше не нужен

      // === 6. Очистка формы ===
      (document.getElementById('mixerName') as HTMLInputElement).value = '';
      (document.getElementById('mixerVolume') as HTMLInputElement).value = '';
      setNewMixerTime('');
      setNewMixerPick('');

      console.log(`✅ Миксер ${name} добавлен в конец списка (sortOrder = ${newSortOrder})`);
    } else {
      const errData = await res.json().catch(() => ({}));
      alert(errData.error || 'Ошибка сохранения миксера в базу');
    }
  }}
  style={volumeCardSoftStyle({
    padding: '14px 32px',
    background: 'linear-gradient(165deg, #10B981 0%, #059669 100%)',
    border: '1px solid rgba(110,231,183,0.35)',
    borderRadius: 12,
    color: 'white',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    height: '52px',
  })}
>
  Добавить
</button>

              {/* Кнопка закрытия модалки — статус и логистика теперь считаются
                  автоматически на сервере, отдельного "завершения" не требуется */}
              <button
                onClick={onClose}
                style={volumeCardSoftStyle({
                  padding: '14px 28px',
                  background: 'linear-gradient(165deg, #3B82F6 0%, #2563EB 100%)',
                  border: '1px solid rgba(147,197,253,0.35)',
                  borderRadius: 12,
                  color: 'white',
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  height: '52px',
                })}
              >
                ✓ Готово
              </button>
            </div>
          </div>
        </div>

        {/* ==================== ИСТОРИЯ ИЗМЕНЕНИЙ (ПОЛНАЯ + МИКСЕРЫ) ==================== */}
<div style={{ marginTop: '10px', borderTop: CARD_BORDER, paddingTop: '8px' }}>
  <h4 style={{ color: '#94A3B8', marginBottom: '8px' }}>История изменений</h4>
  
  <div style={volumeCardSoftStyle({
    borderRadius: 16,
    padding: '16px',
    fontSize: '15px',
    // Тот же принцип: до 1080px высоты вьюпорта — ровно 160px (как на 1920),
    // на 4K и выше — растёт дальше, до потолка в 520px.
    maxHeight: 'clamp(160px, calc(160px + (100vh - 1080px) * 0.33), 520px)',
    overflowY: 'auto',
  })}>
    <OrderHistoryTimeline entries={history} />
  </div>
</div>

        </div>
        {/* /flex: 1, остальной контент */}

        </div>
        {/* /ТЕЛО МОДАЛКИ: карта + остальной контент */}

      </div>
    </div>
  </>
  );
}