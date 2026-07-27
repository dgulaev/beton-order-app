'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Phone, Plus, Radar, RefreshCw, X } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { formatPhoneInput } from '@/lib/phone';
import {
  LEAD_SOURCE_LABEL,
  LEAD_STATUS_LABEL,
  leadToOrderInitialData,
  type Lead,
  type LeadStatus,
} from '@/lib/leads';
import { useRealtimeLeads } from '@/hooks/useRealtimeLeads';
import {
  modalCloseButtonStyle,
  modalFieldStyle,
  volumeCardSoftStyle,
  volumeModalStyle,
} from '@/app/adminCifra/cardStyles';
import MobileNewOrderModal from '../components/MobileNewOrderModal';
import { useUserRole } from '../../providers/UserRoleProvider';

const INBOX_STATUSES: LeadStatus[] = ['new', 'in_progress'];

const EMPTY_FORM = {
  name: '',
  phone: '+7',
  grade: 'М300',
  volume_m3: '',
  address: '',
  city: 'Брянск',
  raw_text: '',
};

export default function MobileLeadsPage() {
  const { user } = useUserRole();
  const userRole = user?.role;
  const userName = user?.full_name;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [initialData, setInitialData] = useState<any>(null);
  const [activeLeadId, setActiveLeadId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/adminCifra/leads?limit=100', {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        const list = (json.leads || []).filter((l: Lead) =>
          INBOX_STATUSES.includes(l.status),
        );
        setLeads(list);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeLeads(setLeads, { enabled: true, statusFilter: INBOX_STATUSES });

  const patchStatus = async (id: number, status: LeadStatus) => {
    const res = await fetch(`/api/adminCifra/leads/${id}`, {
      method: 'PATCH',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      alert(json.error || 'Не удалось обновить статус');
      return false;
    }
    if (!INBOX_STATUSES.includes(status)) {
      setLeads((prev) => prev.filter((l) => l.id !== id));
    } else {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    }
    return true;
  };

  const openConvert = async (lead: Lead) => {
    setActiveLeadId(lead.id);
    if (lead.status === 'new') {
      await patchStatus(lead.id, 'in_progress');
    }
    setInitialData(leadToOrderInitialData(lead));
    setShowModal(true);
  };

  const submitCreate = async () => {
    const name = createForm.name.trim();
    const phone = createForm.phone.trim();
    const rawText = createForm.raw_text.trim();
    if (!name && !phone && !rawText) {
      alert('Укажите имя, телефон или текст обращения');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/adminCifra/leads', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name: name || null,
          phone: phone && phone !== '+7' ? phone : null,
          grade: createForm.grade.trim() || null,
          volume_m3: createForm.volume_m3 ? Number(createForm.volume_m3) : null,
          address: createForm.address.trim() || null,
          city: createForm.city.trim() || null,
          raw_text: rawText || [name, phone].filter(Boolean).join(', '),
          source: 'manual',
        }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error || 'Не удалось создать лид');
        return;
      }
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      void load();
    } catch {
      alert('Ошибка соединения с сервером');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ padding: '16px 14px 100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8 }}>
        <h1 style={{ margin: 0, color: '#F1F5F9', fontSize: 22 }}>Лиды</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            onClick={() => {
              setCreateForm(EMPTY_FORM);
              setShowCreate(true);
            }}
            style={{ background: 'none', border: 'none', color: '#60A5FA', padding: 8 }}
            aria-label="Создать лид"
          >
            <Plus size={22} />
          </button>
          <Link
            href="/mobile/demand"
            style={{ color: '#6EE7B7', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, textDecoration: 'none', padding: 8 }}
          >
            <Radar size={18} /> Спрос
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            style={{ background: 'none', border: 'none', color: '#93C5FD', padding: 8 }}
            aria-label="Обновить"
          >
            <RefreshCw size={20} />
          </button>
        </div>
      </div>

      {loading && <p style={{ color: '#94A3B8' }}>Загрузка…</p>}
      {!loading && leads.length === 0 && (
        <div style={volumeCardSoftStyle({ padding: 18, color: '#94A3B8' })}>
          Новых лидов нет. Можно создать вручную кнопкой «+».
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {leads.map((lead) => (
          <div key={lead.id} style={volumeCardSoftStyle({ padding: 14 })}>
            <div style={{ color: '#F8FAFC', fontWeight: 700, marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span>#{lead.id} · {LEAD_SOURCE_LABEL[lead.source] || lead.source}</span>
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#93C5FD',
                background: '#1E3A5F',
                padding: '2px 8px',
                borderRadius: 8,
              }}>
                {LEAD_STATUS_LABEL[lead.status] || lead.status}
              </span>
            </div>
            <div style={{ color: '#CBD5E1', fontSize: 14, whiteSpace: 'pre-wrap', marginBottom: 8 }}>
              {lead.raw_text || '—'}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10, fontSize: 13, color: '#94A3B8' }}>
              {lead.name && <span>{lead.name}</span>}
              {lead.phone && (
                <a href={`tel:${lead.phone}`} style={{ color: '#93C5FD', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <Phone size={14} /> {lead.phone}
                </a>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void openConvert(lead)}
                style={{
                  flex: 1,
                  minWidth: 120,
                  padding: 12,
                  borderRadius: 12,
                  border: 'none',
                  background: '#2563EB',
                  color: '#fff',
                  fontWeight: 700,
                }}
              >
                В заказ
              </button>
              {lead.chat_url && (
                <a
                  href={lead.chat_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid #334155',
                    color: '#E2E8F0',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  aria-label="Открыть чат"
                >
                  <ExternalLink size={18} />
                </a>
              )}
              <button
                type="button"
                onClick={() => void patchStatus(lead.id, 'rejected')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid #7F1D1D',
                  background: 'transparent',
                  color: '#FCA5A5',
                  fontSize: 13,
                }}
              >
                Отказ
              </button>
              <button
                type="button"
                onClick={() => void patchStatus(lead.id, 'spam')}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid #334155',
                  background: 'transparent',
                  color: '#94A3B8',
                  fontSize: 13,
                }}
              >
                Спам
              </button>
            </div>
          </div>
        ))}
      </div>

      <MobileNewOrderModal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setInitialData(null);
          setActiveLeadId(null);
        }}
        onSuccess={(_order, meta) => {
          setShowModal(false);
          if (activeLeadId && meta?.leadConverted && !meta?.warning) {
            setLeads((prev) => prev.filter((l) => l.id !== activeLeadId));
          }
          setActiveLeadId(null);
          void load();
        }}
        initialData={initialData}
        currentRole={userRole || undefined}
        currentUserName={userName || undefined}
      />

      {showCreate && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.82)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={() => !creating && setShowCreate(false)}
        >
          <div
            style={volumeModalStyle({
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: 18,
              borderRadius: '20px 20px 0 0',
              color: '#E2E8F0',
            })}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: '#F8FAFC' }}>Новый лид</h2>
              <button type="button" style={modalCloseButtonStyle()} onClick={() => setShowCreate(false)} aria-label="Закрыть">
                <X size={18} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                placeholder="Имя"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                style={modalFieldStyle()}
              />
              <input
                placeholder="Телефон"
                value={createForm.phone}
                onChange={(e) => setCreateForm((f) => ({ ...f, phone: formatPhoneInput(e.target.value) }))}
                style={modalFieldStyle()}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input
                  placeholder="Марка"
                  value={createForm.grade}
                  onChange={(e) => setCreateForm((f) => ({ ...f, grade: e.target.value }))}
                  style={modalFieldStyle()}
                />
                <input
                  placeholder="Объём, м³"
                  type="number"
                  value={createForm.volume_m3}
                  onChange={(e) => setCreateForm((f) => ({ ...f, volume_m3: e.target.value }))}
                  style={modalFieldStyle()}
                />
              </div>
              <input
                placeholder="Город"
                value={createForm.city}
                onChange={(e) => setCreateForm((f) => ({ ...f, city: e.target.value }))}
                style={modalFieldStyle()}
              />
              <input
                placeholder="Адрес"
                value={createForm.address}
                onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                style={modalFieldStyle()}
              />
              <textarea
                placeholder="Текст обращения"
                rows={3}
                value={createForm.raw_text}
                onChange={(e) => setCreateForm((f) => ({ ...f, raw_text: e.target.value }))}
                style={modalFieldStyle({ resize: 'vertical' })}
              />
              <button
                type="button"
                disabled={creating}
                onClick={() => void submitCreate()}
                style={{
                  marginTop: 6,
                  padding: 14,
                  borderRadius: 12,
                  border: 'none',
                  background: '#2563EB',
                  color: '#fff',
                  fontWeight: 700,
                }}
              >
                {creating ? 'Создание…' : 'Создать лид'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
