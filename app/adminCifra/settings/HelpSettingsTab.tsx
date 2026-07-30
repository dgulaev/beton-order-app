'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { setRuntimeHelpArticles } from '@/lib/help/registry';
import type { HelpArticle, HelpBlock, HelpRole } from '@/lib/help/types';
import { volumeCardSoftStyle } from '../cardStyles';
import { appConfirm } from '../components/appDialog';
import ModalSelect from '../components/ModalSelect';

const ROLE_LABEL: Record<HelpRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  dispatcher: 'Dispatcher',
  operator: 'Operator',
  laborant: 'Laborant',
  guest: 'Guest',
  driver: 'Водитель',
};

const BLOCK_TYPE_OPTIONS: { value: HelpBlock['type']; label: string }[] = [
  { value: 'h2', label: 'Заголовок H2' },
  { value: 'h3', label: 'Заголовок H3' },
  { value: 'p', label: 'Абзац' },
  { value: 'ol', label: 'Нумерованный список' },
  { value: 'ul', label: 'Маркированный список' },
  { value: 'callout', label: 'Подсказка / важно' },
];

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: '#25334A',
  border: '1px solid #334155',
  borderRadius: 10,
  color: '#fff',
  fontSize: 14,
  boxSizing: 'border-box',
};

const labelStyle: CSSProperties = {
  display: 'block',
  color: '#94A3B8',
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 6,
};

function emptyBlock(type: HelpBlock['type']): HelpBlock {
  if (type === 'ol' || type === 'ul') return { type, items: [''] };
  if (type === 'callout') return { type: 'callout', tone: 'tip', text: '' };
  return { type, text: '' };
}

function cloneArticle(a: HelpArticle): HelpArticle {
  return JSON.parse(JSON.stringify(a)) as HelpArticle;
}

export default function HelpSettingsTab() {
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [overrideIds, setOverrideIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<HelpArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/adminCifra/help-articles');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось загрузить');
      const list = (data.articles || []) as HelpArticle[];
      setArticles(list);
      setOverrideIds(new Set((data.overrideIds || []) as string[]));
      setRuntimeHelpArticles(list);
      if (data.warning) setMessage(data.warning);
      setSelectedId((prev) => {
        if (prev && list.some((a) => a.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setDraft(null);
      return;
    }
    const found = articles.find((a) => a.id === selectedId);
    setDraft(found ? cloneArticle(found) : null);
  }, [selectedId, articles]);

  const dirty = useMemo(() => {
    if (!draft || !selectedId) return false;
    const original = articles.find((a) => a.id === selectedId);
    if (!original) return false;
    return JSON.stringify(draft) !== JSON.stringify(original);
  }, [draft, articles, selectedId]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/adminCifra/help-articles', {
        method: 'PUT',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ article: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось сохранить');
      const list = (data.articles || []) as HelpArticle[];
      setArticles(list);
      setOverrideIds(new Set((data.overrideIds || []) as string[]));
      setRuntimeHelpArticles(list);
      setMessage('Сохранено');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async () => {
    if (!draft) return;
    const ok = await appConfirm(
      'Сбросить текст к версии из кода? Правки в БД для этой статьи будут удалены.',
      { title: 'Сброс инструкции', okLabel: 'Сбросить' },
    );
    if (!ok) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/adminCifra/help-articles?id=${encodeURIComponent(draft.id)}`,
        {
          method: 'DELETE',
          headers: adminCifraAuthHeaders(),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось сбросить');
      const list = (data.articles || []) as HelpArticle[];
      setArticles(list);
      setOverrideIds(new Set((data.overrideIds || []) as string[]));
      setRuntimeHelpArticles(list);
      setMessage('Сброшено к умолчанию');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сброса');
    } finally {
      setSaving(false);
    }
  };

  const updateBlock = (index: number, next: HelpBlock) => {
    if (!draft) return;
    const body = [...draft.body];
    body[index] = next;
    setDraft({ ...draft, body });
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    if (!draft) return;
    const j = index + dir;
    if (j < 0 || j >= draft.body.length) return;
    const body = [...draft.body];
    [body[index], body[j]] = [body[j], body[index]];
    setDraft({ ...draft, body });
  };

  const removeBlock = (index: number) => {
    if (!draft) return;
    setDraft({ ...draft, body: draft.body.filter((_, i) => i !== index) });
  };

  const addBlock = (type: HelpBlock['type']) => {
    if (!draft) return;
    setDraft({ ...draft, body: [...draft.body, emptyBlock(type)] });
  };

  if (loading) {
    return <p style={{ margin: 0, color: '#94A3B8' }}>Загрузка инструкций…</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {(message || error) && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 12,
            background: error ? 'rgba(248,113,113,0.12)' : 'rgba(74,222,128,0.1)',
            border: `1px solid ${error ? 'rgba(248,113,113,0.4)' : 'rgba(74,222,128,0.35)'}`,
            color: error ? '#FCA5A5' : '#BBF7D0',
            fontSize: 13,
          }}
        >
          {error || message}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 280px) 1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* Список статей */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {articles.map((a) => {
            const on = a.id === selectedId;
            const overridden = overrideIds.has(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setSelectedId(a.id)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: on ? '1px solid rgba(96,165,250,0.55)' : '1px solid #334155',
                  background: on ? '#1E3A5F' : '#0F172A',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 650, fontSize: 14 }}>{a.title}</div>
                <div style={{ color: '#64748B', fontSize: 11, marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
                  {a.id}
                  {overridden ? ' · изменено' : ''}
                </div>
                <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>
                  {a.roles.map((r) => ROLE_LABEL[r] || r).join(', ')}
                </div>
              </button>
            );
          })}
        </div>

        {/* Редактор */}
        {draft ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={saving || !overrideIds.has(draft.id)}
                onClick={() => void resetToDefault()}
                style={volumeCardSoftStyle({
                  padding: '10px 14px',
                  borderRadius: 10,
                  color: '#FDE68A',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: overrideIds.has(draft.id) ? 'pointer' : 'not-allowed',
                  opacity: overrideIds.has(draft.id) ? 1 : 0.4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                })}
              >
                <RotateCcw size={15} /> Сбросить к умолчанию
              </button>
              <button
                type="button"
                disabled={saving || !dirty}
                onClick={() => void save()}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: 'none',
                  background: dirty ? 'linear-gradient(165deg, #10B981 0%, #059669 100%)' : '#334155',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: dirty && !saving ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                <Save size={15} /> {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>

            <div>
              <label style={labelStyle}>Заголовок</label>
              <input
                style={inputStyle}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div>
              <label style={labelStyle}>Кратко (для онбординга)</label>
              <textarea
                style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }}
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              />
            </div>

            <div
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: '#0F172A',
                border: '1px solid #334155',
                color: '#94A3B8',
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              <div>
                <strong style={{ color: '#CBD5E1' }}>Роли:</strong>{' '}
                {draft.roles.map((r) => ROLE_LABEL[r] || r).join(', ')}
              </div>
              <div style={{ marginTop: 4 }}>
                <strong style={{ color: '#CBD5E1' }}>Страница:</strong>{' '}
                {(draft.routes && draft.routes.length
                  ? draft.routes.join(', ')
                  : draft.route) || '— (вводная статья)'}
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                Роли и привязку к страницам менять нельзя — только тексты.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 15, color: '#E2E8F0' }}>Блоки текста</h3>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#94A3B8', fontSize: 13 }}>
                  <Plus size={15} />
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const v = e.target.value as HelpBlock['type'] | '';
                      if (v) addBlock(v);
                      e.target.value = '';
                    }}
                    style={{ ...inputStyle, width: 'auto', minWidth: 180, padding: '8px 12px', fontSize: 13 }}
                  >
                    <option value="" disabled>
                      Добавить блок…
                    </option>
                    {BLOCK_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {draft.body.map((block, index) => (
                <BlockEditor
                  key={index}
                  block={block}
                  index={index}
                  total={draft.body.length}
                  onChange={(next) => updateBlock(index, next)}
                  onMoveUp={() => moveBlock(index, -1)}
                  onMoveDown={() => moveBlock(index, 1)}
                  onRemove={() => removeBlock(index)}
                />
              ))}
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, color: '#94A3B8' }}>Выбери статью слева</p>
        )}
      </div>
    </div>
  );
}

function BlockEditor({
  block,
  index,
  total,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  block: HelpBlock;
  index: number;
  total: number;
  onChange: (b: HelpBlock) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const changeType = (type: HelpBlock['type']) => {
    if (type === block.type) return;
    onChange(emptyBlock(type));
  };

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 14,
        border: '1px solid #334155',
        background: '#1E2937',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ color: '#64748B', fontSize: 12, fontWeight: 700 }}>#{index + 1}</span>
        <ModalSelect
          value={block.type}
          onChange={(v) => changeType(v as HelpBlock['type'])}
          options={BLOCK_TYPE_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            text: o.label,
          }))}
          triggerStyle={{
            ...inputStyle,
            width: 'auto',
            minWidth: 160,
            padding: '6px 10px',
            fontSize: 13,
          }}
        />
        {block.type === 'callout' && (
          <ModalSelect
            value={block.tone}
            onChange={(v) =>
              onChange({ ...block, tone: v === 'warn' ? 'warn' : 'tip' })
            }
            options={[
              { value: 'tip', label: 'Подсказка', text: 'Подсказка' },
              { value: 'warn', label: 'Важно', text: 'Важно' },
            ]}
            triggerStyle={{
              ...inputStyle,
              width: 'auto',
              minWidth: 120,
              padding: '6px 10px',
              fontSize: 13,
            }}
          />
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <IconBtn title="Выше" disabled={index === 0} onClick={onMoveUp}>
            <ArrowUp size={15} />
          </IconBtn>
          <IconBtn title="Ниже" disabled={index >= total - 1} onClick={onMoveDown}>
            <ArrowDown size={15} />
          </IconBtn>
          <IconBtn title="Удалить" onClick={onRemove} danger>
            <Trash2 size={15} />
          </IconBtn>
        </div>
      </div>

      {(block.type === 'h2' ||
        block.type === 'h3' ||
        block.type === 'p' ||
        block.type === 'callout') && (
        <textarea
          style={{ ...inputStyle, minHeight: block.type === 'p' || block.type === 'callout' ? 80 : 44, resize: 'vertical' }}
          value={block.text}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
          placeholder="Текст…"
        />
      )}

      {(block.type === 'ol' || block.type === 'ul') && (
        <textarea
          style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
          value={block.items.join('\n')}
          onChange={(e) =>
            onChange({
              ...block,
              items: e.target.value.split('\n'),
            })
          }
          placeholder="Каждый пункт — с новой строки"
        />
      )}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  title,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        border: '1px solid #334155',
        background: '#0F172A',
        color: danger ? '#F87171' : '#E2E8F0',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {children}
    </button>
  );
}
