'use client';

import { useCallback, useEffect, useState } from 'react';
import { Radar, RefreshCw, ExternalLink } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';
import { demandSourceLabel } from '@/lib/demand/labels';
import { useRouter } from 'next/navigation';

type DemandItem = {
  id: number;
  source: string;
  title: string;
  body: string | null;
  region: string | null;
  volume_m3: number | null;
  grades: string[] | null;
  fit_score: number | null;
  status: string;
  external_url: string | null;
  lead_id: number | null;
  published_at: string | null;
};

export default function DemandPage() {
  const router = useRouter();
  const [items, setItems] = useState<DemandItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [status, setStatus] = useState('new');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (minScore > 0) qs.set('min_score', String(minScore));
      const res = await fetch(`/api/adminCifra/demand?${qs}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) setItems(json.items || []);
    } finally {
      setLoading(false);
    }
  }, [status, minScore]);

  useEffect(() => {
    void load();
  }, [load]);

  const runRadar = async () => {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch('/api/adminCifra/demand', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      });
      const json = await res.json();
      if (!json.success && json.error) setMessage(json.error);
      else {
        setMessage(
          `Собрано ${json.collected}, новых ${json.created}` +
            (json.errors?.length ? ` · ошибки: ${json.errors.join('; ')}` : ''),
        );
      }
      await load();
    } finally {
      setRunning(false);
    }
  };

  const ignore = async (id: number) => {
    await fetch(`/api/adminCifra/demand/${id}`, {
      method: 'PATCH',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'ignored' }),
    });
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const take = async (id: number) => {
    const res = await fetch(`/api/adminCifra/demand/${id}/take`, {
      method: 'POST',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
    });
    const json = await res.json();
    if (json.success) {
      setMessage(`Лид #${json.lead?.id} создан — откройте раздел «Лиды»`);
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status: 'taken', lead_id: json.lead?.id } : i)),
      );
      router.push('/adminCifra/leads');
    } else {
      setMessage(json.error || 'Ошибка');
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Radar size={28} color="#34D399" />
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, color: '#F1F5F9', fontSize: 24 }}>Спрос</h1>
          <p style={{ margin: '4px 0 0', color: '#94A3B8', fontSize: 13 }}>
            Demand Radar — тендеры и запросы на бетон
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runRadar()}
          disabled={running}
          style={volumeCardSoftStyle({
            border: 'none',
            color: '#E2E8F0',
            padding: '10px 14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            opacity: running ? 0.6 : 1,
          })}
        >
          <RefreshCw size={16} /> {running ? 'Сканирование…' : 'Запустить поиск'}
        </button>
      </div>

      <div style={volumeCardStyle({ padding: 14, marginBottom: 16, color: '#CBD5E1', fontSize: 13 })}>
        Источники: ГосПлан (тест <code>v2test.gosplan.info</code>, выкл. <code>GOSPLAN_ENABLED=0</code>),
        JSON-лента <code>DEMAND_FEED_URL</code>, демо при <code>DEMAND_DEMO=1</code>.
        Регион завода: <code>DEMAND_HOME_REGIONS</code> (по умолчанию брянск).
        Код субъекта ЕИС: <code>GOSPLAN_REGIONS=32</code>.
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {([
          { value: 'new', label: 'Новые' },
          { value: 'relevant', label: 'Релевантные' },
          { value: 'taken', label: 'Взятые' },
          { value: 'ignored', label: 'Игнор' },
          { value: '', label: 'Все' },
        ] as const).map((s) => (
          <button
            key={s.value || 'all'}
            type="button"
            onClick={() => setStatus(s.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: status === s.value ? '1px solid #34D399' : '1px solid #334155',
              background: status === s.value ? '#064E3B' : '#0F172A',
              color: '#E2E8F0',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {s.label}
          </button>
        ))}
        <label style={{ color: '#94A3B8', fontSize: 13, marginLeft: 'auto' }}>
          Мин. балл{' '}
          <input
            type="number"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value) || 0)}
            style={{
              width: 64,
              marginLeft: 6,
              padding: 6,
              borderRadius: 8,
              border: '1px solid #334155',
              background: '#0F172A',
              color: '#fff',
            }}
          />
        </label>
      </div>

      {message && <div style={{ marginBottom: 12, color: '#6EE7B7', fontSize: 14 }}>{message}</div>}

      {loading ? (
        <p style={{ color: '#94A3B8' }}>Загрузка…</p>
      ) : items.length === 0 ? (
        <div style={volumeCardStyle({ padding: 24, color: '#94A3B8' })}>
          Пока пусто. Запустите поиск или настройте ленту.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item) => (
            <div key={item.id} style={volumeCardSoftStyle({ padding: 16 })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#F8FAFC', fontWeight: 700 }}>
                    {item.title}
                    <span style={{
                      marginLeft: 8,
                      fontSize: 12,
                      color: '#A7F3D0',
                      background: '#064E3B',
                      padding: '2px 8px',
                      borderRadius: 8,
                    }}>
                      оценка {item.fit_score ?? 0}%
                    </span>
                  </div>
                  <div style={{ color: '#94A3B8', fontSize: 13, marginTop: 4 }}>
                    {demandSourceLabel(item.source)}
                    {item.region ? ` · ${item.region}` : ''}
                    {item.volume_m3 != null ? ` · ${item.volume_m3} м³` : ''}
                    {item.grades?.length ? ` · ${item.grades.join(', ')}` : ''}
                    {item.published_at
                      ? ` · ${new Date(item.published_at).toLocaleDateString('ru-RU')}`
                      : ''}
                  </div>
                  {item.body && (
                    <div
                      style={{
                        color: '#CBD5E1',
                        fontSize: 13,
                        marginTop: 10,
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.45,
                        maxHeight: 220,
                        overflow: 'auto',
                      }}
                    >
                      {item.body}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 140 }}>
                  {item.status !== 'taken' && item.status !== 'ignored' && (
                    <>
                      <button
                        type="button"
                        onClick={() => void take(item.id)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: 'none',
                          background: '#059669',
                          color: '#fff',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Взять
                      </button>
                      <button
                        type="button"
                        onClick={() => void ignore(item.id)}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 10,
                          border: '1px solid #334155',
                          background: 'transparent',
                          color: '#94A3B8',
                          cursor: 'pointer',
                        }}
                      >
                        Не интересно
                      </button>
                    </>
                  )}
                  {item.external_url && (
                    <a
                      href={item.external_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#93C5FD', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                    >
                      <ExternalLink size={14} /> Открыть на ЕИС
                    </a>
                  )}
                  {item.lead_id && (
                    <span style={{ color: '#86EFAC', fontSize: 13 }}>Лид #{item.lead_id}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
