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
}

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
        window.location.href = '/';
        return;
      }

      localStorage.setItem('lastForceLogoutVersion', currentVersion.toString());

    } catch (err: any) {
      console.warn('Role fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // === ОДИН РАЗ при загрузке + проверка при возврате на вкладку ===
  useEffect(() => {
    fetchRole();

    // Проверяем роль только когда пользователь возвращается на вкладку
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchRole(true); // force = true, без лишнего loading
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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