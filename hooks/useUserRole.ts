// app/hooks/useUserRole.ts
import { useState, useEffect } from 'react';

export interface UserRole {
  role: string;
  full_name: string;
  username: string;
  force_logout_version?: number;
}

export function useUserRole() {
  const [user, setUser] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchRole = async () => {
      try {
        setLoading(true);

        const savedUserId = localStorage.getItem('userId');
        if (!savedUserId) {
          if (isMounted) setUser(null);
          return;
        }

        const res = await fetch('/api/user/role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: parseInt(savedUserId) }),
          cache: 'no-store'
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        
        if (isMounted) {
          setUser(data);
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) {
          console.warn('Role fetch error:', err);
          setError(err.message);
          setUser(null);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchRole(); // только один раз при монтировании

    // Проверка force logout — раз в 10 часов (не чаще!)
    const interval = setInterval(() => {
      const savedUserId = localStorage.getItem('userId');
      if (savedUserId) fetchRole();
    }, 36_000_000); // 10 часов

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  return { 
    user, 
    loading, 
    error, 
    isAdmin: user?.role === 'admin' 
  };
}