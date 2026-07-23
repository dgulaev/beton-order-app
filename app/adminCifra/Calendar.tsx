'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { Order } from './hooks/useCalendarOrders';
import { useRealtimeOrders } from '@/hooks/useRealtimeOrders';
import { modalCloseButtonStyle, volumeCardSoftStyle, volumeModalStyle } from './cardStyles';

interface StatusConfig {
  label: string;
  color: string;
  bg: string;
  final?: boolean;
}

interface CalendarProps {
  onClose: () => void;
  /** Если передан — не делаем отдельный fetch, используем данные дашборда */
  orders?: Order[];
  /** Открыть полноценную модалку заказа (та же, что и везде в админке) */
  onSelectOrder: (order: Order) => void;
  /** Быстрое создание заявки на конкретную дату (ПКМ / долгое нажатие на день) */
  onQuickCreateOrder: (dateStr: string) => void;
  /** Общая функция стилей статуса — та же, что использует весь дашборд */
  getStatusConfig?: (status: string) => StatusConfig;
  /** Вызывается при переходе в другой месяц — дашборд подгружает данные для него */
  onViewMonthChange?: (year: number, month: number) => void;
}

// Корректное склонение русского слова «заказ» по числу (1 заказ, 2 заказа, 5 заказов...)
const pluralizeOrders = (count: number): string => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'заказ';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'заказа';
  return 'заказов';
};

// Официальные нерабочие праздничные дни РФ (фиксированные даты по ТК РФ).
// [месяц (0-индекс), день]. Переносы выходных из-за совпадения с праздником
// зависят от постановления правительства на конкретный год и здесь не учтены.
const RUSSIAN_HOLIDAYS: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], // Новогодние каникулы
  [1, 23], // День защитника Отечества
  [2, 8],  // Международный женский день
  [4, 1],  // Праздник Весны и Труда
  [4, 9],  // День Победы
  [5, 12], // День России
  [10, 4], // День народного единства
];

const isRussianHoliday = (month: number, day: number): boolean =>
  RUSSIAN_HOLIDAYS.some(([hMonth, hDay]) => hMonth === month && hDay === day);

const defaultGetStatusConfig = (status: string): StatusConfig => {
  switch (status) {
    case 'new': return { label: 'Новая', color: '#FACC15', bg: '#FACC1520', final: false };
    case 'processing': return { label: 'В работе', color: '#3B82F6', bg: '#3B82F620', final: false };
    case 'completed': return { label: 'Выполнена', color: '#10B981', bg: '#10B98120', final: true };
    case 'cancelled': return { label: 'Отменена', color: '#EF4444', bg: '#EF444420', final: true };
    default: return { label: 'Неизвестно', color: '#64748B', bg: '#33415560', final: false };
  }
};

// Кнопки навигации месяца — «призрачные», без фона, чтобы не отвлекать от
// самого календаря; подсветка появляется только при наведении.
const navButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  background: 'transparent',
  color: '#94A3B8',
  border: 'none',
  borderRadius: '9999px',
  fontSize: '15px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'all 0.2s',
};

// «Сегодня» — тоже призрачная, как соседние кнопки навигации, только зелёным
// акцентом (цвет объёмов/успеха в админке), чтобы не выделяться синим фоном.
const todayButtonStyle: React.CSSProperties = {
  padding: '10px 22px',
  background: 'transparent',
  color: '#10B981',
  border: 'none',
  borderRadius: '9999px',
  fontSize: '15px',
  fontWeight: '600',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'all 0.2s',
};

export default function Calendar({ onClose, orders: externalOrders, onSelectOrder, onQuickCreateOrder, getStatusConfig = defaultGetStatusConfig, onViewMonthChange }: CalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  // Сразу выбираем сегодняшний день — тогда заявки в боковой панели видны
  // немедленно при открытии календаря, без обязательного клика по дню.
  const [selectedDay, setSelectedDay] = useState<number | null>(() => new Date().getDate());
  const [allOrders, setAllOrders] = useState<Order[]>(externalOrders ?? []);
  const [loading, setLoading] = useState(!externalOrders?.length);

  // Долгое нажатие на день (тач-устройства) — тот же эффект, что и ПКМ на десктопе
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Синхронизация с переданными заказами (дашборд + realtime)
  useEffect(() => {
    if (externalOrders) {
      setAllOrders(externalOrders);
      setLoading(false);
    }
  }, [externalOrders]);

  useRealtimeOrders(setAllOrders, { enabled: !externalOrders });

  // Загружаем заказы только если не переданы снаружи
  useEffect(() => {
    if (externalOrders) return;

    const fetchAllOrders = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/adminCifra/all-orders');
        if (res.ok) {
          const data = await res.json();
          setAllOrders(data);
        }
      } catch (err) {
        console.error('Ошибка загрузки заказов для календаря:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAllOrders();
  }, [externalOrders]);

  // Группировка по датам
  const groupedByDate: { [key: string]: Order[] } = {};
  const dailyVolumes: { [key: string]: number } = {};

  allOrders.forEach((order) => {
    if (!order.delivery_date) return;
    const dateKey = order.delivery_date.split('T')[0].split(' ')[0]; // нормализация даты
    if (!groupedByDate[dateKey]) groupedByDate[dateKey] = [];
    groupedByDate[dateKey].push(order);
    dailyVolumes[dateKey] = (dailyVolumes[dateKey] || 0) + (order.volume || 0);
  });

  const handlePrevMonth = () => {
    const d = new Date(year, month - 1, 1);
    setCurrentDate(d);
    setSelectedDay(null);
    onViewMonthChange?.(d.getFullYear(), d.getMonth() + 1);
  };

  const handleNextMonth = () => {
    const d = new Date(year, month + 1, 1);
    setCurrentDate(d);
    setSelectedDay(null);
    onViewMonthChange?.(d.getFullYear(), d.getMonth() + 1);
  };

  const handleToday = () => {
    const now = new Date();
    setCurrentDate(now);
    setSelectedDay(now.getDate());
  };

  const handleDayClick = (day: number) => {
    setSelectedDay(day);
  };

  // Клавиатурная навигация: ← / → — смена месяца, Esc — закрыть календарь.
  // Игнорируем, если фокус в поле ввода (например, в открытой поверх модалке заказа) —
  // иначе стрелки для перемещения курсора в тексте будут случайно листать месяц.
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const isTyping = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    if (isTyping) return;

    if (e.key === 'ArrowLeft') handlePrevMonth();
    else if (e.key === 'ArrowRight') handleNextMonth();
    else if (e.key === 'Escape') onClose();
  }, [year, month]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const currentMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const selectedDateKey = selectedDay
    ? `${currentMonthKey}-${String(selectedDay).padStart(2, '0')}`
    : null;

  const dayOrders = selectedDateKey ? groupedByDate[selectedDateKey] || [] : [];

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const currentDay = today.getDate();

  // Итоги за месяц — быстрая сводка без необходимости кликать по каждому дню
  const monthStats = Object.keys(groupedByDate).reduce(
    (acc, dateKey) => {
      if (!dateKey.startsWith(currentMonthKey)) return acc;
      acc.count += groupedByDate[dateKey].length;
      acc.volume += dailyVolumes[dateKey] || 0;
      return acc;
    },
    { count: 0, volume: 0 }
  );

  return (
    <div className="overflow-hidden flex flex-col" style={volumeModalStyle({
      // width/height через vw/vh, а не % — родительская обёртка модалки в
      // dashboard/page.tsx сама не имеет явной ширины (растягивается по
      // контенту), поэтому w-full/max-w-[] от неё не работали на больших
      // экранах и календарь оставался «зажатым» до природной ширины сетки дней.
      width: 'min(1560px, 94vw)',
      height: 'min(920px, 92vh)',
      borderRadius: 24,
      padding: '32px',
    })}>
      {/* Шапка: месяц по центру, закрытие — иконкой в углу без фона */}
      <div style={{ position: 'relative', textAlign: 'center', flexShrink: 0, marginBottom: '10px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: '700', color: '#fff', margin: 0, textTransform: 'capitalize' }}>
          {currentDate.toLocaleString('ru-RU', { month: 'long', year: 'numeric' })}
        </h2>
        <button
          onClick={onClose}
          title="Закрыть"
          style={modalCloseButtonStyle({
            position: 'absolute',
            top: 0,
            right: 0,
          })}
        >
          <X size={20} />
        </button>
      </div>

      {/* Итоги за месяц — крупнее, по центру: полезная сводка без кликов по дням */}
      <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: '18px', marginBottom: '22px', flexShrink: 0 }}>
        За месяц: <strong style={{ color: '#fff', fontSize: '19px' }}>{monthStats.count}</strong> {pluralizeOrders(monthStats.count)}
        {' • '}
        <strong style={{ color: '#10B981', fontSize: '19px' }}>{monthStats.volume.toFixed(1)} м³</strong>
      </div>

      <div style={{ display: 'flex', gap: '36px', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Календарь */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: '15px', color: '#94A3B8', marginBottom: '16px', flexShrink: 0 }}>
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => <div key={day}>{day}</div>)}
          </div>

          {/* flex:1 + minHeight:0 — сетка дней всегда занимает одну и ту же высоту
              независимо от того, 5 или 6 строк недель в месяце. Если строк 6 и они
              не помещаются — сетка скроллится внутри себя, а не «толкает» кнопки
              навигации вниз (иначе они скакали от месяца к месяцу). */}
          <div className="scroll-hidden" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', alignContent: 'start', rowGap: '8px', columnGap: '10px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {Array.from({ length: new Date(year, month, 1).getDay() === 0 ? 6 : new Date(year, month, 1).getDay() - 1 }).map((_, i) => (
              <div key={`empty-${i}`} style={{ height: '86px' }} />
            ))}

            {Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => {
              const day = i + 1;
              const dateKey = `${currentMonthKey}-${String(day).padStart(2, '0')}`;
              const volume = dailyVolumes[dateKey] || 0;
              const ordersOnDay = groupedByDate[dateKey] || [];
              const isSelected = selectedDay === day;
              const isToday = isCurrentMonth && day === currentDay;
              const cancelledCount = ordersOnDay.filter((o: any) => o.status === 'cancelled').length;
              const dayOfWeek = new Date(year, month, day).getDay();
              const isWeekendOrHoliday = dayOfWeek === 0 || dayOfWeek === 6 || isRussianHoliday(month, day);

              const triggerQuickCreate = () => onQuickCreateOrder(dateKey);

              return (
                <div
                  key={day}
                  title="Клик — заявки дня • ПКМ / долгое нажатие — новая заявка на этот день"
                  onClick={() => {
                    if (longPressTriggered.current) { longPressTriggered.current = false; return; }
                    handleDayClick(day);
                  }}
                  onContextMenu={(e) => { e.preventDefault(); triggerQuickCreate(); }}
                  onTouchStart={() => {
                    longPressTriggered.current = false;
                    longPressTimer.current = setTimeout(() => {
                      longPressTriggered.current = true;
                      triggerQuickCreate();
                    }, 550);
                  }}
                  onTouchEnd={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                  onTouchMove={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                  style={{
                    height: '86px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '14px',
                    // Синего фона больше нет — выбор дня показываем лёгким зелёным
                    // оттенком фона + зелёным кольцом (тем же акцентом, что и «сегодня»).
                    backgroundColor: isSelected ? 'rgba(16,185,129,0.16)' : '#334155',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '19px',
                    fontWeight: '600',
                    position: 'relative',
                    // Мягкое зелёное кольцо вместо жёсткой синей/красной рамки — в общем
                    // цвете акцентов админки и без утолщения самой клетки (box-shadow,
                    // а не border, поэтому высота клетки не отличается от остальных).
                    boxShadow: (isSelected || isToday) ? 'inset 0 0 0 2px #10B981' : 'none',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  {ordersOnDay.length > 0 && (
                    <span style={{
                      position: 'absolute',
                      top: '6px',
                      right: '8px',
                      fontSize: '11px',
                      fontWeight: '700',
                      color: isSelected ? '#A7F3D0' : '#64748B',
                      background: isSelected ? 'rgba(16,185,129,0.2)' : 'rgba(148,163,184,0.15)',
                      borderRadius: '9999px',
                      padding: '1px 7px',
                    }}>
                      {ordersOnDay.length}
                    </span>
                  )}
                  {cancelledCount > 0 && (
                    <span style={{
                      position: 'absolute',
                      top: '6px',
                      left: '8px',
                      fontSize: '11px',
                      fontWeight: '700',
                      color: '#fff',
                      background: '#EF4444',
                      borderRadius: '9999px',
                      padding: '1px 6px',
                      minWidth: '15px',
                      textAlign: 'center',
                    }} title={`Отменено заказов: ${cancelledCount}`}>
                      {cancelledCount}
                    </span>
                  )}
                  <span style={{ color: isWeekendOrHoliday ? '#FACC15' : '#fff' }}>{day}</span>
                  {volume > 0 && (
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#10B981', marginTop: '4px' }}>
                      {Number(volume).toFixed(1)} м³
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Навигация по месяцам — без фона, под календарём, слева от бокового окна */}
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '14px', marginTop: '16px', flexShrink: 0 }}>
            <button
              onClick={handlePrevMonth}
              style={navButtonStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(148,163,184,0.12)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94A3B8'; }}
            >
              ← Пред. месяц
            </button>
            <button
              onClick={handleToday}
              style={todayButtonStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(16,185,129,0.12)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              Сегодня
            </button>
            <button
              onClick={handleNextMonth}
              style={navButtonStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(148,163,184,0.12)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94A3B8'; }}
            >
              След. месяц →
            </button>
          </div>
        </div>

        {/* Список заказов на выбранный день */}
        <div style={volumeCardSoftStyle({ width: '540px', borderRadius: 20, padding: '28px', display: 'flex', flexDirection: 'column', minHeight: 0 })}>
          <h3 style={{ fontSize: '22px', marginBottom: '20px', color: '#fff', flexShrink: 0 }}>
            {selectedDay
              // day+month вместе даёт корректный родительный падеж («15 июля», а не «15 июль»)
              ? `Заказы на ${new Date(year, month, selectedDay).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} (${dayOrders.length})`
              : 'Выберите день'}
          </h3>

          {loading ? (
            <p style={{ color: '#94A3B8', textAlign: 'center', margin: 'auto' }}>Загрузка...</p>
          ) : dayOrders.length > 0 ? (
            <div className="scroll-hidden" style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {dayOrders.map((order) => {
                const statusStyle = getStatusConfig((order as any).status);
                return (
                  <div
                    key={order.id}
                    onClick={() => onSelectOrder(order)}
                    style={volumeCardSoftStyle({
                      padding: '18px',
                      borderRadius: 14,
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'filter 0.15s ease',
                    })}
                    onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: '600', color: '#fff', fontSize: '18px' }}>#{order.id}</span>
                      <span style={{
                        padding: '4px 14px',
                        borderRadius: '9999px',
                        fontSize: '13px',
                        fontWeight: '600',
                        backgroundColor: statusStyle.bg,
                        color: statusStyle.color,
                      }}>
                        {statusStyle.label}
                      </span>
                    </div>

                    <div style={{ fontSize: '15px', color: '#94A3B8', marginTop: '8px' }}>
                      {(order as any).organization_name || (order as any).full_name || '—'}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', alignItems: 'center' }}>
                      <span style={{ color: '#10B981', fontWeight: '600' }}>{order.volume} м³</span>
                      <span style={{ color: '#64748B', fontSize: '13px' }}>{(order as any).delivery_time || ''}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ color: '#94A3B8', textAlign: 'center', margin: 'auto', fontSize: '17px' }}>
              {selectedDay ? 'На выбранный день заказов нет' : 'Выберите день слева, чтобы увидеть заказы'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
