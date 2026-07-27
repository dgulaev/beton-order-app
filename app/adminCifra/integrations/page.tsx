'use client';

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { Cable, CheckCircle2, CircleAlert, RefreshCw, Save } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { useUserRole } from '../../providers/UserRoleProvider';
import {
  modalFieldStyle,
  volumeCardSoftStyle,
  volumeCardStyle,
} from '../cardStyles';
import IntegrationRequestsPanel from './IntegrationRequestsPanel';

type PublicSettings = {
  avito: {
    enabled: boolean;
    configured: boolean;
    demand_from_messenger: boolean;
    client_id: string | null;
    user_id: string | null;
    client_secret_set: boolean;
    webhook_secret_set: boolean;
    client_id_from_db: boolean;
    user_id_from_db: boolean;
    client_secret_from_db: boolean;
    webhook_secret_from_db: boolean;
  };
  gosplan: {
    enabled: boolean;
    base_url: string;
    regions: string;
    api_key_set: boolean;
    api_key_from_db: boolean;
  };
  demand: {
    demo: boolean;
    feed_url: string | null;
    home_regions: string;
    min_volume_m3: number | null;
    alert_score: number;
    feed_url_from_db: boolean;
    home_regions_from_db: boolean;
  };
  table_ready: boolean;
  updated_at: string | null;
};

type FormState = {
  avito_enabled: boolean;
  avito_demand_messenger: boolean;
  avito_client_id: string;
  avito_user_id: string;
  avito_client_secret: string;
  avito_webhook_secret: string;
  clear_avito_client_secret: boolean;
  clear_avito_webhook_secret: boolean;
  gosplan_enabled: boolean;
  gosplan_base_url: string;
  gosplan_regions: string;
  gosplan_api_key: string;
  clear_gosplan_api_key: boolean;
  demand_demo: boolean;
  demand_feed_url: string;
  demand_home_regions: string;
  demand_min_volume_m3: string;
  demand_alert_score: string;
};

const pageWrap: CSSProperties = {
  padding: 'clamp(12px, 2vw, 28px)',
  width: '100%',
  maxWidth: 'min(1280px, 100%)',
  margin: '0 auto',
  boxSizing: 'border-box',
  overflowX: 'hidden',
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 13,
  color: '#94A3B8',
  marginBottom: 4,
};

const hintStyle: CSSProperties = {
  display: 'block',
  marginTop: 4,
  fontSize: 12,
  color: '#64748B',
  wordBreak: 'break-word',
};

const fieldInput = (extra: CSSProperties = {}): CSSProperties =>
  modalFieldStyle({ width: '100%', maxWidth: '100%', boxSizing: 'border-box', ...extra });

const grid2: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
  gap: 12,
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: ok ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.12)',
        color: ok ? '#6EE7B7' : '#FCD34D',
        border: `1px solid ${ok ? 'rgba(52,211,153,0.35)' : 'rgba(251,191,36,0.35)'}`,
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {ok ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
      {label}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        border: 'none',
        background: 'transparent',
        color: '#E2E8F0',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 0,
        opacity: disabled ? 0.5 : 1,
        textAlign: 'left',
      }}
    >
      <span
        style={{
          width: 44,
          height: 26,
          borderRadius: 999,
          background: checked ? '#059669' : '#334155',
          position: 'relative',
          transition: 'background 0.15s',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 22 : 3,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.15s',
          }}
        />
      </span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

function Section({
  title,
  subtitle,
  status,
  children,
}: {
  title: string;
  subtitle: string;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={volumeCardStyle({ padding: 'clamp(14px, 2vw, 22px)', marginBottom: 16 })}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <h2 style={{ margin: 0, color: '#F8FAFC', fontSize: 'clamp(16px, 2vw, 18px)' }}>{title}</h2>
          <p
            style={{
              margin: '4px 0 0',
              color: '#94A3B8',
              fontSize: 13,
              lineHeight: 1.45,
              wordBreak: 'break-word',
            }}
          >
            {subtitle}
          </p>
        </div>
        {status}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </section>
  );
}

/**
 * В инпуты кладём только значения из БД.
 * Эффективные (env) показываем подсказкой — иначе Save скопирует env в таблицу.
 */
function formFromSettings(s: PublicSettings): FormState {
  return {
    avito_enabled: s.avito.enabled,
    avito_demand_messenger: s.avito.demand_from_messenger,
    avito_client_id: s.avito.client_id_from_db ? s.avito.client_id || '' : '',
    avito_user_id: s.avito.user_id_from_db ? s.avito.user_id || '' : '',
    avito_client_secret: '',
    avito_webhook_secret: '',
    clear_avito_client_secret: false,
    clear_avito_webhook_secret: false,
    gosplan_enabled: s.gosplan.enabled,
    gosplan_base_url: s.gosplan.base_url || '',
    gosplan_regions: s.gosplan.regions || '32',
    gosplan_api_key: '',
    clear_gosplan_api_key: false,
    demand_demo: s.demand.demo,
    demand_feed_url: s.demand.feed_url_from_db ? s.demand.feed_url || '' : '',
    demand_home_regions: s.demand.home_regions_from_db
      ? s.demand.home_regions || ''
      : '',
    demand_min_volume_m3:
      s.demand.min_volume_m3 != null ? String(s.demand.min_volume_m3) : '',
    demand_alert_score: String(s.demand.alert_score ?? 60),
  };
}

export default function IntegrationsPage() {
  const { isAdmin, user, loading: roleLoading } = useUserRole();
  const canView = isAdmin || user?.role === 'manager';
  const canEditSecrets = isAdmin;

  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/adminCifra/integrations', {
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || `Ошибка (${res.status})`);
        setSettings(null);
        setForm(null);
        return;
      }
      setSettings(json.settings);
      setForm(formFromSettings(json.settings));
    } catch {
      setError('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (roleLoading) return;
    if (!canView) {
      setLoading(false);
      return;
    }
    void load();
  }, [roleLoading, canView, load]);

  const save = async () => {
    if (!form || !canEditSecrets || saving) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        avito_enabled: form.avito_enabled,
        avito_demand_messenger: form.avito_demand_messenger,
        avito_client_id: form.avito_client_id,
        avito_user_id: form.avito_user_id,
        gosplan_enabled: form.gosplan_enabled,
        gosplan_base_url: form.gosplan_base_url,
        gosplan_regions: form.gosplan_regions,
        demand_demo: form.demand_demo,
        demand_feed_url: form.demand_feed_url,
        demand_home_regions: form.demand_home_regions,
        demand_min_volume_m3: form.demand_min_volume_m3,
        demand_alert_score: form.demand_alert_score,
      };
      if (form.avito_client_secret.trim()) {
        body.avito_client_secret = form.avito_client_secret.trim();
      } else if (form.clear_avito_client_secret) {
        body.clear_avito_client_secret = true;
      }
      if (form.avito_webhook_secret.trim()) {
        body.avito_webhook_secret = form.avito_webhook_secret.trim();
      } else if (form.clear_avito_webhook_secret) {
        body.clear_avito_webhook_secret = true;
      }
      if (form.gosplan_api_key.trim()) {
        body.gosplan_api_key = form.gosplan_api_key.trim();
      } else if (form.clear_gosplan_api_key) {
        body.clear_gosplan_api_key = true;
      }

      const res = await fetch('/api/adminCifra/integrations', {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || 'Не удалось сохранить');
        return;
      }
      setSettings(json.settings);
      setForm(formFromSettings(json.settings));
      setMessage('Сохранено');
    } catch {
      setError('Ошибка соединения');
    } finally {
      setSaving(false);
    }
  };

  if (roleLoading) {
    return (
      <div style={pageWrap}>
        <p style={{ color: '#94A3B8' }}>Загрузка…</p>
      </div>
    );
  }

  if (!canView) {
    return (
      <div style={pageWrap}>
        <div style={volumeCardStyle({ padding: 24, color: '#FCA5A5' })}>
          Доступ только для admin и manager.
        </div>
      </div>
    );
  }

  const settingsToolbar = canEditSecrets ? (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 14,
      }}
    >
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: '#34D399',
            marginBottom: 2,
          }}
        >
          Настройки
        </div>
        <div style={{ color: '#94A3B8', fontSize: 13 }}>
          Авито, ГосПлан, Спрос — пустой secret не меняет значение
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          flex: '1 1 220px',
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || saving}
          title="Обновить настройки"
          aria-label="Обновить настройки"
          style={volumeCardSoftStyle({
            border: 'none',
            color: '#94A3B8',
            padding: '10px 12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            minHeight: 44,
          })}
        >
          <RefreshCw size={16} />
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !form || loading}
          style={{
            border: 'none',
            background: '#059669',
            color: '#fff',
            padding: '10px 16px',
            borderRadius: 12,
            cursor: saving ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontWeight: 600,
            opacity: saving ? 0.7 : 1,
            flex: '1 1 180px',
            minHeight: 44,
            maxWidth: 320,
          }}
        >
          <Save size={16} /> {saving ? 'Сохранение…' : 'Сохранить настройки'}
        </button>
      </div>
    </div>
  ) : (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: '#64748B',
        marginBottom: 10,
      }}
    >
      Подключения (только просмотр)
    </div>
  );

  const settingsBlock =
    loading || !form || !settings ? (
      <p style={{ color: '#94A3B8' }}>Загрузка настроек…</p>
    ) : (
      <>
        {settingsToolbar}
        <fieldset
          disabled={!canEditSecrets}
          style={{
            border: 'none',
            margin: 0,
            padding: 0,
            minWidth: 0,
            opacity: canEditSecrets ? 1 : 0.72,
          }}
        >
          <Section
            title="Авито"
            subtitle="Объявления, чаты, webhook → лиды. После смены webhook-секрета переподпиши на «Площадках»."
            status={
              <StatusPill
                ok={settings.avito.configured}
                label={settings.avito.configured ? 'Подключено' : 'Не настроено'}
              />
            }
          >
            <Toggle
              checked={form.avito_enabled}
              onChange={(v) => setForm((f) => (f ? { ...f, avito_enabled: v } : f))}
              label={form.avito_enabled ? 'Включено' : 'Выключено'}
            />
            <Toggle
              checked={form.avito_demand_messenger}
              onChange={(v) =>
                setForm((f) => (f ? { ...f, avito_demand_messenger: v } : f))
              }
              label={
                form.avito_demand_messenger
                  ? 'Спрос из чатов Авито: вкл.'
                  : 'Спрос из чатов Авито: выкл.'
              }
            />
            <p style={{ margin: 0, fontSize: 12, color: '#64748B', lineHeight: 1.45 }}>
              Легально: только входящие в ваши объявления (Messenger API). Поиск чужих объявлений
              Авито не отдаёт и мы его не парсим — риск бана.
            </p>
            <div style={grid2}>
              <label style={{ minWidth: 0 }}>
                <span style={labelStyle}>Client ID</span>
                <input
                  value={form.avito_client_id}
                  onChange={(e) =>
                    setForm((f) => (f ? { ...f, avito_client_id: e.target.value } : f))
                  }
                  style={fieldInput()}
                  placeholder="оставить пустым → из env"
                  autoComplete="off"
                />
                {!settings.avito.client_id_from_db && settings.avito.client_id && (
                  <span style={hintStyle}>Сейчас из env: {settings.avito.client_id}</span>
                )}
              </label>
              <label style={{ minWidth: 0 }}>
                <span style={labelStyle}>User ID</span>
                <input
                  value={form.avito_user_id}
                  onChange={(e) =>
                    setForm((f) => (f ? { ...f, avito_user_id: e.target.value } : f))
                  }
                  style={fieldInput()}
                  placeholder="числовой id · пусто → env"
                  autoComplete="off"
                  inputMode="numeric"
                />
                {!settings.avito.user_id_from_db && settings.avito.user_id && (
                  <span style={hintStyle}>Сейчас из env: {settings.avito.user_id}</span>
                )}
              </label>
            </div>
            <label style={{ minWidth: 0 }}>
              <span style={labelStyle}>
                Client Secret{' '}
                {settings.avito.client_secret_set ? (
                  <span style={{ color: '#6EE7B7' }}>
                    · задан{settings.avito.client_secret_from_db ? ' (БД)' : ' (env)'}
                  </span>
                ) : (
                  <span style={{ color: '#FCD34D' }}>· не задан</span>
                )}
              </span>
              <input
                type="password"
                value={form.avito_client_secret}
                onChange={(e) =>
                  setForm((f) =>
                    f
                      ? {
                          ...f,
                          avito_client_secret: e.target.value,
                          clear_avito_client_secret: false,
                        }
                      : f,
                  )
                }
                style={fieldInput()}
                placeholder="оставьте пустым, чтобы не менять"
                autoComplete="new-password"
              />
            </label>
            {settings.avito.client_secret_from_db && (
              <label style={{ fontSize: 13, color: '#94A3B8', display: 'flex', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.clear_avito_client_secret}
                  onChange={(e) =>
                    setForm((f) =>
                      f
                        ? {
                            ...f,
                            clear_avito_client_secret: e.target.checked,
                            avito_client_secret: '',
                          }
                        : f,
                    )
                  }
                />
                Очистить secret в БД (вернуться к env)
              </label>
            )}
            <label style={{ minWidth: 0 }}>
              <span style={labelStyle}>
                Webhook secret{' '}
                {settings.avito.webhook_secret_set ? (
                  <span style={{ color: '#6EE7B7' }}>
                    · задан{settings.avito.webhook_secret_from_db ? ' (БД)' : ' (env)'}
                  </span>
                ) : (
                  <span style={{ color: '#FCD34D' }}>· не задан</span>
                )}
              </span>
              <input
                type="password"
                value={form.avito_webhook_secret}
                onChange={(e) =>
                  setForm((f) =>
                    f
                      ? {
                          ...f,
                          avito_webhook_secret: e.target.value,
                          clear_avito_webhook_secret: false,
                        }
                      : f,
                  )
                }
                style={fieldInput()}
                placeholder="свой секрет для URL webhook"
                autoComplete="new-password"
              />
            </label>
            {settings.avito.webhook_secret_from_db && (
              <label style={{ fontSize: 13, color: '#94A3B8', display: 'flex', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.clear_avito_webhook_secret}
                  onChange={(e) =>
                    setForm((f) =>
                      f
                        ? {
                            ...f,
                            clear_avito_webhook_secret: e.target.checked,
                            avito_webhook_secret: '',
                          }
                        : f,
                    )
                  }
                />
                Очистить webhook-секрет в БД (вернуться к env)
              </label>
            )}
            <div style={{ fontSize: 13, color: '#94A3B8' }}>
              Подписка webhook:{' '}
              <Link href="/adminCifra/marketplace" style={{ color: '#93C5FD' }}>
                Площадки → Подключить webhook
              </Link>
            </div>
          </Section>

          <Section
            title="ГосПлан / ЕИС"
            subtitle="Источник тендеров для страницы «Спрос»."
            status={
              <StatusPill
                ok={settings.gosplan.enabled}
                label={settings.gosplan.enabled ? 'Включён' : 'Выключен'}
              />
            }
          >
            <Toggle
              checked={form.gosplan_enabled}
              onChange={(v) => setForm((f) => (f ? { ...f, gosplan_enabled: v } : f))}
              label={form.gosplan_enabled ? 'Сбор включён' : 'Сбор выключен'}
            />
            <label style={{ minWidth: 0 }}>
              <span style={labelStyle}>Base URL</span>
              <input
                value={form.gosplan_base_url}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, gosplan_base_url: e.target.value } : f))
                }
                style={fieldInput()}
                placeholder="https://v2test.gosplan.info"
              />
            </label>
            <label style={{ minWidth: 0 }}>
              <span style={labelStyle}>Регионы (коды субъектов ЕИС через запятую)</span>
              <input
                value={form.gosplan_regions}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, gosplan_regions: e.target.value } : f))
                }
                style={fieldInput()}
                placeholder="32"
              />
              <span style={hintStyle}>32 = Брянская область</span>
            </label>
            <label style={{ minWidth: 0 }}>
              <span style={labelStyle}>
                API key{' '}
                {settings.gosplan.api_key_set ? (
                  <span style={{ color: '#6EE7B7' }}>
                    · задан{settings.gosplan.api_key_from_db ? ' (БД)' : ' (env)'}
                  </span>
                ) : (
                  <span style={{ color: '#94A3B8' }}>· не обязателен на тесте</span>
                )}
              </span>
              <input
                type="password"
                value={form.gosplan_api_key}
                onChange={(e) =>
                  setForm((f) =>
                    f
                      ? {
                          ...f,
                          gosplan_api_key: e.target.value,
                          clear_gosplan_api_key: false,
                        }
                      : f,
                  )
                }
                style={fieldInput()}
                placeholder="для продакшен-сервера ГосПлан"
                autoComplete="new-password"
              />
            </label>
            {settings.gosplan.api_key_from_db && (
              <label style={{ fontSize: 13, color: '#94A3B8', display: 'flex', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.clear_gosplan_api_key}
                  onChange={(e) =>
                    setForm((f) =>
                      f
                        ? {
                            ...f,
                            clear_gosplan_api_key: e.target.checked,
                            gosplan_api_key: '',
                          }
                        : f,
                    )
                  }
                />
                Очистить API key в БД
              </label>
            )}
          </Section>

          <Section
            title="Спрос (Demand Radar)"
            subtitle="Регион завода, лента и демо. Запуск поиска — на странице «Спрос»."
            status={
              <StatusPill
                ok={
                  Boolean(settings.demand.feed_url) ||
                  settings.gosplan.enabled ||
                  settings.demand.demo
                }
                label="Параметры"
              />
            }
          >
            <Toggle
              checked={form.demand_demo}
              onChange={(v) => setForm((f) => (f ? { ...f, demand_demo: v } : f))}
              label={form.demand_demo ? 'Демо-карточки вкл.' : 'Демо выкл.'}
            />
            <p style={{ margin: 0, fontSize: 12, color: '#64748B' }}>
              На Vercel production демо всегда игнорируется.
            </p>
            <label style={{ minWidth: 0 }}>
              <span style={labelStyle}>Регионы завода (слова через запятую)</span>
              <input
                value={form.demand_home_regions}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, demand_home_regions: e.target.value } : f))
                }
                style={fieldInput()}
                placeholder="пусто → env / брянск,брянская"
              />
              {!settings.demand.home_regions_from_db && settings.demand.home_regions && (
                <span style={hintStyle}>Сейчас: {settings.demand.home_regions}</span>
              )}
            </label>
            <label style={{ minWidth: 0 }}>
              <span style={labelStyle}>JSON-лента</span>
              <input
                value={form.demand_feed_url}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, demand_feed_url: e.target.value } : f))
                }
                style={fieldInput()}
                placeholder="https://… · пусто → env"
              />
              {!settings.demand.feed_url_from_db && settings.demand.feed_url && (
                <span style={hintStyle}>Сейчас из env: {settings.demand.feed_url}</span>
              )}
            </label>
            <div style={grid2}>
              <label style={{ minWidth: 0 }}>
                <span style={labelStyle}>Мин. объём, м³</span>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.demand_min_volume_m3}
                  onChange={(e) =>
                    setForm((f) => (f ? { ...f, demand_min_volume_m3: e.target.value } : f))
                  }
                  style={fieldInput()}
                />
              </label>
              <label style={{ minWidth: 0 }}>
                <span style={labelStyle}>Порог алерта, %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.demand_alert_score}
                  onChange={(e) =>
                    setForm((f) => (f ? { ...f, demand_alert_score: e.target.value } : f))
                  }
                  style={fieldInput()}
                />
              </label>
            </div>
            <div style={{ fontSize: 13, color: '#94A3B8' }}>
              <Link href="/adminCifra/demand" style={{ color: '#93C5FD' }}>
                Открыть Спрос →
              </Link>
            </div>
          </Section>

          {settings.updated_at && (
            <p style={{ color: '#64748B', fontSize: 12, marginTop: 4 }}>
              Обновлено: {new Date(settings.updated_at).toLocaleString('ru-RU')}
            </p>
          )}
        </fieldset>

        {canEditSecrets && (
          <div
            style={{
              position: 'sticky',
              bottom: 12,
              zIndex: 5,
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              background: 'rgba(15,23,42,0.94)',
              border: '1px solid rgba(52,211,153,0.35)',
              display: 'flex',
              justifyContent: 'stretch',
              backdropFilter: 'blur(8px)',
            }}
          >
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || loading}
              style={{
                border: 'none',
                background: '#059669',
                color: '#fff',
                padding: '12px 18px',
                borderRadius: 12,
                cursor: saving ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontWeight: 600,
                width: '100%',
                minHeight: 48,
              }}
            >
              <Save size={16} /> {saving ? 'Сохранение…' : 'Сохранить настройки'}
            </button>
          </div>
        )}
      </>
    );

  return (
    <div style={pageWrap}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 22,
          flexWrap: 'wrap',
        }}
      >
        <Cable size={28} color="#A78BFA" style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h1 style={{ margin: 0, color: '#F1F5F9', fontSize: 'clamp(20px, 2vw, 28px)' }}>
            Интеграции
          </h1>
          <p style={{ margin: '4px 0 0', color: '#94A3B8', fontSize: 13, lineHeight: 1.4 }}>
            {canEditSecrets
              ? 'Сверху — ключи и тумблеры. Ниже — заявки на новые площадки.'
              : 'Можно создать заявку на площадку. Секреты правит только admin.'}
          </p>
        </div>
      </div>

      {!canEditSecrets && (
        <div
          style={volumeCardSoftStyle({
            padding: 12,
            marginBottom: 14,
            color: '#FDE68A',
            fontSize: 13,
          })}
        >
          Секреты редактирует admin. Вам доступны заявки на новые площадки.
        </div>
      )}

      {settings && !settings.table_ready && (
        <div style={volumeCardStyle({ padding: 14, marginBottom: 14, color: '#FDE68A', fontSize: 13 })}>
          Таблица настроек ещё не создана — работают только env. Выполни в Supabase:{' '}
          <code style={{ wordBreak: 'break-all' }}>scripts/integration-settings-schema.sql</code>
        </div>
      )}

      {error && (
        <div
          style={volumeCardStyle({
            padding: 14,
            marginBottom: 12,
            color: '#FCA5A5',
            wordBreak: 'break-word',
          })}
        >
          {error}
        </div>
      )}
      {message && (
        <div style={{ marginBottom: 12, color: '#6EE7B7', fontSize: 14 }}>{message}</div>
      )}

      {/* Admin: сначала настройки (зелёная «Сохранить»), потом заявки.
          Manager: сначала заявки, настройки только смотреть. */}
      {canEditSecrets ? (
        <>
          {settingsBlock}
          <div style={{ height: 8 }} />
          <IntegrationRequestsPanel />
        </>
      ) : (
        <>
          <IntegrationRequestsPanel />
          <div style={{ height: 8 }} />
          {settingsBlock}
        </>
      )}
    </div>
  );
}
