'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Radar, RefreshCw, ExternalLink } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';
import { demandSourceLabel } from '@/lib/demand/labels';
import { useRouter } from 'next/navigation';
import { useRealtimeDemand, type DemandItemRow } from '@/hooks/useRealtimeDemand';

const pageWrap: CSSProperties = {
  padding: 'clamp(12px, 2vw, 28px)',
  width: '100%',
  maxWidth: 'min(1600px, 100%)',
  margin: '0 auto',
  boxSizing: 'border-box',
};

export default function DemandPage() {
  const router = useRouter();
  const [items, setItems] = useState<DemandItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [minScore, setMinScore] = useState(0);
  const [status, setStatus] = useState('new');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (minScore > 0) qs.set('min_score', String(minScore));
      const res = await fetch(`/api/adminCifra/demand?${qs}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setLoadError(json.error || `Ошибка загрузки (${res.status})`);
        setItems([]);
        return;
      }
      setItems(json.items || []);
    } catch {
      setLoadError('Ошибка соединения с сервером');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [status, minScore]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeDemand(setItems, {
    enabled: true,
    statusFilter: status || undefined,
    minScore,
  });

  const runRadar = async () => {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch('/api/adminCifra/demand', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || (!json.success && json.error)) {
        setMessage(json.error || `Ошибка сканирования (${res.status})`);
      } else {
        setMessage(
          `Собрано ${json.collected ?? 0}, новых ${json.created ?? 0}` +
            (json.errors?.length ? ` · ошибки: ${json.errors.join('; ')}` : ''),
        );
      }
      await load();
    } catch {
      setMessage('Ошибка соединения при сканировании');
    } finally {
      setRunning(false);
    }
  };

  const ignore = async (id: number) => {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/adminCifra/demand/${id}`, {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: 'ignored' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setMessage(json.error || 'Не удалось скрыть');
        return;
      }
      setItems((prev) => {
        if (status && status !== 'ignored') return prev.filter((i) => i.id !== id);
        return prev.map((i) => (i.id === id ? { ...i, status: 'ignored' } : i));
      });
    } catch {
      setMessage('Ошибка соединения');
    } finally {
      setBusyId(null);
    }
  };

  const markRelevant = async (id: number) => {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/adminCifra/demand/${id}`, {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: 'relevant' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setMessage(json.error || 'Не удалось пометить');
        return;
      }
      setItems((prev) => {
        if (status && status !== 'relevant') return prev.filter((i) => i.id !== id);
        return prev.map((i) => (i.id === id ? { ...i, status: 'relevant' } : i));
      });
    } catch {
      setMessage('Ошибка соединения');
    } finally {
      setBusyId(null);
    }
  };

  const take = async (id: number) => {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/adminCifra/demand/${id}/take`, {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setMessage(json.error || 'Ошибка');
        return;
      }
      const leadId = json.lead?.id;
      setItems((prev) => {
        if (status && status !== 'taken') return prev.filter((i) => i.id !== id);
        return prev.map((i) =>
          i.id === id ? { ...i, status: 'taken', lead_id: leadId ?? i.lead_id } : i,
        );
      });
      if (json.already) {
        setMessage(
          leadId
            ? `Лид #${leadId} уже был создан ранее — открываю «Лиды»`
            : 'Уже взято ранее — открываю «Лиды»',
        );
      } else {
        setMessage(leadId ? `Лид #${leadId} создан — открываю «Лиды»` : 'Лид создан');
      }
      router.push('/adminCifra/leads?status=new&source=demand');
    } catch {
      setMessage('Ошибка соединения');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={pageWrap}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <Radar size={28} color="#34D399" style={{ flexShrink: 0 }} />
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h1 style={{ margin: 0, color: '#F1F5F9', fontSize: 'clamp(20px, 2vw, 28px)' }}>
            Спрос
          </h1>
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
            flexShrink: 0,
          })}
        >
          <RefreshCw size={16} /> {running ? 'Сканирование…' : 'Запустить поиск'}
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 16,
          padding: '12px 16px',
          borderRadius: 14,
          background: 'linear-gradient(135deg, rgba(6,78,59,0.35), rgba(15,23,42,0.6))',
          border: '1px solid rgba(52,211,153,0.22)',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'rgba(52,211,153,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Radar size={18} color="#34D399" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#ECFDF5', fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
            Радар спроса по Брянской области
          </div>
          <div style={{ color: '#94A3B8', fontSize: 13, lineHeight: 1.45 }}>
            Собирает тендеры и запросы на бетон с площадок. Нажми «Запустить поиск», оцени карточки
            и бери подходящие в лиды.
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 14,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {(
          [
            { value: 'new', label: 'Новые' },
            { value: 'relevant', label: 'Релевантные' },
            { value: 'taken', label: 'Взятые' },
            { value: 'ignored', label: 'Игнор' },
            { value: '', label: 'Все' },
          ] as const
        ).map((s) => (
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
        <label
          style={{
            color: '#94A3B8',
            fontSize: 13,
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Мин. балл
          <input
            type="number"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value) || 0)}
            style={{
              width: 64,
              padding: 6,
              borderRadius: 8,
              border: '1px solid #334155',
              background: '#0F172A',
              color: '#fff',
            }}
          />
        </label>
      </div>

      {message && (
        <div style={{ marginBottom: 12, color: '#6EE7B7', fontSize: 14 }}>{message}</div>
      )}
      {loadError && (
        <div style={volumeCardStyle({ padding: 14, marginBottom: 12, color: '#FCA5A5' })}>
          {loadError}
        </div>
      )}

      {loading ? (
        <p style={{ color: '#94A3B8' }}>Загрузка…</p>
      ) : items.length === 0 ? (
        <div style={volumeCardStyle({ padding: 24, color: '#94A3B8' })}>
          {loadError
            ? 'Не удалось загрузить спрос.'
            : 'Пока пусто. Запустите поиск или настройте ленту.'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 520px), 1fr))',
            gap: 12,
          }}
        >
          {items.map((item) => {
            const busy = busyId === item.id;
            return (
              <div key={item.id} style={volumeCardSoftStyle({ padding: 16, height: '100%' })}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                    height: '100%',
                  }}
                >
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ color: '#F8FAFC', fontWeight: 700, wordBreak: 'break-word' }}>
                      {item.title}
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 12,
                          color: '#A7F3D0',
                          background: '#064E3B',
                          padding: '2px 8px',
                          borderRadius: 8,
                          whiteSpace: 'nowrap',
                        }}
                      >
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
                          wordBreak: 'break-word',
                        }}
                      >
                        {item.body}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      minWidth: 140,
                      flex: '0 0 auto',
                    }}
                  >
                    {item.status !== 'taken' && item.status !== 'ignored' && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void take(item.id)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: 'none',
                            background: '#059669',
                            color: '#fff',
                            fontWeight: 600,
                            cursor: busy ? 'wait' : 'pointer',
                            opacity: busy ? 0.7 : 1,
                          }}
                        >
                          {busy ? '…' : 'Взять'}
                        </button>
                        {item.status !== 'relevant' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void markRelevant(item.id)}
                            style={{
                              padding: '8px 12px',
                              borderRadius: 10,
                              border: '1px solid #065F46',
                              background: 'transparent',
                              color: '#6EE7B7',
                              cursor: busy ? 'wait' : 'pointer',
                              fontSize: 13,
                            }}
                          >
                            Релевантно
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void ignore(item.id)}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 10,
                            border: '1px solid #334155',
                            background: 'transparent',
                            color: '#94A3B8',
                            cursor: busy ? 'wait' : 'pointer',
                            fontSize: 13,
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
                        style={{
                          color: '#93C5FD',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 13,
                        }}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
