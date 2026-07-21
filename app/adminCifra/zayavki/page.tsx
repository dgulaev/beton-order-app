'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Order } from '../hooks/useCalendarOrders';
import { useRealtimeOrders } from '../../../hooks/useRealtimeOrders';
import NewOrderModal from '@/app/adminCifra/components/NewOrderModal';
import { useMapRouteLinks } from '@/lib/yandexRoute';
import { Package, Save, Trash2, Send, Share2, Copy, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { OrderHistoryTimeline } from '@/lib/orderHistoryDisplay';
import OrderRouteMap from '@/app/adminCifra/components/OrderRouteMap';
import ModalActionButton from '@/app/adminCifra/components/ModalActionButton';
import { findRecipeByGrade, getAdditiveDosage, ADDITIVE_NAMES } from '@/lib/recipeAdditives';

// ==================== Подсказка "тут есть скрытый контент" (мерцающая стрелочка вниз) ====================
// Скроллбар у блока всегда скрыт (глобальный сброс в globals.css); вместо него —
// мягкий градиент + мерцающая стрелка снизу, видна только пока список не докручен до конца.
function ScrollMoreHint({ visible, background = 'rgba(37,51,74,0.95)' }: { visible: boolean; background?: string }) {
  if (!visible) return null;
  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: '26px',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      paddingBottom: '2px',
      background: `linear-gradient(to bottom, rgba(37,51,74,0), ${background})`,
      borderRadius: '0 0 12px 12px',
      pointerEvents: 'none',
    }}>
      <span style={{ color: '#94A3B8', fontSize: '13px', lineHeight: 1, animation: 'zayavkiScrollBounce 1.4s ease-in-out infinite' }}>
        ▼
      </span>
    </div>
  );
}

export default function ZayavkiPage() {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const { yandexHref: yandexRouteHref, googleHref: googleRouteHref, twoGisHref: twoGisRouteHref } = useMapRouteLinks(selectedOrder?.address);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'processing' | 'completed' | 'cancelled'>('all');
  // Режим расширенного поиска по всему месяцу
  const [searchMode, setSearchMode] = useState(false);
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [newOrderInitialData, setNewOrderInitialData] = useState<any>(null);
  const [orderHistory, setOrderHistory] = useState<any[]>([]);
  const [orderMixers, setOrderMixers] = useState<any[]>([]);
  const [userFullName, setUserFullName] = useState<string>('');
  const [currentRole, setCurrentRole] = useState<string>('');
 
  
  const [notificationSent, setNotificationSent] = useState(false);
  const [isSendingNotification, setIsSendingNotification] = useState(false);

  const [recipes, setRecipes] = useState<any[]>([]);
  // Остатки добавок на складе (литры), подгружаются один раз
  const [warehouseAdditives, setWarehouseAdditives] = useState<{ pfm: number; linomix: number } | null>(null);
  const [showAdditivePopup, setShowAdditivePopup] = useState(false);

  // ==================== ПОИСК КЛИЕНТА В МОДАЛКЕ РЕДАКТИРОВАНИЯ ====================
  const [allClients, setAllClients] = useState<any[]>([]);
  const [clientQuery, setClientQuery] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);

  // ==================== "СПИСОК УШЁЛ ВНИЗ" — стрелки-подсказки для скроллящихся блоков модалки ====================
  const mixerListRef = useRef<HTMLDivElement>(null);
  const [mixerListHasMore, setMixerListHasMore] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const [commentHasMore, setCommentHasMore] = useState(false);

  const recomputeOverflow = (el: HTMLElement | null, setter: (v: boolean) => void) => {
    if (!el) { setter(false); return; }
    setter(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  };

  const handleMixerListScroll = () => recomputeOverflow(mixerListRef.current, setMixerListHasMore);
  const handleHistoryScroll = () => recomputeOverflow(historyRef.current, setHistoryHasMore);
  const handleCommentScroll = () => recomputeOverflow(commentRef.current, setCommentHasMore);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      recomputeOverflow(mixerListRef.current, setMixerListHasMore);
      recomputeOverflow(historyRef.current, setHistoryHasMore);
      recomputeOverflow(commentRef.current, setCommentHasMore);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrder?.id, orderMixers.length, orderHistory.length]);

  // ==================== HELPER ДЛЯ СТАТУСОВ (getStatusConfig) ====================
const getStatusConfig = (status: string) => {
  switch (status) {
    case 'new':
      return { label: 'Новая', bg: '#FACC1520', color: '#FACC15', final: false };
    case 'processing':
      return { label: 'В работе', bg: '#3B82F620', color: '#3B82F6', final: false };
    case 'completed':
      return { label: 'Выполнена', bg: '#10B98120', color: '#10B981', final: true };
    case 'cancelled':
      return { label: 'Отменена', bg: '#EF444420', color: '#EF4444', final: true };
    default:
      return { label: status, bg: '#64748B20', color: '#64748B', final: false };
  }
};

    // ==================== HELPER ДЛЯ ПРОВЕРКИ ПРАВ ====================
  const hasManagerPermissions = (role: string): boolean => {
    if (!role) return false;
    const r = role.toLowerCase().trim();
    return r === 'admin' || r === 'manager' || r === 'dispatcher' || r === 'logist';
  };

  const isAdmin = (role: string): boolean => {
    return role?.toLowerCase().trim() === 'admin';
  };

  // ==================== ЗАГРУЗКА ИСТОРИИ ИЗМЕНЕНИЙ ====================
  const loadOrderHistory = useCallback(async (orderId: number) => {
    try {
      const res = await fetch(`/api/adminCifra/orders/${orderId}/history`);
      if (res.ok) {
        const data = await res.json();
        setOrderHistory(data);
      } else {
        setOrderHistory([]);
      }
    } catch (err) {
      console.error('Ошибка загрузки истории:', err);
      setOrderHistory([]);
    }
  }, []);

  // ==================== ЗАГРУЗКА НАЗНАЧЕННЫХ МИКСЕРОВ (для отображения простоя) ====================
  const loadOrderMixers = useCallback(async (orderId: number) => {
    try {
      const res = await fetch(`/api/adminCifra/order-mixers?orderId=${orderId}`);
      if (res.ok) {
        setOrderMixers(await res.json());
      } else {
        setOrderMixers([]);
      }
    } catch (err) {
      console.error('Ошибка загрузки миксеров заявки:', err);
      setOrderMixers([]);
    }
  }, []);

  // Правка объёма уже назначенного миксера — инструмент для исправления
  // ситуаций постфактум (напр. заявка #589: заявку закрыли по факту 7=7 м³,
  // а по факту реально привезли 8 м³). Разрешена и на уже "Выполненной"
  // заявке.
  const handleMixerVolumeChange = useCallback(async (mixerId: number, newVolume: number) => {
    const oldMixer = orderMixers.find((m: any) => m.id === mixerId);
    const oldVolume = oldMixer?.volume;

    setOrderMixers(prev => prev.map((m: any) => m.id === mixerId ? { ...m, volume: newVolume } : m));

    try {
      const res = await fetch('/api/adminCifra/order-mixers/volume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mixerId,
          volume: newVolume,
          userName: userFullName || 'Сотрудник',
          userRole: currentRole || 'admin',
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Не удалось изменить объём миксера');
      }

      if (selectedOrder?.id) {
        loadOrderHistory(selectedOrder.id);
        if (data.data?.orderCompleted) {
          setSelectedOrder((prev: any) => prev ? { ...prev, status: 'completed' } : prev);
        }
      }
    } catch (err) {
      console.error('Ошибка сохранения объёма миксера:', err);
      setOrderMixers(prev => prev.map((m: any) => m.id === mixerId ? { ...m, volume: oldVolume } : m));
      alert('Не удалось сохранить объём миксера: ' + (err instanceof Error ? err.message : ''));
    }
  }, [orderMixers, userFullName, currentRole, selectedOrder?.id, loadOrderHistory]);

  // ==================== ОТКРЫТИЕ ЗАЯВКИ С ИСТОРИЕЙ ====================
  const handleOpenOrder = useCallback((order: Order) => {
    setSelectedOrder(order);
    const orderId = order.id ? Number(order.id) : null;
    if (orderId) {
      loadOrderHistory(orderId);
      loadOrderMixers(orderId);
    } else {
      console.error('У заявки отсутствует id:', order);
    }
  }, [loadOrderHistory, loadOrderMixers]);

                  // ==================== ЗАГРУЗКА РОЛИ И РЕАЛЬНОГО ИМЕНИ ====================
useEffect(() => {
  const loadRoleAndName = async () => {
    const savedUserId = localStorage.getItem('userId');
    if (!savedUserId) {
      setCurrentRole('admin');
      setUserFullName('Сотрудник');
      return;
    }

    try {
      const res = await fetch('/api/user/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: savedUserId }),
        cache: 'no-store'
      });

      if (res.ok) {
        const data = await res.json();
        const role = (data.role || 'admin').toLowerCase();
        const name = data.full_name || data.username || data.name || 'Сотрудник';

        setCurrentRole(role);
        setUserFullName(name);

        localStorage.setItem('userRole', role);
        localStorage.setItem('userName', name);

        console.log(`✅ Загружено: ${name} (${role})`);
      } else {
        setCurrentRole('admin');
        setUserFullName('Сотрудник');
      }
    } catch (err) {
      console.error('❌ Ошибка загрузки роли/имени:', err);
      setCurrentRole('admin');
      setUserFullName('Сотрудник');
    }
  };

  loadRoleAndName();
}, []);

  // ==================== УДАЛЕНИЕ ЗАЯВКИ ====================
  const handleDeleteOrder = async (orderId: number) => {
    if (!confirm('Вы уверены, что хотите удалить эту заявку? Действие необратимо.')) return;

    try {
      const res = await fetch(`/api/adminCifra/orders/${orderId}`, { method: 'DELETE' });

      if (res.ok) {
        alert('✅ Заявка успешно удалена');
        setSelectedOrder(null);
        setAllOrders(prev => prev.filter(o => String(o.id) !== String(orderId)));
      } else {
        alert('Ошибка при удалении заявки');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения с сервером');
    }
  };

  // ==================== РЕДАКТИРОВАНИЕ ЗАЯВКИ ====================
  const handleEditOrder = (order: any) => {
    const newAddress = prompt('Новый адрес:', order.address);
    if (newAddress === null) return;

    const newVolume = prompt('Новый объём (м³):', order.volume);
    if (newVolume === null) return;

    const updatedOrder = {
      ...order,
      address: newAddress,
      volume: parseFloat(newVolume),
    };

    fetch('/api/adminCifra/orders/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedOrder),
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert('✅ Заявка обновлена!');
        setSelectedOrder(updatedOrder);
        setAllOrders(prev => prev.map(o => o.id === order.id ? updatedOrder : o));
      } else {
        alert('Ошибка обновления');
      }
    })
    .catch(() => alert('Ошибка соединения'));
  };

  // ==================== РУЧНАЯ ОТПРАВКА УВЕДОМЛЕНИЯ В MAX ====================
  const sendNotification = async (orderId: number) => {
    if (!orderId) return alert('ID заявки не найден');

    if (!confirm('Отправить обновлённую заявку в Max?')) return;

    setIsSendingNotification(true);

    try {
      const res = await fetch('/api/order/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });

      if (res.ok) {
        setNotificationSent(true);
        alert('✅ Уведомление успешно отправлено в Max!');
      } else {
        alert('Не удалось отправить уведомление');
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка отправки уведомления');
    } finally {
      setIsSendingNotification(false);
    }
  };

  // ==================== ПОДЕЛИТЬСЯ ЗАЯВКОЙ (ЧИСТЫЙ ТЕКСТ) ====================
  const shareOrder = (order: any) => {
    const shareText = `Заявка №${order.id}

Марка: ${order.grade}
Объём: ${order.volume} м³
Дата: ${order.delivery_date}
Время: ${order.delivery_time}

Адрес: ${order.address}

Тип: ${order.customer_type}
${order.customer_type?.includes('Юридическое') 
  ? `Организация: ${order.organization_name || '-'}`
  : `ФИО: ${order.full_name || '-'}`}

Телефон: ${order.phone}

Комментарий: ${order.comment || '-'}`.trim();

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(shareText).then(() => {
        alert('✅ Информация скопирована!\nМожно отправить клиенту.');
      }).catch(() => {
        fallbackCopyText(shareText);
      });
    } else {
      fallbackCopyText(shareText);
    }
  };

  // Fallback для случаев, когда clipboard API недоступен
  const fallbackCopyText = (text: string) => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      document.execCommand('copy');
      alert('✅ Информация скопирована!\nМожно отправить клиенту.');
    } catch (err) {
      alert('Не удалось скопировать текст. Скопируйте вручную.');
      console.error('Fallback copy failed', err);
    }

    document.body.removeChild(textArea);
  };

  // ==================== КОПИРОВАТЬ ЗАЯВКУ ====================
  const copyOrder = (order: any) => {
    const copiedData = {
      grade: order.grade,
      volume: order.volume,
      deliveryDate: order.delivery_date,
      deliveryTime: order.delivery_time,
      address: order.address,
      customerType: order.customer_type?.includes('Юридическое') ? 'legal' : 'physical',
      organizationName: order.organization_name || '',
      fullName: order.full_name || '',
      phone: order.phone,
      inn: order.inn || '',
      comment: order.comment || '',
    };

    setSelectedOrder(null);
    setNewOrderInitialData(copiedData);
    setShowNewOrderModal(true);

    console.log('📋 Данные заявки успешно скопированы:', copiedData);
  };

  // ==================== REALTIME (начальная загрузка + live-обновления) ====================
  const { status: ordersRealtimeStatus } = useRealtimeOrders(setAllOrders);

  // Заявку удалили (например, тестовую #604), пока её модалка была открыта —
  // realtime DELETE уже убрал заявку из allOrders, но selectedOrder — отдельный
  // стейт модалки, и без этой проверки она продолжала бы показывать
  // замороженные старые данные до перезагрузки страницы.
  useEffect(() => {
    if (!selectedOrder?.id) return;
    if (allOrders.length === 0) return;
    const stillExists = allOrders.some((o: any) => String(o.id) === String(selectedOrder.id));
    if (!stillExists) {
      setSelectedOrder(null);
    }
  }, [allOrders, selectedOrder?.id]);

  // Загружаем заказы только за выбранный месяц вместо всей истории.
  // При смене месяца (selectedDate) делаем новый запрос.
  const selYear = selectedDate.getFullYear();
  const selMonth = selectedDate.getMonth() + 1;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/adminCifra/orders?year=${selYear}&month=${selMonth}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => { if (!cancelled) setAllOrders(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selYear, selMonth]);

  // ==================== 1. РАБОТА С ДАТАМИ (ИСПРАВЛЕНО) ====================
  // Новая функция — надёжно получает дату в локальном часовом поясе
  const getLocalDateString = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const selectedDateStr = getLocalDateString(selectedDate);

  // ==================== 2. ФИЛЬТРАЦИЯ ЗАЯВОК НА ВЫБРАННЫЙ ДЕНЬ (с часовым поясом) ====================
  const dayOrders = allOrders
    .filter((o: Order) => {
      if (!o?.delivery_date) return false;

      let orderDate: Date;

      if (typeof o.delivery_date === 'string') {
        // Если приходит строка — парсим как local дату
        orderDate = new Date(o.delivery_date);
      } else {
        orderDate = new Date(o.delivery_date);
      }

      // Приводим к локальной дате (учитываем часовой пояс пользователя)
      const orderDateStr = orderDate.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('.').reverse().join('-'); // YYYY-MM-DD

      const selectedStr = selectedDate.toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('.').reverse().join('-');

      return orderDateStr === selectedStr;
    })
    .sort((a, b) => (a.delivery_time || '00:00').localeCompare(b.delivery_time || '00:00'));

    // Заявки на день
    // console.log(`📅 Выбранная дата: ${selectedDateStr} | Найдено заявок: ${dayOrders.length}`);

  // ==================== KPI ====================
  // Исключаем отменённые заявки из всех расчётов
  const activeOrders = dayOrders.filter((o: Order) => o.status !== 'cancelled');

  const totalVolume = activeOrders.reduce((sum: number, o: Order) => 
    sum + (Number(o.volume) || 0), 0);

  const completedVolume = activeOrders
    .filter((o: Order) => o.status === 'completed')
    .reduce((sum: number, o: Order) => 
      sum + (Number(o.volume) || 0), 0);

  const deliveriesCount = activeOrders.length;   // количество активных заявок

  const pprz = totalVolume > 0 
    ? Math.round((completedVolume / totalVolume) * 100) 
    : 0;

              // ==================== НЕДЕЛЯ (ПН - ВС) ====================
  const getWeekDays = () => {
    const days = [];
    const current = new Date(selectedDate);
    
    // Находим понедельник текущей недели
    const dayOfWeek = current.getDay(); // 0 = воскресенье, 1 = понедельник...
    const diff = current.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // сдвиг к понедельнику
    const monday = new Date(current);
    monday.setDate(diff);
    monday.setHours(12, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const weekDays = getWeekDays();

  // ==================== 4. ПОДСЧЁТ ЗАЯВОК НА ДЕНЬ ====================
  const getOrdersCountForDate = (date: Date) => {
    const dateStr = getLocalDateString(date);
    
    return allOrders.filter(o => {
      if (!o?.delivery_date) return false;
      
      let orderDateStr: string;
      if (typeof o.delivery_date === 'string') {
        orderDateStr = o.delivery_date.substring(0, 10);
      } else {
        orderDateStr = getLocalDateString(new Date(o.delivery_date));
      }
      return orderDateStr === dateStr;
    }).length;
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'new': return '#FACC15';
      case 'processing': return '#3B82F6';
      case 'completed': return '#10B981';
      case 'cancelled': return '#EF4444';
      default: return '#64748B';
    }
  };

  const filteredOrders = dayOrders.filter(order => {
    const searchLower = searchQuery.toLowerCase();

    const matchesSearch = 
      (order.organization_name || '').toLowerCase().includes(searchLower) ||
      (order.full_name || '').toLowerCase().includes(searchLower) ||
      String(order.id).includes(searchQuery) ||
      (order.inn || '').includes(searchQuery);

    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Результаты расширенного поиска — по всему загруженному месяцу
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return allOrders
      .filter((order: any) => {
        const matchesSearch =
          (order.organization_name || '').toLowerCase().includes(q) ||
          (order.full_name || '').toLowerCase().includes(q) ||
          String(order.id).includes(q) ||
          (order.inn || '').includes(q) ||
          (order.grade || '').toLowerCase().includes(q) ||
          (order.address || '').toLowerCase().includes(q);
        const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
        return matchesSearch && matchesStatus;
      })
      .sort((a: any, b: any) => {
        const dc = String(b.delivery_date || '').localeCompare(String(a.delivery_date || ''));
        if (dc !== 0) return dc;
        return String(a.delivery_time || '').localeCompare(String(b.delivery_time || ''));
      });
  }, [searchMode, searchQuery, allOrders, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const runSearch = () => {
    if (!searchQuery.trim()) return;
    setSearchMode(true);
  };

  const clearSearch = () => {
    setSearchMode(false);
    setSearchQuery('');
  };
  

       // ==================== ЗАГРУЗКА РЕЦЕПТОВ ====================
  useEffect(() => {
    const fetchRecipes = async () => {
      try {
        const res = await fetch('/api/adminCifra/recipes');
        if (res.ok) {
          const data = await res.json();
         // console.log('✅ Загружено рецептов из adminCifra:', data.length, data);
          setRecipes(data);
        } else {
          console.error('❌ Ошибка загрузки рецептов, статус:', res.status);
        }
      } catch (err) {
        console.error('❌ Ошибка загрузки рецептов:', err);
      }
    };

    fetchRecipes();
  }, []);

  // ==================== ЗАГРУЗКА КЛИЕНТОВ ДЛЯ ПОИСКА ====================
  useEffect(() => {
    fetch('/api/adminCifra/clients')
      .then(r => r.ok ? r.json() : [])
      .then(data => setAllClients(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Закрытие dropdown при клике вне
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ==================== ЗАГРУЗКА ОСТАТКОВ СКЛАДА ====================
  useEffect(() => {
    const fetchWarehouse = async () => {
      try {
        const res = await fetch('/api/adminCifra/warehouse');
        if (!res.ok) return;
        const data = await res.json();
        const adds: any[] = data.additives || [];
        const pfm    = Number(adds.find((a: any) => Number(a.additive_id) === 1)?.current ?? 0);
        const linomix = Number(adds.find((a: any) => Number(a.additive_id) === 2)?.current ?? 0);
        setWarehouseAdditives({ pfm, linomix });
      } catch { /* тихо */ }
    };
    fetchWarehouse();
  }, []);

         // ==================== РАСЧЁТ ЦЕМЕНТА ====================
  // П5: useMemo — функция остаётся, но memoизированные значения ниже
  const calculateCementNeeded = (onlyCompleted: boolean) => {
    // Исключаем отменённые заявки из расчётов
    let orders = dayOrders.filter((o: Order) => o.status !== 'cancelled');

    if (onlyCompleted) {
      orders = orders.filter((o: Order) => o.status === 'completed');
    }

    let totalKg = 0;

    // console.log(`📊 Расчёт цемента. Всего активных заказов на день: ${orders.length}`);

    orders.forEach((order: any, index: number) => {
      const grade = String(order.grade || '').trim();
      const volume = Number(order.volume || 0);

      if (volume <= 0) return;

      // Расширенный поиск рецепта
      let recipe = recipes.find(r => r.code === grade);
      if (!recipe) recipe = recipes.find(r => r.code === grade.replace('и', ''));
      if (!recipe) recipe = recipes.find(r => r.name?.includes(grade));

    // Лог для определения правильности рецептов в заявках
    // console.log(`   [${index}] Марка: "${grade}" → рецепт найден:`, recipe ? recipe.code : 'НЕ НАЙДЕН');

      if (recipe && recipe.cement) {
        totalKg += volume * Number(recipe.cement);
      }
    });

    const tons = (totalKg / 1000).toFixed(1);
    // console.log(`✅ Итого цемента: ${tons} т`);
    return tons;
  };

    // ==================== РАСЧЁТ ДОБАВОК (с поддержкой additive2 для растворов) ====================
  const calculateAdditiveNeeded = (onlyCompleted: boolean = false) => {
    let orders = dayOrders.filter((o: any) => o.status !== 'cancelled');
    if (onlyCompleted) {
      orders = orders.filter((o: any) => o.status === 'completed');
    }

    let totalKg = 0;

    orders.forEach((order: any) => {
      let grade = String(order.grade || '').trim();
      const volume = Number(order.volume || 0);
      if (volume <= 0 || !grade) return;

      // Поиск рецепта
      let recipe = recipes.find((r: any) => r.code === grade);
      if (!recipe) recipe = recipes.find((r: any) => r.code === grade.replace(/и$/, ''));
      if (!recipe) recipe = recipes.find((r: any) => grade.includes(r.code));
      if (!recipe) recipe = recipes.find((r: any) => r.name?.toLowerCase().includes(grade.toLowerCase()));

      if (!recipe) return;

      let additiveValue = 0;

      // Логика выбора колонки добавки
      if (recipe.type === 'mortar' && recipe.additive2 !== null && recipe.additive2 !== undefined) {
        additiveValue = Number(recipe.additive2);
      } else if (recipe.additive !== null && recipe.additive !== undefined) {
        additiveValue = Number(recipe.additive);
      }

      if (additiveValue > 0) {
        totalKg += volume * additiveValue;
      }
    });

    return totalKg.toFixed(1);   // в кг
  };

  // П5: weekOrderCounts — подсчёт заявок для каждого дня недели
  const weekOrderCounts = useMemo(() =>
    weekDays.map((d: Date) => getOrdersCountForDate(d))
  , [allOrders, weekDays]); // eslint-disable-line react-hooks/exhaustive-deps

  // П5: memoизированные значения для рендера (избегаем пересчёта при каждом ререндере)
  const cementCompletedMemo  = useMemo(() => calculateCementNeeded(true),  [dayOrders, recipes]); // eslint-disable-line react-hooks/exhaustive-deps
  const cementAllMemo        = useMemo(() => calculateCementNeeded(false), [dayOrders, recipes]); // eslint-disable-line react-hooks/exhaustive-deps
  const additiveCompletedMemo = useMemo(() => calculateAdditiveNeeded(true),  [dayOrders, recipes]); // eslint-disable-line react-hooks/exhaustive-deps
  const additiveAllMemo       = useMemo(() => calculateAdditiveNeeded(false), [dayOrders, recipes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ==================== ПРОГНОЗ ДОБАВОК — скользящие 7 дней от selectedDate ====================
  // Не привязываемся к ПН-ВС: берём selectedDate + 6 следующих дней.
  const weekAdditiveForecast = useMemo(() => {
    if (!recipes.length) return null;

    // 7 дат начиная с selectedDate
    const forecastDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      forecastDates.push(`${y}-${m}-${day}`);
    }
    const forecastDateSet = new Set(forecastDates);
    const dateFrom = forecastDates[0];
    const dateTo   = forecastDates[6];

    // Активные заявки в диапазоне
    const forecastOrders = allOrders.filter((o: any) => {
      if (o.status === 'cancelled') return false;
      if (!o.delivery_date) return false;
      const ds = typeof o.delivery_date === 'string'
        ? o.delivery_date.substring(0, 10)
        : (() => { const d = new Date(o.delivery_date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
      return forecastDateSet.has(ds);
    });

    let pfmLiters = 0;
    let linomixLiters = 0;

    // Детали по каждой заявке для попапа
    const details: Array<{
      id: number; grade: string; volume: number; deliveryDate: string;
      additiveId: 1 | 2; additiveName: string; kg: number; liters: number;
    }> = [];

    forecastOrders.forEach((order: any) => {
      const recipe = findRecipeByGrade(recipes, order.grade);
      const dosage = getAdditiveDosage(recipe);
      if (!dosage) return;
      const volume = Number(order.volume || 0);
      if (volume <= 0) return;
      const kg = volume * dosage.kgPerM3;
      const liters = kg / dosage.densityKgPerLiter;
      if (dosage.additiveId === 1) pfmLiters += liters;
      else linomixLiters += liters;
      const ds = typeof order.delivery_date === 'string'
        ? order.delivery_date.substring(0, 10)
        : (() => { const d = new Date(order.delivery_date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
      details.push({ id: order.id, grade: order.grade || '—', volume, deliveryDate: ds, additiveId: dosage.additiveId, additiveName: dosage.name, kg: Math.round(kg * 10) / 10, liters: Math.round(liters * 10) / 10 });
    });

    const pfmStock     = warehouseAdditives?.pfm    ?? null;
    const linomixStock = warehouseAdditives?.linomix ?? null;

    return {
      dateFrom, dateTo,
      totalOrders: forecastOrders.length,
      totalVolume: Math.round(forecastOrders.reduce((s: number, o: any) => s + Number(o.volume || 0), 0)),
      pfm:     { needed: Math.round(pfmLiters),     stock: pfmStock,     shortage: pfmStock     !== null && pfmStock     < pfmLiters },
      linomix: { needed: Math.round(linomixLiters),  stock: linomixStock, shortage: linomixStock !== null && linomixStock < linomixLiters },
      hasAlert: (pfmStock !== null && pfmStock < pfmLiters) || (linomixStock !== null && linomixStock < linomixLiters),
      details,
    };
  }, [allOrders, selectedDate, recipes, warehouseAdditives]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ 
      color: '#fff',
      flex: 1,
      minHeight: 0,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxSizing: 'border-box'
    }}>
    
    {/* Header */}
    <div style={{ 
      background: '#1E2937', 
      padding: '14px 32px', 
      borderRadius: '20px 20px 0 0',
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'space-between',
      flexShrink: 0
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Package size={26} color="#94A3B8" />
          Заявки
        </h1>
        
        
      </div>
    </div>

                              {/* ==================== KPI БАР ==================== */}
      <div style={{ 
        padding: '14px 32px', 
        background: '#1E2937', 
        display: 'flex', 
        gap: '60px', 
        borderTop: '1px solid #334155',
        borderRadius: '0 0 20px 20px',
        alignItems: 'center',
        flexWrap: 'wrap',
        flexShrink: 0,
        marginBottom: '16px'
      }}>
        
        {/* Выполнено сегодня */}
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Выполнено сегодня</div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>
            {Math.round(completedVolume)} / <span style={{ opacity: 0.6, color: '#94A3B8' }}>{Math.round(totalVolume)}</span> м³
          </div>
        </div>

        {/* Понадобится цемента */}
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Понадобится цемента</div>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#60A5FA' }}>
            {cementCompletedMemo} / 
            <span style={{ opacity: 0.6, color: '#94A3B8' }}>
              {Math.round(Number(cementAllMemo))}
            </span> т
          </div>
        </div>

        {/* Понадобится добавок */}
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Понадобится добавок</div>
          <div style={{ fontSize: '28px', fontWeight: '700', color: '#FACC15' }}>
            {additiveCompletedMemo} / 
            <span style={{ opacity: 0.6, color: '#94A3B8' }}>
              {Math.round(Number(additiveAllMemo))}
            </span> кг
          </div>
        </div>

        {/* Доставок сегодня */}
        <div>
          <div style={{ color: '#94A3B8', fontSize: '14px' }}>Доставок сегодня</div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>
            {deliveriesCount}
          </div>
        </div>

        {/* Пилюля нехватки добавок перенесена к кнопке Новая заявка */}

      </div>

      <div style={{ display: 'flex', gap: '24px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        
                {/* ==================== ЛЕВАЯ КОЛОНКА — ЗАЯВКИ НА НЕДЕЛЮ ==================== */}
        <div style={{ 
          width: '340px', 
          flexShrink: 0,
          height: '100%',
          minHeight: 0,
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}>
          <div style={{ 
            background: '#1E2937', 
            borderRadius: '20px', 
            padding: '20px',
            height: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            
            <h3 style={{ marginBottom: '10px', color: '#94A3B8', fontSize: '16px', flexShrink: 0 }}>
              ЗАЯВКИ НА НЕДЕЛЮ
            </h3>

            {/* ==================== НАВИГАЦИЯ ПО НЕДЕЛЯМ ==================== */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '10px',
              color: '#CBD5E1',
              flexShrink: 0,
              gap: '16px'
            }}>
              <button 
                onClick={() => {
                  const newDate = new Date(selectedDate);
                  newDate.setDate(newDate.getDate() - 7);
                  setSelectedDate(newDate);
                }}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#94A3B8', 
                  fontSize: '32px', 
                  cursor: 'pointer',
                  padding: '8px 16px',
                  flexShrink: 0,
                  userSelect: 'none'
                }}
              >
                ←
              </button>

              <div style={{ 
                fontWeight: '700', 
                fontSize: '18px', 
                textAlign: 'center',
                flex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}>
                {selectedDate.toLocaleDateString('ru-RU', { 
                  month: 'long', 
                  year: 'numeric' 
                })}
              </div>

              <button 
                onClick={() => {
                  const newDate = new Date(selectedDate);
                  newDate.setDate(newDate.getDate() + 7);
                  setSelectedDate(newDate);
                }}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#94A3B8', 
                  fontSize: '32px', 
                  cursor: 'pointer',
                  padding: '8px 16px',
                  flexShrink: 0,
                  userSelect: 'none'
                }}
              >
                →
              </button>
            </div>

            {/* ==================== СПИСОК ДНЕЙ НЕДЕЛИ (все 7 всегда видны, без скролла; на больших экранах не растягиваются выше меры) ==================== */}
<div style={{ 
  flex: 1, 
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  gap: '6px',
  overflow: 'hidden'
}}>
  {weekDays.map((d: Date, dIdx: number) => {
    const dateStr = d.toISOString().split('T')[0];
    const count = weekOrderCounts[dIdx];
    const isSelected = dateStr === selectedDateStr;
    const isToday = d.toDateString() === new Date().toDateString();

    // Количество отменённых заявок в этот день
    const cancelledCount = dayOrders.filter(o => {
      const orderDate = typeof o.delivery_date === 'string' 
        ? o.delivery_date.substring(0, 10) 
        : new Date(o.delivery_date).toISOString().substring(0, 10);
      return orderDate === dateStr && o.status === 'cancelled';
    }).length;

    return (
      <div
        key={dateStr}
        onClick={() => setSelectedDate(d)}
        style={{
          flex: 1,
          minHeight: 0,
          maxHeight: '58px',
          padding: '0 16px',
          background: isSelected ? '#3B82F620' : '#25334A',
          borderRadius: '10px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          border: isSelected ? '2px solid #3B82F6' : 'none',
          transition: 'all 0.2s ease',
          userSelect: 'none',
          overflow: 'hidden'
        }}
      >
        <div style={{ fontWeight: '600', fontSize: '14px', whiteSpace: 'nowrap' }}>
          {d.toLocaleDateString('ru-RU', { 
            weekday: 'short', 
            day: 'numeric', 
            month: 'short' 
          })}
          {isToday && <span style={{ color: '#60A5FA', marginLeft: '6px' }}>●</span>}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {/* Бейдж отменённых заявок — теперь СЛЕВА */}
          {cancelledCount > 0 && (
            <div style={{
              background: '#EF444420',
              color: '#EF4444',
              padding: '3px 9px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: '600',
              border: '1px solid #EF444440'
            }}>
              -{cancelledCount}
            </div>
          )}

          {/* Основной счётчик активных заявок */}
          <div style={{ 
            background: '#334155', 
            color: '#CBD5E1', 
            padding: '3px 11px', 
            borderRadius: '9999px',
            fontSize: '13px',
            fontWeight: '600',
            minWidth: '26px',
            textAlign: 'center'
          }}>
            {count}
          </div>
        </div>
      </div>
    );
  })}
</div>

{/* ==================== ГРАФИК ЗА НЕДЕЛЮ ==================== */}
<div style={{ 
  background: '#1E2937', 
  borderRadius: '16px', 
  padding: '12px 20px',
  marginTop: '10px',
  marginBottom: '5px',
  height: '165px',
  flexShrink: 0,
  position: 'relative'
}}>
  <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '6px', fontWeight: '600' }}>
    Объём по дням недели (м³)
  </div>

  <svg width="100%" height="105" viewBox="0 0 280 110" style={{ overflow: 'visible' }}>
    {/* Сетка */}
    {[0, 30, 60, 90, 120].map(y => (
      <line key={y} x1="0" y1={y} x2="280" y2={y} stroke="#334155" strokeWidth="1" />
    ))}

    {/* Линия графика */}
    <polyline
      points={weekDays.map((d, i) => {
        const dateStr = d.toISOString().split('T')[0];
        const dailyVolume = allOrders
          .filter(o => {
            if (!o?.delivery_date) return false;
            const orderDate = typeof o.delivery_date === 'string' 
              ? o.delivery_date.substring(0, 10) 
              : new Date(o.delivery_date).toISOString().split('T')[0];
            return orderDate === dateStr && o.status !== 'cancelled';
          })
          .reduce((sum, o) => sum + Number(o.volume || 0), 0);

        const maxVolume = Math.max(...weekDays.map(dd => {
          const ds = dd.toISOString().split('T')[0];
          return allOrders
            .filter(o => {
              const od = typeof o.delivery_date === 'string' ? o.delivery_date.substring(0,10) : new Date(o.delivery_date).toISOString().split('T')[0];
              return od === ds && o.status !== 'cancelled';
            })
            .reduce((s, o) => s + Number(o.volume || 0), 0);
        })) || 100;

        const x = 20 + i * 40;
        const y = 100 - (dailyVolume / (maxVolume || 1)) * 80;
        return `${x},${y}`;
      }).join(' ')}
      fill="none"
      stroke="#60A5FA"
      strokeWidth="3"
      strokeLinejoin="round"
      strokeLinecap="round"
    />

    {/* Точки на графике */}
    {weekDays.map((d, i) => {
      const dateStr = d.toISOString().split('T')[0];
      const dailyVolume = allOrders
        .filter(o => {
          if (!o?.delivery_date) return false;
          const orderDate = typeof o.delivery_date === 'string' 
            ? o.delivery_date.substring(0, 10) 
            : new Date(o.delivery_date).toISOString().split('T')[0];
          return orderDate === dateStr && o.status !== 'cancelled';
        })
        .reduce((sum, o) => sum + Number(o.volume || 0), 0);

      const maxVolume = Math.max(...weekDays.map(dd => {
        const ds = dd.toISOString().split('T')[0];
        return allOrders
          .filter(o => {
            const od = typeof o.delivery_date === 'string' ? o.delivery_date.substring(0,10) : new Date(o.delivery_date).toISOString().split('T')[0];
            return od === ds && o.status !== 'cancelled';
          })
          .reduce((s, o) => s + Number(o.volume || 0), 0);
      })) || 100;

      const x = 20 + i * 40;
      const y = 100 - (dailyVolume / (maxVolume || 1)) * 80;

      return (
        <g key={i}>
          <circle cx={x} cy={y} r="4" fill="#60A5FA" />
          <text x={x} y={y - 12} textAnchor="middle" fill="#94A3B8" fontSize="11">
            {Math.round(dailyVolume)}
          </text>
        </g>
      );
    })}

    {/* Подписи дней */}
    {weekDays.map((d, i) => {
      const x = 20 + i * 40;
      return (
        <text 
          key={i} 
          x={x} 
          y="118" 
          textAnchor="middle" 
          fill="#64748B" 
          fontSize="11"
        >
          {d.toLocaleDateString('ru-RU', { weekday: 'short' })}
        </text>
      );
    })}
  </svg>
</div>

                                    {/* ==================== РАЗДЕЛИТЕЛЬ + СВОДКА ЗА НЕДЕЛЮ ==================== */}
            <div style={{ marginTop: '8px', paddingTop: '10px', borderTop: '1px solid #334155', flexShrink: 0 }}>
              <div style={{ 
                background: '#25334A', 
                borderRadius: '16px', 
                padding: '12px 16px',
                fontSize: '15px'
              }}>
                <div style={{ color: '#94A3B8', marginBottom: '8px', fontWeight: '600' }}>Итого за неделю</div>
                
                {/* 1. Количество заявок */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '15px' }}>Всего заявок:</span>
                  <strong style={{ fontSize: '17px' }}>
                    {weekOrderCounts.reduce((sum, c) => sum + c, 0)}
                  </strong>
                </div>
                
                {/* 2. Запланировано */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '15px' }}>Запланировано:</span>
                  <strong style={{ fontSize: '17px' }}>
                    {Math.round(weekDays.reduce((sum, d) => {
                      const dateStr = getLocalDateString(d);
                      return sum + allOrders
                        .filter(o => {
                          if (!o?.delivery_date) return false;
                          const orderDate = typeof o.delivery_date === 'string' 
                            ? o.delivery_date.substring(0, 10) 
                            : getLocalDateString(new Date(o.delivery_date));
                          return orderDate === dateStr;
                        })
                        .reduce((v, o) => v + Number(o.volume || 0), 0);
                    }, 0))} м³
                  </strong>
                </div>

                {/* 3. Отгружено */}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '15px' }}>Отгружено:</span>
                  <strong style={{ fontSize: '17px', color: '#10B981' }}>
                    {Math.round(weekDays.reduce((sum, d) => {
                      const dateStr = getLocalDateString(d);
                      return sum + allOrders
                        .filter(o => {
                          if (!o?.delivery_date) return false;
                          const orderDate = typeof o.delivery_date === 'string' 
                            ? o.delivery_date.substring(0, 10) 
                            : getLocalDateString(new Date(o.delivery_date));
                          return orderDate === dateStr && o.status === 'completed';
                        })
                        .reduce((v, o) => v + Number(o.volume || 0), 0);
                    }, 0))} м³
                  </strong>
                </div>
              </div>

              <button 
                onClick={() => setShowNewOrderModal(true)}
                style={{
                  width: '100%',
                  marginTop: '8px',
                  padding: '12px',
                  background: '#10B981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontSize: '16px'
                }}
              >
                + Новая заявка
              </button>
              
            </div>

          </div>
        </div>

        {/* ==================== ПРАВАЯ КОЛОНКА — ОСНОВНОЙ СПИСОК ==================== */}
<div style={{ flex: 1, minHeight: 0, height: '100%', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

  {/* Заголовок + поиск + кнопки — всё в одну строку */}
  <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, flexWrap: 'wrap' }}>
    {/* Заголовок */}
    <h2 style={{ margin: 0, flexShrink: 0, fontSize: '18px' }}>
      {searchMode
        ? <><span style={{ color: '#3B82F6' }}>«{searchQuery}»</span> <span style={{ color: '#64748B', fontSize: '14px', fontWeight: 400 }}>{searchResults.length} заявок</span></>
        : selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
    </h2>

    {/* Разделитель */}
    <div style={{ width: '1px', height: '22px', background: '#334155', flexShrink: 0 }} />

    {/* Строка поиска */}
    <input
      type="text"
      placeholder="Поиск по клиенту, №, ИНН, адресу, марке..."
      value={searchQuery}
      onChange={(e) => { setSearchQuery(e.target.value); if (searchMode) setSearchMode(false); }}
      onKeyDown={(e) => e.key === 'Enter' && runSearch()}
      style={{
        padding: '8px 16px',
        background: searchMode ? 'rgba(59,130,246,0.12)' : '#25334A',
        border: searchMode ? '1.5px solid rgba(59,130,246,0.4)' : '1.5px solid transparent',
        borderRadius: '9999px',
        width: '300px',
        color: '#fff',
        fontSize: '14px',
        outline: 'none',
        transition: 'all 0.2s',
        flexShrink: 0,
      }}
    />

    <button
      onClick={runSearch}
      disabled={!searchQuery.trim()}
      style={{
        padding: '8px 18px',
        background: searchQuery.trim() ? '#3B82F6' : '#25334A',
        border: 'none',
        borderRadius: '9999px',
        color: searchQuery.trim() ? '#fff' : '#64748B',
        fontSize: '14px',
        fontWeight: 600,
        cursor: searchQuery.trim() ? 'pointer' : 'default',
        transition: 'all 0.2s',
        flexShrink: 0,
      }}
    >
      Найти
    </button>

    {searchMode && (
      <button
        onClick={clearSearch}
        style={{
          padding: '8px 14px',
          background: 'transparent',
          border: '1.5px solid #334155',
          borderRadius: '9999px',
          color: '#94A3B8',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        ✕ Сбросить
      </button>
    )}

    {/* Отступ вправо */}
    <div style={{ flex: 1 }} />

    {/* Пилюля нехватки добавок */}
    {weekAdditiveForecast?.hasAlert && (
      <button
        onClick={() => setShowAdditivePopup(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '8px 14px',
          background: 'rgba(239,68,68,0.10)',
          border: '1.5px solid rgba(239,68,68,0.40)',
          borderRadius: '9999px',
          color: '#FCA5A5',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'filter 0.15s',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
        onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.2)')}
        onMouseLeave={e => (e.currentTarget.style.filter = '')}
        title="Нехватка добавок — нажмите для деталей"
      >
        <AlertTriangle size={13} color="#EF4444" />
        Не хватает добавок
      </button>
    )}

    {/* Кнопка Новая заявка */}
    <button
      onClick={() => setShowNewOrderModal(true)}
      style={{
        padding: '8px 22px',
        background: '#10B981',
        color: 'white',
        border: 'none',
        borderRadius: '9999px',
        fontSize: '14px',
        fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: '6px',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      + Новая заявка
    </button>
  </div>

    {/* ==================== СПИСОК ЗАЯВОК СО СКРОЛЛОМ ==================== */}
<div style={{ 
  flex: 1,
  minHeight: 0,
  boxSizing: 'border-box',
  background: '#1E2937', 
  borderRadius: '24px', 
  padding: '24px 32px',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
}}>
  
  <div className="scroll-hidden" style={{ 
    flex: 1, 
    overflowY: 'auto', 
    display: 'flex', 
    flexDirection: 'column', 
    gap: '7px',
    paddingRight: '8px'
  }}>
    {loading ? (
      <div style={{ textAlign: 'center', padding: '100px', color: '#64748B' }}>Загрузка заявок...</div>
    ) : (searchMode ? searchResults : filteredOrders).length > 0 ? (searchMode ? searchResults : filteredOrders).map((order: Order, index: number) => (
      <div
  key={order.id}
  onClick={() => handleOpenOrder(order)}
  style={{
    background: '#25334A',
    borderRadius: '14px',
    padding: '9px 20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    transition: 'all 0.2s',
    flexShrink: 0
  }}
>
        {/* Порядковый номер */}
        <div style={{ 
          width: '38px', 
          textAlign: 'center',
          color: '#64748B',
          fontWeight: '700',
          fontSize: '15px',
          userSelect: 'none'
        }}>
          {index + 1}
        </div>

        {/* Дата — только в режиме поиска */}
        {searchMode && (
          <div style={{ width: '90px', flexShrink: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '13px', color: '#CBD5E1' }}>
              {order.delivery_date ? new Date(order.delivery_date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—'}
            </div>
            <div style={{ fontSize: '12px', color: '#64748B' }}>
              {(order as any).delivery_time ? String((order as any).delivery_time).slice(0, 5) : ''}
            </div>
          </div>
        )}

        {/* Время — только вне режима поиска */}
        {!searchMode && (
        <div style={{ width: '76px', fontWeight: '700', fontSize: '15px' }}>
          {order.delivery_time}
        </div>
        )}

        {/* Информация о заявке */}
        <div style={{ flex: 1, lineHeight: 1.25 }}>
          <div style={{ fontWeight: '600', fontSize: '15px' }}>
            #{order.id} — {order.organization_name || order.full_name || '—'}
          </div>
          <div style={{ color: '#94A3B8', fontSize: '13px' }}>
            {order.grade} • {order.volume} м³
          </div>
        </div>

        {/* БЕЙДЖ "ПОД ВОПРОСОМ" */}
{(order as any).is_questionable && (
  <div style={{
    padding: '4px 12px',
    background: '#EF4444',
    color: 'white',
    fontSize: '12px',
    fontWeight: '700',
    borderRadius: '9999px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    boxShadow: '0 2px 6px rgba(239, 68, 68, 0.3)'
  }}>
    ⚠️ Под вопросом
  </div>
)}

        {/* Статус */}
        <div style={{ 
          padding: '5px 16px', 
          borderRadius: '9999px', 
          background: getStatusColor(order.status) + '20', 
          color: getStatusColor(order.status),
          fontWeight: '600',
          fontSize: '13.5px'
        }}>
          {order.status === 'new' && 'Новая'}
          {order.status === 'processing' && 'В работе'}
          {order.status === 'completed' && 'Выполнена'}
          {order.status === 'cancelled' && 'Отменена'}
        </div>
      </div>
    )    ) : (
      <div style={{ textAlign: 'center', padding: '140px 0', color: '#64748B', fontSize: '18px' }}>
        {searchMode
          ? <>Ничего не найдено по запросу <strong style={{ color: '#94A3B8' }}>«{searchQuery}»</strong></>
          : 'По выбранным фильтрам ничего не найдено'}
      </div>
    )}
  </div>
</div>
</div>


      {/* МОДАЛЬНОЕ ОКНО ЗАКАЗА — БЕЗ IFRAME */}
{selectedOrder && (
  <div 
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.94)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} 
    
  >
    <div 
      className="w-full max-w-[1650px] max-h-[90vh] overflow-auto mx-auto my-10 scroll-hidden"
      style={{ 
        position: 'relative',
        background: '#1E2937', 
        borderRadius: '24px', 
        // Небольшой доп. отступ сверху — заголовок теперь встроен в шапки
        // колонок, а не в отдельную строку (см. комментарий в OrderDetailModal.tsx).
        padding: '38px 32px 32px 32px', 
        boxShadow: '0 30px 80px rgba(0,0,0,0.7)'
      }} 
      onClick={e => e.stopPropagation()}
    >
      <style>{`
        @keyframes zayavkiScrollBounce {
          0%, 100% { transform: translateY(0); opacity: 0.7; }
          50%      { transform: translateY(3px); opacity: 1; }
        }
      `}</style>

      {/* Плавающая кнопка закрытия — единая для всей модалки, колонки больше не несут свой заголовок/крестик */}
      <button
        onClick={() => setSelectedOrder(null)}
        title="Закрыть"
        style={{
          position: 'absolute',
          top: '26px',
          right: '26px',
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(148, 163, 184, 0.1)',
          border: 'none',
          borderRadius: '9999px',
          color: '#94A3B8',
          cursor: 'pointer',
          zIndex: 1,
        }}
      >
        <X size={18} />
      </button>

      {/* ==================== ТЕЛО МОДАЛКИ: КАРТА СЛЕВА (НА ВСЮ ВЫСОТУ) + ОСТАЛЬНОЙ КОНТЕНТ ==================== */}
      <div style={{ display: 'flex', gap: '28px', alignItems: 'stretch' }}>

        <div style={{ width: '340px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <OrderRouteMap address={selectedOrder.address} routeHref={yandexRouteHref} />
          </div>
          {/* Запасные варианты — открывают карты приложений отдельной ссылкой,
              бесплатно (просто deep-link, без платного API маршрутов).
              Адрес/координаты те же нормализованные, что и у Яндекса
              (см. useMapRouteLinks) — город/область достраиваются одинаково
              для всех трёх сервисов. */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <a 
              href={twoGisRouteHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{ flex: 1, padding: '9px 8px', background: '#25334A', color: '#94A3B8', textAlign: 'center', borderRadius: '10px', textDecoration: 'none', fontWeight: '600', fontSize: '13px' }}
            >
              2ГИС
            </a>
            <a 
              href={googleRouteHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{ flex: 1, padding: '9px 8px', background: '#25334A', color: '#94A3B8', textAlign: 'center', borderRadius: '10px', textDecoration: 'none', fontWeight: '600', fontSize: '13px' }}
            >
              🗺️ Google
            </a>
          </div>
        </div>

      <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
        
        {/* Левая колонка — Информация (с возможностью редактирования, ПОЛНОСТЬЮ без обрезки/скролла).
            display:flex + height:100% — колонка растягивается по высоте сетки на уровень
            правой колонки (грид уже это делает по умолчанию), а Комментарий клиента
            (flex:1) дотягивается вниз до её нижнего края, на уровень с "Историей изменений". */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* ==================== ЗАГОЛОВОК ЗАЯВКИ + СТАТУС + "ПОД ВОПРОСОМ" (на месте бывшей "Информация о заказе") ==================== */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: '21px', color: '#F1F5F9', whiteSpace: 'nowrap' }}>
              Заявка #{selectedOrder.id}
            </h2>

            {/* Статус — компактный read-only бейдж, в одном стиле с кнопками действий
                (тонкая рамка + акцентный цвет, без сплошной "таблеточной" заливки) */}
            <div style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px', 
              borderRadius: '10px', 
              border: `1px solid ${getStatusColor(selectedOrder.status)}30`,
              fontWeight: '600',
              fontSize: '13px',
              whiteSpace: 'nowrap',
              color: getStatusColor(selectedOrder.status),
            }}>
              {selectedOrder.status === 'new' && '🟡 Новая'}
              {selectedOrder.status === 'processing' && '🔵 В работе'}
              {selectedOrder.status === 'completed' && '🟢 Выполнена'}
              {selectedOrder.status === 'cancelled' && '🔴 Отменена'}
            </div>

            {/* Чекбокс "Под вопросом" — тот же элегантный стиль, лёгкая подсветка фона когда отмечен */}
            {hasManagerPermissions(currentRole) && (
              <label
                htmlFor="isQuestionable"
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px', 
                  padding: '8px 14px', 
                  borderRadius: '10px',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  background: selectedOrder?.is_questionable ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                  fontSize: '13px',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input 
                  type="checkbox" 
                  id="isQuestionable"
                  checked={selectedOrder?.is_questionable || false}
                  onChange={async (e) => {
                    const newValue = e.target.checked;
                    
                    const res = await fetch('/api/adminCifra/orders/update', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        id: selectedOrder.id,
                        is_questionable: newValue,
                        userRole: currentRole || 'admin',
                        userName: userFullName || 'Сотрудник',
                      })
                    });

                    if (res.ok) {
                      setSelectedOrder((prev: any) => ({
                        ...prev,
                        is_questionable: newValue
                      }));

                      setAllOrders((prev: any[]) => prev.map((o: any) => 
                        o.id === selectedOrder.id 
                          ? { ...o, is_questionable: newValue } 
                          : o
                      ));
                    }
                  }}
                  style={{ width: '14px', height: '14px', accentColor: '#EF4444' }}
                />
                <span style={{ color: '#F87171', fontWeight: '600' }}>
                  Под вопросом
                </span>
              </label>
            )}
          </div>
          
          <div style={{ background: '#25334A', borderRadius: '16px', padding: '14px 18px', lineHeight: '1.3' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '7px', alignItems: 'center' }}>

              <div style={{ color: '#94A3B8' }}>Клиент</div>
              {/* ── Поиск клиента ── */}
              <div ref={clientDropdownRef} style={{ position: 'relative' }}>
                <input
                  value={clientQuery !== '' ? clientQuery : (selectedOrder.organization_name || selectedOrder.full_name || '')}
                  placeholder="Поиск по имени или организации…"
                  onChange={(e) => {
                    setClientQuery(e.target.value);
                    setShowClientDropdown(true);
                  }}
                  onFocus={() => {
                    setClientQuery('');
                    setShowClientDropdown(true);
                  }}
                  style={{ width: '100%', background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff', boxSizing: 'border-box' }}
                />
                {showClientDropdown && (() => {
                  const q = clientQuery.toLowerCase();
                  const filtered = allClients.filter((c: any) => {
                    const name = (c.organization_name || c.full_name || c.name || '').toLowerCase();
                    const phone = (c.phone || '').toLowerCase();
                    const inn = (c.inn || '').toLowerCase();
                    return !q || name.includes(q) || phone.includes(q) || inn.includes(q);
                  }).slice(0, 10);
                  if (!filtered.length) return null;
                  return (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                      background: '#1E2937', border: '1px solid #334155', borderRadius: '8px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: '220px', overflowY: 'auto',
                      marginTop: '4px',
                    }}>
                      {filtered.map((c: any, ci: number) => {
                        const displayName = c.organization_name || c.full_name || c.name || '—';
                        const isLegal = !!c.organization_name;
                        return (
                          <div
                            key={`${c.id ?? 'x'}-${ci}`}
                            onMouseDown={() => {
                              setSelectedOrder({
                                ...selectedOrder,
                                organization_name: c.organization_name || '',
                                full_name: c.full_name || '',
                                phone: c.phone || selectedOrder.phone,
                                inn: c.inn || selectedOrder.inn,
                                user_id: c.user_id ?? c.id,
                              });
                              setClientQuery('');
                              setShowClientDropdown(false);
                            }}
                            style={{
                              padding: '8px 12px', cursor: 'pointer',
                              borderBottom: '1px solid #334155',
                              display: 'flex', flexDirection: 'column', gap: '2px',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#25334A')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <span style={{ fontSize: '13px', fontWeight: 600, color: '#E2E8F0' }}>
                              {isLegal ? '🏢 ' : '👤 '}{displayName}
                            </span>
                            <span style={{ fontSize: '11px', color: '#64748B' }}>
                              {[c.phone, c.inn ? `ИНН ${c.inn}` : null].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {selectedOrder.inn !== undefined && (
                <>
                  <div style={{ color: '#94A3B8' }}>ИНН</div>
                  <input 
                    value={selectedOrder.inn || ''} 
                    onChange={(e) => setSelectedOrder({ ...selectedOrder, inn: e.target.value })}
                    style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff' }}
                  />
                </>
              )}

              <div style={{ color: '#94A3B8' }}>Телефон</div>
              <input 
                value={selectedOrder.phone || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, phone: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Марка бетона</div>
              <select
                value={selectedOrder.grade || ''}
                onChange={(e) => setSelectedOrder({ ...selectedOrder, grade: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: selectedOrder.grade ? '#fff' : '#64748B', width: '100%' }}
              >
                {!selectedOrder.grade && <option value="">— выберите марку —</option>}
                {recipes
                  .map((r: any) => r.code || r.name)
                  .filter((v: string, i: number, arr: string[]) => v && arr.indexOf(v) === i)
                  .sort()
                  .map((grade: string) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))
                }
              </select>

              <div style={{ color: '#94A3B8' }}>Объём</div>
              <input 
                type="number" 
                step="0.01"
                min="0.01"
                value={selectedOrder.volume || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, volume: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Дата доставки</div>
              <input 
                type="date" 
                value={selectedOrder.delivery_date ? selectedOrder.delivery_date.split('T')[0] : ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, delivery_date: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff' }}
              />

              <div style={{ color: '#94A3B8' }}>Время доставки</div>
              <input 
                type="time" 
                value={selectedOrder.delivery_time || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, delivery_time: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff' }}
              />

                                <div style={{ color: '#94A3B8' }}>Статус заявки</div>
                
                {getStatusConfig(selectedOrder.status).final ? (
                  // ==================== ФИНАЛЬНЫЕ СТАТУСЫ — ЗАЩИЩЕНЫ ====================
                  <div style={{ 
                    backgroundColor: getStatusConfig(selectedOrder.status).bg,
                    color: getStatusConfig(selectedOrder.status).color,
                    padding: '8px 16px',
                    borderRadius: '10px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontWeight: '600',
                    fontSize: '14px',
                    width: '88%'
                  }}>
                    {getStatusConfig(selectedOrder.status).label} — конечный статус
                  </div>
                ) : (
                  // Можно менять
                  <select 
                    value={selectedOrder.status || 'new'} 
                    onChange={(e) => setSelectedOrder({ ...selectedOrder, status: e.target.value })}
                    style={{ 
                      background: '#334155', 
                      border: 'none', 
                      borderRadius: '8px', 
                      padding: '6px 10px', 
                      color: '#fff',
                      fontSize: '14px',
                      width: '100%'
                    }}
                  >
                    <option value="new">🟡 Новая</option>
                    <option value="processing">🔵 В работе</option>
                    <option value="completed">🟢 Выполнена</option>
                    <option value="cancelled">🔴 Отменена</option>
                  </select>
                )}

              <div style={{ color: '#94A3B8' }}>Адрес доставки</div>
              <textarea 
                value={selectedOrder.address || ''} 
                onChange={(e) => setSelectedOrder({ ...selectedOrder, address: e.target.value })}
                style={{ background: '#334155', border: 'none', borderRadius: '8px', padding: '6px 10px', color: '#fff', minHeight: '48px', gridColumn: '2' }}
              />

            </div>
          </div>

          {/* Комментарий — редактируемое поле. flex:1 растягивает его вниз до нижнего
              края правой колонки (на уровень с "Историей изменений"); скроллбар
              textarea скрыт, вместо него — мерцающая стрелка, если текст не влезает. */}
          {selectedOrder.comment && (
            <div style={{ marginTop: '10px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <h4 style={{ color: '#94A3B8', marginBottom: '6px', flexShrink: 0 }}>Комментарий клиента</h4>
              <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                <textarea 
                  ref={commentRef}
                  onScroll={handleCommentScroll}
                  value={selectedOrder.comment} 
                  onChange={(e) => setSelectedOrder({ ...selectedOrder, comment: e.target.value })}
                  style={{ width: '100%', height: '100%', boxSizing: 'border-box', resize: 'none', background: '#25334A', border: 'none', borderRadius: '16px', padding: '12px 16px', color: '#fff', minHeight: '72px' }}
                />
                <ScrollMoreHint visible={commentHasMore} />
              </div>
            </div>
          )}
        </div>          
              
                            {/* Правая колонка — Логистика + История (может скроллиться внутри своих блоков) */}
              <div>
                {/* ==================== НАЗНАЧЕННЫЕ МИКСЕРЫ + ПРОСТОЙ ==================== */}
                {orderMixers.length > 0 && (() => {
                  const totalDowntime = orderMixers.reduce((sum, m) => sum + Number(m.downtimeMinutes || 0), 0);
                  const formatOnSiteDuration = (m: any): string | null => {
                    if (!m.onSiteAt) return null;
                    const end = m.unloadedAt ? new Date(m.unloadedAt) : new Date();
                    const minutes = Math.round((end.getTime() - new Date(m.onSiteAt).getTime()) / 60000);
                    return minutes >= 0 ? `${minutes} мин` : null;
                  };

                  return (
                    <div style={{ marginBottom: '20px' }}>
                      <h3 style={{ marginBottom: '10px', color: '#94A3B8' }}>
                        Назначенные миксеры ({orderMixers.length})
                      </h3>

                      <div style={{ background: '#25334A', borderRadius: '16px', padding: '14px' }}>
                        <div style={{
                          marginBottom: '12px',
                          paddingBottom: '12px',
                          borderBottom: '1px solid #334155',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px'
                        }}>
                          <span style={{ color: '#94A3B8', fontSize: '13.5px' }}>Общий простой по заявке:</span>
                          <span style={{ color: totalDowntime > 0 ? '#F97316' : '#10B981', fontWeight: '700', fontSize: '16px' }}>{totalDowntime} мин</span>
                        </div>

                        {/* Список миксеров — своя внутренняя прокрутка. Скроллбар скрыт,
                            вместо него — мерцающая стрелка вниз, пока список не докручен. */}
                        <div style={{ position: 'relative' }}>
                        <div
                          ref={mixerListRef}
                          onScroll={handleMixerListScroll}
                          style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}
                        >
                          {orderMixers.map((mixer: any) => {
                            const duration = formatOnSiteDuration(mixer);
                            return (
                              <div
                                key={mixer.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  background: '#1E2937',
                                  borderRadius: '8px',
                                  padding: '7px 12px',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                }}
                              >
                                <span style={{ fontWeight: '700', fontSize: '13.5px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {mixer.mixerName || mixer.number}
                                </span>
                                <span style={{ color: '#64748B', fontSize: '13px' }}>· {mixer.time}</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                                  <span style={{ color: '#64748B', fontSize: '13px' }}>·</span>
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
                                      borderRadius: '6px',
                                      padding: '2px 3px',
                                      fontSize: '12.5px',
                                      width: '40px'
                                    }}
                                  />
                                  <span style={{ color: '#94A3B8', fontSize: '13px' }}>м³</span>
                                </span>

                                <span style={{ marginLeft: 'auto', fontSize: '13px', color: '#10B981', fontWeight: 600 }}>
                                  {mixer.status || 'Загрузка'}
                                </span>
                                <span style={{
                                  fontSize: '12px',
                                  color: Number(mixer.downtimeMinutes) > 0 ? '#F97316' : '#94A3B8'
                                }}>
                                  ⏱ {duration || '0 мин'}
                                  {mixer.status === 'Разгружен' && ` (простой ${Number(mixer.downtimeMinutes || 0)} мин)`}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <ScrollMoreHint visible={mixerListHasMore} />
                        </div>
                      </div>
                    </div>
                  );
                })()}

                                               {/* ==================== ИСТОРИЯ ИЗМЕНЕНИЙ ==================== */}
<div>
  <h3 style={{ marginBottom: '12px', color: '#94A3B8' }}>История изменений</h3>
  <div style={{ position: 'relative' }}>
  <div
    ref={historyRef}
    onScroll={handleHistoryScroll}
    style={{ 
    background: '#25334A', 
    borderRadius: '16px', 
    padding: '16px', 
    maxHeight: '260px', 
    overflowY: 'auto',
    fontSize: '14px',
    lineHeight: '1.6'
  }}>
    <OrderHistoryTimeline entries={orderHistory} />
  </div>
  <ScrollMoreHint visible={historyHasMore} />
  </div>
</div>
              </div>
            </div>
            {/* /grid 1fr 1fr */}
      </div>
      {/* /flex: 1, остальной контент */}

      </div>
      {/* /ТЕЛО МОДАЛКИ: карта + остальной контент */}

        {/* ==================== КНОПКИ ДЕЙСТВИЙ — компактные, элегантные, без "таблеточного" фона ==================== */}
    <div style={{ marginTop: '32px', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>

      { hasManagerPermissions(currentRole) && (
        <>
          {/* Сохранить изменения */}
          <ModalActionButton
            color="#10B981"
            icon={<Save size={15} />}
            label="Сохранить"
            onClick={async () => {
              console.log('🟡 Сохраняем. userFullName =', userFullName);   // ← Добавили

              const updatedOrder = { ...selectedOrder };

              try {
                const payload = {
                  id: selectedOrder.id,
                  ...selectedOrder,
                  userRole: currentRole || 'admin',
                  userName: userFullName || 'Сотрудник'
                };

                console.log('📤 Отправляем в API payload.userName =', payload.userName);   // ← Добавили

                const res = await fetch('/api/adminCifra/orders/update', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                });

                if (res.ok) {
                  alert('✅ Изменения успешно сохранены!');
                  setAllOrders(prev => prev.map(order => String(order.id) === String(selectedOrder.id) ? updatedOrder : order));
                  if (typeof loadOrderHistory === 'function') loadOrderHistory(selectedOrder.id);
                } else {
                  const errorData = await res.json().catch(() => ({}));
                  alert(errorData.message || 'Ошибка сохранения');
                }
              } catch (err) {
                console.error('Ошибка сохранения:', err);
                alert('Ошибка соединения с сервером');
              }
            }}
          />

          {/* Удалить заявку */}
          <ModalActionButton
            color="#EF4444"
            icon={<Trash2 size={15} />}
            label="Удалить"
            onClick={() => handleDeleteOrder(selectedOrder.id)}
          />

          {/* Отправить в Max */}
          <ModalActionButton
            color="#3B82F6"
            icon={<Send size={15} />}
            label="В Max"
            disabled={isSendingNotification}
            onClick={() => sendNotification(selectedOrder.id)}
          />

          {/* Поделиться */}
          <ModalActionButton
            color="#8B5CF6"
            icon={<Share2 size={15} />}
            label="Поделиться"
            onClick={() => shareOrder(selectedOrder)}
          />

          {/* Копировать заявку */}
          <ModalActionButton
            color="#6366F1"
            icon={<Copy size={15} />}
            label="Копировать заявку"
            onClick={() => copyOrder(selectedOrder)}
          />
        </>
      )}

      {/* Отмена */}
      <ModalActionButton
        color="#94A3B8"
        icon={<X size={15} />}
        label="Отмена"
        onClick={() => setSelectedOrder(null)}
      />

    </div>
    </div>
  </div>
)}




           {showNewOrderModal && (
  <NewOrderModal 
  isOpen={showNewOrderModal}
    onClose={() => {
      setShowNewOrderModal(false);
      setNewOrderInitialData(null);
    }} 
    onSuccess={(newOrder) => {
      if (newOrder) {
        // Защита от задвоения: realtime-подписка useRealtimeOrders (см. ниже)
        // может вставить эту же заявку раньше, чем вернётся ответ на создание.
        setAllOrders(prev => {
          if (prev.some(o => String(o.id) === String(newOrder.id))) return prev;
          return [newOrder, ...prev];
        });
      }
    }} 
    initialData={newOrderInitialData}
    defaultDeliveryDate={selectedDateStr}
    currentRole={currentRole}
    currentUserName={userFullName || 'Сотрудник'}   // ← Реальное имя
  />
)}

      {/* ==================== ПОПАП: ПРОГНОЗ ДОБАВОК ==================== */}
      {showAdditivePopup && weekAdditiveForecast && (
        <div
          onClick={() => setShowAdditivePopup(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="scroll-hidden"
            style={{
              background: '#1E2937', borderRadius: '20px', padding: '28px',
              width: '100%', maxWidth: '560px', maxHeight: '80vh',
              overflowY: 'auto', boxSizing: 'border-box',
              border: weekAdditiveForecast.hasAlert ? '1.5px solid rgba(239,68,68,0.4)' : '1.5px solid rgba(16,185,129,0.3)',
            }}
          >
            {/* Заголовок */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  {weekAdditiveForecast.hasAlert
                    ? <AlertTriangle size={18} color="#EF4444" />
                    : <CheckCircle2 size={18} color="#10B981" />}
                  <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
                    Прогноз добавок — 7 дней
                  </h2>
                </div>
                <div style={{ color: '#64748B', fontSize: '13px' }}>
                  {(() => {
                    const fmt = (ds: string) => {
                      const [y, m, d] = ds.split('-');
                      return `${d}.${m}.${y}`;
                    };
                    return `${fmt(weekAdditiveForecast.dateFrom)} — ${fmt(weekAdditiveForecast.dateTo)}`;
                  })()}
                  {' · '}
                  {weekAdditiveForecast.totalOrders} заявок, {weekAdditiveForecast.totalVolume} м³
                </div>
              </div>
              <button
                onClick={() => setShowAdditivePopup(false)}
                style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', padding: '4px', fontSize: '20px', lineHeight: 1 }}
              >✕</button>
            </div>

            {/* Блоки по каждой добавке */}
            {([
              { key: 'pfm' as const, id: 1 as const, name: ADDITIVE_NAMES[1] },
              { key: 'linomix' as const, id: 2 as const, name: ADDITIVE_NAMES[2] },
            ] as const).map(({ key, id, name }) => {
              const item = weekAdditiveForecast[key];
              if (item.needed === 0) return null;
              const pct = item.stock !== null && item.needed > 0
                ? Math.min(100, Math.round((item.stock / item.needed) * 100))
                : null;
              const orders = weekAdditiveForecast.details.filter(d => d.additiveId === id);
              return (
                <div key={key} style={{
                  background: '#25334A', borderRadius: '14px', padding: '16px', marginBottom: '14px',
                  border: item.shortage ? '1px solid rgba(239,68,68,0.3)' : '1px solid #334155',
                }}>
                  {/* Шапка добавки */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontWeight: 700, fontSize: '15px' }}>{name}</span>
                    {item.shortage && item.stock !== null && (
                      <span style={{ background: '#EF444425', color: '#F87171', fontSize: '12px', fontWeight: 700, borderRadius: '8px', padding: '3px 10px' }}>
                        Нехватка {item.needed - Math.round(item.stock)} л
                      </span>
                    )}
                    {!item.shortage && (
                      <span style={{ background: '#10B98120', color: '#34D399', fontSize: '12px', fontWeight: 700, borderRadius: '8px', padding: '3px 10px' }}>
                        Достаточно
                      </span>
                    )}
                  </div>
                  {/* Цифры */}
                  <div style={{ display: 'flex', gap: '24px', marginBottom: '10px' }}>
                    <div>
                      <div style={{ color: '#64748B', fontSize: '12px', marginBottom: '2px' }}>На складе</div>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: item.shortage ? '#EF4444' : '#10B981' }}>
                        {item.stock !== null ? `${Math.round(item.stock)} л` : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#64748B', fontSize: '12px', marginBottom: '2px' }}>Нужно</div>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: '#CBD5E1' }}>{item.needed} л</div>
                    </div>
                    {item.stock !== null && (
                      <div>
                        <div style={{ color: '#64748B', fontSize: '12px', marginBottom: '2px' }}>Обеспечение</div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: item.shortage ? '#FACC15' : '#10B981' }}>{pct}%</div>
                      </div>
                    )}
                  </div>
                  {/* Прогресс */}
                  {pct !== null && (
                    <div style={{ height: '6px', background: '#334155', borderRadius: '9999px', overflow: 'hidden', marginBottom: '14px' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: item.shortage ? 'linear-gradient(90deg,#EF4444,#F97316)' : '#10B981', borderRadius: '9999px', transition: 'width 0.4s ease' }} />
                    </div>
                  )}
                  {/* Таблица заявок */}
                  {orders.length > 0 && (
                    <>
                      <div style={{ color: '#475569', fontSize: '12px', fontWeight: 600, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Заявки ({orders.length})
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 60px 60px 60px', gap: '4px 8px', color: '#64748B', fontSize: '11px', marginBottom: '4px' }}>
                        <div>№</div><div>Марка</div><div style={{ textAlign: 'right' }}>Объём</div><div style={{ textAlign: 'right' }}>кг</div><div style={{ textAlign: 'right' }}>л</div>
                      </div>
                      {orders.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)).map((o, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '48px 1fr 60px 60px 60px', gap: '4px 8px', padding: '5px 0', borderTop: '1px solid #334155', fontSize: '13px', alignItems: 'center' }}>
                          <div style={{ color: '#60A5FA', fontWeight: 600 }}>#{o.id}</div>
                          <div style={{ color: '#CBD5E1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {o.grade} <span style={{ color: '#475569', fontSize: '11px' }}>{o.deliveryDate.slice(5).replace('-', '.')}</span>
                          </div>
                          <div style={{ textAlign: 'right', color: '#CBD5E1' }}>{o.volume} м³</div>
                          <div style={{ textAlign: 'right', color: '#94A3B8' }}>{o.kg} кг</div>
                          <div style={{ textAlign: 'right', color: '#94A3B8' }}>{o.liters} л</div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}

            {/* Кнопка закрытия */}
            <button
              onClick={() => setShowAdditivePopup(false)}
              style={{ width: '100%', padding: '12px', background: '#334155', borderRadius: '12px', color: '#94A3B8', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '14px', marginTop: '4px' }}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

    </div>
    </div>
  );
}