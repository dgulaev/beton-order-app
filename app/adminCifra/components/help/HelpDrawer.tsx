'use client';

import { X, BookOpen, ChevronRight } from 'lucide-react';
import type { HelpArticle } from '@/lib/help/types';
import HelpArticleBody from './HelpArticleBody';

interface Props {
  open: boolean;
  article: HelpArticle | null;
  /** Список для режима «оглавление» */
  catalog?: HelpArticle[];
  /** Роль читателя — фильтр блоков с roles */
  role?: string | null;
  onSelectArticle?: (id: string) => void;
  onClose: () => void;
}

export default function HelpDrawer({
  open,
  article,
  catalog,
  role,
  onSelectArticle,
  onClose,
}: Props) {
  if (!open) return null;

  const showCatalog = !article && !!catalog?.length;

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          // Выше онбординга (930), иначе боковая справка оказывается под его затемнением.
          zIndex: 940,
          background: 'rgba(0,0,0,0.45)',
        }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={article?.title || 'Инструкции'}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 941,
          width: 'min(480px, 100vw)',
          background: '#0F172A',
          borderLeft: '1px solid #1E2937',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            padding: '18px 20px 14px',
            borderBottom: '1px solid #1E2937',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: '#94A3B8',
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 6,
              }}
            >
              <BookOpen size={14} />
              Инструкция
            </div>
            <div style={{ color: '#fff', fontSize: 20, fontWeight: 700, lineHeight: 1.25 }}>
              {article?.title || 'Инструкции'}
            </div>
            {article?.summary && (
              <div style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>{article.summary}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              background: '#1E2937',
              border: '1px solid #334155',
              borderRadius: 10,
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#E2E8F0',
              flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px 28px' }}>
          {article && <HelpArticleBody body={article.body} role={role} />}

          {showCatalog && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ margin: '0 0 8px', color: '#94A3B8', fontSize: 14 }}>
                Выбери тему — откроется подробная инструкция.
              </p>
              {catalog!.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectArticle?.(item.id)}
                  style={{
                    textAlign: 'left',
                    padding: '14px 16px',
                    borderRadius: 14,
                    border: '1px solid #334155',
                    background: '#1E2937',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <span>
                    <span style={{ display: 'block', fontWeight: 650, fontSize: 15 }}>{item.title}</span>
                    <span style={{ display: 'block', color: '#94A3B8', fontSize: 13, marginTop: 4 }}>
                      {item.summary}
                    </span>
                  </span>
                  <ChevronRight size={18} color="#64748B" />
                </button>
              ))}
            </div>
          )}

          {!article && !showCatalog && (
            <p style={{ margin: 0, color: '#94A3B8' }}>Для этой страницы пока нет инструкции.</p>
          )}
        </div>
      </div>
    </>
  );
}
