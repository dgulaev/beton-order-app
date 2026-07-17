'use client';

import { useState, useEffect } from 'react';
import { DollarSign } from 'lucide-react';

export default function WithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);

  // Загрузка userId и роли
  useEffect(() => {
    const saved = localStorage.getItem('userId');
    if (saved) {
      const uid = parseInt(saved, 10);
      setUserId(uid);

      fetch('/api/user/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid }),
      })
        .then(r => r.json())
        .then(data => setUserRole(data.role || 'client'));
    }
  }, []);

  // Функция загрузки выводов
  const loadWithdrawals = async () => {
    if (!userId) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/adminCifra/withdrawals?userId=${userId}`);
      if (res.ok) {
        const data = await res.json();
        setWithdrawals(data.withdrawals || []);
      } else {
        console.error('Ошибка загрузки выводов:', res.status);
      }
    } catch (err) {
      console.error('Ошибка fetch withdrawals:', err);
    } finally {
      setLoading(false);
    }
  };

  // Загрузка данных после определения роли
  useEffect(() => {
    if (userId && ['admin', 'manager'].includes(userRole || '')) {
      loadWithdrawals();
    }
  }, [userId, userRole]);

  // Отметить как выплачено
  const markAsPaid = async (id: number) => {
    if (!confirm('Отметить как выплачено?')) return;

    try {
      const res = await fetch('/api/adminCifra/withdrawals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'completed' })
      });

      if (res.ok) {
        alert('✅ Выплата успешно отмечена как выполненная');
        
        // Обновляем список
        loadWithdrawals();

        // Обновляем уведомления в дашборде
        window.dispatchEvent(new Event('refreshNotifications'));
        
      } else {
        alert('Не удалось обновить статус');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения');
    }
  };

  if (!userRole || !['admin', 'manager'].includes(userRole)) {
    return (
      <div style={{ padding: '100px', textAlign: 'center', color: '#EF4444', background: '#0F172A', minHeight: '100vh' }}>
        Доступ запрещён. Только для администраторов и менеджеров.
      </div>
    );
  }

  return (
    <div style={{ padding: '32px 40px', background: '#0F172A', minHeight: '100vh', color: '#fff' }}>
      <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#fff', marginTop: 0, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <DollarSign size={26} color="#94A3B8" />
        Выводы наличных
      </h1>
      <p style={{ color: '#94A3B8', marginBottom: '32px' }}>Актуальные запросы клиентов на вывод баланса</p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px' }}>Загрузка...</div>
      ) : withdrawals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '120px 0', color: '#64748B' }}>
          Пока нет запросов на вывод наличных
        </div>
      ) : (
        <div style={{ background: '#1E2937', borderRadius: '16px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#334155' }}>
                <th style={{ padding: '16px', textAlign: 'left' }}>Дата</th>
                <th style={{ padding: '16px', textAlign: 'left' }}>Клиент</th>
                <th style={{ padding: '16px', textAlign: 'left' }}>Телефон</th>
                <th style={{ padding: '16px', textAlign: 'right' }}>Сумма</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Статус</th>
                <th style={{ padding: '16px', textAlign: 'center' }}>Действие</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map((w) => (
                <tr key={w.id} style={{ borderBottom: '1px solid #334155' }}>
                  <td style={{ padding: '16px' }}>{new Date(w.created_at).toLocaleString('ru-RU')}</td>
                  <td style={{ padding: '16px', fontWeight: '600' }}>
                    {w.users?.full_name || w.users?.username || '—'}
                  </td>
                  <td style={{ padding: '16px' }}>{w.users?.phone || '—'}</td>
                  <td style={{ padding: '16px', textAlign: 'right', fontWeight: '700', color: '#10B981' }}>
                    {w.amount} ₽
                  </td>
                  <td style={{ padding: '16px', textAlign: 'center' }}>
                    <span style={{
                      padding: '6px 16px',
                      borderRadius: '9999px',
                      background: w.status === 'completed' ? '#10B98120' : '#F59E0B20',
                      color: w.status === 'completed' ? '#10B981' : '#F59E0B'
                    }}>
                      {w.status === 'completed' ? '✅ Выплачено' : '⏳ Ожидает'}
                    </span>
                  </td>
                  <td style={{ padding: '16px', textAlign: 'center' }}>
                    {w.status !== 'completed' && (
                      <button
                        onClick={() => markAsPaid(w.id)}
                        style={{
                          padding: '8px 24px',
                          background: '#10B981',
                          color: 'white',
                          border: 'none',
                          borderRadius: '9999px',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        Выплачено
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}