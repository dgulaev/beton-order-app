'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, FlaskConical, Truck, Package, Users, UserCog, DollarSign, Menu, X, Bell, CheckCircle, LogOut, Globe } from 'lucide-react';

import { useEffect, useState, useRef } from 'react';

import Image from 'next/image';

export default function AdminCifraLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (path: string) => pathname === path;

  // ==================== 1. ОСНОВНЫЕ СОСТОЯНИЯ ====================
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(true);

  // ==================== 1.1 НОВОЕ: СОСТОЯНИЕ АВТОРИЗАЦИИ ====================
const [isLoggedIn, setIsLoggedIn] = useState(false);
const [phone, setPhone] = useState('');
const [password, setPassword] = useState('');
const [loginLoading, setLoginLoading] = useState(false);
const [loginError, setLoginError] = useState('');

// ==================== 1.2 РОЛЬ GUEST ====================
const isGuest = userRole === 'guest';

  // ==================== 2. СОСТОЯНИЯ УВЕДОМЛЕНИЙ ====================
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [lastNotificationId, setLastNotificationId] = useState<number | null>(null);

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
      console.log('Звук заблокирован браузером (нормально):', err.message);
    });
  };

  // ==================== 3. ПРОВЕРКА АВТОРИЗАЦИИ И FORCE LOGOUT ====================
useEffect(() => {
  const savedUserId = localStorage.getItem('userId');
  
  if (!savedUserId) {
    setIsLoggedIn(false);
    setLoading(false);
    return;
  }

  setIsLoggedIn(true);
  checkUserRole(savedUserId);

  // === ПОЛИНГ ПРИНУДИТЕЛЬНОГО ВЫХОДА ===
  // Для продакшена делаем проверку раз в 30 минут, чтобы не создавать лишнюю нагрузку на базу
  const forceCheckInterval = setInterval(() => {
    const currentUserId = localStorage.getItem('userId');
    if (currentUserId) {
      checkUserRole(currentUserId);
    }
  }, 1800000); // 30 минут = 1 800 000 миллисекунд

  return () => clearInterval(forceCheckInterval);
}, []);

const checkUserRole = async (savedUserId: string) => {
  try {
    const res = await fetch('/api/user/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: parseInt(savedUserId) }),
    });

    const data = await res.json();

    // === ПРИНУДИТЕЛЬНЫЙ ВЫХОД ===
    if (data.forceLogoutVersion && data.forceLogoutVersion >= 9999) {
      
      // Главный Админ (user_id = 1777619517739) может входить всегда
      if (parseInt(savedUserId) === 1777619517739) {
        console.log('✅ Главный Админ — разрешаем вход несмотря на force_logout_version');
        setUserRole(data.role || 'admin');
        return;
      } 
      
      // Все остальные сотрудники выкидываются автоматически
      console.log(`🔴 Принудительный выход для пользователя ${savedUserId}`);
      localStorage.removeItem('userId');
      setIsLoggedIn(false);
      setUserRole(null);
      window.location.reload();
      return;
    }

    setUserRole(data.role || 'client');

  } catch (e) {
    console.error('Role check error:', e);
    setUserRole('client');
  } finally {
    setLoading(false);
  }
};

  // ==================== 3.1 ОЧИСТКА СТАРЫХ ЗАКРЫТЫХ УВЕДОМЛЕНИЙ ====================
  useEffect(() => {
    const closed = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
    if (closed.length > 50) {
      localStorage.setItem('closedNotifications', JSON.stringify(closed.slice(-30)));
    }
  }, []);

  // ==================== 4. ВХОД ====================
const handleLogin = async (e: React.FormEvent) => {
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
      
      console.log('✅ Логин успешен, обновляем состояние');
      
      setIsLoggedIn(true);
      setUserRole(data.role);
      setPhone('');
      setPassword('');
      
      // Жёсткая перезагрузка страницы
      window.location.reload();
      
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


  // ==================== 4.2 УВЕДОМЛЕНИЕ ПО КЛИЕНТУ (НОВЫЙ БЛОК) ====================
  const showClientReminder = (client: any) => {
    const closed = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
    const key = `client-reminder-${client.groupId || client.user_id}`;

    if (closed.includes(key)) return;

    const notif = document.createElement('div');
    notif.style.cssText = `
      position: fixed;
      top: 90px;
      right: 24px;
      background: linear-gradient(135deg, #f59e0b, #fbbf24);
      color: #0f172a;
      padding: 18px 24px;
      borderRadius: 16px;
      z-index: 10000;
      box-shadow: 0 20px 40px rgba(245, 158, 11, 0.4);
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 420px;
      cursor: pointer;
    `;

    notif.innerHTML = `
      <div style="font-size: 36px;">📞</div>
      <div style="flex: 1;">
        <div style="font-size: 17px; font-weight: 700;">Пора позвонить клиенту!</div>
        <div style="font-size: 15px; margin-top: 4px;">
          ${client.organization_name || client.full_name || 'Клиент'}
        </div>
        <div style="font-size: 14px; opacity: 0.9;">
          Следующий контакт: ${new Date(client.next_contact).toLocaleDateString('ru-RU')}
        </div>
      </div>
      <div style="font-size: 28px; cursor: pointer; padding: 4px 10px;" class="close-reminder">✕</div>
    `;

    const closeBtn = notif.querySelector('.close-reminder') as HTMLElement;
    const closeNotification = () => {
      notif.remove();
      const closedList = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
      closedList.push(key);
      localStorage.setItem('closedNotifications', JSON.stringify(closedList));
    };

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeNotification();
      });
    }

    notif.addEventListener('click', () => {
      window.location.href = '/adminCifra/clients';
      closeNotification();
    });

    document.body.appendChild(notif);
    playNotificationSound();
  };
// ==================== 4.3 УЛУЧШЕННОЕ ВСПЛЫВАЮЩЕЕ УВЕДОМЛЕНИЕ ====================
const showVisualNotification = (type: 'new' | 'status' | 'volume' | 'datetime', orderData?: any, oldData?: any) => {
  const orderId = orderData?.id || '—';

  let title = '';
  let message = '';
  let emoji = '';

  // Функция форматирования даты
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

  // Надёжный перевод статусов (независимо от регистра)
  const statusMap: Record<string, string> = {
    'new': 'Новая',
    'NEW': 'Новая',
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

  playNotificationSound();

  const notif = document.createElement('div');
  notif.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    background: linear-gradient(135deg, #22c55e, #86efac);
    color: #0f172a;
    padding: 16px 22px;
    border-radius: 16px;
    z-index: 10000;
    font-weight: 600;
    box-shadow: 0 20px 40px rgba(34, 197, 94, 0.45);
    display: flex;
    alignItems: center;
    gap: 14px;
    min-width: 390px;
    cursor: pointer;
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

  document.body.appendChild(notif);
};

// ==================== 4.3.1 HEARTBEAT — ОБНОВЛЕНИЕ АКТИВНОСТИ (каждые 5 минут) ====================
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

      console.log('❤️ Heartbeat sent, status:', res.status);
    } catch (e) {
      console.warn('Heartbeat failed:', e);
    }
  };

  sendHeartbeat(); // сразу

  // Интервал — 10 минут
  const interval = setInterval(sendHeartbeat, 10 * 60 * 1000);

  return () => clearInterval(interval);
}, [userRole]);

// ==================== 4.4 ПРИСВОЕНИЕ ФУНКЦИЙ В WINDOW (ВАЖНО!) ====================
useEffect(() => {
  (window as any).showVisualNotification = showVisualNotification;
  (window as any).playNotificationSound = playNotificationSound;
  
  console.log('✅ window.showVisualNotification и playNotificationSound доступны');
}, []); // пустой массив — выполняется один раз

 // ==================== БЛОК 5. УЛУЧШЕННЫЙ POLLING (ФИКС ПОВТОРНЫХ УВЕДОМЛЕНИЙ) ====================
useEffect(() => {
  if (!userRole || !['admin', 'manager', 'dispatcher', 'operator'].includes(userRole)) {
    return;
  }

  console.log(`✅ Polling запущен для роли: ${userRole}`);

  // Восстанавливаем последний обработанный ID из localStorage
  let lastMaxOrderId = parseInt(localStorage.getItem('lastMaxOrderId') || '0');
  let lastKnownData: Record<number, any> = {};

  const checkOrders = async () => {
    try {
      const res = await fetch('/api/adminCifra/all-orders', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(10000) // ← Защита от зависания (10 секунд)
      });

      if (!res.ok) {
        console.warn(`Polling: HTTP ${res.status} — сервер вернул ошибку`);
        return;
      }

      const response = await res.json();
      
      // ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
      // Универсальная обработка ответа (массив или {orders: [...]})
      const orders = Array.isArray(response) 
        ? response 
        : (response.orders || response || []);
      // ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←

      const currentMaxId = orders.length > 0 
        ? Math.max(...orders.map((o: any) => o.id || 0)) 
        : 0;

      // === НОВЫЕ ЗАЯВКИ ===
      if (currentMaxId > lastMaxOrderId) {
        const newOrders = orders.filter((o: any) => o.id > lastMaxOrderId);

        console.log(`🆕 Найдено новых заявок: ${newOrders.length}`);

        for (const newOrder of newOrders) {
          setNewOrdersCount(prev => prev + 1);
          if (typeof playNotificationSound === 'function') playNotificationSound();
          showVisualNotification('new', newOrder);
        }

        // Сохраняем прогресс
        lastMaxOrderId = currentMaxId;
        localStorage.setItem('lastMaxOrderId', currentMaxId.toString());
      }

      // === Изменения в существующих заявках ===
      orders.forEach((order: any) => {
        const prev = lastKnownData[order.id];

        if (prev) {
          if (prev.status !== order.status) {
            if (typeof playNotificationSound === 'function') playNotificationSound();
            showVisualNotification('status', order);
          }
          if (prev.volume !== order.volume) {
            if (typeof playNotificationSound === 'function') playNotificationSound();
            showVisualNotification('volume', order, prev);
          }
          if (prev.delivery_date !== order.delivery_date || prev.delivery_time !== order.delivery_time) {
            if (typeof playNotificationSound === 'function') playNotificationSound();
            showVisualNotification('datetime', order);
          }
        }

        lastKnownData[order.id] = { ...order };
      });

    } catch (err: any) {
      if (err.name === 'TimeoutError') {
        console.warn('Polling: запрос превысил таймаут (10 сек)');
      } else {
        console.warn('Polling error:', err.message || err);
      }
    }
  };

  const initialTimer = setTimeout(checkOrders, 1500);
  const interval = setInterval(checkOrders, 10000);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}, [userRole]);

// ==================== 5.1 ПРОВЕРКА НАПОМИНАНИЙ ПО КЛИЕНТАМ (ОДИН РАЗ В ДЕНЬ) ====================
useEffect(() => {
  if (!userRole || !['admin', 'manager', 'dispatcher', 'operator'].includes(userRole)) return;

  const checkClientReminders = async () => {
    try {
      const savedUserId = localStorage.getItem('userId');
      if (!savedUserId) return;

      const res = await fetch(`/api/adminCifra/clients/reminders?userId=${savedUserId}`);

      if (!res.ok) {
        console.warn('Reminders API returned:', res.status);
        return;
      }

      const reminders = await res.json();

      console.log(`📢 Получено ${reminders.length} напоминаний`);

      reminders.forEach((reminder: any) => {
        const key = `client-reminder-${reminder.groupId || reminder.user_id}`;
        const closed = JSON.parse(localStorage.getItem('closedNotifications') || '[]');

        if (!closed.includes(key)) {
          showClientReminder(reminder);
        }
      });
    } catch (err) {
      console.warn('Client reminders check error:', err);
    }
  };

  // Первый запуск
  checkClientReminders();

  // Ежедневная проверка в 9:00 утра
  const now = new Date();
  const tomorrow9AM = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
  const timeUntil9AM = tomorrow9AM.getTime() - now.getTime();

  const dailyTimer = setTimeout(() => {
    checkClientReminders();
    setInterval(checkClientReminders, 24 * 60 * 60 * 1000);
  }, timeUntil9AM);

  return () => clearTimeout(dailyTimer);

}, [userRole]);


  // ==================== 6. СБРОС СЧЁТЧИКА ====================
  useEffect(() => {
    if (pathname === '/adminCifra/zayavki') {
      setNewOrdersCount(0);
    }
  }, [pathname]);

  if (loading) {
    return <div style={{ padding: '100px', textAlign: 'center', background: '#0F172A', color: '#94A3B8', minHeight: '100vh' }}>Загрузка...</div>;
  }


  // ==================== ФОРМА ВХОДА (если не авторизован) ====================
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
              onChange={(e) => setPhone(e.target.value)}
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

  // ==================== 4.1 КНОПКА "ВЫКИНУТЬ ВСЕХ" ====================
const forceLogoutAll = async () => {
  if (!confirm('Вы уверены, что хотите выкинуть ВСЕХ сотрудников?\n\nОни будут вынуждены заново ввести пароль.')) {
    return;
  }

  try {
    const res = await fetch('/api/adminCifra/force-logout-all', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 1777619517739 }) // твой user_id
    });

    const data = await res.json();

    if (data.success) {
      alert('✅ Все сотрудники успешно выкинуты из системы!');
      window.location.reload();
    } else {
      alert('Ошибка: ' + (data.message || 'Неизвестная ошибка'));
    }
  } catch (err) {
    alert('Ошибка соединения с сервером');
  }
};


  // ==================== ПРОВЕРКА РОЛЕЙ ====================
const allowedRoles = ['admin', 'manager', 'dispatcher', 'operator', 'guest'];

if (!userRole || !allowedRoles.includes(userRole)) {
  return <div style={{ padding: '100px', textAlign: 'center', background: '#0F172A', color: '#94A3B8' }}>Доступ запрещён</div>;
}

  // ==================== 7. ГЛОБАЛЬНЫЙ МАСШТАБ ====================
  const getGlobalScale = () => {
    const width = window.innerWidth;
    if (width >= 2560) return 1.00;
    if (width >= 1920) return 0.82;
    if (width >= 1680) return 0.79;
    if (width >= 1440) return 0.77;
    return 0.74;
  };

  const scale = getGlobalScale();

  

  return (
    <div style={{ 
      transform: `scale(${scale})`, 
      transformOrigin: 'top left',
      width: `${100 / scale}%`,
      height: `${100 / scale}%`,
      overflow: 'hidden',
      minHeight: '100vh'
    }}>
      <div style={{ 
        display: 'flex', 
        minHeight: '100vh', 
        backgroundColor: '#0F172A',
        color: '#fff'
      }}>
        
        {/* ==================== 8. СВОРАЧИВАЕМОЕ МЕНЮ ==================== */}
        <div style={{
          width: isCollapsed ? '72px' : '280px',
          backgroundColor: '#1E2937',
          color: '#fff',
          padding: '24px 12px',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #334155',
          transition: 'width 0.3s ease',
          flexShrink: 0,
          overflow: 'hidden'
        }}>
          
          {/* Кнопка сворачивания */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'flex-end', 
            marginBottom: '20px',
            paddingRight: '8px'
          }}>
            <button 
              onClick={() => setIsCollapsed(!isCollapsed)}
              style={{
                background: 'none',
                border: 'none',
                color: '#94A3B8',
                cursor: 'pointer',
                padding: '8px',
                borderRadius: '8px'
              }}
            >
              {isCollapsed ? <Menu size={24} /> : <X size={24} />}
            </button>
          </div>

      {/* ==================== ЛОГОТИП TRADECOM ==================== */}
          <div style={{ 
            padding: '0 12px', 
            marginBottom: '40px', 
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}>
            <Image 
              src={isCollapsed ? "/logo-tradecom-circle.png" : "/logo-tradecom-white.png"} 
              alt="TRADECOM" 
              width={isCollapsed ? 82 : 270} 
              height={isCollapsed ? 82 : 130} 
              style={{ 
                objectFit: 'contain',
                borderRadius: isCollapsed ? '50%' : '8px',
                transition: 'all 0.3s ease'
              }} 
              priority
            />
            
            {!isCollapsed && (
              <p style={{ 
                fontSize: '13px', 
                color: '#64748B', 
                marginTop: '8px',
                letterSpacing: '0.5px'
              }}>
                ТрейдКом • ДИСПЕТЧЕРИЗАЦИЯ
              </p>
            )}
          </div>

                    <nav style={{ flex: 1 }}>

            <Link href="/adminCifra/dashboard" style={navLinkStyle(isActive('/adminCifra/dashboard'), isCollapsed)}>
              <Home size={22} /> {!isCollapsed && <span>Дашборд</span>}
            </Link>

            {/* ==================== БЛОК 9: ПУНКТ МЕНЮ "ЗАЯВКИ" ==================== */}
            <div>
              <Link 
                href="/adminCifra/zayavki" 
                style={navLinkStyle(isActive('/adminCifra/zayavki'), isCollapsed)}
                onClick={() => setNewOrdersCount(0)}
              >
                <Package size={22} /> 
                {!isCollapsed && <span>Заявки</span>}
              </Link>
            </div>

            {/* ==================== БЛОК 9.1: ОГРАНИЧЕНИЕ МЕНЮ ==================== */}
            {userRole === 'operator' ? (
              <Link href="/adminCifra/operator" style={navLinkStyle(isActive('/adminCifra/operator'), isCollapsed)}>
                <UserCog size={22} /> {!isCollapsed && <span>Оператор БСУ</span>}
              </Link>
            ) : (
              <>
                <Link href="/adminCifra/tasks" style={navLinkStyle(isActive('/adminCifra/tasks'), isCollapsed)}>
                  <CheckCircle size={22} /> {!isCollapsed && <span>Задачи</span>}
                </Link>

                <Link href="/adminCifra/recipes" style={navLinkStyle(isActive('/adminCifra/recipes'), isCollapsed)}>
                  <FlaskConical size={22} /> {!isCollapsed && <span>Рецепты</span>}
                </Link>

                <Link href="/adminCifra/mixers" style={navLinkStyle(isActive('/adminCifra/mixers'), isCollapsed)}>
                  <Truck size={22} /> {!isCollapsed && <span>Миксеры</span>}
                </Link>

                <Link href="/adminCifra/clients" style={navLinkStyle(isActive('/adminCifra/clients'), isCollapsed)}>
                  <Users size={22} /> {!isCollapsed && <span>Клиенты</span>}
                </Link>

                <Link href="/adminCifra/operator" style={navLinkStyle(isActive('/adminCifra/operator'), isCollapsed)}>
                  <UserCog size={22} /> {!isCollapsed && <span>Оператор БСУ</span>}
                </Link>

                

                {/* ==================== БЛОК 9.2 ССЫЛКА "КТО В ОНЛАЙН" ==================== */}
                 {(userRole === 'admin') && (
                 <Link 
                    href="/adminCifra/online" 
                    style={navLinkStyle(false, isCollapsed)}   // ← точно как у разлогина
                 >
                <Globe size={22} /> 
                   {!isCollapsed && <span>Кто в онлайн</span>}
                </Link>
                )}

                {(userRole === 'admin') && (
                  <Link href="/adminCifra/withdrawals" style={navLinkStyle(isActive('/adminCifra/withdrawals'), isCollapsed)}>
                    <DollarSign size={22} /> {!isCollapsed && <span>Выводы наличных</span>}
                  </Link>
                )}

                {/* ==================== БЛОК 9.3 ССЫЛКА "ВЫКИНУТЬ ВСЕХ" ==================== */}
                {(userRole === 'admin') && (
                <Link 
                    href="#" 
                    onClick={(e) => {
                    e.preventDefault();
                    forceLogoutAll();
                }}
                    style={navLinkStyle(false, isCollapsed)}
                 >
               <LogOut size={22} /> 
                   {!isCollapsed && <span>Разлогинить всех</span>}
               </Link>
               )}
              </>
            )}
          </nav>
        </div>

        {/* ==================== 10. ОСНОВНОЙ КОНТЕНТ ==================== */}
        <div style={{ 
          flex: 1, 
          overflow: 'auto', 
          padding: '20px 32px', 
          minHeight: '80vh',
          backgroundColor: '#0F172A',
          ...(pathname === '/adminCifra/zayavki' && {
            padding: '20px 40px',
            minHeight: '920px',
            overflow: 'visible'
          })
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ==================== 11. СТИЛЬ ДЛЯ ССЫЛОК ====================
const navLinkStyle = (active: boolean, collapsed: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  padding: '14px 16px',
  borderRadius: '12px',
  backgroundColor: active ? '#3B82F6' : 'transparent',
  color: active ? '#fff' : '#94A3B8',
  marginBottom: '6px',
  textDecoration: 'none',
  fontSize: '16px',
  fontWeight: '500' as const,
  justifyContent: collapsed ? 'center' : 'flex-start',
  transition: 'all 0.2s',
} as React.CSSProperties);   // ← Добавили эту строку