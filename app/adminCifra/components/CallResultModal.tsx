'use client';

import { useEffect, useState } from 'react';
import { Phone, X, Check, Minus, XCircle } from 'lucide-react';
import ModalActionButton from './ModalActionButton';
import { formatPhoneDisplay } from '@/lib/phone';

export type CallResultKind = 'positive' | 'neutral' | 'negative';

type CallClient = {
  phone?: string | null;
  organization_name?: string | null;
  full_name?: string | null;
  user_id?: number | string;
  id?: number | string;
  _group?: { clients?: Array<{ user_id?: number | string }> };
};

type Props = {
  client: CallClient;
  onClose: () => void;
  onSaved: () => void;
  /** desktop — центрированная модалка; mobile — нижняя панель */
  variant?: 'desktop' | 'mobile';
};

const RESULTS: Array<{
  id: CallResultKind;
  label: string;
  color: string;
  Icon: typeof Check;
}> = [
  { id: 'positive', label: 'Положительный', color: '#10B981', Icon: Check },
  { id: 'neutral', label: 'Нейтральный', color: '#F59E0B', Icon: Minus },
  { id: 'negative', label: 'Отрицательный', color: '#EF4444', Icon: XCircle },
];

export default function CallResultModal({
  client,
  onClose,
  onSaved,
  variant = 'desktop',
}: Props) {
  const [result, setResult] = useState<CallResultKind>('positive');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const isMobile = variant === 'mobile';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const displayName =
    client.organization_name || client.full_name || 'Клиент';
  const phone = client.phone || '';

  const save = async () => {
    const clientId =
      client.user_id || client.id || client._group?.clients?.[0]?.user_id;
    if (!clientId) {
      alert('Не удалось определить клиента');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/adminCifra/client-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          result,
          comment: comment.trim() || null,
        }),
      });
      if (!res.ok) throw new Error('Ошибка сервера');
      onSaved();
    } catch (err) {
      console.error(err);
      alert('Ошибка при сохранении результата звонка');
    } finally {
      setSaving(false);
    }
  };

  const panel = (
    <div
      className={
        isMobile
          ? undefined
          : 'w-full max-w-[520px] max-h-[90vh] overflow-auto mx-auto scroll-hidden'
      }
      style={
        isMobile
          ? {
              background: '#1E2937',
              borderRadius: '20px 20px 0 0',
              padding: '16px 20px 28px',
              maxHeight: 'calc(90vh - 74px)',
              overflow: 'auto',
            }
          : {
              background: '#1E2937',
              borderRadius: 24,
              padding: '28px 32px 24px',
            }
      }
      onClick={(e) => e.stopPropagation()}
    >
      {isMobile && (
        <div
          style={{
            width: 40,
            height: 4,
            background: '#334155',
            borderRadius: 9999,
            margin: '0 auto 16px',
          }}
        />
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: isMobile ? 20 : 24, fontWeight: 700, color: '#fff' }}>
          Звонок клиенту
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          style={{
            background: '#334155',
            border: 'none',
            borderRadius: 9999,
            width: 36,
            height: 36,
            color: '#94A3B8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={18} />
        </button>
      </div>

      <div
        style={{
          background: '#25334A',
          borderRadius: 16,
          padding: isMobile ? 16 : 20,
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
          {displayName}
        </div>
        <div style={{ fontSize: 14, color: '#94A3B8' }}>{formatPhoneDisplay(phone)}</div>
      </div>

      {phone ? (
        <a
          href={`tel:${phone}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: isMobile ? 15 : 14,
            marginBottom: 20,
            borderRadius: 14,
            border: '1px solid #10B98150',
            background: '#10B98114',
            color: '#10B981',
            fontWeight: 600,
            fontSize: isMobile ? 16 : 15,
            textDecoration: 'none',
          }}
        >
          <Phone size={18} />
          Позвонить
        </a>
      ) : (
        <div
          style={{
            marginBottom: 20,
            padding: 14,
            borderRadius: 14,
            background: '#25334A',
            color: '#64748B',
            textAlign: 'center',
            fontSize: 14,
          }}
        >
          Телефон не указан
        </div>
      )}

      <div style={{ marginBottom: 8, color: '#94A3B8', fontSize: 14, fontWeight: 600 }}>
        Результат звонка
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 10,
          marginBottom: 16,
        }}
      >
        {RESULTS.map(({ id, label, color, Icon }) => {
          const active = result === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setResult(id)}
              style={{
                padding: isMobile ? '12px 8px' : '12px 10px',
                borderRadius: 12,
                border: `1px solid ${active ? color + '90' : '#334155'}`,
                background: active ? `${color}18` : '#25334A',
                color: active ? color : '#94A3B8',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                fontWeight: 600,
                fontSize: isMobile ? 12 : 13,
                transition: 'background 0.15s, border-color 0.15s',
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          );
        })}
      </div>

      <label style={{ display: 'block', color: '#94A3B8', fontSize: 14, marginBottom: 8 }}>
        Комментарий
      </label>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Необязательно…"
        rows={isMobile ? 3 : 4}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '14px 16px',
          background: '#25334A',
          border: 'none',
          borderRadius: 16,
          color: '#fff',
          fontSize: 15,
          resize: 'vertical',
          minHeight: 80,
          marginBottom: 20,
          outline: 'none',
        }}
      />

      <div style={{ display: 'flex', gap: 12 }}>
        <ModalActionButton
          onClick={onClose}
          color="#94A3B8"
          icon={<X size={16} />}
          label="Отмена"
          fullWidth
          size={isMobile ? 'lg' : 'sm'}
          disabled={saving}
        />
        <ModalActionButton
          onClick={save}
          color="#3B82F6"
          icon={<Check size={16} />}
          label={saving ? 'Сохранение…' : 'Сохранить'}
          fullWidth
          size={isMobile ? 'lg' : 'sm'}
          disabled={saving}
        />
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10050 }}
          onClick={onClose}
        />
        <div
          style={{
            position: 'fixed',
            bottom: 74,
            left: 0,
            right: 0,
            zIndex: 10051,
          }}
        >
          {panel}
        </div>
      </>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.94)',
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      {panel}
    </div>
  );
}
