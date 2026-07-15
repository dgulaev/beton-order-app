'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, FlaskConical, Truck, Package, Users, UserCog, DollarSign, Menu, X, Bell, CheckCircle, LogOut, Globe } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { useUserRole } from '../providers/UserRoleProvider';
import { useOrderChangeNotifications } from '@/hooks/useRealtimeOrders';
import { formatPhoneInput } from '@/lib/phone';

// ==================== PERSISTENTНЫЕ УВЕДОМЛЕНИЯ (localStorage) ====================
const NOTIF_STORAGE_KEY = 'persistentOrderNotifications';
const NOTIF_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 часа

interface PersistedNotif {
  id: string;
  emoji: string;
  title: string;
  message: string;
  timestamp: number;
}

function loadPersistedNotifs(): PersistedNotif[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(NOTIF_STORAGE_KEY);
    if (!raw) return [];
    const all: PersistedNotif[] = JSON.parse(raw);
    return all.filter(n => Date.now() - n.timestamp < NOTIF_MAX_AGE_MS);
  } catch { return []; }
}

function savePersistedNotif(notif: PersistedNotif) {
  try {
    const existing = loadPersistedNotifs();
    if (existing.some(n => n.id === notif.id)) return;
    const updated = [notif, ...existing].slice(0, 30);
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

function deletePersistedNotif(id: string) {
  try {
    const existing = loadPersistedNotifs();
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(existing.filter(n => n.id !== id)));
  } catch {}
}

export default function AdminCifraLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (path: string) => pathname === path;

  // ==================== 1. РОЛЬ ИЗ PROVIDER ====================
  const { user, loading: roleLoading, refreshRole, logout } = useUserRole();

  const [isCollapsed, setIsCollapsed] = useState(true);

  // Реальная высота окна в пикселях (100%/100vh ненадёжны в цепочке flex-родителей —
  // считаем сами и передаём вниз конкретное число, а не проценты)
  const [viewportH, setViewportH] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerHeight : 1080
  );

  useEffect(() => {
    const updateViewportHeight = () => setViewportH(window.innerHeight);
    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight);
    return () => window.removeEventListener('resize', updateViewportHeight);
  }, []);

  // Админка — это фиксированный "каркас" приложения (свой скролл внутри),
  // а не обычная скроллящаяся страница. Если из-за округления пикселей/масштаба
  // на 1-2px "вылезет" за пределы экрана — скрываем это на уровне html/body,
  // а не даём странице целиком скроллиться.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    // overscroll-behavior отключает "резиновый" bounce-эффект трекпада на macOS —
    // без него страница визуально "тянется" вверх/вниз при прокрутке колесом/трекпадом,
    // даже когда html/body overflow:hidden и скроллить формально нечего.
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';

    // Ищем ближайший реально скроллящийся контейнер над курсором — по
    // computed-стилю overflowY, а не по классу .scroll-hidden. Так находятся
    // и вложенные зоны без этого класса (например «История изменений» внутри
    // модалки заказа), у которых своя внутренняя прокрутка внутри внешней.
    const findScrollableAncestor = (el: HTMLElement | null): HTMLElement | null => {
      let node: HTMLElement | null = el;
      while (node && node !== document.body) {
        const overflowY = window.getComputedStyle(node).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    };

    // На macOS (мышь Magic Mouse/трекпад) даже с overflow:hidden и
    // overscroll-behavior:none браузер иногда всё равно даёт "резиновое"
    // визуальное оттягивание страницы вверх/вниз колесом. Жёстко блокируем
    // само событие wheel на уровне окна — но только когда курсор НЕ над
    // внутренней скролл-зоной, у которой ещё есть куда скроллить в эту
    // сторону, чтобы не поломать скролл списков/модалок (в т.ч. вложенных).
    const blockPageBounce = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      const scrollable = findScrollableAncestor(target);
      if (scrollable) {
        const atTop = scrollable.scrollTop <= 0;
        const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1;
        const canScroll = (e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom);
        if (canScroll) return;
      }
      e.preventDefault();
    };
    window.addEventListener('wheel', blockPageBounce, { passive: false });

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      html.style.overscrollBehavior = prevHtmlOverscroll;
      body.style.overscrollBehavior = prevBodyOverscroll;
      window.removeEventListener('wheel', blockPageBounce);
    };
  }, []);

  // ==================== 1.1 СОСТОЯНИЯ АВТОРИЗАЦИИ ====================
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const isLoggedIn = !!user && !roleLoading;
  const userRole = user?.role || null;
  const isGuest = userRole === 'guest';

  // ==================== 1.2 АВТОМАТИЧЕСКИЙ РЕДИРЕКТ НА МОБИЛЬНУЮ ВЕРСИЮ ====================
  useEffect(() => {
    const redirectToMobile = () => {
      const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Samsung/i.test(navigator.userAgent) ||
                       window.innerWidth <= 768;

      const currentPath = window.location.pathname;

      if (isMobile && currentPath.startsWith('/adminCifra') && !window.location.search.includes('desktop=true')) {
        let newPath = currentPath.replace('/adminCifra', '/mobile');

        if (newPath === '/mobile/dashboard' || newPath.includes('dashboard')) {
          newPath = '/mobile/';
        }

        newPath = newPath.replace('/mobile/mobile', '/mobile').replace('//', '/');

        console.log('📱 Auto redirect to mobile:', newPath);
        window.location.replace(newPath);
      }
    };

    redirectToMobile();
    const timer = setTimeout(redirectToMobile, 700);

    return () => clearTimeout(timer);
  }, []);

  // ==================== 2. СОСТОЯНИЯ УВЕДОМЛЕНИЙ ====================
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [lastNotificationId, setLastNotificationId] = useState<number | null>(null);

  // Ref для функции создания тоста — позволяет вызывать её из mount-эффекта
  // без проблем с замыканиями (всегда последняя версия функции)
  const createToastRef = useRef<((id: string, emoji: string, title: string, message: string) => void) | null>(null);

  // ==================== 2.1 СОСТОЯНИЕ УВЕДОМЛЕНИЙ ПО КЛИЕНТАМ ====================
  const [clientReminders, setClientReminders] = useState<any[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ==================== 2.2 ИНИЦИАЛИЗАЦИЯ ЗВУКА ====================
  useEffect(() => {
    audioRef.current = new Audio('/sounds/new-order.mp3');
    if (audioRef.current) {
      audioRef.current.volume = 0.9;
    }
  }, []);

  const playNotificationSound = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch((err) => {
      console.warn('🔇 [Notify] Звук не воспроизведён:', err?.name, '—', err?.message);
    });
  };

  // ==================== 3.1 ОЧИСТКА СТАРЫХ ЗАКРЫТЫХ УВЕДОМЛЕНИЙ ====================
  useEffect(() => {
    const closed = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
    if (closed.length > 50) {
      localStorage.setItem('closedNotifications', JSON.stringify(closed.slice(-30)));
    }
  }, []);

    // ==================== 4. ВХОД ====================
  const handleLogin = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');

    try {
      const res = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });

      const data = await res.json();

      if (data.success && data.userId) {
        localStorage.setItem('userId', data.userId.toString());
        refreshRole(); // подхватываем роль сразу, без перезагрузки страницы
      } else {
        setLoginError(data.message || 'Неверный телефон или пароль');
      }
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('Ошибка соединения с сервером');
    } finally {
      setLoginLoading(false);
    }
  };

  // ==================== 4.1 УВЕДОМЛЕНИЕ ПО КЛИЕНТУ ====================
 // const showClientReminder = (client: any) => {
   // const closed = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
   // const key = `client-reminder-${client.groupId || client.user_id}`;

   // if (closed.includes(key)) return;

   // const notif = document.createElement('div');
  //  notif.style.cssText = `
  //    position: fixed;
   //   top: 90px;
   //   right: 24px;
   //   background: linear-gradient(135deg, #f59e0b, #fbbf24);
  //    color: #0f172a;
   //   padding: 18px 24px;
   //  borderRadius: 16px;
   //  z-index: 10000;
    //  box-shadow: 0 20px 40px rgba(245, 158, 11, 0.4);
    //  display: flex;
    //  align-items: center;
    //  gap: 16px;
    //  min-width: 420px;
   //  cursor: pointer;
   // `;

   // notif.innerHTML = `
    //  <div style="font-size: 36px;">📞</div>
    //  <div style="flex: 1;">
     //   <div style="font-size: 17px; font-weight: 700;">Пора позвонить клиенту!</div>
     //   <div style="font-size: 15px; margin-top: 4px;">
     //     ${client.organization_name || client.full_name || 'Клиент'}
    //    </div>
    //    <div style="font-size: 14px; opacity: 0.9;">
    //      Следующий контакт: ${new Date(client.next_contact).toLocaleDateString('ru-RU')}
     //   </div>
     // </div>
     // <div style="font-size: 28px; cursor: pointer; padding: 4px 10px;" class="close-reminder">✕</div>
    //`;
//
   // const closeBtn = notif.querySelector('.close-reminder') as HTMLElement;
   // const closeNotification = () => {
     // notif.remove();
    //  const closedList = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
    //  closedList.push(key);
    //  localStorage.setItem('closedNotifications', JSON.stringify(closedList));
   // };
//
   // if (closeBtn) {
   //  closeBtn.addEventListener('click', (e) => {
    //    e.stopPropagation();
    //    closeNotification();
    //  });
  //  }

   // notif.addEventListener('click', () => {
   //   window.location.href = '/adminCifra/clients';
   //   closeNotification();
   // });
//
   // document.body.appendChild(notif);
  //  playNotificationSound();
 // };

  // ==================== 4.1.1 КОНТЕЙНЕР ДЛЯ СТЕКА БАННЕРОВ (новые не перекрывают старые) ====================
  const getNotificationContainer = (): HTMLElement => {
    let container = document.getElementById('order-notifications-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'order-notifications-container';
      container.style.cssText = `
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 12px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
    }
    return container;
  };

  // ==================== 4.2 СОЗДАНИЕ DOM-ТОСТА (не зависит от sound/storage) ====================
  // Обновляем ref на каждом рендере — mount-эффект восстановления всегда вызовет актуальную версию
  createToastRef.current = (id: string, emoji: string, title: string, message: string) => {
    const notif = document.createElement('div');
    notif.dataset.notifId = id;
    notif.style.cssText = `
      position: relative;
      background: linear-gradient(135deg, #22c55e, #86efac);
      color: #0f172a;
      padding: 16px 22px;
      border-radius: 16px;
      font-weight: 600;
      box-shadow: 0 20px 40px rgba(34, 197, 94, 0.45);
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 390px;
      cursor: pointer;
      pointer-events: auto;
    `;

    notif.innerHTML = `
      <div style="font-size: 34px;">${emoji}</div>
      <div style="flex: 1;">
        <div style="font-size: 16px; font-weight: 700;">${title}</div>
        <div style="font-size: 14px; opacity: 0.92;">${message}</div>
      </div>
      <div style="font-size: 24px; opacity: 0.75; cursor: pointer; padding: 4px 8px;" class="close-btn">✕</div>
    `;

    const closeBtn = notif.querySelector('.close-btn') as HTMLElement;

    const closeNotification = () => {
      notif.remove();
      deletePersistedNotif(id);
      setNewOrdersCount(prev => Math.max(0, prev - 1));
    };

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeNotification();
      });
    }

    notif.addEventListener('click', (e) => {
      if (e.target !== closeBtn) {
        window.location.href = '/adminCifra/zayavki';
        closeNotification();
      }
    });

    getNotificationContainer().prepend(notif);
  };

  // ==================== 4.3A ВОССТАНОВЛЕНИЕ УВЕДОМЛЕНИЙ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ ====================
  useEffect(() => {
    const saved = loadPersistedNotifs();
    if (saved.length === 0) return;
    // Небольшая задержка чтобы контейнер успел смонтироваться в DOM
    const timer = setTimeout(() => {
      saved.forEach(n => {
        createToastRef.current?.(n.id, n.emoji, n.title, n.message);
      });
      // Обновляем счётчик
      setNewOrdersCount(prev => prev + saved.length);
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==================== 4.2.1 ВЫСОКОУРОВНЕВАЯ ФУНКЦИЯ — ПРИШЛО НОВОЕ СОБЫТИЕ ====================
  const showVisualNotification = (type: 'new' | 'status' | 'volume' | 'datetime', orderData?: any, oldData?: any) => {
    const orderId = orderData?.id || '—';

    let title = '';
    let message = '';
    let emoji = '';

    const formatDate = (dateStr: string) => {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    };

    if (type === 'new') {
      emoji = '🆕';
      title = 'Новая заявка!';
      const deliveryStr = formatDate(orderData?.delivery_date);
      message = `№${orderId} — ${orderData?.grade || ''} — ${orderData?.volume || ''} м³`;
      if (deliveryStr) message += ` — на ${deliveryStr}`;
    } 
    else if (type === 'status') {
      emoji = '🔄';
      title = 'Статус изменён';
      const statusMap: Record<string, string> = {
        'new': 'Новая', 'NEW': 'Новая',
        'processing': 'В работе',
        'completed': 'Выполнена',
        'cancelled': 'Отменена'
      };
      const rawStatus = (orderData?.status || '').toString().toLowerCase();
      const statusText = statusMap[rawStatus] || orderData?.status || '—';
      message = `Заявка №${orderId} → ${statusText}`;
    } 
    else if (type === 'volume') {
      emoji = '📦';
      title = 'Изменён объём';
      message = `Заявка №${orderId} — было ${oldData?.volume || '?'} → стало ${orderData?.volume} м³`;
    } 
    else if (type === 'datetime') {
      emoji = '🕒';
      title = 'Изменены дата и время';
      const deliveryStr = formatDate(orderData?.delivery_date);
      message = `Заявка №${orderId} — ${deliveryStr}`;
      if (orderData?.delivery_time) {
        message += ` ${orderData.delivery_time}`;
      }
    }

    // Сохраняем в localStorage — переживёт перезагрузку страницы
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    savePersistedNotif({ id, emoji, title, message, timestamp: Date.now() });

    playNotificationSound();
    createToastRef.current?.(id, emoji, title, message);
  };

  // ==================== 4.3 HEARTBEAT — ОБНОВЛЕНИЕ АКТИВНОСТИ (каждые 5 минут) ====================
  useEffect(() => {
    const savedUserId = localStorage.getItem('userId');
    if (!savedUserId || userRole === 'guest') return;

    const sendHeartbeat = async () => {
      try {
        const res = await fetch('/api/adminCifra/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: parseInt(savedUserId) })
        });
      } catch (e) {
        console.warn('Heartbeat failed:', e);
      }
    };

    sendHeartbeat();

    const interval = setInterval(sendHeartbeat, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, [userRole]);

  // ==================== 4.4 ПРИСВОЕНИЕ ФУНКЦИЙ В WINDOW ====================
  useEffect(() => {
    (window as any).showVisualNotification = showVisualNotification;
    (window as any).playNotificationSound = playNotificationSound;
  }, []);

  // ==================== БЛОК 5. REALTIME-УВЕДОМЛЕНИЯ О ЗАЯВКАХ ====================
  const staffRoles = ['admin', 'manager', 'dispatcher', 'operator'];
  const { status: realtimeStatus } = useOrderChangeNotifications({
    enabled: !!userRole && staffRoles.includes(userRole),
    onNewOrder: (order) => {
      setNewOrdersCount((prev) => prev + 1);
      playNotificationSound();
      showVisualNotification('new', order);
    },
    onStatusChange: (order) => {
      playNotificationSound();
      showVisualNotification('status', order);
    },
    onVolumeChange: (order, oldOrder) => {
      playNotificationSound();
      showVisualNotification('volume', order, oldOrder);
    },
    onDateTimeChange: (order) => {
      playNotificationSound();
      showVisualNotification('datetime', order);
    },
  });

  // ==================== 6. СБРОС СЧЁТЧИКА ====================
  useEffect(() => {
    if (pathname === '/adminCifra/zayavki') {
      setNewOrdersCount(0);
    }
  }, [pathname]);

  // ==================== 6.1 ЗАГРУЗКА ====================
  if (roleLoading) {
    return (
      <div style={{ 
        padding: '100px', 
        textAlign: 'center', 
        background: '#0F172A', 
        color: '#94A3B8', 
        minHeight: '100vh' 
      }}>
        Загрузка...
      </div>
    );
  }

  // ==================== 6.2 ФОРМА ВХОДА ====================
  if (!isLoggedIn) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#0F172A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        padding: '20px'
      }}>
        <div style={{
          background: '#1E2937',
          padding: '40px 30px',
          borderRadius: '20px',
          width: '100%',
          maxWidth: '420px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
        }}>
          <h1 style={{ textAlign: 'center', marginBottom: '8px' }}>ТрейдКом • Вход</h1>
          <p style={{ textAlign: 'center', color: '#94A3B8', marginBottom: '30px' }}>
            Войдите в систему
          </p>

          <form onSubmit={handleLogin}>
            <input
              type="tel"
              placeholder="+7 (___) ___-__-__"
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              style={{
                width: '90%',
                padding: '16px',
                marginBottom: '16px',
                borderRadius: '12px',
                border: '1px solid #334155',
                background: '#0F172A',
                color: '#fff',
                fontSize: '17px'
              }}
              required
            />
            <input
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '90%',
                padding: '16px',
                marginBottom: '24px',
                borderRadius: '12px',
                border: '1px solid #334155',
                background: '#0F172A',
                color: '#fff',
                fontSize: '17px'
              }}
              required
            />

            {loginError && (
              <p style={{ color: '#ef4444', textAlign: 'center', marginBottom: '16px' }}>{loginError}</p>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              style={{
                width: '98%',
                padding: '16px',
                background: loginLoading ? '#475569' : '#22c55e',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                fontSize: '17px',
                fontWeight: '600',
                cursor: loginLoading ? 'not-allowed' : 'pointer'
              }}
            >
              {loginLoading ? 'Вход...' : 'Войти'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ==================== 7. КНОПКА "ВЫКИНУТЬ ВСЕХ" ====================
  const forceLogoutAll = async () => {
    if (!confirm('Вы уверены, что хотите выкинуть ВСЕХ сотрудников?\n\nОни будут вынуждены заново ввести пароль.')) {
      return;
    }

    try {
      const res = await fetch('/api/adminCifra/force-logout-all', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 1777619517739 })
      });

      const data = await res.json();

      if (data.success) {
        alert('✅ Все сотрудники успешно выкинуты из системы!');
      } else {
        alert('Ошибка: ' + (data.message || 'Неизвестная ошибка'));
      }
    } catch (err) {
      alert('Ошибка соединения с сервером');
    }
  };

  // ==================== 7.1 ПРОВЕРКА РОЛЕЙ ====================
  if (!isLoggedIn || !userRole) {
    return <div style={{ padding: '100px', textAlign: 'center', background: '#0F172A', color: '#94A3B8', minHeight: '100vh' }}>Доступ запрещён</div>;
  }

  // ==================== 8. ГЛОБАЛЬНЫЙ МАСШТАБ ====================
  const getGlobalScale = () => {
    const width = window.innerWidth;
    if (width >= 1920) return 1.00;
    if (width >= 1680) return 0.88;
    if (width >= 1440) return 0.84;
    return 0.80;
  };

  const scale = getGlobalScale();
  // Страницы-"каркасы": без скролла страницы целиком, со своим внутренним
  // скроллом по зонам (как дашборд) — сейчас это дашборд, заявки, оператор БСУ и миксеры.
  const isFrameLayout = pathname === '/adminCifra/dashboard' || pathname === '/adminCifra/zayavki' || pathname === '/adminCifra/operator' || pathname === '/adminCifra/mixers' || pathname === '/adminCifra/tasks';
  const isDashboard = isFrameLayout;
  // Высота ДО применения transform: scale — после масштабирования визуально
  // она станет равна ровно viewportH (реальной высоте окна браузера).
  const preScaleHeight = viewportH / scale;

  return (
    <div 
      style={{
        // position: fixed выводит каркас из нормального потока документа —
        // если из-за округления пикселей/DPI/шрифтов реальная высота контента
        // на 1-2px отличается от расчётной, это больше не может "просочиться"
        // в скролл страницы через родителей (html/body overflow:hidden тогда
        // не нужен как единственная защита, а служит подстраховкой).
        position: 'fixed',
        top: 0,
        left: 0,
        transform: `scale(${scale})`, 
        transformOrigin: 'top left',
        width: `${100 / scale}%`,
        height: `${preScaleHeight}px`,
        overflow: 'hidden',
        overscrollBehavior: 'none',
      }}
      className="admin-layout"
    >
      <div style={{ 
        display: 'flex', 
        alignItems: 'stretch',
        height: '100%',
        overflow: 'hidden',
        overscrollBehavior: 'none',
        backgroundColor: '#0F172A',
        color: '#fff'
      }}>

        
        
        {/* ==================== 9. СВОРАЧИВАЕМОЕ МЕНЮ ==================== */}
        <div 
          className="sidebar-menu"
          style={{
            width: isCollapsed ? '68px' : '280px',
            backgroundColor: '#1E2937',
            color: '#fff',
            padding: '24px 0',
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid #334155',
            // cubic-bezier даёт более «упругий» эффект раскрытия по сравнению с linear ease
            transition: 'width 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
            flexShrink: 0,
            height: '100%',
            overflow: 'hidden',
            overscrollBehavior: 'none',
          }}>

          {/* Кнопка сворачивания — центрирована в collapsed, прижата вправо в expanded */}
          <div style={{ 
            display: 'flex', 
            justifyContent: isCollapsed ? 'center' : 'flex-end', 
            marginBottom: '16px',
            paddingRight: isCollapsed ? 0 : '16px',
            paddingLeft: isCollapsed ? 0 : '16px',
            transition: 'padding 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
          }}>
            <button 
              onClick={() => setIsCollapsed(!isCollapsed)}
              style={{
                background: 'none',
                border: 'none',
                color: '#94A3B8',
                cursor: 'pointer',
                padding: '8px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={e => (e.currentTarget.style.color = '#94A3B8')}
            >
              {isCollapsed ? <Menu size={22} /> : <X size={20} />}
            </button>
          </div>

          {/* ==================== 9.1 ЛОГОТИП — только в развёрнутом виде ==================== */}
          {!isCollapsed && (
            <div style={{ 
              padding: '0 20px', 
              marginBottom: '28px', 
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}>
              <Image 
                src="/logo-tradecom-white.png"
                alt="TRADECOM" 
                width={220}
                height={106}
                style={{ objectFit: 'contain', borderRadius: '8px' }} 
                priority
              />
              <p style={{ 
                fontSize: '12px', 
                color: '#64748B', 
                marginTop: '6px',
                letterSpacing: '0.5px',
                whiteSpace: 'nowrap',
              }}>
                ТрейдКом • ДИСПЕТЧЕРИЗАЦИЯ
              </p>
            </div>
          )}

          {/* ==================== ИНДИКАТОР REALTIME ==================== */}
          {staffRoles.includes(userRole || '') && (
            <div
              title={
                realtimeStatus === 'SUBSCRIBED' ? 'Уведомления подключены' :
                realtimeStatus === 'CONNECTING' ? 'Подключение...' :
                'Уведомления отключены — обновите страницу'
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: isCollapsed ? '4px 0' : '4px 12px',
                marginBottom: '8px',
                justifyContent: isCollapsed ? 'center' : 'flex-start',
                cursor: realtimeStatus !== 'SUBSCRIBED' ? 'pointer' : 'default',
              }}
              onClick={() => realtimeStatus !== 'SUBSCRIBED' && window.location.reload()}
            >
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                flexShrink: 0,
                background:
                  realtimeStatus === 'SUBSCRIBED' ? '#4ADE80' :
                  realtimeStatus === 'CONNECTING' ? '#FACC15' : '#F87171',
                boxShadow:
                  realtimeStatus === 'SUBSCRIBED' ? '0 0 6px rgba(74,222,128,0.8)' :
                  realtimeStatus === 'CONNECTING' ? '0 0 6px rgba(250,204,21,0.8)' : '0 0 6px rgba(248,113,113,0.8)',
              }} />
              {!isCollapsed && (
                <span style={{
                  fontSize: '11px',
                  color:
                    realtimeStatus === 'SUBSCRIBED' ? '#4ADE80' :
                    realtimeStatus === 'CONNECTING' ? '#FACC15' : '#F87171',
                  whiteSpace: 'nowrap',
                  letterSpacing: '0.02em',
                }}>
                  {realtimeStatus === 'SUBSCRIBED' ? 'Уведомления ●' :
                   realtimeStatus === 'CONNECTING' ? 'Подключение...' :
                   'Нет связи — обновить'}
                </span>
              )}
            </div>
          )}

          <nav style={{ flex: 1, paddingLeft: '8px', paddingRight: '8px' }}>

            <Link href="/adminCifra/dashboard" style={navLinkStyle(isActive('/adminCifra/dashboard'), isCollapsed)}>
              <Home size={22} />
              <span style={navTextStyle(isCollapsed)}>Дашборд</span>
            </Link>

            {/* ==================== БЛОК 10: ПУНКТ МЕНЮ "ЗАЯВКИ" ==================== */}
            <Link 
              href="/adminCifra/zayavki" 
              style={navLinkStyle(isActive('/adminCifra/zayavki'), isCollapsed)}
              onClick={() => setNewOrdersCount(0)}
            >
              <Package size={22} />
              <span style={navTextStyle(isCollapsed)}>Заявки</span>
            </Link>

            {/* ==================== БЛОК 11: ОГРАНИЧЕНИЕ МЕНЮ ==================== */}
            {userRole === 'operator' ? (
              <Link href="/adminCifra/operator" style={navLinkStyle(isActive('/adminCifra/operator'), isCollapsed)}>
                <UserCog size={22} />
                <span style={navTextStyle(isCollapsed)}>Оператор БСУ</span>
              </Link>
            ) : (
              <>
                <Link href="/adminCifra/tasks" style={navLinkStyle(isActive('/adminCifra/tasks'), isCollapsed)}>
                  <CheckCircle size={22} />
                  <span style={navTextStyle(isCollapsed)}>Задачи</span>
                </Link>

                <Link href="/adminCifra/recipes" style={navLinkStyle(isActive('/adminCifra/recipes'), isCollapsed)}>
                  <FlaskConical size={22} />
                  <span style={navTextStyle(isCollapsed)}>Рецепты</span>
                </Link>

                <Link href="/adminCifra/mixers" style={navLinkStyle(isActive('/adminCifra/mixers'), isCollapsed)}>
                  <Truck size={22} />
                  <span style={navTextStyle(isCollapsed)}>Миксеры</span>
                </Link>

                <Link href="/adminCifra/clients" style={navLinkStyle(isActive('/adminCifra/clients'), isCollapsed)}>
                  <Users size={22} />
                  <span style={navTextStyle(isCollapsed)}>Клиенты</span>
                </Link>

                <Link href="/adminCifra/operator" style={navLinkStyle(isActive('/adminCifra/operator'), isCollapsed)}>
                  <UserCog size={22} />
                  <span style={navTextStyle(isCollapsed)}>Оператор БСУ</span>
                </Link>

                {/* ==================== БЛОК 12 ССЫЛКА "КТО В ОНЛАЙН" ==================== */}
                {(userRole === 'admin') && (
                  <Link href="/adminCifra/online" style={navLinkStyle(false, isCollapsed)}>
                    <Globe size={22} />
                    <span style={navTextStyle(isCollapsed)}>Кто в онлайн</span>
                  </Link>
                )}

                {(userRole === 'admin') && (
                  <Link href="/adminCifra/withdrawals" style={navLinkStyle(isActive('/adminCifra/withdrawals'), isCollapsed)}>
                    <DollarSign size={22} />
                    <span style={navTextStyle(isCollapsed)}>Вывод баллов</span>
                  </Link>
                )}

                {/* ==================== БЛОК 13 ССЫЛКА "ВЫКИНУТЬ ВСЕХ" ==================== */}
                {(userRole === 'admin') && (
                  <Link 
                    href="#" 
                    onClick={(e) => { e.preventDefault(); forceLogoutAll(); }}
                    style={navLinkStyle(false, isCollapsed)}
                  >
                    <LogOut size={22} />
                    <span style={navTextStyle(isCollapsed)}>Разлогинить всех</span>
                  </Link>
                )}
              </>
            )}

            {/* ==================== БЛОК 13.1 ЛИЧНЫЙ ВЫХОД ==================== */}
            {userRole !== 'admin' && (
              <Link
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (confirm('Выйти из системы?')) logout();
                }}
                style={navLinkStyle(false, isCollapsed)}
              >
                <LogOut size={22} />
                <span style={navTextStyle(isCollapsed)}>Выйти</span>
              </Link>
            )}
          </nav>
        </div>

        {/* ==================== 14. ОСНОВНОЙ КОНТЕНТ ==================== */}
        <div style={{ 
          flex: 1, 
          minHeight: 0,
          alignSelf: 'stretch',
          boxSizing: 'border-box',
          overflow: isDashboard ? 'hidden' : 'auto', 
          overscrollBehavior: 'none',
          padding: isDashboard ? '14px 20px' : '20px 32px', 
          display: isDashboard ? 'flex' : 'block',
          flexDirection: 'column',
          backgroundColor: '#0F172A',
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ==================== 15. СТИЛИ ДЛЯ ССЫЛОК ====================
const ACCENT = '#4ADE80'; // Tailwind green-400 — «салатовый» акцент

const navLinkStyle = (active: boolean, collapsed: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 0,
  padding: collapsed ? '13px 0' : '13px 14px',
  borderRadius: '12px',
  // Активный пункт: прозрачный фон с лёгким зелёным оттенком + контур + мягкое свечение
  backgroundColor: active ? 'rgba(74,222,128,0.12)' : 'transparent',
  color: active ? ACCENT : '#94A3B8',
  border: active ? `1px solid rgba(74,222,128,0.45)` : '1px solid transparent',
  boxShadow: active ? `0 0 14px rgba(74,222,128,0.22)` : 'none',
  marginBottom: '4px',
  textDecoration: 'none',
  fontSize: '15px',
  fontWeight: active ? '600' : '500',
  justifyContent: collapsed ? 'center' : 'flex-start',
  transition: 'background-color 0.2s, color 0.2s, border-color 0.2s, box-shadow 0.2s, padding 0.35s cubic-bezier(0.4,0,0.2,1)',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

// Текстовая метка пункта меню — всегда в DOM, но плавно скрывается через
// max-width + opacity, чтобы не было резкого «мигания» при сворачивании.
const navTextStyle = (collapsed: boolean): React.CSSProperties => ({
  maxWidth: collapsed ? 0 : '200px',
  paddingLeft: collapsed ? 0 : '14px',
  opacity: collapsed ? 0 : 1,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  transition: 'max-width 0.35s cubic-bezier(0.4,0,0.2,1), padding-left 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease',
  flexShrink: 0,
});