'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Plus } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import {
  INTEGRATION_KIND_LABEL,
  INTEGRATION_PRESETS,
  INTEGRATION_STATUS_LABEL,
  normalizeSourceKey,
  type IntegrationKind,
} from '@/lib/integrations/requestPresets';
import { modalFieldStyle, volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';

type RequestItem = {
  id: number;
  source_key: string;
  title: string;
  kind: IntegrationKind | string;
  status: string;
  notes: string | null;
  credentials_hint: string | null;
  docs_url: string | null;
  account_info: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: '#94A3B8',
  marginBottom: 4,
};

const fieldInput = (extra: CSSProperties = {}): CSSProperties =>
  modalFieldStyle({ width: '100%', maxWidth: '100%', boxSizing: 'border-box', ...extra });

const statusColor: Record<string, string> = {
  requested: '#FCD34D',
  in_progress: '#93C5FD',
  wired: '#6EE7B7',
  cancelled: '#94A3B8',
};

export default function IntegrationRequestsPanel() {
  const [items, setItems] = useState<RequestItem[]>([]);
  const [tableReady, setTableReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [presetKey, setPresetKey] = useState('custom');
  const preset = useMemo(
    () => INTEGRATION_PRESETS.find((p) => p.key === presetKey) || INTEGRATION_PRESETS[INTEGRATION_PRESETS.length - 1],
    [presetKey],
  );

  const [title, setTitle] = useState('');
  const [sourceKey, setSourceKey] = useState('');
  const [kind, setKind] = useState<IntegrationKind>('marketplace');
  const [notes, setNotes] = useState('');
  const [accountInfo, setAccountInfo] = useState('');
  const [docsUrl, setDocsUrl] = useState('');
  const [credentialsHint, setCredentialsHint] = useState('');

  const applyPreset = useCallback((key: string) => {
    const p = INTEGRATION_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setPresetKey(key);
    setTitle(p.title);
    setSourceKey(key === 'custom' ? '' : p.key);
    setKind(p.kind);
    setDocsUrl(p.docsUrl || '');
    setCredentialsHint(p.credentialsHint);
    setNotes('');
    setAccountInfo('');
  }, []);

  useEffect(() => {
    applyPreset('custom');
  }, [applyPreset]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/adminCifra/integrations/requests', {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || `Ошибка (${res.status})`);
        setItems([]);
        setTableReady(json.table_ready === true);
        return;
      }
      setItems(json.items || []);
      setTableReady(true);
    } catch {
      setError('Ошибка соединения');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (saving) return;
    const key = normalizeSourceKey(sourceKey || title);
    if (!title.trim()) {
      setError('Укажи название площадки');
      return;
    }
    if (!key || key.length < 2) {
      setError('Укажи ключ латиницей (youla, cian…). Из кириллицы ключ не собрать.');
      return;
    }
    if (docsUrl.trim()) {
      try {
        const u = new URL(docsUrl.trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          setError('Ссылка должна начинаться с http:// или https://');
          return;
        }
      } catch {
        setError('Некорректная ссылка на API / кабинет');
        return;
      }
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/adminCifra/integrations/requests', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          title: title.trim(),
          source_key: key,
          kind,
          notes,
          account_info: accountInfo,
          docs_url: docsUrl.trim(),
          credentials_hint: credentialsHint,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || 'Не удалось создать');
        return;
      }
      setMessage('Заявка создана — разработчик подключит adapter и секреты в коде');
      setShowForm(false);
      applyPreset('custom');
      await load();
    } catch {
      setError('Ошибка соединения');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: number, status: string) => {
    if (statusBusyId != null) return;
    setStatusBusyId(id);
    setError(null);
    try {
      const res = await fetch('/api/adminCifra/integrations/requests', {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || 'Не удалось обновить статус');
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...json.item } : i)));
    } catch {
      setError('Ошибка соединения');
    } finally {
      setStatusBusyId(null);
    }
  };

  return (
    <section style={volumeCardStyle({ padding: 'clamp(14px, 2vw, 22px)', marginBottom: 16 })}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 14,
          alignItems: 'center',
        }}
      >
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#A78BFA',
              marginBottom: 4,
            }}
          >
            Заявки
          </div>
          <h2 style={{ margin: 0, color: '#F8FAFC', fontSize: 'clamp(16px, 2vw, 18px)' }}>
            Новая площадка
          </h2>
          <p style={{ margin: '4px 0 0', color: '#94A3B8', fontSize: 13, lineHeight: 1.45 }}>
            Заявка с ТЗ для разработчика. Секреты сюда не пишем — только название, кабинет и что нужно.
          </p>
        </div>
        {!showForm && items.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowForm(true);
              setMessage(null);
              setError(null);
            }}
            style={{
              border: '1px solid rgba(167,139,250,0.45)',
              background: 'rgba(124,58,237,0.2)',
              color: '#E9D5FF',
              padding: '10px 14px',
              borderRadius: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontWeight: 600,
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            <Plus size={16} /> Новая заявка
          </button>
        )}
      </div>

      {!tableReady && (
        <div style={{ color: '#FDE68A', fontSize: 13, marginBottom: 12, wordBreak: 'break-word' }}>
          Нужна таблица: выполни в Supabase{' '}
          <code>scripts/integration-requests-schema.sql</code>
        </div>
      )}
      {error && (
        <div style={{ color: '#FCA5A5', fontSize: 13, marginBottom: 10, wordBreak: 'break-word' }}>
          {error}
        </div>
      )}
      {message && (
        <div style={{ color: '#6EE7B7', fontSize: 13, marginBottom: 10 }}>{message}</div>
      )}

      {showForm && (
        <div
          style={volumeCardSoftStyle({
            padding: 16,
            marginBottom: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          })}
        >
          <label>
            <span style={labelStyle}>Шаблон</span>
            <select
              value={presetKey}
              onChange={(e) => applyPreset(e.target.value)}
              style={fieldInput()}
            >
              {INTEGRATION_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>

          <div
            style={{
              padding: 12,
              borderRadius: 12,
              background: 'rgba(124,58,237,0.12)',
              border: '1px solid rgba(167,139,250,0.35)',
              color: '#E9D5FF',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: '#F5F3FF' }}>Инструкция</strong>
            <p style={{ margin: '6px 0 0' }}>{preset.managerGuide}</p>
            <ol style={{ margin: '10px 0 0', paddingLeft: 18 }}>
              <li>Заполни название и ключ площадки (латиница).</li>
              <li>В «Данные аккаунта» — логин/ID кабинета (без паролей и secret).</li>
              <li>В заметках — что нужно: объявления, чаты, тендеры.</li>
              <li>
                Блок «Ключи для кода» оставь как шаблон — разработчик пропишет значения в env.
              </li>
            </ol>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
              gap: 12,
            }}
          >
            <label style={{ minWidth: 0 }}>
              <span style={labelStyle}>Название</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={fieldInput()}
                placeholder="Юла"
              />
            </label>
            <label style={{ minWidth: 0 }}>
              <span style={labelStyle}>Ключ (source) — только латиница</span>
              <input
                value={sourceKey}
                onChange={(e) => setSourceKey(normalizeSourceKey(e.target.value))}
                style={fieldInput()}
                placeholder="youla"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: '#64748B' }}>
                Уникальный id в коде. Кириллица отбрасывается.
              </span>
            </label>
            <label style={{ minWidth: 0 }}>
              <span style={labelStyle}>Тип</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as IntegrationKind)}
                style={fieldInput()}
              >
                <option value="marketplace">Площадка (объявления/чаты)</option>
                <option value="demand">Спрос / тендеры</option>
                <option value="other">Прочее</option>
              </select>
            </label>
          </div>

          <label style={{ minWidth: 0 }}>
            <span style={labelStyle}>Данные аккаунта (без секретов)</span>
            <input
              value={accountInfo}
              onChange={(e) => setAccountInfo(e.target.value)}
              style={fieldInput()}
              placeholder="логин кабинета, ID продавца, email…"
            />
          </label>
          <label style={{ minWidth: 0 }}>
            <span style={labelStyle}>Ссылка на API / кабинет</span>
            <input
              value={docsUrl}
              onChange={(e) => setDocsUrl(e.target.value)}
              style={fieldInput()}
              placeholder="https://…"
            />
          </label>
          <label style={{ minWidth: 0 }}>
            <span style={labelStyle}>Заметки / ТЗ</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={fieldInput({ resize: 'vertical' })}
              placeholder="Нужны входящие сообщения → лиды, синк объявлений…"
            />
          </label>
          <label style={{ minWidth: 0 }}>
            <span style={labelStyle}>Ключи для кода (шаблон env — без значений)</span>
            <textarea
              value={credentialsHint}
              onChange={(e) => setCredentialsHint(e.target.value)}
              rows={6}
              style={fieldInput({
                resize: 'vertical',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
              })}
            />
          </label>

          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              alignItems: 'stretch',
            }}
          >
            <button
              type="button"
              disabled={saving || !title.trim()}
              onClick={() => void create()}
              style={{
                border: 'none',
                background: saving ? '#5B21B6' : '#7C3AED',
                color: '#fff',
                padding: '12px 16px',
                borderRadius: 12,
                cursor: saving ? 'wait' : 'pointer',
                fontWeight: 600,
                flex: '1 1 160px',
                minHeight: 44,
              }}
            >
              {saving ? 'Создание…' : 'Создать заявку'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setShowForm(false);
                setError(null);
              }}
              style={{
                border: '1px solid #334155',
                background: 'transparent',
                color: '#94A3B8',
                padding: '12px 16px',
                borderRadius: 12,
                cursor: 'pointer',
                fontWeight: 500,
                flex: '1 1 120px',
                minHeight: 44,
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: '#94A3B8', margin: 0 }}>Загрузка заявок…</p>
      ) : items.length === 0 && !showForm ? (
        <div
          style={{
            textAlign: 'center',
            padding: '28px 16px',
            borderRadius: 14,
            border: '1px dashed #334155',
            background: 'rgba(15,23,42,0.5)',
          }}
        >
          <p style={{ color: '#94A3B8', margin: '0 0 14px', fontSize: 14 }}>
            Заявок пока нет — можно завести Юлу, ЦИАН или другую площадку.
          </p>
          <button
            type="button"
            onClick={() => {
              setShowForm(true);
              setMessage(null);
              setError(null);
            }}
            style={{
              border: 'none',
              background: '#7C3AED',
              color: '#fff',
              padding: '12px 18px',
              borderRadius: 12,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            <Plus size={16} /> Добавить площадку
          </button>
        </div>
      ) : items.length === 0 && showForm ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={volumeCardSoftStyle({
                padding: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              })}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#F8FAFC', fontWeight: 700, wordBreak: 'break-word' }}>
                    {item.title}{' '}
                    <span style={{ color: '#A78BFA', fontWeight: 600, fontSize: 13 }}>
                      · {item.source_key}
                    </span>
                  </div>
                  <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 2 }}>
                    {INTEGRATION_KIND_LABEL[item.kind as IntegrationKind] || item.kind}
                    {item.created_by_name ? ` · ${item.created_by_name}` : ''}
                    {' · '}
                    {new Date(item.created_at).toLocaleString('ru-RU')}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: statusColor[item.status] || '#E2E8F0',
                    border: `1px solid ${statusColor[item.status] || '#334155'}`,
                    padding: '4px 10px',
                    borderRadius: 999,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {INTEGRATION_STATUS_LABEL[item.status] || item.status}
                </span>
              </div>

              {item.account_info && (
                <div style={{ color: '#CBD5E1', fontSize: 13, wordBreak: 'break-word' }}>
                  Аккаунт: {item.account_info}
                </div>
              )}
              {item.notes && (
                <div
                  style={{
                    color: '#CBD5E1',
                    fontSize: 13,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {item.notes}
                </div>
              )}
              {item.docs_url && (
                <a
                  href={item.docs_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#93C5FD', fontSize: 13, wordBreak: 'break-all' }}
                >
                  {item.docs_url}
                </a>
              )}
              {item.credentials_hint && (
                <pre
                  style={{
                    margin: 0,
                    padding: 10,
                    borderRadius: 10,
                    background: '#020617',
                    border: '1px solid #1E293B',
                    color: '#94A3B8',
                    fontSize: 11,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {item.credentials_hint}
                </pre>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(
                  [
                    ['requested', 'Заявка'],
                    ['in_progress', 'В работе'],
                    ['wired', 'Подключено'],
                    ['cancelled', 'Отменить'],
                  ] as const
                ).map(([st, label]) => {
                  const busy = statusBusyId === item.id;
                  const active = item.status === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      disabled={active || statusBusyId != null}
                      onClick={() => void setStatus(item.id, st)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid #334155',
                        background: active ? '#1E293B' : 'transparent',
                        color: '#CBD5E1',
                        fontSize: 12,
                        cursor: active || busy ? 'default' : 'pointer',
                        opacity: active ? 0.7 : busy ? 0.5 : 1,
                        minHeight: 36,
                      }}
                    >
                      {busy && !active ? '…' : label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
