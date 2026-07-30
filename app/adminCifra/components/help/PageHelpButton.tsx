'use client';

import { CircleHelp } from 'lucide-react';
import { volumeCardSoftStyle } from '../../cardStyles';
import { useHelp } from './HelpProvider';

type Props = {
  title?: string;
  /** Компактная пилюля под шапки с высотой ~26px (дашборд). */
  compact?: boolean;
};

export default function PageHelpButton({
  title = 'Инструкция',
  compact = false,
}: Props) {
  const { helpEnabled, openPageHelp } = useHelp();
  if (!helpEnabled) return null;

  if (compact) {
    return (
      <button
        type="button"
        onClick={openPageHelp}
        title={title}
        aria-label={title}
        style={volumeCardSoftStyle({
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          boxSizing: 'border-box',
          height: 26,
          color: '#E2E8F0',
          fontWeight: 600,
          fontSize: 13,
          lineHeight: 1,
          padding: '0 12px',
          borderRadius: 9999,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transform: 'translateY(3px)',
        })}
      >
        <CircleHelp size={14} />
        Справка
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openPageHelp}
      title={title}
      aria-label={title}
      style={volumeCardSoftStyle({
        padding: '10px 16px',
        borderRadius: 9999,
        color: '#E2E8F0',
        fontWeight: 500,
        fontSize: 14,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      })}
    >
      <CircleHelp size={18} />
      Справка
    </button>
  );
}
