'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, RefreshCw, X } from 'lucide-react';
import {
  modalCloseButtonStyle,
  modalFieldStyle,
  volumeModalStyle,
} from '../cardStyles';
import { appAlert, appConfirm } from './appDialog';
import ModalActionButton from './ModalActionButton';
import {
  dailyReportAutoKey,
  dailyReportEditedKey,
  mergeDailyReportDraft,
  pruneDailyReportDrafts,
} from '@/lib/dailyMixerReport';
import { normalizePlanDateKey } from '@/lib/dailyLogisticsPlan';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { copyTextToClipboard } from '@/lib/clipboard';

type Props = {
  open: boolean;
  onClose: () => void;
  dateKey: string;
  dateLabel: string;
  /** Оперативный текст без выполненных заявок (по умолчанию в окне). */
  initialText: string;
  /** Полный день — все заявки, для переключателя «Полный день». */
  fullDayText?: string;
  /** Автотекст с дашборда/страницы — для «Сбросить правки». */
  autoReport?: string;
};

/**
 * Модалка текста для публикации в Макс.
 * По умолчанию — без выполненных заявок; «Полный день» показывает весь список.
 */
export default function MaxPlanPublishModal({
  open,
  onClose,
  dateKey,
  dateLabel,
  initialText,
  fullDayText = '',
  autoReport = '',
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState('');
  const [fullDayMode, setFullDayMode] = useState(false);
  const [viewportW, setViewportW] = useState(1920);
  const [publishing, setPublishing] = useState(false);
  const wasOpenRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef({ start: 0, end: 0 });

  useEffect(() => {
    setMounted(true);
    const sync = () => setViewportW(window.innerWidth);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const uiScale = viewportW >= 2500 ? 1.2 : viewportW >= 1900 ? 1.1 : 1;
  const modalWidth = useMemo(() => {
    if (viewportW >= 1900) return Math.min(1400, Math.round(viewportW * 0.72));
    return Math.min(1100, Math.round(viewportW * 0.94));
  }, [viewportW]);

  const hasFullDayVariant = Boolean(String(fullDayText || '').trim());
  const activeBase = String(initialText || '').trim()
    ? initialText
    : autoReport;
  const fullBase = hasFullDayVariant ? fullDayText : activeBase;

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened || !dateKey) return;

    let cancelled = false;
    pruneDailyReportDrafts();
    setFullDayMode(false);
    const editedKey = dailyReportEditedKey(dateKey);
    const autoKey = dailyReportAutoKey(dateKey);
    // При открытии из интеллекта («В Макс») — сразу оперативный текст.
    const seed = String(initialText || '').trim()
      ? initialText
      : mergeDailyReportDraft(
          localStorage.getItem(autoKey),
          localStorage.getItem(editedKey),
          autoReport,
        );
    setText(seed);
    localStorage.setItem(editedKey, seed);
    if (autoReport) localStorage.setItem(autoKey, autoReport);

    const apiDate = normalizePlanDateKey(dateKey) || dateKey;
    void (async () => {
      try {
        // Если интеллект уже передал свежий текст — не затираем общим снимком.
        if (String(initialText || '').trim()) return;
        const res = await fetch(
          `/api/adminCifra/logistics-plan?date=${encodeURIComponent(apiDate)}`,
          { headers: adminCifraAuthHeaders() },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json().catch(() => ({}));
        const maxText =
          data?.plan?.max_text != null ? String(data.plan.max_text) : '';
        if (!maxText.trim() || cancelled) return;
        setText(maxText);
        localStorage.setItem(editedKey, maxText);
      } catch {
        /* offline */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, dateKey, initialText, autoReport]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const editedKey = dailyReportEditedKey(dateKey);

  const persist = (value: string) => {
    setText(value);
    localStorage.setItem(editedKey, value);
  };

  const currentBase = fullDayMode ? fullBase : activeBase;

  const handleRefresh = async () => {
    const base = currentBase || autoReport || initialText;
    if (text !== base) {
      const ok = await appConfirm(
        'Пересобрать текст из текущего плана? Ручные правки в этом окне будут потеряны.',
        { variant: 'warning', okLabel: 'Пересобрать' },
      );
      if (!ok) return;
    }
    persist(base);
    if (autoReport) localStorage.setItem(dailyReportAutoKey(dateKey), autoReport);
  };

  const switchFullDayMode = async (next: boolean) => {
    if (next === fullDayMode) return;
    if (!hasFullDayVariant && next) return;
    const fromBase = fullDayMode ? fullBase : activeBase;
    if (text !== fromBase) {
      const ok = await appConfirm(
        next
          ? 'Показать полный день? Текущие правки в оперативном тексте будут заменены.'
          : 'Вернуть оперативный отчёт без выполненных? Текущие правки будут заменены.',
        { variant: 'warning', okLabel: 'Переключить' },
      );
      if (!ok) return;
    }
    setFullDayMode(next);
    persist(next ? fullBase : activeBase);
  };

  const rememberSelection = () => {
    const el = textareaRef.current;
    if (!el) return;
    selectionRef.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  const handleCopy = async () => {
    const el = textareaRef.current;
    const live =
      el && document.activeElement === el
        ? { start: el.selectionStart, end: el.selectionEnd }
        : selectionRef.current;
    const hasSelection = live.end > live.start;
    const toCopy = hasSelection ? text.slice(live.start, live.end) : text;
    if (!toCopy.trim()) {
      await appAlert('Нечего копировать — текст пуст', {
        title: 'Пусто',
        variant: 'warning',
      });
      return;
    }
    const ok = await copyTextToClipboard(toCopy);
    if (ok) {
      await appAlert(
        hasSelection
          ? 'Фрагмент скопирован — можно вставить в Макс'
          : 'Весь текст скопирован — можно вставить в Макс',
        { title: 'Готово', variant: 'success' },
      );
    } else {
      await appAlert('Не удалось скопировать — выдели текст вручную', {
        title: 'Ошибка',
        variant: 'danger',
      });
    }
  };

  const publishMaxText = async () => {
    const apiDate = normalizePlanDateKey(dateKey) || dateKey;
    // Правки в окне сохраняем как есть; иначе в снимок — полный день.
    const toSave =
      text !== currentBase
        ? text
        : hasFullDayVariant && String(fullBase || '').trim()
          ? fullBase
          : text;

    setPublishing(true);
    try {
      // Подтянуть текущий payload, чтобы не затереть trips пустым объектом
      const getRes = await fetch(
        `/api/adminCifra/logistics-plan?date=${encodeURIComponent(apiDate)}`,
        { headers: adminCifraAuthHeaders() },
      );
      const getData = getRes.ok ? await getRes.json().catch(() => ({})) : {};
      const payload =
        getData?.plan?.payload && typeof getData.plan.payload === 'object'
          ? getData.plan.payload
          : {};
      const expectedRevision = Number(getData?.plan?.revision) || undefined;
      const res = await fetch('/api/adminCifra/logistics-plan', {
        method: 'PUT',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          date: apiDate,
          payload,
          maxText: toSave,
          ...(expectedRevision ? { expectedRevision } : {}),
        }),
      });
      if (res.status === 409) {
        await appAlert(
          'План устарел — кто-то уже сохранил другую версию. Обнови страницу планирования и повтори.',
          { title: 'Конфликт', variant: 'warning' },
        );
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await appAlert(data.error || 'Не удалось сохранить текст в общий план', {
          title: 'Ошибка',
          variant: 'danger',
        });
        return;
      }
      localStorage.setItem(editedKey, text);
      await appAlert(
        toSave !== text && hasFullDayVariant
          ? 'В общий план сохранён полный день; в окне остаётся оперативный текст'
          : 'Текст Макс сохранён в общий план дня',
        {
          title: 'Сохранено',
          variant: 'success',
        },
      );
    } catch {
      await appAlert('Сеть недоступна', { title: 'Ошибка', variant: 'danger' });
    } finally {
      setPublishing(false);
    }
  };

  const handleClose = () => {
    localStorage.setItem(editedKey, text);
    onClose();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`План для Макс · ${dateLabel}`}
      onClick={handleClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.82)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: viewportW >= 1600 ? 28 : 16,
        boxSizing: 'border-box',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={volumeModalStyle({
          width: modalWidth,
          maxWidth: '100%',
          height: '88vh',
          maxHeight: '92vh',
          overflow: 'hidden',
          padding: Math.round(28 * uiScale),
          display: 'flex',
          flexDirection: 'column',
          gap: Math.round(12 * uiScale),
          position: 'relative',
          boxSizing: 'border-box',
        })}
      >
        <button
          type="button"
          aria-label="Закрыть"
          onClick={handleClose}
          style={{
            ...modalCloseButtonStyle(),
            position: 'absolute',
            top: 16,
            right: 16,
          }}
        >
          <X size={20} />
        </button>

        <div>
          <div
            style={{
              fontSize: Math.round(22 * uiScale),
              fontWeight: 800,
              color: '#F1F5F9',
            }}
          >
            План для Макс · {dateLabel}
          </div>
          <div
            style={{
              fontSize: Math.round(14 * uiScale),
              color: '#94A3B8',
              marginTop: 6,
              lineHeight: 1.45,
            }}
          >
            По умолчанию — без выполненных заявок (в шапке сводка). «Полный день»
            показывает весь список. «Сохранить в план» пишет полный день в общий
            снимок. «Скопировать» — то, что в окне, для вставки в Макс.
          </div>
          {hasFullDayVariant ? (
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 12,
                cursor: 'pointer',
                userSelect: 'none',
                color: '#E2E8F0',
                fontSize: Math.round(14 * uiScale),
                fontWeight: 600,
              }}
            >
              <input
                type="checkbox"
                checked={fullDayMode}
                onChange={(e) => void switchFullDayMode(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: '#A78BFA' }}
              />
              Полный день (включая выполненные)
            </label>
          ) : null}
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => persist(e.target.value)}
          onSelect={rememberSelection}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
          spellCheck={false}
          style={modalFieldStyle({
            flex: 1,
            minHeight: 280,
            resize: 'none',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: Math.round(16 * uiScale),
            lineHeight: 1.55,
            color: '#E2E8F0',
          })}
        />

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            justifyContent: 'flex-end',
          }}
        >
          <ModalActionButton
            color="#94A3B8"
            icon={<RefreshCw size={16} />}
            label="Сбросить правки"
            size="lg"
            onClick={() => void handleRefresh()}
          />
          <ModalActionButton
            color="#A78BFA"
            icon={<Copy size={16} />}
            label={publishing ? 'Сохраняю…' : 'Сохранить в план'}
            size="lg"
            onClick={() => void publishMaxText()}
            disabled={publishing || !text.trim()}
          />
          <span onMouseDown={(e) => e.preventDefault()}>
            <ModalActionButton
              color="#34D399"
              icon={<Copy size={16} />}
              label="Скопировать для Макс"
              size="lg"
              onClick={() => void handleCopy()}
            />
          </span>
          <ModalActionButton
            color="#60A5FA"
            icon={<X size={16} />}
            label="Закрыть"
            size="lg"
            onClick={handleClose}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
