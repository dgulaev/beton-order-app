'use client';

import { createContext, useContext, ReactNode, useEffect, useState, useCallback, useRef } from 'react';
import { FORCE_LOGOUT_CHECK_EVENT } from '@/hooks/useStaffHeartbeat';
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, isFetchTimeoutError } from '@/lib/fetchWithTimeout';

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
  /** Сразу применить сессию после admin-login (без ожидания /api/user/role). */
  applyLoginSession: (session: UserRole) => void;
  logout: () => void;
}

// Проверка force-logout: при возврате на вкладку + poll.
// 5 мин — функция «разлогинить всех» применяется редко; при возврате
// на вкладку проверка всё равно срабатывает сразу.
const FORCE_LOGOUT_POLL_MS = 5 * 60_000;

// Таймаут role — см. lib/fetchWithTimeout (Samsung мог крутить полоску 60–70 с).
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
  /** Инкремент при новом fetch — старый ответ не должен перезаписать свежий логин. */
  const fetchGenRef = useRef(0);

  const fetchRole = useCallback(async (
    force = false,
    opts?: { urgent?: boolean; bypassInFlight?: boolean },
  ) => {
    // Схлопываем гонки: visibility + poll + ручной refresh в одну секунду
    // иначе в логе пачка POST /api/user/role подряд.
    // urgent / bypassInFlight (после логина) — debounce и схлопывание не применяем.
    const now = Date.now();
    const bypass = !!(opts?.urgent || opts?.bypassInFlight);
    if (!bypass && inFlightRef.current) return inFlightRef.current;
    if (force && !bypass && now - lastFetchAtRef.current < 1500) return;

    const myGen = ++fetchGenRef.current;

    const run = (async () => {
      try {
        if (!force) setLoading(true);

        const savedUserId = localStorage.getItem('userId');
        if (!savedUserId) {
          if (myGen === fetchGenRef.current) {
            setUser(null);
            setLoading(false);
          }
          return;
        }

        lastFetchAtRef.current = Date.now();
        const res = await fetchWithTimeout('/api/user/role', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': savedUserId,
          },
          body: JSON.stringify({}),
          cache: 'no-store',
          timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
        });

        // Уже ушёл более новый fetch (логин / urgent) — ответ устарел
        if (myGen !== fetchGenRef.current) return;

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (myGen !== fetchGenRef.current) return;
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

        const session: UserRole = {
          role: data.role,
          full_name: data.full_name,
          username: data.username || data.full_name || '',
          force_logout_version: currentVersion,
          can_process_tenders: data.can_process_tenders === true,
        };
        setUser(session);
        setError(null);
        try {
          localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(session));
        } catch {
          // localStorage может быть недоступен (приватный режим) — не критично.
        }

        localStorage.setItem('lastForceLogoutVersion', String(currentVersion));
      } catch (err: any) {
        if (myGen !== fetchGenRef.current) return;
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
        const isTransient =
          err instanceof TypeError
          || err?.name === 'AbortError'
          || isFetchTimeoutError(err);
        if (!isTransient) {
          console.warn('Role fetch error:', err);
          setError(err?.message || 'Role check failed');
        }
      } finally {
        if (myGen === fetchGenRef.current) {
          setLoading(false);
          inFlightRef.current = null;
        }
      }
    })();

    inFlightRef.current = run;
    return run;
  }, []);

  const applyLoginSession = useCallback((session: UserRole) => {
    // Инвалидируем любой in-flight /api/user/role, стартовавший до логина
    // (иначе старый ответ мог затереть только что вошедшего пользователя).
    fetchGenRef.current += 1;
    inFlightRef.current = null;
    lastFetchAtRef.current = 0;
    setUser(session);
    setLoading(false);
    setError(null);
    try {
      localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(session));
    } catch {
      /* ignore */
    }
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
    void fetchRole(true, { bypassInFlight: true });
  }, [fetchRole]);

  return (
    <UserRoleContext.Provider
      value={{
        user,
        loading,
        error,
        isAdmin: (user?.role || '').toLowerCase() === 'admin',
        refreshRole,
        applyLoginSession,
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
