'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { AlertTriangle, FileText, Trash2, Upload } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { appConfirm } from '../components/appDialog';
import {
  FLEET_DOC_TYPES,
  type FleetDocType,
  type FleetDocument,
  type FleetReminder,
} from '@/lib/fleetLifecycle';

interface Props {
  mixerId: number;
  canMutate: boolean;
  onUpdated?: () => void;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const end = new Date(`${dateStr.slice(0, 10)}T23:59:59`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
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

export default function FleetDocumentsPanel({ mixerId, canMutate, onUpdated }: Props) {
  const [documents, setDocuments] = useState<(FleetDocument & { url?: string })[]>([]);
  const [reminders, setReminders] = useState<FleetReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [docType, setDocType] = useState<FleetDocType>(FLEET_DOC_TYPES[0]?.value || 'sts');
  const [docExpires, setDocExpires] = useState('');
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, remRes] = await Promise.all([
        fetch(`/api/adminCifra/fleet/documents?mixer_id=${mixerId}`, {
          headers: adminCifraAuthHeaders(),
        }),
        fetch(`/api/adminCifra/fleet/reminders?mixer_id=${mixerId}`, {
          headers: adminCifraAuthHeaders(),
        }),
      ]);
      const docsData = await docsRes.json().catch(() => ({}));
      const remData = await remRes.json().catch(() => ({}));
      if (docsRes.ok) setDocuments(docsData.documents || []);
      if (remRes.ok) setReminders(remData.reminders || []);
    } finally {
      setLoading(false);
    }
  }, [mixerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadDocument = async (file: File) => {
    if (!canMutate) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('mixer_id', String(mixerId));
      form.append('doc_type', docType);
      form.append('file', file);
      if (docExpires) form.append('expires_at', docExpires);
      const res = await fetch('/api/adminCifra/fleet/documents', {
        method: 'POST',
        headers: adminCifraAuthHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Ошибка загрузки');
        return;
      }
      setDocExpires('');
      await load();
      onUpdated?.();
    } catch {
      alert('Ошибка соединения');
    } finally {
      setUploading(false);
    }
  };

  const deleteDocument = async (doc: FleetDocument) => {
    if (!canMutate) return;
    if (!(await appConfirm('Удалить документ?', { variant: 'danger', okLabel: 'Удалить' }))) return;
    const res = await fetch(`/api/adminCifra/fleet/documents?id=${doc.id}`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Ошибка');
      return;
    }
    await load();
    onUpdated?.();
  };

  return (
    <div>
      {reminders.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {reminders.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(250,204,21,0.08)',
                border: '1px solid rgba(250,204,21,0.2)',
                color: '#FDE68A',
                fontSize: 13,
                marginBottom: 8,
              }}
            >
              <AlertTriangle size={14} />
              {r.title}
              {r.due_date ? ` · до ${r.due_date.slice(0, 10)}` : ''}
            </div>
          ))}
        </div>
      )}

      {canMutate && (
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: '#1E2937',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as FleetDocType)}
              style={fieldStyle}
            >
              {FLEET_DOC_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={docExpires}
              onChange={(e) => setDocExpires(e.target.value)}
              style={fieldStyle}
              title="Срок действия"
            />
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '10px',
              borderRadius: 10,
              border: '1px dashed #475569',
              color: '#94A3B8',
              cursor: uploading ? 'wait' : 'pointer',
            }}
          >
            <Upload size={16} />
            {uploading ? 'Загрузка…' : 'Загрузить PDF или фото'}
            <input
              type="file"
              accept=".pdf,image/jpeg,image/png,image/webp"
              hidden
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadDocument(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>Загрузка…</div>
      ) : documents.length === 0 ? (
        <div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>Документов пока нет</div>
      ) : (
        documents.map((doc) => {
          const days = daysUntil(doc.expires_at);
          const expiring = days != null && days >= 0 && days <= 14;
          return (
            <div
              key={doc.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                borderRadius: 12,
                background: '#1E2937',
                marginBottom: 8,
              }}
            >
              <FileText size={18} color="#64748B" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#E2E8F0', fontSize: 14, fontWeight: 600 }}>
                  {FLEET_DOC_TYPES.find((d) => d.value === doc.doc_type)?.label ?? doc.doc_type}
                  {doc.title ? ` — ${doc.title}` : ''}
                </div>
                <div style={{ color: '#64748B', fontSize: 12 }}>{doc.file_name}</div>
                {doc.expires_at && (
                  <div style={{ color: expiring ? '#FBBF24' : '#64748B', fontSize: 11, marginTop: 2 }}>
                    до {doc.expires_at.slice(0, 10)}
                    {expiring ? ` (${days} дн.)` : ''}
                  </div>
                )}
              </div>
              {doc.url && (
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#4ADE80', fontSize: 12, flexShrink: 0 }}
                >
                  Открыть
                </a>
              )}
              {canMutate && (
                <button
                  type="button"
                  onClick={() => void deleteDocument(doc)}
                  style={{ background: 'none', border: 'none', color: '#F87171', cursor: 'pointer' }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
