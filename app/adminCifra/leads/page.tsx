'use client';

import { useCallback, useEffect, useState } from 'react';
import { Inbox, ExternalLink, Phone, Plus, RefreshCw, X } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { formatPhoneInput } from '@/lib/phone';
import { LEAD_SOURCE_LABEL, leadToOrderInitialData, type Lead, type LeadStatus } from '@/lib/leads';
import { useRealtimeLeads } from '@/hooks/useRealtimeLeads';
import { modalCloseButtonStyle, modalFieldStyle, volumeCardSoftStyle, volumeCardStyle, volumeModalStyle } from '../cardStyles';
import NewOrderModal from '../components/NewOrderModal';
import { useUserRole } from '../../providers/UserRoleProvider';

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  converted: 'В заказ',
  rejected: 'Отказ',
  spam: 'Спам',
};

const EMPTY_LEAD_FORM = {
  name: '',
  phone: '+7',
  grade: 'М300',
  volume_m3: '',
  address: '',
  city: 'Брянск',
  desired_date: '',
  raw_text: '',
};

export default function LeadsPage() {
  const { user } = useUserRole();
  const userRole = user?.role;
  const userName = user?.full_name;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('new');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderInitial, setOrderInitial] = useState<any>(null);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_LEAD_FORM);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (sourceFilter) qs.set('source', sourceFilter);
      const res = await fetch(`/api/adminCifra/leads?${qs}`, {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) setLeads(json.leads || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sourceFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeLeads(setLeads, { enabled: true });

  const patchStatus = async (id: number, status: LeadStatus) => {
    const res = await fetch(`/api/adminCifra/leads/${id}`, {
      method: 'PATCH',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      alert(json.error || 'Не удалось обновить статус лида');
      return;
    }
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
  };

  const openConvert = async (lead: Lead) => {
    setConvertingId(lead.id);
    if (lead.status === 'new') {
      await patchStatus(lead.id, 'in_progress');
    }
    setOrderInitial(leadToOrderInitialData(lead));
    setShowOrderModal(true);
  };

  const openCreateModal = () => {
    setCreateForm(EMPTY_LEAD_FORM);
    setShowCreateModal(true);
  };

  const submitCreateLead = async () => {
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
          desired_date: createForm.desired_date || null,
          raw_text: rawText || [name, phone].filter(Boolean).join(', '),
          source: 'manual',
        }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error || 'Не удалось создать лид');
        return;
      }
      setShowCreateModal(false);
      setCreateForm(EMPTY_LEAD_FORM);
      if (statusFilter && statusFilter !== 'new') setStatusFilter('new');
      else void load();
    } catch (e) {
      console.error(e);
      alert('Ошибка соединения с сервером');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Inbox size={28} color="#60A5FA" />
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, color: '#F1F5F9', fontSize: 24 }}>Лиды</h1>
          <p style={{ margin: '4px 0 0', color: '#94A3B8', fontSize: 13 }}>
            Inbox с площадок (Авито и др.) → конверсия в заявку
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          style={{
            border: 'none',
            background: '#2563EB',
            color: '#fff',
            padding: '10px 14px',
            borderRadius: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          <Plus size={16} /> Создать лид
        </button>
        <button
          type="button"
          onClick={() => void load()}
          style={volumeCardSoftStyle({
            border: 'none',
            color: '#E2E8F0',
            padding: '10px 14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          })}
        >
          <RefreshCw size={16} /> Обновить
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {['', 'new', 'in_progress', 'converted', 'rejected', 'spam'].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: statusFilter === s ? '1px solid #60A5FA' : '1px solid #334155',
              background: statusFilter === s ? '#1E3A5F' : '#0F172A',
              color: '#E2E8F0',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {s ? STATUS_LABEL[s as LeadStatus] : 'Все'}
          </button>
        ))}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          style={{
            marginLeft: 'auto',
            padding: '8px 12px',
            borderRadius: 10,
            background: '#0F172A',
            color: '#E2E8F0',
            border: '1px solid #334155',
          }}
        >
          <option value="">Все источники</option>
          <option value="public_form">Публичная форма</option>
          <option value="avito">Авито</option>
          <option value="demand">Спрос</option>
          <option value="manual">Вручную</option>
          <option value="site">Сайт</option>
          <option value="tender">Тендер</option>
        </select>
      </div>

      {loading ? (
        <p style={{ color: '#94A3B8' }}>Загрузка…</p>
      ) : leads.length === 0 ? (
        <div style={volumeCardStyle({ padding: 28, color: '#94A3B8' })}>
          Лидов пока нет.{' '}
          <button
            type="button"
            onClick={openCreateModal}
            style={{
              background: 'none',
              border: 'none',
              color: '#93C5FD',
              cursor: 'pointer',
              padding: 0,
              fontSize: 'inherit',
              textDecoration: 'underline',
            }}
          >
            Создайте лид вручную
          </button>
          {' '}или подключите webhook Авито.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {leads.map((lead) => (
            <div key={lead.id} style={volumeCardSoftStyle({ padding: 16 })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: '#F8FAFC', fontWeight: 700, marginBottom: 4 }}>
                    #{lead.id} · {LEAD_SOURCE_LABEL[lead.source] || lead.source}
                    <span style={{
                      marginLeft: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#93C5FD',
                      background: '#1E3A5F',
                      padding: '2px 8px',
                      borderRadius: 8,
                    }}>
                      {STATUS_LABEL[lead.status] || lead.status}
                    </span>
                    {lead.score != null && lead.score > 0 && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: '#A7F3D0' }}>
                        оценка {lead.score}
                      </span>
                    )}
                  </div>
                  <div style={{ color: '#CBD5E1', fontSize: 14, whiteSpace: 'pre-wrap' }}>
                    {lead.raw_text || '—'}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap', color: '#94A3B8', fontSize: 13 }}>
                    {lead.name && <span>{lead.name}</span>}
                    {lead.phone && (
                      <a href={`tel:${lead.phone}`} style={{ color: '#93C5FD', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Phone size={14} /> {lead.phone}
                      </a>
                    )}
                    {lead.grade && <span>{lead.grade}</span>}
                    {lead.volume_m3 != null && <span>{lead.volume_m3} м³</span>}
                    {lead.city && <span>{lead.city}</span>}
                    <span>{new Date(lead.created_at).toLocaleString('ru-RU')}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 140 }}>
                  {lead.status !== 'converted' && lead.status !== 'spam' && (
                    <button
                      type="button"
                      onClick={() => void openConvert(lead)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: 'none',
                        background: '#2563EB',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Создать заказ
                    </button>
                  )}
                  {lead.chat_url && (
                    <a
                      href={lead.chat_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid #334155',
                        color: '#E2E8F0',
                        textDecoration: 'none',
                        textAlign: 'center',
                        fontSize: 13,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}
                    >
                      <ExternalLink size={14} /> Чат
                    </a>
                  )}
                  {lead.status !== 'rejected' && lead.status !== 'converted' && (
                    <button
                      type="button"
                      onClick={() => void patchStatus(lead.id, 'rejected')}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 10,
                        border: '1px solid #7F1D1D',
                        background: 'transparent',
                        color: '#FCA5A5',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      Отказ
                    </button>
                  )}
                  {lead.status !== 'spam' && lead.status !== 'converted' && (
                    <button
                      type="button"
                      onClick={() => void patchStatus(lead.id, 'spam')}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 10,
                        border: '1px solid #334155',
                        background: 'transparent',
                        color: '#94A3B8',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      Спам
                    </button>
                  )}
                  {lead.order_id && (
                    <span style={{ color: '#86EFAC', fontSize: 13 }}>Заявка #{lead.order_id}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showOrderModal && (
        <NewOrderModal
          isOpen={showOrderModal}
          onClose={() => {
            setShowOrderModal(false);
            setOrderInitial(null);
            setConvertingId(null);
          }}
          onSuccess={(_order, meta) => {
            setShowOrderModal(false);
            setOrderInitial(null);
            // Оптимистично помечаем converted только если сервер реально конвертировал лид
            if (convertingId && meta?.leadConverted && !meta?.warning) {
              setLeads((prev) =>
                prev.map((l) => (l.id === convertingId ? { ...l, status: 'converted' } : l)),
              );
            }
            setConvertingId(null);
            void load();
          }}
          initialData={orderInitial}
          currentRole={userRole || undefined}
          currentUserName={userName || undefined}
        />
      )}

      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.82)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => !creating && setShowCreateModal(false)}
        >
          <div
            style={volumeModalStyle({
              width: '100%',
              maxWidth: 480,
              padding: 22,
              color: '#E2E8F0',
            })}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18, color: '#F8FAFC' }}>Новый лид</h2>
              <button
                type="button"
                aria-label="Закрыть"
                disabled={creating}
                onClick={() => setShowCreateModal(false)}
                style={modalCloseButtonStyle()}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontSize: 13, color: '#94A3B8' }}>
                Имя
                <input
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  style={modalFieldStyle({ marginTop: 4 })}
                  placeholder="Иван Иванов"
                />
              </label>
              <label style={{ fontSize: 13, color: '#94A3B8' }}>
                Телефон
                <input
                  value={createForm.phone}
                  onChange={(e) => setCreateForm((f) => ({ ...f, phone: formatPhoneInput(e.target.value) }))}
                  style={modalFieldStyle({ marginTop: 4 })}
                  placeholder="+7…"
                />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ fontSize: 13, color: '#94A3B8' }}>
                  Марка
                  <input
                    value={createForm.grade}
                    onChange={(e) => setCreateForm((f) => ({ ...f, grade: e.target.value }))}
                    style={modalFieldStyle({ marginTop: 4 })}
                  />
                </label>
                <label style={{ fontSize: 13, color: '#94A3B8' }}>
                  Объём, м³
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={createForm.volume_m3}
                    onChange={(e) => setCreateForm((f) => ({ ...f, volume_m3: e.target.value }))}
                    style={modalFieldStyle({ marginTop: 4 })}
                  />
                </label>
              </div>
              <label style={{ fontSize: 13, color: '#94A3B8' }}>
                Город
                <input
                  value={createForm.city}
                  onChange={(e) => setCreateForm((f) => ({ ...f, city: e.target.value }))}
                  style={modalFieldStyle({ marginTop: 4 })}
                />
              </label>
              <label style={{ fontSize: 13, color: '#94A3B8' }}>
                Адрес
                <input
                  value={createForm.address}
                  onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                  style={modalFieldStyle({ marginTop: 4 })}
                />
              </label>
              <label style={{ fontSize: 13, color: '#94A3B8' }}>
                Желаемая дата
                <input
                  type="date"
                  value={createForm.desired_date}
                  onChange={(e) => setCreateForm((f) => ({ ...f, desired_date: e.target.value }))}
                  style={modalFieldStyle({ marginTop: 4 })}
                />
              </label>
              <label style={{ fontSize: 13, color: '#94A3B8' }}>
                Текст обращения
                <textarea
                  value={createForm.raw_text}
                  onChange={(e) => setCreateForm((f) => ({ ...f, raw_text: e.target.value }))}
                  rows={3}
                  style={modalFieldStyle({ marginTop: 4, resize: 'vertical' })}
                  placeholder="Что нужно клиенту…"
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={creating}
                onClick={() => setShowCreateModal(false)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid #334155',
                  background: 'transparent',
                  color: '#CBD5E1',
                  cursor: 'pointer',
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={() => void submitCreateLead()}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: 'none',
                  background: creating ? '#1E40AF' : '#2563EB',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: creating ? 'wait' : 'pointer',
                }}
              >
                {creating ? 'Создание…' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
