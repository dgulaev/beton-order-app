'use client';

import { BookOpen, Check } from 'lucide-react';
import type { HelpArticle } from '@/lib/help/types';
import { overlayStyle, modalStyle, primaryButton, ghostButton } from '../../recipes/labStyles';

interface Props {
  open: boolean;
  articles: HelpArticle[];
  readIds: Set<string>;
  onOpenArticle: (id: string) => void;
  onComplete: () => void;
  onSkip: () => void;
}

export default function HelpOnboardingModal({
  open,
  articles,
  readIds,
  onOpenArticle,
  onComplete,
  onSkip,
}: Props) {
  if (!open) return null;

  const allRead = articles.length > 0 && articles.every((a) => readIds.has(a.id));

  return (
    <div style={{ ...overlayStyle, zIndex: 930 }} onClick={onSkip}>
      <div
        role="dialog"
        aria-label="С чего начать"
        style={modalStyle(480)}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <BookOpen size={22} color="#4ADE80" />
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff' }}>С чего начать</h2>
        </div>
        <p style={{ margin: '0 0 18px', color: '#94A3B8', fontSize: 14.5, lineHeight: 1.5 }}>
          Перед работой прочитай короткие инструкции. Это займёт несколько минут — потом сможешь открыть их снова через меню «Инструкции» или кнопку «?».
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
          {articles.map((a, index) => {
            const read = readIds.has(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onOpenArticle(a.id)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: `1px solid ${read ? 'rgba(74,222,128,0.45)' : '#334155'}`,
                  background: read ? 'rgba(74,222,128,0.08)' : '#1E2937',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    background: read ? '#10B981' : '#25334A',
                    color: read ? '#fff' : '#94A3B8',
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {read ? <Check size={16} /> : index + 1}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 650, fontSize: 15 }}>{a.title}</span>
                  <span style={{ display: 'block', color: '#94A3B8', fontSize: 13, marginTop: 2 }}>
                    {a.summary}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onSkip} style={ghostButton}>
            Позже
          </button>
          <button
            type="button"
            onClick={onComplete}
            disabled={!allRead}
            title={allRead ? undefined : 'Сначала открой все пункты списка'}
            style={{
              ...primaryButton(),
              opacity: allRead ? 1 : 0.45,
              cursor: allRead ? 'pointer' : 'not-allowed',
            }}
          >
            Всё понял, начать работу
          </button>
        </div>
      </div>
    </div>
  );
}
