'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MessageCircle,
  Save,
} from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import type { ListingTemplate } from '@/lib/avitoListingTemplates';
import { volumeCardSoftStyle } from '../cardStyles';
import { ListingChat } from './ListingChat';

export type MarketplaceListing = {
  id: number;
  source: string;
  external_id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  status: string;
  url: string | null;
  category: string | null;
  city: string | null;
  views: number | null;
  contacts: number | null;
  template_key: string | null;
  last_synced_at: string | null;
  updated_at?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

type Props = {
  listing: MarketplaceListing;
  templates: ListingTemplate[];
  expanded: boolean;
  openChat: boolean;
  onToggle: () => void;
  onUpdated: (listing: MarketplaceListing) => void;
  onMessage: (msg: string) => void;
};

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    active: 'Активно',
    old: 'Архив',
    rejected: 'Отклонено',
    blocked: 'Заблокировано',
    removed: 'Снято',
  };
  return map[status] || status;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ListingCard({
  listing,
  templates,
  expanded,
  openChat,
  onToggle,
  onUpdated,
  onMessage,
}: Props) {
  const [title, setTitle] = useState(listing.title || '');
  const [description, setDescription] = useState(listing.description || '');
  const [price, setPrice] = useState(
    listing.price != null ? String(listing.price) : '',
  );
  const [saving, setSaving] = useState(false);
  const [pushingPrice, setPushingPrice] = useState(false);
  const [showChat, setShowChat] = useState(openChat);

  useEffect(() => {
    setTitle(listing.title || '');
    setDescription(listing.description || '');
    setPrice(listing.price != null ? String(listing.price) : '');
  }, [listing.id, listing.title, listing.description, listing.price]);

  useEffect(() => {
    if (openChat) {
      setShowChat(true);
    }
  }, [openChat]);

  const patch = useCallback(
    async (body: Record<string, unknown>, okMsg: string) => {
      const res = await fetch(`/api/adminCifra/marketplace/listings/${listing.id}`, {
        method: 'PATCH',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        onMessage(json.error || 'Не удалось сохранить');
        return null;
      }
      onUpdated(json.listing as MarketplaceListing);
      onMessage(okMsg);
      return json.listing as MarketplaceListing;
    },
    [listing.id, onMessage, onUpdated],
  );

  const saveLocal = async () => {
    setSaving(true);
    try {
      const priceNum = price === '' ? null : Number(price);
      if (price !== '' && (!Number.isFinite(priceNum) || (priceNum as number) < 0)) {
        onMessage('Некорректная цена');
        return;
      }
      await patch(
        {
          title: title.trim() || null,
          description: description.trim() || null,
          price: priceNum,
          push_to_avito: false,
        },
        'Карточка сохранена в Цифре (на Авито не уходило)',
      );
    } finally {
      setSaving(false);
    }
  };

  const pushPrice = async () => {
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      onMessage('Некорректная цена');
      return;
    }
    setPushingPrice(true);
    try {
      await patch(
        { price: priceNum, push_to_avito: true },
        'Цена обновлена на Авито',
      );
    } finally {
      setPushingPrice(false);
    }
  };

  const applyTemplate = async (templateKey: string) => {
    if (!templateKey) return;
    await patch(
      { template_key: templateKey, apply_template: true, push_to_avito: false },
      'Шаблон применён локально',
    );
  };

  return (
    <div style={volumeCardSoftStyle({ padding: 16 })}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ color: '#F8FAFC', fontWeight: 700, fontSize: 16 }}>
            {listing.title || `Объявление ${listing.external_id}`}
          </div>
          <div style={{ color: '#94A3B8', fontSize: 13, marginTop: 4 }}>
            {statusLabel(listing.status)}
            {listing.price != null
              ? ` · ${Number(listing.price).toLocaleString('ru-RU')} ₽`
              : ''}
            {` · просмотры ${listing.views ?? 0} · контакты ${listing.contacts ?? 0}`}
            {listing.city ? ` · ${listing.city}` : ''}
            {listing.template_key ? ` · шаблон ${listing.template_key}` : ''}
          </div>
          {!expanded && listing.description && (
            <div
              style={{
                marginTop: 8,
                color: '#CBD5E1',
                fontSize: 13,
                lineHeight: 1.4,
                maxHeight: 40,
                overflow: 'hidden',
              }}
            >
              {listing.description}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94A3B8' }}>
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </button>

      {expanded && (
        <div style={{ marginTop: 16, borderTop: '1px solid #334155', paddingTop: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 100%), 1fr))',
              gap: 10,
              marginBottom: 14,
            }}
          >
            <Meta label="Статус" value={statusLabel(listing.status)} />
            <Meta label="Категория" value={listing.category || '—'} />
            {listing.city ? <Meta label="Город" value={listing.city} /> : null}
            <Meta label="Просмотры" value={String(listing.views ?? 0)} />
            <Meta label="Контакты" value={String(listing.contacts ?? 0)} />
            {(() => {
              const st = listing.raw_payload?._stats as
                | { favorites?: number }
                | undefined;
              return st?.favorites != null ? (
                <Meta label="В избранном" value={String(st.favorites)} />
              ) : null;
            })()}
            <Meta label="ID Авито" value={listing.external_id} />
            <Meta label="Синхронизация" value={formatWhen(listing.last_synced_at)} />
            {listing.template_key ? (
              <Meta label="Шаблон" value={listing.template_key} />
            ) : null}
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            <label style={labelStyle}>
              Заголовок (локально в Цифре)
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Текст в Цифре
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={8}
                placeholder="Авито API не отдаёт текст объявления. Возьми из шаблона («Применить шаблон») или вставь свой — хранится только в Цифре."
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </label>
            {!description.trim() && (
              <p style={{ margin: 0, color: '#FDE68A', fontSize: 12 }}>
                Текст пустой: нажми «Применить шаблон…» или вставь вручную и сохрани.
              </p>
            )}
            <label style={labelStyle}>
              Цена, ₽
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                style={{ ...inputStyle, maxWidth: 200 }}
              />
            </label>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              marginTop: 12,
              alignItems: 'center',
            }}
          >
            <button
              type="button"
              onClick={() => void saveLocal()}
              disabled={saving}
              style={btnPrimary}
            >
              <Save size={14} /> {saving ? 'Сохранение…' : 'Сохранить в Цифре'}
            </button>
            <button
              type="button"
              onClick={() => void pushPrice()}
              disabled={pushingPrice}
              style={btnBlue}
            >
              {pushingPrice ? 'Отправка…' : 'Цена на Авито'}
            </button>
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) void applyTemplate(e.target.value);
                e.target.value = '';
              }}
              style={selectStyle}
            >
              <option value="">Применить шаблон…</option>
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.title.slice(0, 48)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowChat((v) => !v)}
              style={btnSoft}
            >
              <MessageCircle size={14} /> {showChat ? 'Скрыть чат' : 'Чаты Авито'}
            </button>
            {listing.url && (
              <a
                href={listing.url}
                target="_blank"
                rel="noreferrer"
                style={{ ...btnSoft, textDecoration: 'none' }}
              >
                <ExternalLink size={14} /> На Авито
              </a>
            )}
          </div>

          <p style={{ margin: '10px 0 0', color: '#64748B', fontSize: 12 }}>
            Синхронизация читает Авито. Текст и заголовок правятся локально; на площадку
            уходит только цена по кнопке «Цена на Авито».
          </p>

          {showChat && (
            <ListingChat listingId={listing.id} listingTitle={listing.title} />
          )}
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: '#0F172A',
        border: '1px solid #1E293B',
        borderRadius: 10,
        padding: '8px 10px',
      }}
    >
      <div style={{ color: '#64748B', fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ color: '#E2E8F0', fontSize: 13, fontWeight: 600, wordBreak: 'break-word' }}>
        {value}
      </div>
    </div>
  );
}

const labelStyle: CSSProperties = {
  fontSize: 13,
  color: '#94A3B8',
  display: 'block',
};

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

const btnPrimary: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderRadius: 10,
  border: 'none',
  background: '#059669',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
};

const btnBlue: CSSProperties = {
  ...btnPrimary,
  background: '#2563EB',
};

const btnSoft: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid #334155',
  background: '#0F172A',
  color: '#E2E8F0',
  cursor: 'pointer',
  fontSize: 13,
};

const selectStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 10,
  background: '#0F172A',
  color: '#E2E8F0',
  border: '1px solid #334155',
  maxWidth: 220,
};
