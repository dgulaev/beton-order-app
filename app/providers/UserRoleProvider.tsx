'use client';

import { createContext, useContext, ReactNode, useEffect, useState } from 'react';

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

    const fetchRole = async (force = false) => {
    try {
      setLoading(true);

      // Проверка кэша (5 минут)
      if (!force) {
        const cached = localStorage.getItem('userRoleCache');
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < 300000) { // 5 минут
            setUser(data);
            setError(null);
            setLoading(false);
            return;
          }
        }
      }

      const savedUserId = localStorage.getItem('userId');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };

      if (savedUserId) {
        headers['x-user-id'] = savedUserId;
      }

      const res = await fetch('/api/user/role', {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
        cache: 'no-store'
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setUser(data);
      setError(null);

      // Сохраняем в кэш
      localStorage.setItem('userRoleCache', JSON.stringify({
        data,
        timestamp: Date.now()
      }));

    } catch (err: any) {
      console.warn('Role fetch error:', err);
      setError(err.message);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRole();
    const interval = setInterval(fetchRole, 300000);
    return () => clearInterval(interval);
  }, []);

  const refreshRole = () => fetchRole();

  return (
    <UserRoleContext.Provider value={{
      user,
      loading,
      error,
      isAdmin: user?.role === 'admin',
      refreshRole
    }}>
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