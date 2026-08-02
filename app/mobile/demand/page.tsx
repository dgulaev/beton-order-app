'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { demandSourceLabel } from '@/lib/demand/labels';
import { canProcessTenders } from '@/lib/demandProcessAccess';
import { volumeCardSoftStyle } from '@/app/adminCifra/cardStyles';
import ProcessDemandModal from '@/app/adminCifra/demand/ProcessDemandModal';
import type { DemandItemRow } from '@/hooks/useRealtimeDemand';
import { useWakeRefresh } from '@/hooks/useWakeReload';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { useUserRole } from '../../providers/UserRoleProvider';

const btnBase: CSSProperties = {
  width: '100%',
  padding: '7px 8px',
  borderRadius: 8,
  fontWeight: 600,
  fontSize: 11,
  lineHeight: 1.2,
  border: 'none',
  cursor: 'pointer',
  textAlign: 'center',
  boxSizing: 'border-box',
};

export default function MobileDemandPage() {
  const { user } = useUserRole();
  const allowTenderProcess = canProcessTenders(user);
  const [items, setItems] = useState<DemandItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [processItem, setProcessItem] = useState<DemandItemRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    try {
      const res = await fetchWithTimeout('/api/adminCifra/demand?status=new&min_score=40', {
        headers: adminCifraAuthHeaders(),
        cache: 'no-store',
      });
      const json = await res.json();
      if (json.success) setItems(json.items || []);
      else if (!opts?.quiet) alert(json.error || 'Не удалось загрузить спрос');
    } catch {
      // Wake (quiet) — без алерта; первый заход — сообщаем
      if (!opts?.quiet) alert('Ошибка соединения с сервером');
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useWakeRefresh(() => {
    void load({ quiet: true });
  });

  const ensureProcessing = async (item: DemandItemRow): Promise<DemandItemRow | null> => {
    if (item.status === 'processing') return item;
    const res = await fetch(`/api/adminCifra/demand/${item.id}`, {
      method: 'PATCH',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: 'processing' }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      alert(json.error || 'Не удалось взять в обработку');
      return null;
    }
    const updated = json.item as DemandItemRow;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...updated } : i)));
    return updated;
  };

  const startProcessing = async (item: DemandItemRow) => {
    setBusyId(item.id);
    setMessage(null);
    try {
      const updated = await ensureProcessing(item);
      if (updated) setProcessItem(updated);
    } catch {
      alert('Ошибка соединения');
    } finally {
      setBusyId(null);
    }
  };

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
        alert(json.error || 'Не удалось отправить — проверьте форму');
        return;
      }
      if (json.warning) {
        alert(`Лид создан, но: ${json.warning}`);
      }
      const leadId = json.lead?.id as number | undefined;
      setItems((prev) => prev.filter((i) => i.id !== updated.id));
      setMessage(
        leadId
          ? `Лид #${leadId} отправлен в работу — исполнители уведомлены.`
          : 'Отправлено в работу.',
      );
    } catch {
      alert('Ошибка соединения');
    } finally {
      setBusyId(null);
    }
  };

  const ignore = async (id: number) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/adminCifra/demand/${id}`, {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ status: 'ignored' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        alert(json.error || 'Не удалось скрыть');
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== id));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: '16px 14px 100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h1 style={{ margin: 0, color: '#F1F5F9', fontSize: 22 }}>Спрос</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link href="/mobile/leads" style={{ color: '#93C5FD', fontSize: 13, textDecoration: 'none' }}>
            Лиды
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            style={{ background: 'none', border: 'none', color: '#6EE7B7' }}
            aria-label="Обновить"
          >
            <RefreshCw size={20} />
          </button>
        </div>
      </div>

      {!allowTenderProcess && (
        <div style={volumeCardSoftStyle({ padding: 14, marginBottom: 12, color: '#94A3B8', fontSize: 13 })}>
          Обработка спроса и отправка в работу — у админов и специалиста по торгам.
        </div>
      )}

      {message && (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(52, 211, 153, 0.35)',
            color: '#A7F3D0',
            fontSize: 13,
          }}
        >
          {message}
        </div>
      )}

      {loading && <p style={{ color: '#94A3B8' }}>Загрузка…</p>}
      {!loading && items.length === 0 && (
        <div style={volumeCardSoftStyle({ padding: 18, color: '#94A3B8' })}>
          Подходящего спроса пока нет
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item) => {
          const busy = busyId === item.id;
          const inProcessing = item.status === 'processing';
          return (
            <div
              key={item.id}
              style={volumeCardSoftStyle({ padding: 12, overflow: 'hidden', minWidth: 0 })}
            >
              <div
                style={{
                  color: '#F8FAFC',
                  fontWeight: 700,
                  marginBottom: 6,
                  fontSize: 14,
                  overflowWrap: 'anywhere',
                  wordBreak: 'break-word',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {item.title}
                <span style={{ marginLeft: 8, color: '#A7F3D0', fontSize: 11, fontWeight: 600 }}>
                  {item.fit_score ?? 0}%
                </span>
              </div>
              <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 8 }}>
                {demandSourceLabel(item.source)}
                {item.region ? ` · ${item.region}` : ''}
                {item.volume_m3 != null ? ` · ${item.volume_m3} м³` : ''}
                {inProcessing ? ' · обработка' : ''}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {allowTenderProcess && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void startProcessing(item)}
                      style={{
                        ...btnBase,
                        gridColumn: '1 / -1',
                        background: inProcessing ? '#D97706' : '#059669',
                        color: '#fff',
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
                        ...btnBase,
                        gridColumn: '1 / -1',
                        background: '#CA8A04',
                        color: '#1F2937',
                        opacity: busy ? 0.7 : 1,
                      }}
                    >
                      Отправить в работу
                    </button>
                  </>
                )}
                {item.status !== 'taken' && item.status !== 'ignored' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void ignore(item.id)}
                    style={{
                      ...btnBase,
                      gridColumn: allowTenderProcess ? undefined : '1 / -1',
                      background: 'transparent',
                      border: '1px solid #334155',
                      color: '#94A3B8',
                      fontWeight: 600,
                    }}
                  >
                    Не интересно
                  </button>
                )}
                {item.external_url && (
                  <a
                    href={item.external_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      ...btnBase,
                      background: 'transparent',
                      border: '1px solid #334155',
                      color: '#93C5FD',
                      fontWeight: 600,
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <ExternalLink size={14} /> ЕИС
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ProcessDemandModal
        open={Boolean(processItem)}
        item={processItem}
        onClose={() => setProcessItem(null)}
        onDraftSaved={(updated) => {
          setProcessItem(updated);
          setItems((prev) => {
            if (prev.some((i) => i.id === updated.id)) {
              return prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i));
            }
            return [updated, ...prev];
          });
          setMessage('Черновик обработки сохранён');
        }}
        onSent={(leadId) => {
          const id = processItem?.id;
          setProcessItem(null);
          if (id != null) setItems((prev) => prev.filter((i) => i.id !== id));
          setMessage(`Лид #${leadId} отправлен в работу — исполнители уведомлены.`);
        }}
      />
    </div>
  );
}
