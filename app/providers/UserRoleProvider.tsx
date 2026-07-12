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

const UserRoleContext = createContext<UserRoleContextType | undefined>(undefined);

export function UserRoleProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
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

      const res = await fetch('/api/user/role', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': savedUserId,
        },
        body: JSON.stringify({}),
        cache: 'no-store',
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setUser(data);
      setError(null);

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
      // недоступен (перезапуск дев-сервера, потеря сети, уход со страницы) —
      // это не ошибка приложения, а обычный сетевой сбой. Следующий тик
      // интервала/возврат на вкладку всё исправит сам, поэтому не шумим в
      // консоль на каждый такой случай — предупреждаем только на реальные
      // ошибки API (не-network, например неожиданный HTTP-статус).
      if (!(err instanceof TypeError)) {
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
    fetchRole();

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