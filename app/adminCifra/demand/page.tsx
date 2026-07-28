'use client';

import { Suspense, useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Radar, RefreshCw, ExternalLink, MessageSquare } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';
import { DEMAND_STATUS_LABEL, demandSourceLabel } from '@/lib/demand/labels';
import { canProcessTenders } from '@/lib/demandProcessAccess';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUserRole } from '@/app/providers/UserRoleProvider';
import { useRealtimeDemand, type DemandItemRow } from '@/hooks/useRealtimeDemand';
import ProcessDemandModal from './ProcessDemandModal';
import { DemandAvitoChat } from './DemandAvitoChat';

const DEMAND_STATUS_VALUES = new Set([
  '',
  'new',
  'relevant',
  'processing',
  'taken',
  'ignored',
]);

const pageWrap: CSSProperties = {
  padding: 'clamp(12px, 2vw, 28px)',
  width: '100%',
  maxWidth: 'min(1600px, 100%)',
  margin: '0 auto',
  boxSizing: 'border-box',
};

export default function DemandPage() {
  return (
    <Suspense fallback={<div style={{ ...pageWrap, color: '#94A3B8' }}>Загрузка…</div>}>
      <DemandPageInner />
    </Suspense>
  );
}

function DemandPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useUserRole();
  const allowTenderProcess = canProcessTenders(user);
  const [items, setItems] = useState<DemandItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [minScore, setMinScore] = useState(0);
  const statusFromUrl = searchParams.get('status');
  const [status, setStatus] = useState(() =>
    statusFromUrl != null && DEMAND_STATUS_VALUES.has(statusFromUrl) ? statusFromUrl : 'new',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [processItem, setProcessItem] = useState<DemandItemRow | null>(null);
  /** Чат Авито грузим только для раскрытой карточки — иначе N запросов к Messenger API. */
  const [openChatDemandId, setOpenChatDemandId] = useState<number | null>(null);

  useEffect(() => {
    if (statusFromUrl == null) return;
    if (!DEMAND_STATUS_VALUES.has(statusFromUrl)) return;
    setStatus(statusFromUrl);
  }, [statusFromUrl]);

  const setStatusAndUrl = (next: string) => {
    setStatus(next);
    const qs = new URLSearchParams(searchParams.toString());
    if (next) qs.set('status', next);
    else qs.delete('status');
    const q = qs.toString();
    router.replace(q ? `/adminCifra/demand?${q}` : '/adminCifra/demand', { scroll: false });
  };

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

  const ensureProcessing = async (item: DemandItemRow): Promise<DemandItemRow | null> => {
    if (item.status === 'processing') return item;
    const res = await fetch(`/api/adminCifra/demand/${item.id}`, {
      method: 'PATCH',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'processing' }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      setMessage(json.error || 'Не удалось взять в обработку');
      return null;
    }
    const updated = json.item as DemandItemRow;
    setItems((prev) => {
      if (status && status !== 'processing') return prev.filter((i) => i.id !== item.id);
      return prev.map((i) => (i.id === item.id ? { ...i, ...updated } : i));
    });
    return updated;
  };

  const startProcessing = async (item: DemandItemRow) => {
    setBusyId(item.id);
    setMessage(null);
    try {
      const updated = await ensureProcessing(item);
      if (updated) setProcessItem(updated);
    } catch {
      setMessage('Ошибка соединения');
    } finally {
      setBusyId(null);
    }
  };

  /** Отправка в работу с карточки: если исполнители уже в черновике — сразу /take, иначе форма. */
  const sendDemandToWork = async (item: DemandItemRow) => {
    setBusyId(item.id);
    setMessage(null);
    try {
      const updated = await ensureProcessing(item);
      if (!updated) return;

      const raw =
        updated.raw_payload && typeof updated.raw_payload === 'object'
          ? updated.raw_payload
          : {};
      const p =
        raw.processing && typeof raw.processing === 'object'
          ? (raw.processing as Record<string, unknown>)
          : {};
      const hasAssignee =
        (p.assigned_to != null && String(p.assigned_to).trim() !== '') ||
        (Array.isArray(p.co_assignees) && p.co_assignees.length > 0);

      if (!hasAssignee) {
        setProcessItem(updated);
        setMessage(
          'Назначьте исполнителей в форме и нажмите «Отправить в работу» внизу окна',
        );
        return;
      }

      const res = await fetch(`/api/adminCifra/demand/${updated.id}/take`, {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(p),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setProcessItem(updated);
        setMessage(json.error || 'Не удалось отправить — проверьте форму');
        return;
      }
      if (json.warning) {
        alert(`Лид создан, но: ${json.warning}`);
      }
      const leadId = json.lead?.id as number | undefined;
      setItems((prev) => {
        if (status && status !== 'taken') return prev.filter((i) => i.id !== updated.id);
        return prev.map((i) =>
          i.id === updated.id
            ? { ...i, status: 'taken', lead_id: leadId ?? i.lead_id }
            : i,
        );
      });
      setMessage(
        leadId
          ? `Лид #${leadId} отправлен в работу — исполнители уведомлены.`
          : 'Отправлено в работу.',
      );
      if (leadId) router.push('/adminCifra/leads?status=new&source=demand');
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
            Новая заявка → «Обработать» (торги, документы) → назначить исполнителей → «Отправить в
            работу». Исполнителям придёт задание взять лид.
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
            { value: 'processing', label: 'Обработка' },
            { value: 'relevant', label: 'Релевантные' },
            { value: 'taken', label: 'В лидах' },
            { value: 'ignored', label: 'Игнор' },
            { value: '', label: 'Все' },
          ] as const
        ).map((s) => (
          <button
            key={s.value || 'all'}
            type="button"
            onClick={() => setStatusAndUrl(s.value)}
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
            const inProcessing = item.status === 'processing';
            const canOpenProcess =
              allowTenderProcess &&
              (item.status === 'new' ||
                item.status === 'relevant' ||
                item.status === 'processing');
            const raw =
              item.raw_payload && typeof item.raw_payload === 'object'
                ? item.raw_payload
                : {};
            const avitoChatId =
              item.source === 'avito' && typeof raw.chat_id === 'string'
                ? raw.chat_id
                : null;
            const avitoChatUrl =
              typeof raw.chat_url === 'string'
                ? raw.chat_url
                : item.external_url;
            const buyerHint = item.title.replace(/^Авито\s*·\s*/i, '').trim() || null;
            const openLabel =
              item.source === 'avito'
                ? 'Открыть в Авито'
                : item.source === 'eis' || item.source === 'tender'
                  ? 'Открыть на ЕИС'
                  : 'Открыть источник';
            return (
              <div key={item.id} style={volumeCardSoftStyle({ padding: 16, height: '100%' })}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
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
                      {inProcessing && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 12,
                            color: '#FDE68A',
                            background: '#78350F',
                            padding: '2px 8px',
                            borderRadius: 8,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {DEMAND_STATUS_LABEL.processing}
                        </span>
                      )}
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
                    {avitoChatId && (
                      <div style={{ marginTop: 12 }}>
                        {openChatDemandId === item.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setOpenChatDemandId(null)}
                              style={{
                                marginBottom: 8,
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: '1px solid #334155',
                                background: 'transparent',
                                color: '#94A3B8',
                                cursor: 'pointer',
                                fontSize: 12,
                              }}
                            >
                              Скрыть чат
                            </button>
                            <DemandAvitoChat
                              chatId={avitoChatId}
                              chatUrl={avitoChatUrl}
                              buyerHint={buyerHint}
                            />
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setOpenChatDemandId(item.id)}
                            style={{
                              padding: '8px 12px',
                              borderRadius: 10,
                              border: '1px solid #1D4ED8',
                              background: 'rgba(37, 99, 235, 0.15)',
                              color: '#93C5FD',
                              cursor: 'pointer',
                              fontSize: 13,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              fontWeight: 600,
                            }}
                          >
                            <MessageSquare size={14} />
                            Показать чат Авито
                          </button>
                        )}
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
                    {canOpenProcess && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void startProcessing(item)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: 'none',
                            background: inProcessing ? '#D97706' : '#059669',
                            color: '#fff',
                            fontWeight: 600,
                            cursor: busy ? 'wait' : 'pointer',
                            opacity: busy ? 0.7 : 1,
                          }}
                        >
                          {busy ? '…' : 'Обработать'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void sendDemandToWork(item)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: 'none',
                            background: '#CA8A04',
                            color: '#1F2937',
                            fontWeight: 600,
                            cursor: busy ? 'wait' : 'pointer',
                            opacity: busy ? 0.7 : 1,
                          }}
                        >
                          Отправить в работу
                        </button>
                      </>
                    )}
                    {item.status !== 'taken' && item.status !== 'ignored' && (
                      <>
                        {!inProcessing && item.status !== 'relevant' && (
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
                        <ExternalLink size={14} /> {openLabel}
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

      <ProcessDemandModal
        open={Boolean(processItem)}
        item={processItem}
        onClose={() => setProcessItem(null)}
        onDraftSaved={(updated) => {
          setProcessItem(updated);
          setItems((prev) => {
            if (status && status !== 'processing' && status !== '') {
              return prev.filter((i) => i.id !== updated.id);
            }
            if (prev.some((i) => i.id === updated.id)) {
              return prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i));
            }
            return status === 'processing' || !status ? [updated, ...prev] : prev;
          });
          setMessage('Черновик обработки сохранён');
        }}
        onSent={(leadId) => {
          const id = processItem?.id;
          setProcessItem(null);
          if (id != null) {
            setItems((prev) => {
              if (status && status !== 'taken') return prev.filter((i) => i.id !== id);
              return prev.map((i) =>
                i.id === id ? { ...i, status: 'taken', lead_id: leadId } : i,
              );
            });
          }
          setMessage(`Лид #${leadId} отправлен в работу — исполнители уведомлены.`);
          router.push('/adminCifra/leads?status=new&source=demand');
        }}
      />
    </div>
  );
}
