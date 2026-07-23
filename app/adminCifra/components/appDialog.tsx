'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import {
  CARD_BORDER,
  modalCloseButtonStyle,
  volumeCardSoftStyle,
  volumeModalStyle,
} from '../cardStyles';

type DialogKind = 'alert' | 'confirm';

type DialogRequest = {
  id: number;
  kind: DialogKind;
  title?: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  variant?: 'info' | 'success' | 'warning' | 'danger';
  resolve: (value: boolean) => void;
};

let seq = 1;
let queue: DialogRequest[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function enqueue(req: Omit<DialogRequest, 'id' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...req, id: seq++, resolve }];
    emit();
  });
}

function shift(): DialogRequest | null {
  if (queue.length === 0) return null;
  const [head, ...rest] = queue;
  queue = rest;
  emit();
  return head;
}

function peek(): DialogRequest | null {
  return queue[0] ?? null;
}

/** Тёмный alert в стиле модалок. */
export function appAlert(
  message: string,
  opts?: { title?: string; okLabel?: string; variant?: DialogRequest['variant'] },
): Promise<void> {
  return enqueue({
    kind: 'alert',
    message: String(message ?? ''),
    title: opts?.title,
    okLabel: opts?.okLabel ?? 'OK',
    variant: opts?.variant ?? inferVariant(String(message ?? '')),
  }).then(() => undefined);
}

/** Тёмный confirm. true = подтвердить, false = отмена. */
export function appConfirm(
  message: string,
  opts?: {
    title?: string;
    okLabel?: string;
    cancelLabel?: string;
    variant?: DialogRequest['variant'];
  },
): Promise<boolean> {
  return enqueue({
    kind: 'confirm',
    message: String(message ?? ''),
    title: opts?.title ?? 'Подтверждение',
    okLabel: opts?.okLabel ?? 'Да',
    cancelLabel: opts?.cancelLabel ?? 'Отмена',
    variant: opts?.variant ?? 'warning',
  });
}

function inferVariant(message: string): DialogRequest['variant'] {
  const m = message.toLowerCase();
  if (/ошибк|не удалось|failed|error|запрещ/.test(m)) return 'danger';
  if (/успеш|сохран|✅|готово/.test(m)) return 'success';
  if (/уверен|удалить|необратим|потерян|выкинуть/.test(m)) return 'warning';
  return 'info';
}

/** Подмена window.alert / частичная поддержка confirm через appConfirm (async). */
export function installAppDialogGlobals() {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __appDialogInstalled?: boolean };
  if (w.__appDialogInstalled) return;
  w.__appDialogInstalled = true;

  window.alert = ((message?: unknown) => {
    void appAlert(message == null ? '' : String(message));
  }) as typeof window.alert;

  // Sync confirm нельзя сделать честно с React-модалкой.
  // Оставляем нативный как fallback, но экспортируем appConfirm для замены вызовов.
  (window as any).appAlert = appAlert;
  (window as any).appConfirm = appConfirm;
}

const VARIANT: Record<
  NonNullable<DialogRequest['variant']>,
  { icon: ReactNode; accent: string; okBg: string; okBorder: string }
> = {
  info: {
    icon: <Info size={22} color="#60A5FA" />,
    accent: '#60A5FA',
    okBg: 'linear-gradient(165deg, #3B82F6 0%, #2563EB 100%)',
    okBorder: '1px solid rgba(147,197,253,0.35)',
  },
  success: {
    icon: <CheckCircle2 size={22} color="#4ADE80" />,
    accent: '#4ADE80',
    okBg: 'linear-gradient(165deg, #10B981 0%, #059669 100%)',
    okBorder: '1px solid rgba(110,231,183,0.35)',
  },
  warning: {
    icon: <AlertTriangle size={22} color="#FBBF24" />,
    accent: '#FBBF24',
    okBg: 'linear-gradient(165deg, #F59E0B 0%, #D97706 100%)',
    okBorder: '1px solid rgba(252,211,77,0.35)',
  },
  danger: {
    icon: <AlertTriangle size={22} color="#F87171" />,
    accent: '#F87171',
    okBg: 'linear-gradient(165deg, #EF4444 0%, #DC2626 100%)',
    okBorder: '1px solid rgba(252,165,165,0.35)',
  },
};

export default function AppDialogHost() {
  const [current, setCurrent] = useState<DialogRequest | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    installAppDialogGlobals();
    const sync = () => setCurrent(peek());
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const close = (result: boolean) => {
    const req = shift();
    if (req) req.resolve(result);
    setCurrent(peek());
  };

  if (!mounted || !current) return null;

  const v = VARIANT[current.variant ?? 'info'];
  const lines = current.message.split('\n');

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.82)',
        zIndex: 12000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={() => {
        // Клик вне окна: alert — OK, confirm — отмена (без действия).
        close(current.kind === 'confirm' ? false : true);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={volumeModalStyle({
          width: 'min(440px, 100%)',
          borderRadius: 20,
          padding: '22px 24px 20px',
          color: '#E2E8F0',
        })}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div
            style={volumeCardSoftStyle({
              width: 42,
              height: 42,
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              border: `1px solid ${v.accent}55`,
            })}
          >
            {v.icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#F1F5F9', marginBottom: 6 }}>
              {current.title ?? (current.kind === 'confirm' ? 'Подтверждение' : 'Сообщение')}
            </div>
            <div style={{ fontSize: 14.5, lineHeight: 1.45, color: '#CBD5E1', whiteSpace: 'pre-wrap' }}>
              {lines.map((line, i) => (
                <div key={i}>{line || '\u00A0'}</div>
              ))}
            </div>
          </div>
          <button
            type="button"
            title="Закрыть"
            onClick={() => close(current.kind === 'confirm' ? false : true)}
            style={modalCloseButtonStyle()}
          >
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            marginTop: 18,
            paddingTop: 14,
            borderTop: CARD_BORDER,
          }}
        >
          {current.kind === 'confirm' && (
            <button
              type="button"
              onClick={() => close(false)}
              style={btnSoft}
            >
              {current.cancelLabel ?? 'Отмена'}
            </button>
          )}
          <button
            type="button"
            onClick={() => close(true)}
            autoFocus
            style={{
              ...btnSoft,
              background: v.okBg,
              border: v.okBorder,
              color: '#fff',
              fontWeight: 700,
              minWidth: 96,
            }}
          >
            {current.okLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const btnSoft: CSSProperties = volumeCardSoftStyle({
  padding: '10px 18px',
  borderRadius: 12,
  color: '#E2E8F0',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
});
