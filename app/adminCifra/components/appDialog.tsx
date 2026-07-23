'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import {
  CARD_BORDER,
  modalCloseButtonStyle,
  modalFieldStyle,
  volumeCardSoftStyle,
  volumeModalStyle,
} from '../cardStyles';

type DialogKind = 'alert' | 'confirm' | 'prompt';

type DialogVariant = 'info' | 'success' | 'warning' | 'danger';

type DialogRequest = {
  id: number;
  kind: DialogKind;
  title?: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  variant?: DialogVariant;
  defaultValue?: string;
  placeholder?: string;
  inputMode?: 'text' | 'decimal' | 'numeric';
  unit?: string;
  resolve: (value: boolean | string | null) => void;
};

let seq = 1;
let queue: DialogRequest[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function enqueue(req: Omit<DialogRequest, 'id' | 'resolve'>): Promise<boolean | string | null> {
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
  opts?: { title?: string; okLabel?: string; variant?: DialogVariant },
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
    variant?: DialogVariant;
  },
): Promise<boolean> {
  return enqueue({
    kind: 'confirm',
    message: String(message ?? ''),
    title: opts?.title ?? 'Подтверждение',
    okLabel: opts?.okLabel ?? 'Да',
    cancelLabel: opts?.cancelLabel ?? 'Отмена',
    variant: opts?.variant ?? 'warning',
  }).then((v) => Boolean(v));
}

/** Тёмный prompt с полем ввода. string = OK, null = отмена. */
export function appPrompt(
  message: string,
  opts?: {
    title?: string;
    okLabel?: string;
    cancelLabel?: string;
    variant?: DialogVariant;
    defaultValue?: string;
    placeholder?: string;
    inputMode?: 'text' | 'decimal' | 'numeric';
    unit?: string;
  },
): Promise<string | null> {
  return enqueue({
    kind: 'prompt',
    message: String(message ?? ''),
    title: opts?.title ?? 'Ввод',
    okLabel: opts?.okLabel ?? 'OK',
    cancelLabel: opts?.cancelLabel ?? 'Отмена',
    variant: opts?.variant ?? 'info',
    defaultValue: opts?.defaultValue ?? '',
    placeholder: opts?.placeholder,
    inputMode: opts?.inputMode ?? 'text',
    unit: opts?.unit,
  }).then((v) => (typeof v === 'string' ? v : null));
}

function inferVariant(message: string): DialogVariant {
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
  (window as any).appPrompt = appPrompt;
}

const VARIANT: Record<
  DialogVariant,
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
  const [promptValue, setPromptValue] = useState('');

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

  useEffect(() => {
    if (current?.kind === 'prompt') {
      setPromptValue(current.defaultValue ?? '');
    }
  }, [current?.id]);

  const close = (result: boolean | string | null) => {
    const req = shift();
    if (req) req.resolve(result);
    setCurrent(peek());
  };

  if (!mounted || !current) return null;

  const v = VARIANT[current.variant ?? 'info'];
  const lines = current.message.split('\n');
  const isPrompt = current.kind === 'prompt';
  const isConfirm = current.kind === 'confirm';

  const dismissOutside = () => {
    if (current.kind === 'alert') close(true);
    else close(isPrompt ? null : false);
  };

  const submit = () => {
    if (isPrompt) close(promptValue);
    else close(true);
  };

  const defaultTitle =
    current.kind === 'confirm' ? 'Подтверждение' : current.kind === 'prompt' ? 'Ввод' : 'Сообщение';

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
      onClick={dismissOutside}
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
              {current.title ?? defaultTitle}
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
            onClick={dismissOutside}
            style={modalCloseButtonStyle()}
          >
            <X size={16} />
          </button>
        </div>

        {isPrompt && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <input
              autoFocus
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  close(null);
                }
              }}
              placeholder={current.placeholder}
              inputMode={current.inputMode}
              style={modalFieldStyle({
                flex: 1,
                fontSize: 18,
                fontWeight: 700,
                textAlign: 'right',
                padding: '12px 14px',
              })}
            />
            {current.unit ? (
              <span style={{ color: '#94A3B8', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
                {current.unit}
              </span>
            ) : null}
          </div>
        )}

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
          {(isConfirm || isPrompt) && (
            <button
              type="button"
              onClick={() => close(isPrompt ? null : false)}
              style={btnSoft}
            >
              {current.cancelLabel ?? 'Отмена'}
            </button>
          )}
          <button
            type="button"
            onClick={submit}
            autoFocus={!isPrompt}
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
