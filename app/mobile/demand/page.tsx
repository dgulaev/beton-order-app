'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { demandSourceLabel } from '@/lib/demand/labels';
import { volumeCardSoftStyle } from '@/app/adminCifra/cardStyles';

type DemandItem = {
  id: number;
  source: string;
  title: string;
  fit_score: number | null;
  region: string | null;
  volume_m3: number | null;
  status: string;
};

export default function MobileDemandPage() {
  const router = useRouter();
  const [items, setItems] = useState<DemandItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [takingId, setTakingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/adminCifra/demand?status=new&min_score=40', {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) setItems(json.items || []);
      else alert(json.error || 'Не удалось загрузить спрос');
    } catch {
      alert('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const take = async (id: number) => {
    setTakingId(id);
    try {
      const res = await fetch(`/api/adminCifra/demand/${id}/take`, {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      });
      const json = await res.json();
      if (json.success) {
        router.push('/mobile/leads');
        return;
      }
      alert(json.error || 'Не удалось взять спрос в работу');
    } catch {
      alert('Ошибка соединения с сервером');
    } finally {
      setTakingId(null);
    }
  };

  return (
    <div style={{ padding: '16px 14px 100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h1 style={{ margin: 0, color: '#F1F5F9', fontSize: 22 }}>Спрос</h1>
        <button
          type="button"
          onClick={() => void load()}
          style={{ background: 'none', border: 'none', color: '#6EE7B7' }}
          aria-label="Обновить"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {loading && <p style={{ color: '#94A3B8' }}>Загрузка…</p>}
      {!loading && items.length === 0 && (
        <div style={volumeCardSoftStyle({ padding: 18, color: '#94A3B8' })}>
          Подходящего спроса пока нет
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item) => (
          <div key={item.id} style={volumeCardSoftStyle({ padding: 14 })}>
            <div style={{ color: '#F8FAFC', fontWeight: 700, marginBottom: 6 }}>
              {item.title}
              <span style={{ marginLeft: 8, color: '#A7F3D0', fontSize: 12 }}>
                оценка {item.fit_score ?? 0}%
              </span>
            </div>
            <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 10 }}>
              {demandSourceLabel(item.source)}
              {item.region ? ` · ${item.region}` : ''}
              {item.volume_m3 != null ? ` · ${item.volume_m3} м³` : ''}
            </div>
            <button
              type="button"
              disabled={takingId === item.id}
              onClick={() => void take(item.id)}
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 12,
                border: 'none',
                background: '#059669',
                color: '#fff',
                fontWeight: 700,
                opacity: takingId === item.id ? 0.7 : 1,
              }}
            >
              {takingId === item.id ? 'Создаём лид…' : 'Взять в лиды'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
