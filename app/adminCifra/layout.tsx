'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, FlaskConical, Truck, Package, Users, UserCog, Menu, X, Bell, CheckCircle, LogOut, UserX, Globe, Smartphone, Inbox, Store, Radar, Megaphone, ChevronDown, Cable } from 'lucide-react';
import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useUserRole } from '../providers/UserRoleProvider';
import { useOrderChangeNotifications } from '@/hooks/useRealtimeOrders';
import { useLeadChangeNotifications } from '@/hooks/useRealtimeLeads';
import { useDemandChangeNotifications } from '@/hooks/useRealtimeDemand';
import { canAccessSales, isSalesPath } from '@/lib/adminCifraSalesAccess';
import { LEAD_SOURCE_LABEL } from '@/lib/leads';
import { sanitizeAvitoMessageText } from '@/lib/integrations/avito/messageText';
import { reconnectAllBroadcastChannels, useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';
import { useWakeReload } from '@/hooks/useWakeReload';
import { useStaffHeartbeat } from '@/hooks/useStaffHeartbeat';
import { formatPhoneInput } from '@/lib/phone';
import { formatTimeHHMM, ruPastByName } from '@/lib/ruLocale';
import { formatBuildLabelFull, formatBuildVersion } from '@/lib/buildInfo';
import AppDialogHost, { appConfirm } from './components/appDialog';

// ==================== PERSISTENTНЫЕ УВЕДОМЛЕНИЯ (localStorage) ====================
const NOTIF_STORAGE_KEY = 'persistentOrderNotifications';
const NOTIF_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 часа

/** Stroke-иконки как в боковом меню (Lucide). */
type NotifIconKey = 'package' | 'check' | 'cancel' | 'play' | 'clock' | 'refresh';

interface PersistedNotif {
  id: string;
  /** Ключ иконки; поле `emoji` — legacy из старых сохранений. */
  icon?: NotifIconKey | string;
  emoji?: string;
  title: string;
  message: string;
  timestamp: number;
  /** Куда вести по клику (по умолчанию — заявки). */
  href?: string;
  /** Визуальный вариант: заявки — зелёный, лиды — жёлтый, комментарии — голубой. */
  tone?: 'order' | 'lead' | 'comment';
}

function escapeToastHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveNotifIcon(raw?: string): NotifIconKey {
  const key = (raw || '').trim();
  if (key === 'package' || key === 'check' || key === 'cancel' || key === 'play' || key === 'clock' || key === 'refresh') {
    return key;
  }
  // Старые эмодзи в localStorage
  if (key === '✅') return 'check';
  if (key === '❌') return 'cancel';
  if (key === '▶️') return 'play';
  if (key === '🔄') return 'refresh';
  if (key === '🕒') return 'clock';
  return 'package';
}

function notifIconHtml(icon: NotifIconKey): string {
  const svg = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block">${inner}</svg>`;
  const icons: Record<NotifIconKey, string> = {
    // Package — как пункт «Заявки»
    package: svg(
      '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/>',
    ),
    // CircleCheck — как CheckCircle в «Задачи»
    check: svg('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
    cancel: svg('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'),
    play: svg(
      '<circle cx="12" cy="12" r="10"/><path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"/>',
    ),
    clock: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
    refresh: svg(
      '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    ),
  };
  return `<div style="color:#0f172a;flex-shrink:0;display:flex;align-items:center;opacity:0.92;">${icons[icon]}</div>`;
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
  const router = useRouter();
  const isActive = (path: string) => pathname === path;
  const isSalesSection = isSalesPath(pathname);

  // Однократная перезагрузка при пробуждении вкладки после долгого простоя
  // (напр. оставленный на ночь экран) — оживляет «замороженную» страницу.
  useWakeReload();

  // ==================== 1. РОЛЬ ИЗ PROVIDER ====================
  const { user, loading: roleLoading, refreshRole, logout } = useUserRole();

  const [isCollapsed, setIsCollapsed] = useState(true);
  const [salesMenuOpen, setSalesMenuOpen] = useState(false);
  const [salesFlyoutPos, setSalesFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const salesMenuRef = useRef<HTMLDivElement | null>(null);
  const salesButtonRef = useRef<HTMLButtonElement | null>(null);
  const salesFlyoutRef = useRef<HTMLDivElement | null>(null);

  // Подменю «Продажи»: в развёрнутом режиме авто-открывать на дочерних страницах;
  // закрывается только вручную (клик по «Продажи») или при сворачивании сайдбара —
  // не по клику снаружи.
  useEffect(() => {
    if (!isCollapsed && isSalesSection) setSalesMenuOpen(true);
    if (isCollapsed) setSalesMenuOpen(false);
  }, [isCollapsed, isSalesSection, pathname]);

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

  // Свёрнутый режим: flyout через portal (сайдбар overflow:hidden обрезает absolute-панель).
  useLayoutEffect(() => {
    if (!isCollapsed || !salesMenuOpen) {
      setSalesFlyoutPos(null);
      return;
    }
    const updatePos = () => {
      const btn = salesButtonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      setSalesFlyoutPos({ top: rect.top, left: rect.right + 8 });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isCollapsed, salesMenuOpen, viewportH]);

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
      // Лаборант работает только на десктопной странице «Лаборатория»
      // (в мобильной версии этого раздела нет) — не уводим его на /mobile.
      if (userRole === 'laborant') return;

      // Ручной выбор «Основная версия» в меню — не уводим обратно на /mobile.
      // Также уважаем ?desktop=true (одноразовый вход с мобилки).
      try {
        if (localStorage.getItem('adminViewPref') === 'desktop') return;
      } catch { /* ignore */ }
      if (window.location.search.includes('desktop=true')) {
        try { localStorage.setItem('adminViewPref', 'desktop'); } catch { /* ignore */ }
        return;
      }

      const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Samsung/i.test(navigator.userAgent) ||
                       window.innerWidth <= 768;

      const currentPath = window.location.pathname;

      if (isMobile && currentPath.startsWith('/adminCifra')) {
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
  }, [userRole]);

  const goToMobileVersion = () => {
    try { localStorage.setItem('adminViewPref', 'mobile'); } catch { /* ignore */ }
    const path = pathname || '/adminCifra/dashboard';
    let next = path.replace(/^\/adminCifra/, '/mobile');
    if (next === '/mobile' || next === '/mobile/' || next.includes('/dashboard')) next = '/mobile/';
    // Разделов без мобильного аналога нет смысла тащить 1:1 — уводим на дашборд.
    const known = ['/mobile/', '/mobile/zayavki', '/mobile/mixers', '/mobile/clients', '/mobile/warehouse'];
    if (!known.some((p) => next === p || (p !== '/mobile/' && next.startsWith(p)))) {
      next = '/mobile/';
    }
    window.location.assign(next);
  };

  // ==================== 2. СОСТОЯНИЯ УВЕДОМЛЕНИЙ ====================
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [newLeadsCount, setNewLeadsCount] = useState(0);
  const [newDemandCount, setNewDemandCount] = useState(0);
  const [lastNotificationId, setLastNotificationId] = useState<number | null>(null);
  const salesBadgeCount = newLeadsCount + newDemandCount;

  // Ref для функции создания тоста — позволяет вызывать её из mount-эффекта
  // без проблем с замыканиями (всегда последняя версия функции)
  const createToastRef = useRef<
    ((
      id: string,
      iconKey: string,
      title: string,
      message: string,
      href?: string,
      tone?: 'order' | 'lead' | 'comment',
    ) => void) | null
  >(null);

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
        // После сброса force_logout_version на сервере синхронизируем локальный маркер
        localStorage.setItem('lastForceLogoutVersion', '0');
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
  createToastRef.current = (
    id: string,
    iconKey: string,
    title: string,
    message: string,
    href = '/adminCifra/zayavki',
    tone: 'order' | 'lead' | 'comment' = 'order',
  ) => {
    const notif = document.createElement('div');
    notif.dataset.notifId = id;
    const isLead =
      tone === 'lead' || id.startsWith('lead-') || id.startsWith('demand-');
    const isComment =
      !isLead && (tone === 'comment' || id.startsWith('comment-'));
    // Заявки — салатовый; лиды/спрос — жёлтый; комментарии — голубой (sky).
    // Одна ширина со стеком — чтобы баннеры не «выпирали».
    const widthPx = 420;
    const bg = isLead
      ? 'linear-gradient(135deg, #eab308, #fde047)'
      : isComment
        ? 'linear-gradient(135deg, #0ea5e9, #7dd3fc)'
        : 'linear-gradient(135deg, #22c55e, #86efac)';
    const shadow = isLead
      ? '0 20px 40px rgba(234, 179, 8, 0.45)'
      : isComment
        ? '0 20px 40px rgba(14, 165, 233, 0.45)'
        : '0 20px 40px rgba(34, 197, 94, 0.45)';
    const padY = isLead ? 20 : 16;
    const titleSize = isLead ? 18 : 16;
    const msgSize = isLead ? 15 : 14;
    const titleMin = isLead ? 14 : 11;
    const msgMin = isLead ? 13 : 10;

    notif.style.cssText = `
      position: relative;
      box-sizing: border-box;
      width: ${widthPx}px;
      max-width: min(${widthPx}px, calc(100vw - 48px));
      background: ${bg};
      color: #0f172a;
      padding: ${padY}px 22px;
      border-radius: 16px;
      font-weight: 600;
      box-shadow: ${shadow};
      display: flex;
      align-items: ${isLead ? 'flex-start' : 'center'};
      gap: 14px;
      cursor: pointer;
      pointer-events: auto;
      min-height: ${isLead ? '76px' : 'auto'};
    `;

    const icon = resolveNotifIcon(iconKey);
    const msgWhiteSpace = isLead ? 'normal' : 'nowrap';
    const msgClamp = isLead
      ? 'display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.35;'
      : '';
    notif.innerHTML = `
      <div style="flex-shrink: 0; ${isLead ? 'padding-top: 2px;' : ''}">${notifIconHtml(icon)}</div>
      <div class="toast-text" style="flex: 1; min-width: 0; overflow: hidden;">
        <div class="toast-title" style="font-size: ${titleSize}px; font-weight: 700; white-space: nowrap; line-height: 1.25;">${escapeToastHtml(title)}</div>
        <div class="toast-msg" style="font-size: ${msgSize}px; opacity: 0.92; white-space: ${msgWhiteSpace}; margin-top: 4px; ${msgClamp}">${escapeToastHtml(message)}</div>
      </div>
      <div style="font-size: 22px; opacity: 0.7; cursor: pointer; line-height: 1; padding: 2px 4px; flex-shrink: 0;" class="close-btn">✕</div>
    `;

    const closeBtn = notif.querySelector('.close-btn') as HTMLElement;
    const textCol = notif.querySelector('.toast-text') as HTMLElement | null;

    /** Ужимает шрифт title/msg, чтобы строки влезли в ширину баннера. */
    const fitToastText = () => {
      if (!textCol) return;
      const titleEl = textCol.querySelector('.toast-title') as HTMLElement | null;
      const msgEl = textCol.querySelector('.toast-msg') as HTMLElement | null;
      if (!titleEl || !msgEl) return;

      const avail = textCol.clientWidth;
      if (avail <= 0) return;

      // Сброс к базовым размерам, затем пропорциональное уменьшение
      titleEl.style.fontSize = `${titleSize}px`;
      msgEl.style.fontSize = `${msgSize}px`;

      // У лидов подзаголовок переносится на 2 строки — ужимаем в основном title
      if (isLead) {
        if (titleEl.scrollWidth <= avail) return;
        const scale = Math.max(titleMin / titleSize, avail / titleEl.scrollWidth);
        titleEl.style.fontSize = `${(titleSize * scale).toFixed(2)}px`;
        let guard = 24;
        while (guard-- > 0 && titleEl.scrollWidth > avail) {
          const t = parseFloat(titleEl.style.fontSize);
          if (t <= titleMin) break;
          titleEl.style.fontSize = `${Math.max(titleMin, t - 0.25)}px`;
        }
        return;
      }

      const need = Math.max(titleEl.scrollWidth, msgEl.scrollWidth);
      if (need <= avail) return;

      const scale = Math.max(0.72, avail / need);
      titleEl.style.fontSize = `${(titleSize * scale).toFixed(2)}px`;
      msgEl.style.fontSize = `${(msgSize * scale).toFixed(2)}px`;

      // Если после округления всё ещё не влезло — дожимаем по 0.25px
      let guard = 24;
      while (
        guard-- > 0 &&
        (titleEl.scrollWidth > avail || msgEl.scrollWidth > avail)
      ) {
        const t = parseFloat(titleEl.style.fontSize);
        const m = parseFloat(msgEl.style.fontSize);
        if (t <= titleMin && m <= msgMin) break;
        titleEl.style.fontSize = `${Math.max(titleMin, t - 0.25)}px`;
        msgEl.style.fontSize = `${Math.max(msgMin, m - 0.25)}px`;
      }
    };

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
        window.location.href = href || '/adminCifra/zayavki';
        closeNotification();
      }
    });

    getNotificationContainer().prepend(notif);
    // После вставки в DOM измеряем реальную ширину и подгоняем шрифт
    requestAnimationFrame(fitToastText);
  };

  // ==================== 4.3A ВОССТАНОВЛЕНИЕ УВЕДОМЛЕНИЙ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ ====================
  useEffect(() => {
    const saved = loadPersistedNotifs();
    if (saved.length === 0) return;
    // Небольшая задержка чтобы контейнер успел смонтироваться в DOM
    const timer = setTimeout(() => {
      saved.forEach(n => {
        const tone =
          n.tone ||
          (n.id.startsWith('lead-') || n.id.startsWith('demand-')
            ? 'lead'
            : n.id.startsWith('comment-')
              ? 'comment'
              : 'order');
        createToastRef.current?.(
          n.id,
          n.icon || n.emoji || 'package',
          n.title,
          n.message,
          n.href,
          tone,
        );
      });
      // Обновляем счётчик
      setNewOrdersCount(prev => prev + saved.length);
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==================== 4.2.1 ВЫСОКОУРОВНЕВАЯ ФУНКЦИЯ — ПРИШЛО НОВОЕ СОБЫТИЕ ====================
  type OrderNotifType = 'new' | 'status' | 'volume' | 'datetime' | 'grade';

  const isUsableActorName = (name: string, role?: string | null) => {
    const n = name.trim();
    const r = String(role || '').toLowerCase();
    if (!n || n === 'Система' || r === 'system') return false;
    if (n === 'Сотрудник' || n === 'Клиент') return false;
    return true;
  };

  /** Запись истории относится к типу тоста (не путаем автора чужого поля). */
  const historyRowMatchesNotif = (row: any, type: OrderNotifType): boolean => {
    const field = String(row?.field_name || '').trim();
    const action = String(row?.action || '');
    if (type === 'new') {
      return action.includes('Создал заявку');
    }
    if (type === 'volume') return field === 'volume';
    if (type === 'grade') return field === 'grade';
    // Не путать со «статус миксера» в истории рейсов.
    if (type === 'status') {
      return field === 'status' || action.includes('статус заявки');
    }
    if (type === 'datetime') {
      return field === 'delivery_date' || field === 'delivery_time';
    }
    return false;
  };

  type ActorResolve =
    | { kind: 'human'; name: string }
    | { kind: 'system' }
    | { kind: 'none' };

  /**
   * Автор изменения из истории заявки.
   * История пишется сразу после UPDATE — поэтому короткие ретраи.
   * Берём только запись по нужному полю; «Система» = автосмена.
   */
  const resolveOrderActor = async (
    orderId: string | number,
    type: OrderNotifType,
  ): Promise<ActorResolve> => {
    const delays = [80, 200, 400, 700];
    for (const delay of delays) {
      await new Promise((r) => setTimeout(r, delay));
      try {
        const res = await fetch(`/api/adminCifra/order-history?orderId=${orderId}&_t=${Date.now()}`);
        if (!res.ok) continue;
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) continue;

        for (const row of rows) {
          if (!historyRowMatchesNotif(row, type)) continue;
          const name = String(row?.user_name || '').trim();
          const role = String(row?.user_role || '').toLowerCase();
          const action = String(row?.action || '');
          if (name === 'Система' || role === 'system' || action.startsWith('Автоматически')) {
            return { kind: 'system' };
          }
          if (isUsableActorName(name, row?.user_role)) {
            return { kind: 'human', name };
          }
        }
      } catch {
        /* ретрай */
      }
    }
    return { kind: 'none' };
  };

  const showVisualNotification = async (
    type: OrderNotifType,
    orderData?: any,
    oldData?: any,
  ) => {
    const orderId = orderData?.id || '—';

    const formatDate = (dateStr: string) => {
      if (!dateStr) return '';
      // YYYY-MM-DD без времени — парсим как локальную дату, иначе UTC сдвигает день.
      const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
      const date = m
        ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
        : new Date(dateStr);
      if (Number.isNaN(date.getTime())) return '';
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    };

    let actor: ActorResolve = { kind: 'none' };
    if (orderId !== '—') {
      actor = await resolveOrderActor(orderId, type);
    }
    if (actor.kind === 'none' && type === 'new') {
      const curator = String(orderData?.curator_name || '').trim();
      if (isUsableActorName(curator)) actor = { kind: 'human', name: curator };
    }

    const who = actor.kind === 'human' ? actor.name : '';
    const created = who ? ruPastByName(who, 'создал', 'создала') : 'создал';
    const changed = who ? ruPastByName(who, 'изменил', 'изменила') : 'изменил';

    let title = '';
    let message = '';
    let icon: NotifIconKey = 'package';

    if (type === 'new') {
      icon = 'package';
      title = who ? `${who} ${created} заявку` : 'Новая заявка';
      const deliveryStr = formatDate(orderData?.delivery_date);
      message = `№${orderId} — ${orderData?.grade || ''} — ${orderData?.volume || ''} м³`;
      if (deliveryStr) message += ` — на ${deliveryStr}`;
    } else if (type === 'status') {
      const statusMap: Record<string, string> = {
        new: 'Новая',
        NEW: 'Новая',
        processing: 'В работе',
        completed: 'Выполнена',
        cancelled: 'Отменена',
      };
      const statusIcon: Record<string, NotifIconKey> = {
        new: 'package',
        processing: 'play',
        completed: 'check',
        cancelled: 'cancel',
      };
      const rawStatus = (orderData?.status || '').toString().toLowerCase();
      icon = statusIcon[rawStatus] || 'refresh';
      const statusText = statusMap[rawStatus] || orderData?.status || '—';
      if (actor.kind === 'system') {
        // Автозавершение при разгрузке всех рейсов и др. системные смены статуса
        title =
          rawStatus === 'completed'
            ? 'Заявка выполнена автоматически'
            : rawStatus === 'cancelled'
              ? 'Заявка отменена автоматически'
              : 'Статус изменён автоматически';
      } else if (who) {
        title = `${who} ${changed} статус`;
      } else {
        title = 'Статус изменён';
      }
      message = `Заявка №${orderId} → ${statusText}`;
    } else if (type === 'volume') {
      icon = 'package';
      title = who ? `${who} ${changed} объём` : 'Изменён объём';
      message = `Заявка №${orderId} — было ${oldData?.volume || '?'} → стало ${orderData?.volume} м³`;
    } else if (type === 'datetime') {
      icon = 'clock';
      title = who ? `${who} ${changed} дату и время` : 'Изменены дата и время';
      const deliveryStr = formatDate(orderData?.delivery_date);
      const timeStr = orderData?.delivery_time ? formatTimeHHMM(orderData.delivery_time) : '';
      message = `Заявка №${orderId}`;
      if (deliveryStr) message += ` — ${deliveryStr}`;
      if (timeStr) message += ` ${timeStr}`;
    } else if (type === 'grade') {
      icon = 'refresh';
      const oldGrade = String(oldData?.grade ?? '').trim() || '—';
      const newGrade = String(orderData?.grade ?? '').trim() || '—';
      title = who ? `${who} ${changed} марку` : 'Изменена марка';
      message = `Заявка №${orderId} — ${oldGrade} → ${newGrade}`;
      if (orderData?.volume != null && orderData?.volume !== '') {
        message += ` · ${orderData.volume} м³`;
      }
    }

    // Сохраняем в localStorage — переживёт перезагрузку страницы
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    savePersistedNotif({ id, icon, title, message, timestamp: Date.now() });

    playNotificationSound();
    createToastRef.current?.(id, icon, title, message);
  };

  // ==================== 4.3 HEARTBEAT — активность для «Кто в онлайн» ====================
  // Тот же хук, что в /mobile — иначе с телефона сотрудник не виден в онлайн.
  useStaffHeartbeat(!!userRole && userRole !== 'guest');

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
      void showVisualNotification('new', order);
    },
    onStatusChange: (order) => {
      void showVisualNotification('status', order);
    },
    onVolumeChange: (order, oldOrder) => {
      void showVisualNotification('volume', order, oldOrder);
    },
    onDateTimeChange: (order) => {
      void showVisualNotification('datetime', order);
    },
    onGradeChange: (order, oldOrder) => {
      void showVisualNotification('grade', order, oldOrder);
    },
  });

  // Тост: новый комментарий сотрудника к заявке (не показываем автору).
  // Лаборант не получает: у него только «Лаборатория», заявок не видит.
  useRealtimeBroadcast({
    topic: 'order_comments:all',
    enabled: !!userRole && staffRoles.includes(userRole),
    onInsert: (record) => {
      if (!record || record.is_deleted) return;
      const myId = Number(localStorage.getItem('userId') || 0);
      if (myId && Number(record.user_id) === myId) return;

      const orderId = record.order_id;
      const author = record.user_name || 'Сотрудник';
      const preview = String(record.body || '').slice(0, 100);
      // Стабильный id — без Date.now(), чтобы не плодить дубли после reconnect
      // и чтобы тост пережил обновление страницы (как заявки/лиды).
      const id = `comment-${record.id}`;
      const title = `Комментарий к заявке #${orderId}`;
      const message = `от: ${author}${preview ? ` — ${preview}` : ''}`;
      const href = `/adminCifra/zayavki?orderId=${orderId}&tab=comments`;

      savePersistedNotif({
        id,
        icon: 'package',
        title,
        message,
        timestamp: Date.now(),
        href,
        tone: 'comment',
      });

      // Уже висит в DOM (повторный broadcast) — не дублируем
      if (document.querySelector(`[data-notif-id="${id}"]`)) return;

      playNotificationSound();
      createToastRef.current?.(id, 'package', title, message, href, 'comment');
    },
  });

  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  useEffect(() => {
    const id = Number(localStorage.getItem('userId') || 0);
    setCurrentUserId(Number.isFinite(id) && id > 0 ? id : null);
  }, [userRole, roleLoading]);

  const showLeadToast = (
    id: string,
    title: string,
    message: string,
    href: string,
  ) => {
    savePersistedNotif({
      id,
      icon: 'package',
      title,
      message,
      timestamp: Date.now(),
      href,
      tone: 'lead',
    });
    playNotificationSound();
    createToastRef.current?.(id, 'package', title, message, href, 'lead');
  };

  useLeadChangeNotifications({
    // Тосты по лидам — только у ролей с доступом к «Продажи».
    enabled: !!userRole && canAccessSales(userRole),
    currentUserId,
    onTakeRequired: (lead) => {
      setNewLeadsCount((prev) => prev + 1);
      const preview = (lead.raw_text || lead.phone || 'Новый лид').slice(0, 160);
      showLeadToast(
        `lead-take-${lead.id}-${Date.now()}`,
        `Вам необходимо взять лид №${lead.id} в работу!`,
        preview,
        `/adminCifra/leads?leadId=${lead.id}`,
      );
    },
    onNewLead: (lead) => {
      setNewLeadsCount((prev) => prev + 1);
      // Жёлтый тост лида (крупнее текст) — отдельно от зелёных заявок.
      const sourceLabel = LEAD_SOURCE_LABEL[lead.source] || lead.source;
      const clientName = (lead.name || '').trim();
      const isAvito = lead.source === 'avito';
      const avitoPreview = isAvito
        ? sanitizeAvitoMessageText(lead.raw_text) || 'Откройте чат в Авито'
        : '';
      const preview = (
        isAvito ? avitoPreview : lead.raw_text || lead.phone || 'Без текста'
      ).slice(0, 160);
      const payload =
        lead.raw_payload && typeof lead.raw_payload === 'object' ? lead.raw_payload : {};
      const actorName = String(
        (payload as Record<string, unknown>).created_by_name
          ?? (payload as Record<string, unknown>).createdByName
          ?? '',
      ).trim();

      let title: string;
      if (lead.source === 'demand' && actorName) {
        const verb = ruPastByName(actorName, 'одобрил', 'одобрила');
        title = `${actorName} ${verb} лид · ${sourceLabel}`;
      } else if ((lead.source === 'manual' || lead.source === 'tender' || lead.source === 'site') && actorName) {
        const verb = ruPastByName(actorName, 'создал', 'создала');
        title = `${actorName} ${verb} лид`;
      } else if (isAvito) {
        title = clientName
          ? `${clientName} · сообщение в Авито`
          : 'Новое сообщение · Авито';
      } else {
        title = `Новый лид · ${sourceLabel}`;
      }

      const href = isAvito
        ? lead.chat_url || '/adminCifra/demand?status=new'
        : '/adminCifra/leads';
      showLeadToast(`lead-${lead.id}`, title, preview, href);
    },
  });

  useDemandChangeNotifications({
    enabled: !!userRole && canAccessSales(userRole),
    onNewDemand: (item) => {
      setNewDemandCount((prev) => prev + 1);
      const isAvito = item.source === 'avito';
      let previewRaw = item.body || '';
      // Убираем служебную строку «От: …» и paywall Авито из превью.
      previewRaw = previewRaw
        .replace(/^От:\s*[^\n]+\n*/i, '')
        .replace(/\n*Объявление:\s*[^\n]+$/i, '')
        .trim();
      const preview = (
        isAvito
          ? sanitizeAvitoMessageText(previewRaw) ||
            (item.title.includes('·')
              ? `По объявлению: ${item.title.replace(/^Авито\s*·\s*/i, '').trim()}`
              : 'Откройте чат в Авито')
          : previewRaw || item.title || 'Новый спрос'
      ).slice(0, 160);
      const title = isAvito
        ? item.title.includes('·')
          ? `${item.title.replace(/^Авито\s*·\s*/i, '').trim() || 'Клиент'} · запрос в Авито`
          : 'Новый запрос · Авито'
        : `Новый спрос · ${item.source}`;
      const chatUrl =
        item.raw_payload && typeof item.raw_payload.chat_url === 'string'
          ? item.raw_payload.chat_url
          : null;
      showLeadToast(
        `demand-${item.id}`,
        title,
        preview,
        chatUrl || '/adminCifra/demand?status=new',
      );
    },
  });

  // ==================== 6. СБРОС СЧЁТЧИКА ====================
  useEffect(() => {
    if (pathname === '/adminCifra/zayavki') {
      setNewOrdersCount(0);
    }
    if (pathname?.startsWith('/adminCifra/leads')) {
      setNewLeadsCount(0);
    }
    if (pathname?.startsWith('/adminCifra/demand')) {
      setNewDemandCount(0);
    }
  }, [pathname]);

  // ==================== 6.0 ОГРАНИЧЕНИЕ ДОСТУПА ПО РОЛЯМ ====================
  // Лаборант — только «Лаборатория».
  // Оператор / лаборант — без раздела «Продажи» (прямые ссылки тоже режем).
  useEffect(() => {
    if (!userRole || !pathname) return;
    if (userRole === 'laborant' && pathname !== '/adminCifra/recipes') {
      router.replace('/adminCifra/recipes');
      return;
    }
    if (!canAccessSales(userRole) && isSalesPath(pathname)) {
      router.replace(
        userRole === 'laborant'
          ? '/adminCifra/recipes'
          : userRole === 'operator'
            ? '/adminCifra/operator'
            : '/adminCifra/dashboard',
      );
    }
  }, [userRole, pathname, router]);

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
    if (!(await appConfirm(
      'Вы уверены, что хотите выкинуть ВСЕХ сотрудников?\n\nОни будут вынуждены заново ввести пароль.',
      { title: 'Выкинуть всех', okLabel: 'Выкинуть', variant: 'danger' },
    ))) {
      return;
    }

    try {
      const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
      if (!userId) {
        alert('Сессия не найдена — войди заново');
        return;
      }

      const res = await fetch('/api/adminCifra/force-logout-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({}),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        alert(`✅ Выкинуто сотрудников: ${data.kicked ?? 'все'}. Ты остаёшься в системе.`);
      } else {
        alert('Ошибка: ' + (data.message || `HTTP ${res.status}`));
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
  const isFrameLayout = pathname === '/adminCifra/dashboard' || pathname === '/adminCifra/zayavki' || pathname === '/adminCifra/operator' || pathname === '/adminCifra/mixers' || pathname === '/adminCifra/tasks' || pathname === '/adminCifra/clients';
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
            // padding только сверху — низ отдаём подвалу, иначе при content-box
            // height:100% + padding снизу выталкивает футер за overflow:hidden
            // (масштаб layout) и строка «Трейдком / v…» пропадает с экрана.
            padding: '20px 0 0',
            boxSizing: 'border-box',
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
              onClick={() => realtimeStatus !== 'SUBSCRIBED' && reconnectAllBroadcastChannels()}
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
                  {realtimeStatus === 'SUBSCRIBED' ? 'Уведомления' :
                   realtimeStatus === 'CONNECTING' ? 'Подключение...' :
                   'Нет связи — кликни'}
                </span>
              )}
            </div>
          )}

          <nav style={{ flex: 1, paddingLeft: '8px', paddingRight: '8px', overflowY: 'auto', minHeight: 0 }}>

            {/* ==================== БЛОК 9.5: ЛАБОРАНТ — ТОЛЬКО «ЛАБОРАТОРИЯ» ==================== */}
            {userRole === 'laborant' ? (
              <Link href="/adminCifra/recipes" style={navLinkStyle(isActive('/adminCifra/recipes'), isCollapsed)}>
                <FlaskConical size={22} />
                <span style={navTextStyle(isCollapsed)}>Лаборатория</span>
              </Link>
            ) : (
            <>
            <Link href="/adminCifra/dashboard" style={navLinkStyle(isActive('/adminCifra/dashboard'), isCollapsed)}>
              <Home size={22} />
              <span style={navTextStyle(isCollapsed)}>Диспетчерская</span>
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

            {/* ==================== ПРОДАЖИ: без operator / laborant ==================== */}
            {canAccessSales(userRole) && (
            <>
            <div ref={salesMenuRef} style={{ position: 'relative', marginBottom: 4 }}>
              <button
                ref={salesButtonRef}
                type="button"
                title={isCollapsed ? 'Продажи' : undefined}
                aria-expanded={salesMenuOpen}
                aria-haspopup="menu"
                onClick={() => setSalesMenuOpen((v) => !v)}
                style={{
                  ...navLinkStyle(isSalesSection, isCollapsed),
                  width: '100%',
                  cursor: 'pointer',
                  marginBottom: 0,
                  // Не использовать shorthand `font` вместе с fontWeight из navLinkStyle
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                  lineHeight: 'inherit',
                  textAlign: 'left',
                  position: 'relative',
                }}
              >
                <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                  <Megaphone size={22} />
                  {isCollapsed && salesBadgeCount > 0 && (
                    <span
                      aria-label={`Новых: ${salesBadgeCount}`}
                      style={{
                        position: 'absolute',
                        top: -6,
                        right: -8,
                        minWidth: 16,
                        height: 16,
                        padding: '0 4px',
                        borderRadius: 9999,
                        background: '#EAB308',
                        color: '#0F172A',
                        fontSize: 10,
                        fontWeight: 800,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 0 0 2px #0F172A',
                      }}
                    >
                      {salesBadgeCount > 99 ? '99+' : salesBadgeCount}
                    </span>
                  )}
                </span>
                <span style={{ ...navTextStyle(isCollapsed), flex: isCollapsed ? undefined : 1 }}>
                  Продажи
                </span>
                {!isCollapsed && salesBadgeCount > 0 && (
                  <span
                    aria-label={`Новых: ${salesBadgeCount}`}
                    style={{
                      minWidth: 20,
                      height: 20,
                      padding: '0 6px',
                      borderRadius: 9999,
                      background: '#EAB308',
                      color: '#0F172A',
                      fontSize: 12,
                      fontWeight: 800,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginRight: 4,
                    }}
                  >
                    {salesBadgeCount > 99 ? '99+' : salesBadgeCount}
                  </span>
                )}
                {!isCollapsed && (
                  <ChevronDown
                    size={16}
                    style={{
                      marginLeft: 4,
                      flexShrink: 0,
                      opacity: 0.85,
                      transform: salesMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                )}
              </button>

              {/* Развёрнутый сайдбар — дерево подпунктов */}
              {!isCollapsed && salesMenuOpen && (
                <div
                  style={{
                    marginTop: 4,
                    marginBottom: 2,
                    marginLeft: 18,
                    padding: '2px 0',
                  }}
                >
                  {SALES_SUBMENU.filter((item) => salesMenuItemVisible(item, userRole)).map(
                    (item, idx, arr) => {
                      const active = isActive(item.href);
                      const Icon = item.icon;
                      const isLast = idx === arr.length - 1;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => {
                            if (item.href === '/adminCifra/leads') setNewLeadsCount(0);
                            if (item.href === '/adminCifra/demand') setNewDemandCount(0);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0,
                            textDecoration: 'none',
                            padding: '0 10px 0 0',
                            marginBottom: isLast ? 0 : 2,
                            color: active ? ACCENT : '#CBD5E1',
                            fontSize: 14,
                            fontWeight: active ? 600 : 500,
                            borderRadius: 10,
                            transition: 'background-color 0.15s, color 0.15s',
                          }}
                        >
                          {/* Вертикаль дерева + «уголок» */}
                          <span
                            aria-hidden
                            style={{
                              position: 'relative',
                              width: 22,
                              alignSelf: 'stretch',
                              flexShrink: 0,
                              marginLeft: 10,
                            }}
                          >
                            {/* линия вниз (кроме последнего) */}
                            <span
                              style={{
                                position: 'absolute',
                                left: 7,
                                top: 0,
                                bottom: isLast ? '50%' : 0,
                                width: 2,
                                background: 'rgba(148, 163, 184, 0.35)',
                                borderRadius: 1,
                              }}
                            />
                            {/* горизонталь к пункту */}
                            <span
                              style={{
                                position: 'absolute',
                                left: 7,
                                top: '50%',
                                width: 12,
                                height: 2,
                                marginTop: -1,
                                background: active
                                  ? 'rgba(74, 222, 128, 0.65)'
                                  : 'rgba(148, 163, 184, 0.35)',
                                borderRadius: 1,
                              }}
                            />
                            {/* узел */}
                            <span
                              style={{
                                position: 'absolute',
                                left: 3,
                                top: '50%',
                                width: 10,
                                height: 10,
                                marginTop: -5,
                                borderRadius: '50%',
                                background: active ? ACCENT : '#334155',
                                border: active
                                  ? '2px solid rgba(74, 222, 128, 0.45)'
                                  : '2px solid rgba(148, 163, 184, 0.4)',
                                boxSizing: 'border-box',
                                zIndex: 1,
                              }}
                            />
                          </span>
                          <span
                            style={{
                              flex: 1,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '9px 10px',
                              minWidth: 0,
                              // Без фона/рамки: активный подпункт — только зелёная точка и текст
                            }}
                          >
                            <Icon
                              size={17}
                              style={{
                                flexShrink: 0,
                                opacity: active ? 1 : 0.75,
                                color: active ? ACCENT : '#94A3B8',
                              }}
                            />
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                color: active ? ACCENT : '#CBD5E1',
                                fontWeight: active ? 600 : 500,
                              }}
                            >
                              {item.label}
                            </span>
                            {item.href === '/adminCifra/leads' && newLeadsCount > 0 && (
                              <span
                                aria-label={`Новых лидов: ${newLeadsCount}`}
                                style={{
                                  minWidth: 18,
                                  height: 18,
                                  padding: '0 5px',
                                  borderRadius: 9999,
                                  background: '#EAB308',
                                  color: '#0F172A',
                                  fontSize: 11,
                                  fontWeight: 800,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                  marginLeft: 'auto',
                                }}
                              >
                                {newLeadsCount > 99 ? '99+' : newLeadsCount}
                              </span>
                            )}
                            {item.href === '/adminCifra/demand' && newDemandCount > 0 && (
                              <span
                                aria-label={`Новый спрос: ${newDemandCount}`}
                                style={{
                                  minWidth: 18,
                                  height: 18,
                                  padding: '0 5px',
                                  borderRadius: 9999,
                                  background: '#EAB308',
                                  color: '#0F172A',
                                  fontSize: 11,
                                  fontWeight: 800,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                  marginLeft: 'auto',
                                }}
                              >
                                {newDemandCount > 99 ? '99+' : newDemandCount}
                              </span>
                            )}
                          </span>
                        </Link>
                      );
                    },
                  )}
                </div>
              )}
            </div>

            {/* Свёрнутый сайдбар — portal в body, иначе overflow:hidden сайдбара обрезает панель */}
            {typeof document !== 'undefined' &&
              isCollapsed &&
              salesMenuOpen &&
              salesFlyoutPos &&
              createPortal(
                <div
                  ref={salesFlyoutRef}
                  role="menu"
                  style={{
                    position: 'fixed',
                    top: salesFlyoutPos.top,
                    left: salesFlyoutPos.left,
                    zIndex: 10050,
                    minWidth: 180,
                    padding: 8,
                    borderRadius: 14,
                    background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 100%)',
                    border: '1px solid rgba(148, 163, 184, 0.28)',
                    boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
                  }}
                >
                  <div style={{
                    color: '#94A3B8',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    padding: '4px 10px 8px',
                  }}>
                    Продажи
                  </div>
                  {SALES_SUBMENU.filter((item) => salesMenuItemVisible(item, userRole)).map((item) => {
                    const active = isActive(item.href);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        onClick={() => {
                          setSalesMenuOpen(false);
                          if (item.href === '/adminCifra/leads') setNewLeadsCount(0);
                          if (item.href === '/adminCifra/demand') setNewDemandCount(0);
                        }}
                        style={{
                          ...navLinkStyle(active, false),
                          padding: '10px 12px',
                          fontSize: 14,
                          marginBottom: 2,
                        }}
                      >
                        <Icon size={18} />
                        <span style={{ paddingLeft: 12, flex: 1 }}>{item.label}</span>
                        {item.href === '/adminCifra/leads' && newLeadsCount > 0 && (
                          <span
                            style={{
                              minWidth: 18,
                              height: 18,
                              padding: '0 5px',
                              borderRadius: 9999,
                              background: '#EAB308',
                              color: '#0F172A',
                              fontSize: 11,
                              fontWeight: 800,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {newLeadsCount > 99 ? '99+' : newLeadsCount}
                          </span>
                        )}
                        {item.href === '/adminCifra/demand' && newDemandCount > 0 && (
                          <span
                            style={{
                              minWidth: 18,
                              height: 18,
                              padding: '0 5px',
                              borderRadius: 9999,
                              background: '#EAB308',
                              color: '#0F172A',
                              fontSize: 11,
                              fontWeight: 800,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {newDemandCount > 99 ? '99+' : newDemandCount}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>,
                document.body,
              )}
            </>
            )}

            {/* ==================== БЛОК 11: ОГРАНИЧЕНИЕ МЕНЮ ==================== */}
            {userRole === 'operator' ? (
              <Link href="/adminCifra/operator" style={navLinkStyle(isActive('/adminCifra/operator'), isCollapsed)}>
                <UserCog size={22} />
                <span style={navTextStyle(isCollapsed)}>Оператор БСУ</span>
              </Link>
            ) : (
              <>
                <Link href="/adminCifra/recipes" style={navLinkStyle(isActive('/adminCifra/recipes'), isCollapsed)}>
                  <FlaskConical size={22} />
                  <span style={navTextStyle(isCollapsed)}>Лаборатория</span>
                </Link>

                <Link href="/adminCifra/mixers" style={navLinkStyle(isActive('/adminCifra/mixers'), isCollapsed)}>
                  <Truck size={22} />
                  <span style={navTextStyle(isCollapsed)}>Миксеры</span>
                </Link>

                <Link href="/adminCifra/clients" style={navLinkStyle(isActive('/adminCifra/clients'), isCollapsed)}>
                  <Users size={22} />
                  <span style={navTextStyle(isCollapsed)}>Клиенты</span>
                </Link>

                {/* Операционка: поручения сотрудникам (не путать с Лидами в «Продажи») */}
                <Link href="/adminCifra/tasks" style={navLinkStyle(isActive('/adminCifra/tasks'), isCollapsed)}>
                  <CheckCircle size={22} />
                  <span style={navTextStyle(isCollapsed)}>Задачи</span>
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

                {/*
                  =====================================================================
                  AUDIT KEEP — НЕ УДАЛЯТЬ пункт «Вывод баллов» и страницу /adminCifra/withdrawals.
                  Скрыто из меню по запросу (временно не используем UI), страница оставлена —
                  позже снова включим в меню. Сам маршрут и page.tsx должны остаться в проекте.
                  =====================================================================
                {(userRole === 'admin') && (
                  <Link href="/adminCifra/withdrawals" style={navLinkStyle(isActive('/adminCifra/withdrawals'), isCollapsed)}>
                    <DollarSign size={22} />
                    <span style={navTextStyle(isCollapsed)}>Вывод баллов</span>
                  </Link>
                )}
                */}
              </>
            )}
            </>
            )}

            {/* ==================== БЛОК 13.1 ЛИЧНЫЙ ВЫХОД ==================== */}
            <Link
              href="#"
              onClick={async (e) => {
                e.preventDefault();
                if (await appConfirm('Выйти из системы?', { title: 'Выход', okLabel: 'Выйти' })) logout();
              }}
              style={navLinkStyle(false, isCollapsed)}
            >
              <LogOut size={22} />
              <span style={navTextStyle(isCollapsed)}>Выйти</span>
            </Link>
          </nav>

          {/* ==================== ПОДВАЛ САЙДБАРА ==================== */}
          <div
            style={{
              marginTop: 'auto',
              padding: isCollapsed ? '10px 6px 12px' : '10px 14px 12px',
              borderTop: '1px solid #334155',
              display: 'flex',
              flexDirection: 'column',
              alignItems: isCollapsed ? 'center' : 'stretch',
              gap: 8,
              flexShrink: 0,
              boxSizing: 'border-box',
            }}
          >
            {userRole !== 'laborant' && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: isCollapsed ? 'center' : 'flex-start',
                  flexWrap: 'wrap',
                  gap: 4,
                }}
              >
                <button
                  type="button"
                  onClick={goToMobileVersion}
                  title="Мобильная версия"
                  aria-label="Мобильная версия"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: isCollapsed ? 6 : '4px 8px',
                    borderRadius: 8,
                    border: '1px solid transparent',
                    background: 'transparent',
                    color: '#94A3B8',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 500,
                    lineHeight: 1,
                    transition: 'color 0.15s, background 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#E2E8F0';
                    e.currentTarget.style.background = 'rgba(148,163,184,0.1)';
                    e.currentTarget.style.borderColor = '#475569';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#94A3B8';
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = 'transparent';
                  }}
                >
                  <Smartphone size={14} strokeWidth={1.75} />
                  {!isCollapsed && <span>Мобильная</span>}
                </button>
                {userRole === 'admin' && !isCollapsed && (
                  <button
                    type="button"
                    onClick={() => { void forceLogoutAll(); }}
                    title="Разлогинить всех"
                    aria-label="Разлогинить всех"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '4px 8px',
                      borderRadius: 8,
                      border: '1px solid transparent',
                      background: 'transparent',
                      color: '#94A3B8',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 500,
                      lineHeight: 1,
                      transition: 'color 0.15s, background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#E2E8F0';
                      e.currentTarget.style.background = 'rgba(148,163,184,0.1)';
                      e.currentTarget.style.borderColor = '#475569';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = '#94A3B8';
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = 'transparent';
                    }}
                  >
                    <UserX size={14} strokeWidth={1.75} />
                    <span>Разлогинить всех</span>
                  </button>
                )}
              </div>
            )}
            {!isCollapsed ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 10,
                  lineHeight: 1.2,
                  letterSpacing: '0.01em',
                  minWidth: 0,
                }}
              >
                <span style={{ color: '#94A3B8', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  © ООО «Трейдком»
                </span>
                <span
                  style={{
                    color: '#94A3B8',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    textAlign: 'right',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                  }}
                  title={formatBuildLabelFull()}
                >
                  {formatBuildVersion()}
                </span>
              </div>
            ) : (
              <div
                title={`ООО «Трейдком» · ${formatBuildLabelFull()}`}
                style={{
                  fontSize: 10,
                  color: '#94A3B8',
                  textAlign: 'center',
                  lineHeight: 1.2,
                  fontWeight: 500,
                }}
              >
                {formatBuildVersion()}
              </div>
            )}
          </div>
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
      <AppDialogHost />
    </div>
  );
}

// Подменю блока «Продажи» (лиды / Авито / спрос / интеграции)
const SALES_SUBMENU = [
  { href: '/adminCifra/leads', label: 'Лиды', icon: Inbox },
  { href: '/adminCifra/marketplace', label: 'Площадки', icon: Store },
  { href: '/adminCifra/demand', label: 'Спрос', icon: Radar },
  { href: '/adminCifra/callout', label: 'Обзвон', icon: Megaphone },
  {
    href: '/adminCifra/integrations',
    label: 'Интеграции',
    icon: Cable,
    /** Только admin и manager (секреты — admin на самой странице). */
    roles: ['admin', 'manager'] as const,
  },
] as const;

function salesMenuItemVisible(
  item: (typeof SALES_SUBMENU)[number],
  role: string | null,
): boolean {
  if (!('roles' in item) || !item.roles) return true;
  if (!role) return false;
  return (item.roles as readonly string[]).includes(role);
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