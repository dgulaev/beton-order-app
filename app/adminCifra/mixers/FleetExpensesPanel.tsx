'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { appConfirm } from '../components/appDialog';
import {
  EXPENSE_CATEGORIES,
  defaultCostPeriod,
  expenseCategoryLabel,
  type ExpenseCategory,
  type FleetExpense,
} from '@/lib/fleetCosts';
import { todayMoscowYmd } from '@/lib/fleetService';
import { formatRub } from '@/lib/fleetTariffs';

interface Props {
  mixerId: number;
  canMutate: boolean;
}

const fieldStyle: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 10,
  border: '1px solid #334155',
  background: '#0F172A',
  color: '#E2E8F0',
  fontSize: 13,
};

export default function FleetExpensesPanel({ mixerId, canMutate }: Props) {
  const defaults = defaultCostPeriod();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [expenses, setExpenses] = useState<FleetExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(todayMoscowYmd);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/adminCifra/fleet/expenses?mixer_id=${mixerId}&from=${from}&to=${to}`,
        { headers: adminCifraAuthHeaders() },
      );
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Не удалось загрузить расходы');
        setExpenses([]);
      } else {
        setExpenses(data.expenses ?? []);
      }
    } catch {
      setError('Ошибка соединения');
    } finally {
      setLoading(false);
    }
  }, [mixerId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!canMutate) return;
    const A = Number(amount);
    if (!(A >= 0) || !Number.isFinite(A)) {
      alert('Укажите сумму');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/adminCifra/fleet/expenses', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          mixer_id: mixerId,
          category,
          amount_rub: A,
          description: desc.trim() || null,
          expense_date: date,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Ошибка');
        return;
      }
      setShowForm(false);
      setAmount('');
      setDesc('');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!canMutate) return;
    if (!(await appConfirm('Удалить расход?'))) return;
    const res = await fetch(`/api/adminCifra/fleet/expenses?id=${id}`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.error || 'Ошибка');
      return;
    }
    await load();
  };

  const total = expenses.reduce((s, e) => s + (Number(e.amount_rub) || 0), 0);

  if (loading && !expenses.length) {
    return <div style={{ color: '#64748B', padding: 24, textAlign: 'center' }}>Загрузка…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && (
        <div style={{ padding: 12, borderRadius: 10, background: 'rgba(248,113,113,0.1)', color: '#F87171', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...fieldStyle, width: 'auto' }} />
        <span style={{ color: '#64748B' }}>—</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...fieldStyle, width: 'auto' }} />
        <span style={{ marginLeft: 'auto', color: '#A78BFA', fontWeight: 700, fontSize: 14 }}>
          {formatRub(total)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700, color: '#E2E8F0', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Wallet size={16} color="#A78BFA" /> Расходы
        </div>
        {canMutate && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 8,
              border: '1px solid rgba(167,139,250,0.35)',
              background: 'rgba(167,139,250,0.1)', color: '#A78BFA',
              fontWeight: 600, fontSize: 12, cursor: 'pointer',
            }}
          >
            <Plus size={14} /> Расход
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ padding: 12, borderRadius: 12, background: '#1E2937', border: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} style={fieldStyle}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <input type="number" placeholder="Сумма, ₽ *" value={amount} onChange={(e) => setAmount(e.target.value)} style={fieldStyle} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} />
          <input placeholder="Описание" value={desc} onChange={(e) => setDesc(e.target.value)} style={fieldStyle} />
          <button
            type="button"
            disabled={saving}
            onClick={() => void create()}
            style={{ padding: 10, borderRadius: 10, border: 'none', background: '#A78BFA', color: '#0F172A', fontWeight: 700, cursor: 'pointer' }}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      )}

      {expenses.length === 0 ? (
        <div style={{ color: '#64748B', fontSize: 13 }}>Расходов за период нет</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {expenses.map((e) => (
            <div key={e.id} style={{ padding: 12, borderRadius: 12, background: '#1E2937', border: '1px solid #334155' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#A78BFA', padding: '2px 8px', borderRadius: 9999, background: 'rgba(167,139,250,0.15)' }}>
                  {expenseCategoryLabel(e.category)}
                </span>
                <span style={{ fontWeight: 700, color: '#F8FAFC' }}>{formatRub(e.amount_rub)}</span>
                <span style={{ marginLeft: 'auto', color: '#64748B', fontSize: 11 }}>{e.expense_date}</span>
              </div>
              {e.description && (
                <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>{e.description}</div>
              )}
              {e.receipt_url && (
                <a href={e.receipt_url} target="_blank" rel="noopener noreferrer" style={{ color: '#38BDF8', fontSize: 12 }}>
                  Чек
                </a>
              )}
              {canMutate && (
                <button
                  type="button"
                  onClick={() => void remove(e.id)}
                  style={{ marginTop: 6, background: 'none', border: 'none', color: '#F87171', cursor: 'pointer', padding: 0 }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
