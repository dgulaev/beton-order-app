'use client';

import { createContext, useContext, ReactNode, useEffect, useState, useCallback } from 'react';

interface UserRole {
  role: string;
  full_name: string;
  username: string;
  force_logout_version?: number;
}

interface UserRoleContextType {
  user: UserRole | null;
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  refreshRole: () => void;
  logout: () => void;
}

// Как часто проверяем force_logout_version, пока пользователь активен на
// странице (плюс проверка при возврате на вкладку и сразу после входа).
// Это лишь страховка на случай, если вкладка держится открытой и активной
// без переключений весь день (обычная проверка при возврате на вкладку
// покрывает все остальные случаи мгновенно). 1 час — достаточно редко, чтобы
// не нагружать сервер лишними запросами.
const FORCE_LOGOUT_POLL_MS = 60 * 60_000;

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

export function UserRoleProvider({ children }: { children: ReactNode }) {
  // Начальное значение — одинаковое на сервере и при первом клиентском
  // рендере (null/true), чтобы не расходиться с SSR-версией. Кэш из
  // localStorage подхватываем чуть ниже, в самом первом useEffect — это
  // происходит сразу после маунта (доли миллисекунды), поэтому "Загрузка..."
  // мелькает практически незаметно, а не висит на время сетевого запроса.
  const [user, setUser] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRole = useCallback(async (force = false) => {
    try {
      if (!force) setLoading(true);

      const savedUserId = localStorage.getItem('userId');
      if (!savedUserId) {
        setUser(null);
        setLoading(false);
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ROLE_FETCH_TIMEOUT_MS);

      const res = await fetch('/api/user/role', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': savedUserId,
        },
        body: JSON.stringify({}),
        cache: 'no-store',
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setUser(data);
      setError(null);
      try {
        localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(data));
      } catch {
        // localStorage может быть недоступен (приватный режим) — не критично.
      }

      // Проверка принудительного выхода
      const currentVersion = data?.force_logout_version || 0;
      const lastVersion = parseInt(localStorage.getItem('lastForceLogoutVersion') || '0');

      if (currentVersion > lastVersion) {
        localStorage.removeItem('userId');
        localStorage.removeItem('userPhone');
        localStorage.removeItem('userRoleCache');
        alert('Ваш сеанс был завершён администратором. Пожалуйста, войдите заново.');
        // Перезагружаем текущую страницу, а не уводим на "/" — layout сам
        // покажет форму входа на нужном пути (/adminCifra или /mobile).
        window.location.reload();
        return;
      }

      localStorage.setItem('lastForceLogoutVersion', currentVersion.toString());

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
      if (!(err instanceof TypeError) && err?.name !== 'AbortError') {
        console.warn('Role fetch error:', err);
      }
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('userId');
    localStorage.removeItem('userPhone');
    localStorage.removeItem('userRoleCache');
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

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Единая периодическая проверка force_logout_version — гарантирует, что
    // после "Разлогинить всех" сотрудник будет выкинут максимум через
    // FORCE_LOGOUT_POLL_MS, даже если не переключал вкладку. Это единственное
    // место в приложении, где выполняется такой опрос (раньше было 2-3
    // дублирующих независимых интервала в разных layout'ах).
    const pollInterval = setInterval(() => {
      if (localStorage.getItem('userId')) fetchRole(true);
    }, FORCE_LOGOUT_POLL_MS);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
        isAdmin: user?.role === 'admin',
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