'use client';

import { Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { Store, RefreshCw, Pencil, Plus, RotateCcw, Trash2, X, Webhook } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import type { ListingTemplate } from '@/lib/avitoListingTemplates';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';
import { appConfirm } from '../components/appDialog';
import { ListingCard, type MarketplaceListing } from './ListingCard';

type TemplateForm = {
  key: string;
  title: string;
  description: string;
  price: string;
  grade: string;
};

type Tab = 'listings' | 'templates';
type StatusFilter = 'active' | 'archive' | 'all';

const emptyForm = (): TemplateForm => ({
  key: '',
  title: '',
  description: '',
  price: '',
  grade: '',
});

function newTemplateKey(): string {
  return `custom_${Date.now().toString(36)}`;
}

function formFromTemplate(t: ListingTemplate): TemplateForm {
  return {
    key: t.key,
    title: t.title,
    description: t.description,
    price: String(t.price),
    grade: t.grade ? String(t.grade) : '',
  };
}

function isUserTemplate(t: ListingTemplate): boolean {
  return t.is_builtin === false;
}

function isActiveStatus(status: string): boolean {
  return status === 'active';
}

export default function MarketplacePage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#94A3B8' }}>Загрузка…</div>}>
      <MarketplacePageInner />
    </Suspense>
  );
}

function MarketplacePageInner() {
  const searchParams = useSearchParams();
  const openExternalId = searchParams.get('open');
  const openChat = searchParams.get('chat') === '1';

  const [tab, setTab] = useState<Tab>('listings');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
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
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<{
    subscribed?: boolean;
    secretConfigured?: boolean;
    needsResubscribe?: boolean;
    error?: string | null;
  } | null>(null);
  const [webhookBusy, setWebhookBusy] = useState(false);

  const loadWebhook = useCallback(async () => {
    try {
      const res = await fetch('/api/adminCifra/marketplace/webhook', {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setWebhookInfo({
          subscribed: json.subscribed,
          secretConfigured: json.secretConfigured,
          needsResubscribe: !!json.needsResubscribe,
          error: json.error || null,
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

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
    void loadWebhook();
  }, [load, loadWebhook]);

  useEffect(() => {
    if (!openExternalId || listings.length === 0) return;
    const found = listings.find((l) => l.external_id === openExternalId);
    if (found) {
      setExpandedId(found.id);
      setStatusFilter('all');
      setTab('listings');
    }
  }, [openExternalId, listings]);

  const filteredListings = useMemo(() => {
    if (statusFilter === 'all') return listings;
    if (statusFilter === 'active') return listings.filter((l) => isActiveStatus(l.status));
    return listings.filter((l) => !isActiveStatus(l.status));
  }, [listings, statusFilter]);

  const activeCount = useMemo(
    () => listings.filter((l) => isActiveStatus(l.status)).length,
    [listings],
  );
  const archiveCount = listings.length - activeCount;

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

  const subscribeWebhook = async () => {
    setWebhookBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/adminCifra/marketplace/webhook', {
        method: 'POST',
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json();
      if (!json.success) {
        setMessage(json.error || 'Не удалось подписать webhook');
      } else {
        setMessage('Webhook Авито подключён — новые сообщения придут зелёным уведомлением, как заявки');
      }
      await loadWebhook();
    } finally {
      setWebhookBusy(false);
    }
  };

  const startEdit = (t: ListingTemplate) => {
    setCreating(false);
    setEditingKey(t.key);
    setForm(formFromTemplate(t));
  };

  const startCreate = () => {
    if (!templatesPersistable) {
      setMessage('Сначала выполни SQL-скрипт marketplace-listing-templates.sql в Supabase');
      return;
    }
    setEditingKey(null);
    setCreating(true);
    setForm({ ...emptyForm(), key: newTemplateKey() });
    setMessage(null);
    requestAnimationFrame(() => {
      document.getElementById('template-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setCreating(false);
    setForm(emptyForm());
  };

  const saveTemplate = async () => {
    const key = form.key.trim();
    const title = form.title.trim();
    const description = form.description.trim();
    const price = Number(form.price);

    if (!key) {
      setMessage('Укажи ключ шаблона');
      return;
    }
    if (!/^[a-zA-Z0-9_\-]+$/.test(key)) {
      setMessage('Ключ: только латиница, цифры, _ и -');
      return;
    }
    if (!title) {
      setMessage('Укажи название');
      return;
    }
    if (!description) {
      setMessage('Укажи текст объявления');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setMessage('Укажи корректную цену');
      return;
    }

    setSavingTemplate(true);
    setMessage(null);
    try {
      const res = await fetch('/api/adminCifra/marketplace/templates', {
        method: creating ? 'POST' : 'PUT',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          key,
          title,
          description,
          price,
          grade: form.grade.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setMessage(json.error || 'Не удалось сохранить шаблон');
        return;
      }
      setMessage(creating ? 'Шаблон добавлен' : 'Шаблон сохранён');
      cancelEdit();
      await load();
    } finally {
      setSavingTemplate(false);
    }
  };

  const removeTemplate = async (t: ListingTemplate) => {
    const userOwned = isUserTemplate(t);
    const ok = await appConfirm(
      userOwned
        ? `Удалить шаблон «${t.title}» безвозвратно?`
        : `Сбросить «${t.title}» к значениям из прайса?`,
      {
        title: userOwned ? 'Удаление' : 'Сброс шаблона',
        okLabel: userOwned ? 'Удалить' : 'Сбросить',
        cancelLabel: 'Отмена',
        variant: userOwned ? 'danger' : 'warning',
      },
    );
    if (!ok) return;

    setDeletingKey(t.key);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/adminCifra/marketplace/templates?key=${encodeURIComponent(t.key)}`,
        {
          method: 'DELETE',
          headers: adminCifraAuthHeaders(),
        },
      );
      const json = await res.json();
      if (!json.success) {
        setMessage(json.error || 'Не удалось удалить');
        return;
      }
      setMessage(json.deleted ? 'Шаблон удалён' : 'Шаблон сброшен к дефолту');
      if (editingKey === t.key) cancelEdit();
      await load();
    } finally {
      setDeletingKey(null);
    }
  };

  const formOpen = creating || editingKey != null;

  return (
    <div
      style={{
        padding: 'clamp(12px, 2vw, 28px)',
        width: '100%',
        maxWidth: 'min(1600px, 100%)',
        margin: '0 auto',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <Store size={28} color="#60A5FA" />
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <h1 style={{ margin: 0, color: '#F1F5F9', fontSize: 'clamp(20px, 2vw, 28px)' }}>
            Площадки
          </h1>
          <p style={{ margin: '4px 0 0', color: '#94A3B8', fontSize: 13 }}>
            Авито: карточки объявлений, чаты и webhook
          </p>
        </div>
        {tab === 'listings' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => void subscribeWebhook()}
              disabled={webhookBusy || !avitoConfigured}
              style={volumeCardSoftStyle({
                border: webhookInfo?.needsResubscribe ? '1px solid #FBBF24' : 'none',
                color: '#E2E8F0',
                padding: '10px 14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                opacity: webhookBusy ? 0.6 : 1,
              })}
            >
              <Webhook size={16} />
              {webhookBusy
                ? 'Подписка…'
                : webhookInfo?.needsResubscribe
                  ? 'Переподключить webhook'
                  : webhookInfo?.subscribed
                    ? 'Webhook OK'
                    : 'Подключить webhook'}
            </button>
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
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(
          [
            { id: 'listings' as const, label: `Объявления (${listings.length})` },
            { id: 'templates' as const, label: `Шаблоны (${templates.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: tab === t.id ? '1px solid #60A5FA' : '1px solid #334155',
              background: tab === t.id ? '#1E3A5F' : '#0F172A',
              color: '#E2E8F0',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!avitoConfigured && (
        <div style={volumeCardStyle({ padding: 16, marginBottom: 16, color: '#FDE68A' })}>
          Авито не настроено. Заполни ключи на странице{' '}
          <a href="/adminCifra/integrations" style={{ color: '#93C5FD' }}>
            Интеграции
          </a>
          {' '}(Client ID, Secret, User ID и webhook-секрет).
        </div>
      )}

      {avitoConfigured && webhookInfo && (
        <div
          style={volumeCardStyle({
            padding: 12,
            marginBottom: 16,
            color: webhookInfo.subscribed ? '#A7F3D0' : '#FDE68A',
            fontSize: 13,
          })}
        >
          {webhookInfo.subscribed
            ? 'Webhook Авито активен — новые сообщения создают лид и зелёное уведомление (как у заявок).'
            : webhookInfo.needsResubscribe
              ? 'Секрет webhook изменился — нажми «Переподключить webhook».'
              : webhookInfo.secretConfigured
                ? 'Webhook ещё не подписан. Нажми «Подключить webhook», чтобы ловить сообщения в realtime.'
                : 'Задай webhook-секрет в «Интеграции», затем нажми «Подключить webhook».'}
          {webhookInfo.error ? (
            <div style={{ marginTop: 6, color: '#FCA5A5' }}>{webhookInfo.error}</div>
          ) : null}
        </div>
      )}

      {tab === 'templates' && !templatesPersistable && (
        <div style={volumeCardStyle({ padding: 16, marginBottom: 16, color: '#FDE68A' })}>
          Чтобы сохранять правки шаблонов, выполни в Supabase SQL Editor скрипт{' '}
          <code>scripts/marketplace-listing-templates.sql</code>
          {templatesPersistError ? ` · ${templatesPersistError}` : ''}
        </div>
      )}

      {message && (
        <div style={{ marginBottom: 12, color: '#93C5FD', fontSize: 14 }}>{message}</div>
      )}

      {tab === 'listings' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {(
              [
                { id: 'active' as const, label: `Активные (${activeCount})` },
                { id: 'archive' as const, label: `Архив (${archiveCount})` },
                { id: 'all' as const, label: `Все (${listings.length})` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: statusFilter === f.id ? '1px solid #34D399' : '1px solid #334155',
                  background: statusFilter === f.id ? '#064E3B' : 'transparent',
                  color: '#E2E8F0',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <p style={{ margin: '0 0 12px', color: '#64748B', fontSize: 12 }}>
            Кликни по объявлению — откроется карточка с текстом, ценой и чатами. На Авито уходит
            только цена.
          </p>

          {loading ? (
            <p style={{ color: '#94A3B8' }}>Загрузка…</p>
          ) : filteredListings.length === 0 ? (
            <div style={volumeCardStyle({ padding: 24, color: '#94A3B8' })}>
              {listings.length === 0
                ? 'Объявлений в базе нет. Нажмите «Синхронизировать Авито».'
                : 'Нет объявлений по выбранному фильтру.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filteredListings.map((L) => (
                <ListingCard
                  key={L.id}
                  listing={L}
                  templates={templates}
                  expanded={expandedId === L.id}
                  openChat={expandedId === L.id && openChat && L.external_id === openExternalId}
                  onToggle={() =>
                    setExpandedId((prev) => (prev === L.id ? null : L.id))
                  }
                  onUpdated={(next) =>
                    setListings((prev) => prev.map((x) => (x.id === next.id ? { ...x, ...next } : x)))
                  }
                  onMessage={setMessage}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'templates' && (
        <>
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

          <p style={{ margin: '0 0 12px', color: '#64748B', fontSize: 12 }}>
            Шаблоны хранятся в Цифре. «+ Новый шаблон» добавляет свой; у своих есть «Удалить».
            У шаблонов из прайса — только правка и «Сброс» к дефолту. На Авито уходит цена по кнопке
            «Цена на Авито».
          </p>

          {formOpen && (
            <div id="template-form-card" style={volumeCardStyle({ padding: 16, marginBottom: 12 })}>
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
                  Ключ (латиница, уникальный)
                  <input
                    value={form.key}
                    disabled={!creating}
                    onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                    placeholder="custom_m250_promo"
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
                    disabled={savingTemplate || !templatesPersistable}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: 'none',
                      background: '#059669',
                      color: '#fff',
                      fontWeight: 600,
                      cursor: 'pointer',
                      opacity: savingTemplate || !templatesPersistable ? 0.6 : 1,
                    }}
                  >
                    {savingTemplate
                      ? 'Сохранение…'
                      : creating
                        ? 'Добавить шаблон'
                        : 'Сохранить'}
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
                  {!creating &&
                    editingKey &&
                    (() => {
                      const editing = templates.find((x) => x.key === editingKey);
                      if (!editing || (!isUserTemplate(editing) && !editing.is_custom)) return null;
                      return (
                        <button
                          type="button"
                          onClick={() => void removeTemplate(editing)}
                          disabled={deletingKey === editing.key}
                          style={{
                            padding: '10px 14px',
                            borderRadius: 10,
                            border: '1px solid #7F1D1D',
                            background: 'rgba(127, 29, 29, 0.35)',
                            color: '#FCA5A5',
                            cursor: 'pointer',
                            opacity: deletingKey === editing.key ? 0.6 : 1,
                          }}
                        >
                          {isUserTemplate(editing) ? 'Удалить' : 'Сбросить'}
                        </button>
                      );
                    })()}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            {templates.map((t) => {
              const userOwned = isUserTemplate(t);
              return (
              <div key={t.key} style={volumeCardSoftStyle({ padding: 12 })}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 700, color: '#F8FAFC', fontSize: 17, lineHeight: 1.35 }}>
                      {t.title}
                      {userOwned && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 12,
                            fontWeight: 600,
                            color: '#BFDBFE',
                            background: '#1E3A8A',
                            padding: '2px 8px',
                            borderRadius: 6,
                            verticalAlign: 'middle',
                          }}
                        >
                          свой
                        </span>
                      )}
                      {!userOwned && t.is_custom && (
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
                        {' '}
                        · ключ {t.key}
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
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      disabled={!templatesPersistable}
                      title="Редактировать"
                      style={{
                        ...iconBtnStyle,
                        opacity: templatesPersistable ? 1 : 0.5,
                        cursor: templatesPersistable ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <Pencil size={14} /> Изменить
                    </button>
                    {userOwned && (
                      <button
                        type="button"
                        onClick={() => void removeTemplate(t)}
                        disabled={!templatesPersistable || deletingKey === t.key}
                        title="Удалить шаблон"
                        style={{
                          ...iconBtnStyle,
                          border: '1px solid #7F1D1D',
                          color: '#FCA5A5',
                          opacity: !templatesPersistable || deletingKey === t.key ? 0.5 : 1,
                        }}
                      >
                        <Trash2 size={14} /> Удалить
                      </button>
                    )}
                    {!userOwned && t.is_custom && (
                      <button
                        type="button"
                        onClick={() => void removeTemplate(t)}
                        disabled={!templatesPersistable || deletingKey === t.key}
                        title="Сбросить к дефолту"
                        style={{
                          ...iconBtnStyle,
                          opacity: !templatesPersistable || deletingKey === t.key ? 0.5 : 1,
                        }}
                      >
                        <RotateCcw size={14} /> Сброс
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </>
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
