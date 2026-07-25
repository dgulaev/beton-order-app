'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, RefreshCw, X, FileText } from 'lucide-react';
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

type Props = {
  open: boolean;
  onClose: () => void;
  /** YYYY-MM-DD (локальный день календаря) */
  dateKey: string;
  dateLabel: string;
  /** Свежий автотекст (пересчитывается родителем). */
  autoReport: string;
};

export default function DailyMixerReportModal({
  open,
  onClose,
  dateKey,
  dateLabel,
  autoReport,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [text, setText] = useState('');
  const wasOpenRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Слияние только при открытии модалки — не мешаем печатать, если данные
  // на дашборде обновляются в фоне.
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened || !dateKey) return;

    pruneDailyReportDrafts();
    const editedKey = dailyReportEditedKey(dateKey);
    const autoKey = dailyReportAutoKey(dateKey);
    const previousAuto = localStorage.getItem(autoKey);
    const saved = localStorage.getItem(editedKey);
    const merged = mergeDailyReportDraft(previousAuto, saved, autoReport);
    setText(merged);
    localStorage.setItem(editedKey, merged);
    localStorage.setItem(autoKey, autoReport);
  }, [open, dateKey, autoReport]);

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

  const handleRefresh = async () => {
        if (text !== autoReport) {
      const ok = await appConfirm(
        'Полностью пересобрать план из дашборда? Все ручные правки будут потеряны.',
        {
          variant: 'warning',
          okLabel: 'Пересобрать',
        }
      );
      if (!ok) return;
    }
    persist(autoReport);
    localStorage.setItem(dailyReportAutoKey(dateKey), autoReport);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      await appAlert('Текст скопирован — можно вставить в Макс', {
        title: 'Готово',
        variant: 'success',
      });
    } catch {
      await appAlert('Не удалось скопировать — выдели текст вручную', {
        title: 'Ошибка',
        variant: 'danger',
      });
    }
  };

  const handleClose = () => {
    localStorage.setItem(editedKey, text);
    // Фиксируем снимок auto на момент закрытия — следующий open смержит дельту
    localStorage.setItem(dailyReportAutoKey(dateKey), autoReport);
    onClose();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Планирование отгрузки · ${dateLabel}`}
      onClick={handleClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.82)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={volumeModalStyle({
          width: 820,
          maxWidth: '100%',
          maxHeight: 'min(1400px, 100%)',
          overflow: 'auto',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          position: 'relative',
        })}
      >
        <button
          type="button"
          onClick={handleClose}
          aria-label="Закрыть"
          style={{
            ...modalCloseButtonStyle(),
            position: 'absolute',
            top: 16,
            right: 16,
          }}
        >
          <X size={18} />
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 36 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileText size={22} color="#93C5FD" />
            <h2 style={{ margin: 0, color: '#E2E8F0', fontSize: 20, fontWeight: 700 }}>
              Планирование отгрузки · {dateLabel}
            </h2>
          </div>
          <div style={{ fontSize: 12, color: '#64748B', paddingLeft: 32 }}>
            Текст для водителей в Макс. Правки сохраняются; новые заявки и рейсы
            подмешиваются при следующем открытии.
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => persist(e.target.value)}
          spellCheck={false}
          style={modalFieldStyle({
            height: 'min(70vh, 720px)',
            minHeight: 280,
            resize: 'vertical',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 14.5,
            lineHeight: 1.55,
            color: '#E2E8F0',
          })}
        />

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            justifyContent: 'flex-end',
          }}
        >
          <ModalActionButton
            color="#94A3B8"
            icon={<RefreshCw size={15} />}
            label="Сбросить правки"
            onClick={() => void handleRefresh()}
          />
          <ModalActionButton
            color="#34D399"
            icon={<Copy size={15} />}
            label="Скопировать для Макс"
            onClick={() => void handleCopy()}
          />
          <ModalActionButton
            color="#60A5FA"
            icon={<X size={15} />}
            label="Закрыть"
            onClick={handleClose}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
