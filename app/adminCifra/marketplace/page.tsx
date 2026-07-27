'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Store, RefreshCw, ExternalLink, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import type { ListingTemplate } from '@/lib/avitoListingTemplates';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';

type Listing = {
  id: number;
  source: string;
  external_id: string;
  title: string | null;
  price: number | null;
  status: string;
  url: string | null;
  views: number | null;
  contacts: number | null;
  template_key: string | null;
  last_synced_at: string | null;
};

type TemplateForm = {
  key: string;
  title: string;
  description: string;
  price: string;
  grade: string;
};

const emptyForm = (): TemplateForm => ({
  key: '',
  title: '',
  description: '',
  price: '',
  grade: '',
});

function formFromTemplate(t: ListingTemplate): TemplateForm {
  return {
    key: t.key,
    title: t.title,
    description: t.description,
    price: String(t.price),
    grade: t.grade ? String(t.grade) : '',
  };
}

export default function MarketplacePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [templates, setTemplates] = useState<ListingTemplate[]>([]);
  const [templatesPersistable, setTemplatesPersistable] = useState(true);
  const [templatesPersistError, setTemplatesPersistError] = useState<string | null>(null);
  const [avitoConfigured, setAvitoConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/adminCifra/marketplace/listings', {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setListings(json.listings || []);
        setTemplates(json.templates || []);
        setTemplatesPersistable(json.templatesPersistable !== false);
        setTemplatesPersistError(json.templatesPersistError || null);
        setAvitoConfigured(!!json.avitoConfigured);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/adminCifra/marketplace/listings', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ source: 'avito' }),
      });
      const json = await res.json();
      if (!json.success) setMessage(json.error || 'Ошибка синхронизации');
      else setMessage(`Синхронизировано: ${json.upserted} из ${json.total}`);
      await load();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSyncing(false);
    }
  };

  const updatePrice = async (id: number, price: number) => {
    const res = await fetch(`/api/adminCifra/marketplace/listings/${id}`, {
      method: 'PATCH',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ price, push_to_avito: true }),
    });
    const json = await res.json();
    if (!json.success) {
      setMessage(json.error || 'Не удалось обновить цену');
      return;
    }
    setListings((prev) => prev.map((l) => (l.id === id ? { ...l, ...json.listing } : l)));
    setMessage('Цена обновлена');
  };

  const applyTemplate = async (id: number, templateKey: string) => {
    const res = await fetch(`/api/adminCifra/marketplace/listings/${id}`, {
      method: 'PATCH',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ template_key: templateKey, apply_template: true }),
    });
    const json = await res.json();
    if (json.success) {
      setListings((prev) => prev.map((l) => (l.id === id ? { ...l, ...json.listing } : l)));
      setMessage('Шаблон применён к объявлению');
    } else {
      setMessage(json.error || 'Не удалось применить шаблон');
    }
  };

  const startEdit = (t: ListingTemplate) => {
    setCreating(false);
    setEditingKey(t.key);
    setForm(formFromTemplate(t));
  };

  const startCreate = () => {
    setEditingKey(null);
    setCreating(true);
    setForm(emptyForm());
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setCreating(false);
    setForm(emptyForm());
  };

  const saveTemplate = async () => {
    setSavingTemplate(true);
    setMessage(null);
    try {
      const res = await fetch('/api/adminCifra/marketplace/templates', {
        method: 'PUT',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          key: form.key,
          title: form.title,
          description: form.description,
          price: Number(form.price),
          grade: form.grade || null,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setMessage(json.error || 'Не удалось сохранить шаблон');
        return;
      }
      setMessage('Шаблон сохранён');
      cancelEdit();
      await load();
    } finally {
      setSavingTemplate(false);
    }
  };

  const resetTemplate = async (key: string) => {
    if (!confirm('Сбросить шаблон к значениям по умолчанию из прайса?')) return;
    setMessage(null);
    const res = await fetch(
      `/api/adminCifra/marketplace/templates?key=${encodeURIComponent(key)}`,
      {
        method: 'DELETE',
        headers: adminCifraAuthHeaders(),
      },
    );
    const json = await res.json();
    if (!json.success) {
      setMessage(json.error || 'Не удалось сбросить');
      return;
    }
    setMessage(json.deleted ? 'Шаблон удалён' : 'Шаблон сброшен к дефолту');
    if (editingKey === key) cancelEdit();
    await load();
  };

  const formOpen = creating || editingKey != null;

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Store size={28} color="#60A5FA" />
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, color: '#F1F5F9', fontSize: 24 }}>Площадки · Объявления</h1>
          <p style={{ margin: '4px 0 0', color: '#94A3B8', fontSize: 13 }}>
            Синхронизация и обновление цен на Авито
          </p>
        </div>
        <button
          type="button"
          onClick={() => void sync()}
          disabled={syncing}
          style={volumeCardSoftStyle({
            border: 'none',
            color: '#E2E8F0',
            padding: '10px 14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            opacity: syncing ? 0.6 : 1,
          })}
        >
          <RefreshCw size={16} /> {syncing ? 'Синхронизация…' : 'Синхронизировать Авито'}
        </button>
      </div>

      {!avitoConfigured && (
        <div style={volumeCardStyle({ padding: 16, marginBottom: 16, color: '#FDE68A' })}>
          Авито не настроено. Добавьте в Vercel / .env.local:{' '}
          <code>AVITO_CLIENT_ID</code>, <code>AVITO_CLIENT_SECRET</code>, <code>AVITO_USER_ID</code>,
          опционально <code>AVITO_WEBHOOK_SECRET</code>.
        </div>
      )}

      {!templatesPersistable && (
        <div style={volumeCardStyle({ padding: 16, marginBottom: 16, color: '#FDE68A' })}>
          Чтобы сохранять правки шаблонов, выполни в Supabase SQL Editor скрипт{' '}
          <code>scripts/marketplace-listing-templates.sql</code>
          {templatesPersistError ? ` · ${templatesPersistError}` : ''}
        </div>
      )}

      {message && (
        <div style={{ marginBottom: 12, color: '#93C5FD', fontSize: 14 }}>{message}</div>
      )}

      <details open style={{ marginBottom: 16, color: '#E2E8F0' }}>
        <summary
          style={{
            cursor: 'pointer',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 16,
            fontWeight: 700,
            color: '#F1F5F9',
          }}
        >
          <span style={{ flex: 1 }}>Шаблоны объявлений ({templates.length})</span>
        </summary>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={startCreate}
            disabled={!templatesPersistable}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 10,
              border: 'none',
              background: '#2563EB',
              color: '#fff',
              cursor: templatesPersistable ? 'pointer' : 'not-allowed',
              opacity: templatesPersistable ? 1 : 0.5,
              fontSize: 13,
            }}
          >
            <Plus size={14} /> Новый шаблон
          </button>
        </div>

        {formOpen && (
          <div style={volumeCardStyle({ padding: 16, marginBottom: 12 })}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ color: '#F8FAFC', fontWeight: 700 }}>
                {creating ? 'Новый шаблон' : `Редактирование · ${editingKey}`}
              </div>
              <button
                type="button"
                onClick={cancelEdit}
                style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ fontSize: 13, color: '#94A3B8' }}>
                Ключ (латиница)
                <input
                  value={form.key}
                  disabled={!creating}
                  onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                  placeholder="grade_M250"
                  style={inputStyle}
                />
              </label>
              <label style={{ fontSize: 13, color: '#94A3B8' }}>
                Название
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  style={inputStyle}
                />
              </label>
              <label style={{ fontSize: 13, color: '#94A3B8' }}>
                Текст объявления
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={7}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 13, color: '#94A3B8', flex: '1 1 140px' }}>
                  Цена, ₽/м³
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    style={inputStyle}
                  />
                </label>
                <label style={{ fontSize: 13, color: '#94A3B8', flex: '1 1 120px' }}>
                  Марка (необяз.)
                  <input
                    value={form.grade}
                    onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
                    placeholder="М300"
                    style={inputStyle}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => void saveTemplate()}
                  disabled={savingTemplate}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: 'none',
                    background: '#059669',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                    opacity: savingTemplate ? 0.6 : 1,
                  }}
                >
                  {savingTemplate ? 'Сохранение…' : 'Сохранить'}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid #334155',
                    background: 'transparent',
                    color: '#94A3B8',
                    cursor: 'pointer',
                  }}
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gap: 8 }}>
          {templates.map((t) => (
            <div key={t.key} style={volumeCardSoftStyle({ padding: 12 })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700, color: '#F8FAFC', fontSize: 17, lineHeight: 1.35 }}>
                    {t.title}
                    {t.is_custom && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#A7F3D0',
                          background: '#064E3B',
                          padding: '2px 8px',
                          borderRadius: 6,
                          verticalAlign: 'middle',
                        }}
                      >
                        изменён
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 15, color: '#CBD5E1', marginTop: 6, fontWeight: 600 }}>
                    {Number(t.price).toLocaleString('ru-RU')} ₽
                    <span style={{ color: '#94A3B8', fontWeight: 500 }}>
                      {' '}· ключ {t.key}
                      {t.grade ? ` · ${t.grade}` : ''}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      color: '#CBD5E1',
                      marginTop: 8,
                      whiteSpace: 'pre-wrap',
                      maxHeight: 96,
                      overflow: 'hidden',
                      lineHeight: 1.45,
                    }}
                  >
                    {t.description}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <button
                    type="button"
                    onClick={() => startEdit(t)}
                    disabled={!templatesPersistable}
                    title="Редактировать"
                    style={iconBtnStyle}
                  >
                    <Pencil size={14} /> Изменить
                  </button>
                  {t.is_custom && (
                    <button
                      type="button"
                      onClick={() => void resetTemplate(t.key)}
                      title="Сбросить к дефолту"
                      style={iconBtnStyle}
                    >
                      <RotateCcw size={14} /> Сброс
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </details>

      {loading ? (
        <p style={{ color: '#94A3B8' }}>Загрузка…</p>
      ) : listings.length === 0 ? (
        <div style={volumeCardStyle({ padding: 24, color: '#94A3B8' })}>
          Объявлений в базе нет. Нажмите «Синхронизировать Авито».
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {listings.map((L) => (
            <div key={L.id} style={volumeCardSoftStyle({ padding: 16 })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ color: '#F8FAFC', fontWeight: 700 }}>{L.title || `Объявление ${L.external_id}`}</div>
                  <div style={{ color: '#94A3B8', fontSize: 13, marginTop: 4 }}>
                    {L.source} · {L.status} · просмотры {L.views ?? 0} · контакты {L.contacts ?? 0}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="number"
                    defaultValue={L.price ?? ''}
                    key={`${L.id}-${L.price}`}
                    style={{
                      width: 120,
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid #334155',
                      background: '#0F172A',
                      color: '#fff',
                    }}
                    id={`price-${L.id}`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(`price-${L.id}`) as HTMLInputElement | null;
                      const price = Number(el?.value);
                      if (Number.isFinite(price)) void updatePrice(L.id, price);
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: 'none',
                      background: '#2563EB',
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    Цена
                  </button>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) void applyTemplate(L.id, e.target.value);
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 10,
                      background: '#0F172A',
                      color: '#E2E8F0',
                      border: '1px solid #334155',
                      maxWidth: 160,
                    }}
                  >
                    <option value="">Шаблон…</option>
                    {templates.map((t) => (
                      <option key={t.key} value={t.key}>{t.title.slice(0, 40)}</option>
                    ))}
                  </select>
                  {L.url && (
                    <a href={L.url} target="_blank" rel="noreferrer" style={{ color: '#93C5FD' }}>
                      <ExternalLink size={18} />
                    </a>
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

const inputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid #334155',
  background: '#0F172A',
  color: '#F8FAFC',
  boxSizing: 'border-box',
};

const iconBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid #334155',
  background: '#0F172A',
  color: '#E2E8F0',
  cursor: 'pointer',
  fontSize: 12,
};
