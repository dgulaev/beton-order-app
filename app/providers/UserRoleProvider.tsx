'use client';

import { createContext, useContext, ReactNode, useEffect, useState, useCallback, useRef } from 'react';
import { FORCE_LOGOUT_CHECK_EVENT } from '@/hooks/useStaffHeartbeat';

interface UserRole {
  role: string;
  full_name: string;
  username: string;
  force_logout_version?: number;
  can_process_tenders?: boolean;
}

interface UserRoleContextType {
  user: UserRole | null;
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  refreshRole: () => void;
  logout: () => void;
}

// Проверка force-logout: при возврате на вкладку + poll.
// 5 мин — функция «разлогинить всех» применяется редко; при возврате
// на вкладку проверка всё равно срабатывает сразу.
const FORCE_LOGOUT_POLL_MS = 5 * 60_000;

// Сколько ждём ответ /api/user/role, прежде чем сдаться — без этого при
// холодном старте сервера (Vercel cold start) или плохой мобильной сети
// запрос мог "висеть" очень долго, а вместе с ним и весь экран за
// блокирующим "Загрузка..." (см. app/mobile/layout.tsx).
const ROLE_FETCH_TIMEOUT_MS = 12_000;
const ROLE_CACHE_KEY = 'userRoleCache';

const UserRoleContext = createContext<UserRoleContextType | undefined>(undefined);

/**
 * Читает последнюю известную роль из localStorage.
 *
 * ⚠️ НЕЛЬЗЯ использовать как ленивое начальное значение useState (было так
 * раньше и ломало гидратацию): при SSR/самом первом клиентском рендере
 * (до того как React "сверил" его с серверной версией) `window` уже
 * определён на клиенте, но не на сервере — та же самая функция вернёт null
 * на сервере и реальные данные на клиенте. Разное содержимое между
 * сервером и первым клиентским рендером — это ровно случай "if (typeof
 * window !== 'undefined')" из ошибки "Hydration failed...". Поэтому читаем
 * кэш только внутри useEffect (см. ниже) — эффекты гарантированно не
 * выполняются при SSR и при сверке гидратации, только после неё.
 */
function readCachedUser(): UserRole | null {
  if (typeof window === 'undefined') return null;
  try {
    const savedUserId = localStorage.getItem('userId');
    if (!savedUserId) return null;
    const cachedRaw = localStorage.getItem(ROLE_CACHE_KEY);
    return cachedRaw ? (JSON.parse(cachedRaw) as UserRole) : null;
  } catch {
    return null;
  }
}

function clearStaffSessionKeys() {
  localStorage.removeItem('userId');
  localStorage.removeItem('userPhone');
  localStorage.removeItem('userRoleCache');
}

export function UserRoleProvider({ children }: { children: ReactNode }) {
  // Начальное значение — одинаковое на сервере и при первом клиентском
  // рендере (null/true), чтобы не расходиться с SSR-версией. Кэш из
  // localStorage подхватываем чуть ниже, в самом первом useEffect — это
  // происходит сразу после маунта (доли миллисекунды), поэтому "Загрузка..."
  // мелькает практически незаметно, а не висит на время сетевого запроса.
  const [user, setUser] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastFetchAtRef = useRef(0);

  const fetchRole = useCallback(async (force = false, opts?: { urgent?: boolean }) => {
    // Схлопываем гонки: visibility + poll + ручной refresh в одну секунду
    // иначе в логе пачка POST /api/user/role подряд.
    // urgent (force-logout от heartbeat) — debounce не применяем.
    const now = Date.now();
    if (inFlightRef.current) return inFlightRef.current;
    if (force && !opts?.urgent && now - lastFetchAtRef.current < 1500) return;

    const run = (async () => {
      try {
        if (!force) setLoading(true);

        const savedUserId = localStorage.getItem('userId');
        if (!savedUserId) {
          setUser(null);
          setLoading(false);
          return;
        }

        // AbortController на Samsung Internet иногда не рвёт зависший fetch
        // (полоска «загрузки» 60–70 с). Promise.race гарантирует выход через 12 с.
        const controller = new AbortController();
        let timedOut = false;
        const timeoutId = setTimeout(() => {
          timedOut = true;
          try {
            controller.abort();
          } catch {
            /* ignore */
          }
        }, ROLE_FETCH_TIMEOUT_MS);

        lastFetchAtRef.current = Date.now();
        const fetchPromise = fetch('/api/user/role', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': savedUserId,
          },
          body: JSON.stringify({}),
          cache: 'no-store',
          signal: controller.signal,
        });
        // Поздний abort после race не должен давать UnhandledRejection.
        void fetchPromise.catch(() => {});

        const res = await Promise.race([
          fetchPromise,
          new Promise<Response>((_, reject) => {
            window.setTimeout(() => {
              timedOut = true;
              reject(new DOMException('Role fetch timeout', 'AbortError'));
            }, ROLE_FETCH_TIMEOUT_MS);
          }),
        ]).finally(() => clearTimeout(timeoutId));

        if (timedOut) throw new DOMException('Role fetch timeout', 'AbortError');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (data?.success === false) throw new Error(data?.message || 'Role check failed');

        // Проверка принудительного выхода — ДО записи кэша роли
        const currentVersion = Number(data?.force_logout_version || 0);
        const lastVersion = parseInt(localStorage.getItem('lastForceLogoutVersion') || '0', 10) || 0;

        if (currentVersion > lastVersion) {
          // Запоминаем версию kick, чтобы после логина (version=0) не было ложного
          // сравнения и чтобы повторный kick с той же константой 9999 (legacy) не
          // «залипал» при рассинхроне.
          localStorage.setItem('lastForceLogoutVersion', String(currentVersion));
          clearStaffSessionKeys();
          setUser(null);
          alert('Ваш сеанс был завершён администратором. Пожалуйста, войдите заново.');
          // Перезагружаем текущую страницу, а не уводим на "/" — layout сам
          // покажет форму входа на нужном пути (/adminCifra или /mobile).
          window.location.reload();
          return;
        }

        setUser(data);
        setError(null);
        try {
          localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(data));
        } catch {
          // localStorage может быть недоступен (приватный режим) — не критично.
        }

        localStorage.setItem('lastForceLogoutVersion', String(currentVersion));
      } catch (err: any) {
        // fetch кидает TypeError ("Failed to fetch"), когда сервер временно
        // недоступен (перезапуск дев-сервера, потеря сети, уход со страницы), а
        // AbortError — когда сами прервали запрос по таймауту (см. выше). Оба
        // случая — обычный сетевой сбой, а не ошибка приложения: следующий тик
        // интервала/возврат на вкладку всё исправит сам, поэтому не шумим в
        // консоль на каждый такой случай — предупреждаем только на реальные
        // ошибки API (не-network, например неожиданный HTTP-статус).
        // Важно: НЕ обнуляем user при сетевом сбое — если роль уже была
        // известна (из кэша или предыдущего успешного запроса), пусть
        // приложение продолжает работать с ней, а не выкидывает на экран входа.
        // И НЕ трогаем lastForceLogoutVersion при ошибке — иначе fail-open
        // мог бы «съесть» pending force-logout.
        if (!(err instanceof TypeError) && err?.name !== 'AbortError') {
          console.warn('Role fetch error:', err);
        }
        setError(err.message);
      } finally {
        setLoading(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = run;
    return run;
  }, []);

  const logout = useCallback(() => {
    clearStaffSessionKeys();
    localStorage.removeItem('lastForceLogoutVersion');
    setUser(null);
    // Перезагружаем ТЕКУЩУЮ страницу (а не уводим на "/") — сами layout'ы
    // /adminCifra и /mobile уже показывают форму входа на своём пути, когда
    // пользователь не залогинен. Раньше редирект на "/" уводил на публичный
    // лендинг вместо формы входа в админку.
    window.location.reload();
  }, []);

  // === При загрузке + при возврате на вкладку + периодически ===
  useEffect(() => {
    // Подхватываем кэш сразу после маунта (безопасно для гидратации — эффекты
    // не участвуют в сверке SSR/клиент), не дожидаясь ответа сети.
    const cached = readCachedUser();
    if (cached) {
      setUser(cached);
      setLoading(false);
    }

    fetchRole(true);

    // Проверяем роль, когда пользователь возвращается на вкладку
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchRole(true); // force = true, без лишнего loading
      }
    };

    // Heartbeat 403 (force-logout) — без синтетического visibilitychange
    const handleForceLogoutCheck = () => {
      void fetchRole(true, { urgent: true });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener(FORCE_LOGOUT_CHECK_EVENT, handleForceLogoutCheck);

    const pollInterval = setInterval(() => {
      if (localStorage.getItem('userId')) fetchRole(true);
    }, FORCE_LOGOUT_POLL_MS);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener(FORCE_LOGOUT_CHECK_EVENT, handleForceLogoutCheck);
      clearInterval(pollInterval);
    };
  }, [fetchRole]);

  const refreshRole = useCallback(() => {
    fetchRole(true);
  }, [fetchRole]);

  return (
    <UserRoleContext.Provider
      value={{
        user,
        loading,
        error,
        isAdmin: (user?.role || '').toLowerCase() === 'admin',
        refreshRole,
        logout,
      }}
    >
      {children}
    </UserRoleContext.Provider>
  );
}

export const useUserRole = () => {
  const context = useContext(UserRoleContext);
  if (context === undefined) {
    throw new Error('useUserRole must be used within UserRoleProvider');
  }
  return context;
};
