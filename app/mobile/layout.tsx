'use client';

// Унифицированный гейт входа в мобильную версию: одна ссылка (/mobile) для
// сотрудников (админ/диспетчер) и водителей миксеров. Вход в два шага:
// 1) телефон → определяем, кто это (/api/auth/identify);
// 2) сотрудник вводит пароль, водитель подтверждает номер своего миксера.
// После входа показываем нужный дашборд — без переключения URL.

import { ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Home, Package, Truck, Factory, Users, ArrowLeft, Loader2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useUserRole } from '../providers/UserRoleProvider';
import { formatPhoneInput } from '@/lib/phone';
import {
  getStoredDriverSession,
  storeDriverSession,
  clearDriverSession,
  getStoredDriverMixerCache,
  storeDriverMixerCache,
  clearDriverMixerCache,
  DriverMixerInfo,
} from './driver/driverClient';
import DriverDashboard from './driver/components/DriverDashboard';
import { useWakeRefresh } from '@/hooks/useWakeReload';
import './globals.css';
import { hardResetBroadcastSocket, useGlobalBroadcastStatus, reconnectAllBroadcastChannels } from '@/hooks/useRealtimeBroadcast';

// Сколько ждём ответ /api/driver/auth, прежде чем сдаться (см. пояснение у
// ROLE_FETCH_TIMEOUT_MS в UserRoleProvider — та же причина).
const DRIVER_AUTH_TIMEOUT_MS = 12_000;

type DriverMixerOption = { number: string; model: string | null; driver: string };
type LoginStep = 'phone' | 'password' | 'driver-mixer' | 'choose-role';

function BroadcastDot({ status }: { status: string }) {
  const isOk   = status === 'SUBSCRIBED';
  const isErr  = status === 'ERROR' || status === 'CLOSED';
  const color  = isOk ? '#10B981' : isErr ? '#EF4444' : '#FACC15';
  const label  = isOk ? 'Онлайн' : isErr ? 'Нет связи' : 'Подключение…';

  return (
    <button
      onClick={() => { if (isErr) reconnectAllBroadcastChannels(); }}
      title={label}
      style={{
        position: 'absolute',
        bottom: '52px',
        right: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        background: 'none',
        border: 'none',
        cursor: isErr ? 'pointer' : 'default',
        padding: '4px',
      }}
    >
      <div style={{
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 ${isOk ? '5px' : '4px'} ${color}`,
        animation: isErr ? 'none' : 'pulse 2.5s infinite',
        flexShrink: 0,
      }} />
      {isErr && (
        <span style={{ fontSize: '9px', color: '#EF4444', fontWeight: 700, whiteSpace: 'nowrap' }}>
          нет связи
        </span>
      )}
    </button>
  );
}

function NavLink({ href, icon, label, pathname }: { href: string; icon: React.ReactNode; label: string; pathname: string | null }) {
  const isActive = (href === '/mobile/' && (pathname === '/mobile/' || pathname === '/mobile')) || (href !== '/mobile/' && pathname?.startsWith(href));
  const activeColor = '#60A5FA';
  const inactiveColor = '#94A3B8';

  return (
    <Link href={href} style={{ textAlign: 'center', color: isActive ? activeColor : inactiveColor, textDecoration: 'none', flex: 1 }}>
      <div style={{ color: isActive ? activeColor : inactiveColor }}>{icon}</div>
      <div style={{ fontSize: '11px', marginTop: '2px', color: isActive ? activeColor : inactiveColor }}>{label}</div>
    </Link>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '16px',
  marginBottom: '14px',
  borderRadius: '12px',
  border: '1px solid #334155',
  background: '#162032',
  color: '#fff',
  fontSize: '17px',
};

export default function MobileLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  // Мягкое восстановление при пробуждении (без перезагрузки — на Android reload
  // сам виснет на белом экране). Пересоздаём broadcast-сокет, чтобы realtime
  // ожил после фоновой заморозки. Данные страницы обновляются в своих компонентах
  // (см. useWakeRefresh в DriverDashboard / mobile-дашборде).
  useWakeRefresh(() => hardResetBroadcastSocket());

  // ==================== 1. РОЛЬ СОТРУДНИКА ИЗ PROVIDER ====================
  const { user, loading: roleLoading, refreshRole, logout } = useUserRole();
  // Достаточно наличия user (пусть даже пока из кэша, а не свежего сетевого
  // ответа) — актуальность (в т.ч. force-logout) провайдер всё равно
  // перепроверяет в фоне и сам разлогинит при необходимости (см. fetchRole).
  const isStaffLoggedIn = !!user;

  // ==================== 2. СЕССИЯ ВОДИТЕЛЯ ====================
  // /mobile/driver остаётся рабочей ссылкой (редиректим на /mobile, см. её page.tsx),
  // но сама проверка и рендер дашборда водителя теперь живут здесь, в общем гейте.
  // Начальное значение — null (одинаково на сервере и при первом клиентском
  // рендере, иначе гидратация не совпадёт с SSR — см. пояснение у
  // readCachedUser в UserRoleProvider.tsx). Кэш водителя подхватываем внутри
  // useEffect ниже — это не блокирует интерфейс "Загрузкой" на время
  // сетевого запроса и не требует повторного входа при кратковременном сбое
  // сети/холодном старте сервера.
  const [checkingDriverSession, setCheckingDriverSession] = useState(true);
  const [driverMixer, setDriverMixer] = useState<DriverMixerInfo | null>(null);

  useEffect(() => {
    const cachedMixer = getStoredDriverMixerCache();
    if (cachedMixer) setDriverMixer(cachedMixer);

    const session = getStoredDriverSession();
    if (!session) {
      setCheckingDriverSession(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DRIVER_AUTH_TIMEOUT_MS);

    (async () => {
      try {
        const res = await fetch('/api/driver/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(session),
          signal: controller.signal,
        });
        const data = await res.json();
        if (data.success && data.mixer) {
          setDriverMixer(data.mixer);
          storeDriverMixerCache(data.mixer);
        } else {
          // Реальный отказ сервера (сессия недействительна) — а не сетевой
          // сбой (он попадёт в catch ниже) — тут действительно выходим.
          clearDriverSession();
          clearDriverMixerCache();
          setDriverMixer(null);
        }
      } catch (err) {
        // Сетевой сбой/таймаут — не разлогиниваем водителя "в слепую", просто
        // остаёмся с тем, что уже показали из кэша (см. useState выше).
        console.error('Driver session check error:', err);
      } finally {
        clearTimeout(timeoutId);
        setCheckingDriverSession(false);
      }
    })();

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  // ==================== 3. УНИФИЦИРОВАННЫЙ ВХОД (телефон → пароль/миксер) ====================
  const [step, setStep] = useState<LoginStep>('phone');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [mixerNumber, setMixerNumber] = useState('');
  const [matchedMixers, setMatchedMixers] = useState<DriverMixerOption[]>([]);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const resetLoginFlow = () => {
    setStep('phone');
    setPhone('');
    setPassword('');
    setMixerNumber('');
    setMatchedMixers([]);
    setLoginError('');
  };

  const backToPhone = () => {
    setStep('phone');
    setPassword('');
    setMixerNumber('');
    setLoginError('');
  };

  // ==================== 4. СКРЫТИЕ БОКОВОГО МЕНЮ (как было) ====================
  useEffect(() => {
    const hideSidebar = () => {
      document.querySelectorAll('aside, nav, [class*="sidebar"], [class*="Sidebar"], header').forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });
    };

    hideSidebar();
    const timer = setTimeout(hideSidebar, 200);
    return () => clearTimeout(timer);
  }, []);

  // ==================== 5. ШАГ 1: ОПРЕДЕЛЯЕМ, КТО ЭТО ====================
  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');

    try {
      const res = await fetch('/api/auth/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await res.json();

      if (!data.success) {
        setLoginError(data.message || 'Телефон не найден');
        return;
      }

      const hasStaff = !!data.staff;
      const driverMixers: DriverMixerOption[] = data.driverMixers || [];
      const hasDriver = driverMixers.length > 0;

      if (hasStaff && hasDriver) {
        setMatchedMixers(driverMixers);
        setMixerNumber(driverMixers[0].number);
        setStep('choose-role');
      } else if (hasStaff) {
        setStep('password');
      } else if (hasDriver) {
        setMatchedMixers(driverMixers);
        setMixerNumber(driverMixers[0].number);
        setStep('driver-mixer');
      }
    } catch (err) {
      console.error('Identify error:', err);
      setLoginError('Ошибка соединения');
    } finally {
      setLoginLoading(false);
    }
  };

  // ==================== 6. ШАГ 2а: ВХОД СОТРУДНИКА ====================
  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');

    try {
      const res = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim(), password }),
      });
      const data = await res.json();

      if (data.success && data.userId) {
        localStorage.setItem('userId', data.userId.toString());
        refreshRole();
        resetLoginFlow();
      } else {
        setLoginError(data.message || 'Неверный пароль');
      }
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('Ошибка соединения');
    } finally {
      setLoginLoading(false);
    }
  };

  // ==================== 7. ШАГ 2б: ВХОД ВОДИТЕЛЯ ====================
  const handleDriverLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mixerNumber) {
      setLoginError('Выберите номер миксера');
      return;
    }
    setLoginLoading(true);
    setLoginError('');

    try {
      const res = await fetch('/api/driver/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: mixerNumber.trim(), phone: phone.trim() }),
      });
      const data = await res.json();

      if (data.success && data.mixer) {
        storeDriverSession({ number: mixerNumber.trim(), phone: phone.trim() });
        setDriverMixer(data.mixer);
        resetLoginFlow();
      } else {
        setLoginError(data.message || 'Не удалось войти');
      }
    } catch (err) {
      console.error('Driver login error:', err);
      setLoginError('Ошибка соединения');
    } finally {
      setLoginLoading(false);
    }
  };

  // ==================== 8. ВЫХОД / СМЕНА ПОЛЬЗОВАТЕЛЯ ====================
  // Один и тот же телефон/планшет может использоваться разными людьми по
  // очереди (сотрудник передал устройство водителю и наоборот) — поэтому
  // выход сразу очищает обе возможные сессии.
  const handleSwitchUser = () => {
    if (!confirm('Выйти и войти как другой пользователь?')) return;
    clearDriverSession();
    clearDriverMixerCache();
    setDriverMixer(null);
    if (user) {
      logout(); // очищает localStorage сотрудника и перезагружает страницу
    } else {
      resetLoginFlow();
    }
  };

  // ==================== 9. РЕДИРЕКТ СО СТАРОЙ ССЫЛКИ ====================
  const pathname = usePathname();
  const isOldDriverLink = pathname === '/mobile/driver' || pathname === '/mobile/driver/';
  useEffect(() => {
    if (isOldDriverLink) router.replace('/mobile');
  }, [isOldDriverLink, router]);

  // ==================== BROADCAST ИНДИКАТОР ====================
  const broadcastStatus = useGlobalBroadcastStatus();

  // ==================== НАВБАР: скрывается при скролле вниз, выезжает при скролле вверх ====================
  const [navVisible, setNavVisible] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 10) {
        setNavVisible(true);
      } else if (y > lastScrollY.current + 6) {
        setNavVisible(false);
      } else if (y < lastScrollY.current - 6) {
        setNavVisible(true);
      }
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ==================== 10. ЗАГРУЗКА ====================
  // Блокируем интерфейс спиннером только пока НЕТ вообще никаких данных
  // (ни закэшированного водителя, ни закэшированной роли сотрудника) — если
  // есть, показываем их сразу, а актуальность в фоне проверяют эффекты выше.
  if ((checkingDriverSession && !driverMixer) || (roleLoading && !user) || isOldDriverLink) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#162032',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94A3B8',
          gap: '12px',
        }}
      >
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} />
        Загрузка...
      </div>
    );
  }

  // ==================== 11. ДАШБОРД ВОДИТЕЛЯ ====================
  if (driverMixer) {
    return <DriverDashboard mixer={driverMixer} onLogout={handleSwitchUser} />;
  }

  // ==================== 12. ФОРМА ВХОДА (никто не залогинен) ====================
  if (!isStaffLoggedIn) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#162032',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          padding: '20px',
        }}
      >
        <div
          style={{
            background: '#334155',
            padding: '40px 30px',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '420px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          }}
        >
          {step !== 'phone' && (
            <button
              onClick={backToPhone}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'none',
                border: 'none',
                color: '#94A3B8',
                fontSize: '14px',
                marginBottom: '18px',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <ArrowLeft size={16} /> Другой телефон
            </button>
          )}

          <h1 style={{ textAlign: 'center', marginBottom: '8px' }}>ТрейдКом • Мобильная версия</h1>
          <p style={{ textAlign: 'center', color: '#94A3B8', marginBottom: '30px' }}>
            {step === 'phone' && 'Введите телефон для входа'}
            {step === 'password' && 'Введите пароль'}
            {step === 'driver-mixer' && 'Подтвердите номер миксера'}
            {step === 'choose-role' && 'Найдено два профиля — выберите нужный'}
          </p>

          {/* ==================== ШАГ 1: ТЕЛЕФОН ==================== */}
          {step === 'phone' && (
            <form onSubmit={handlePhoneSubmit}>
              <input
                type="tel"
                placeholder="+7 (___) ___-__-__"
                value={phone}
                onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                style={INPUT_STYLE}
                autoFocus
                required
              />
              {loginError && <p style={{ color: '#ef4444', textAlign: 'center', marginBottom: '16px' }}>{loginError}</p>}
              <button
                type="submit"
                disabled={loginLoading}
                style={{ width: '100%', boxSizing: 'border-box', padding: '16px', background: loginLoading ? '#475569' : '#22c55e', color: 'white', border: 'none', borderRadius: '12px', fontSize: '17px', fontWeight: 600, cursor: loginLoading ? 'not-allowed' : 'pointer' }}
              >
                {loginLoading ? 'Проверка...' : 'Продолжить'}
              </button>
            </form>
          )}

          {/* ==================== ШАГ 2: ВЫБОР РОЛИ (редкий случай — оба профиля) ==================== */}
          {step === 'choose-role' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                onClick={() => setStep('password')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '16px', background: '#22c55e', color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 600, cursor: 'pointer' }}
              >
                Войти как сотрудник
              </button>
              <button
                onClick={() => setStep('driver-mixer')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '16px', background: '#10B981', color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 600, cursor: 'pointer' }}
              >
                Войти как водитель
              </button>
            </div>
          )}

          {/* ==================== ШАГ 2а: ПАРОЛЬ СОТРУДНИКА ==================== */}
          {step === 'password' && (
            <form onSubmit={handleStaffLogin}>
              <input
                type="password"
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={INPUT_STYLE}
                autoFocus
                required
              />
              {loginError && <p style={{ color: '#ef4444', textAlign: 'center', marginBottom: '16px' }}>{loginError}</p>}
              <button
                type="submit"
                disabled={loginLoading}
                style={{ width: '100%', boxSizing: 'border-box', padding: '16px', background: loginLoading ? '#475569' : '#22c55e', color: 'white', border: 'none', borderRadius: '12px', fontSize: '17px', fontWeight: 600, cursor: loginLoading ? 'not-allowed' : 'pointer' }}
              >
                {loginLoading ? 'Вход...' : 'Войти'}
              </button>
            </form>
          )}

          {/* ==================== ШАГ 2б: НОМЕР МИКСЕРА ВОДИТЕЛЯ ==================== */}
          {step === 'driver-mixer' && (
            <form onSubmit={handleDriverLogin}>
              {matchedMixers.length > 1 ? (
                <select
                  value={mixerNumber}
                  onChange={(e) => setMixerNumber(e.target.value)}
                  style={{ ...INPUT_STYLE, appearance: 'none' }}
                  required
                >
                  {matchedMixers.map((m) => (
                    <option key={m.number} value={m.number}>
                      {m.number} {m.model ? `— ${m.model}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Номер миксера"
                  value={mixerNumber}
                  onChange={(e) => setMixerNumber(e.target.value)}
                  style={INPUT_STYLE}
                  required
                />
              )}
              {loginError && <p style={{ color: '#ef4444', textAlign: 'center', marginBottom: '16px' }}>{loginError}</p>}
              <button
                type="submit"
                disabled={loginLoading}
                style={{ width: '100%', boxSizing: 'border-box', padding: '16px', background: loginLoading ? '#475569' : '#10B981', color: 'white', border: 'none', borderRadius: '12px', fontSize: '17px', fontWeight: 600, cursor: loginLoading ? 'not-allowed' : 'pointer' }}
              >
                {loginLoading ? 'Вход...' : 'Войти'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ==================== НАВБАР И ОСНОВНОЙ КОНТЕНТ (сотрудник) ====================
  // Кнопку выхода теперь рисует каждая страница сама, в своей первой строке
  // (см. MobileExitButton) — фиксированный оверлей здесь перекрывал кнопки
  // в шапках страниц (например, календарь на Дашборде).
  return (
    <div id="mobile-root" style={{ width: '100vw', maxWidth: '100vw', overflowX: 'hidden', backgroundColor: '#162032', minHeight: '100vh', position: 'relative' }}>
      {children}

      {/* Нижний навбар с анимацией появления/скрытия */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '74px',
        background: '#334155',
        borderTop: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        zIndex: 1000,
        paddingBottom: '8px',
        transform: navVisible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <NavLink href="/mobile/" icon={<Home size={26} />} label="Дашборд" pathname={pathname} />
        <NavLink href="/mobile/zayavki" icon={<Package size={26} />} label="Заявки" pathname={pathname} />
        <NavLink href="/mobile/mixers" icon={<Truck size={26} />} label="Миксеры" pathname={pathname} />
        <NavLink href="/mobile/warehouse" icon={<Factory size={26} />} label="Склад" pathname={pathname} />
        <NavLink href="/mobile/clients" icon={<Users size={26} />} label="Клиенты" pathname={pathname} />

        {/* Broadcast-индикатор: правый нижний угол навбара */}
        <BroadcastDot status={broadcastStatus} />
      </div>
    </div>
  );
}
