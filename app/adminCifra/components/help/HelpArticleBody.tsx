'use client';

import { filterHelpBlocksForRole, type HelpBlock } from '@/lib/help/types';

export default function HelpArticleBody({
  body,
  role,
}: {
  body: HelpBlock[];
  /** Текущая роль — скрывает блоки с roles, куда она не входит. */
  role?: string | null;
}) {
  const visible = filterHelpBlocksForRole(body, role);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, color: '#E2E8F0', fontSize: 14.5, lineHeight: 1.55 }}>
      {visible.map((block, i) => {
        switch (block.type) {
          case 'h2':
            return (
              <h2
                key={i}
                style={{
                  margin: '8px 0 0',
                  fontSize: 17,
                  fontWeight: 700,
                  color: '#fff',
                }}
              >
                {block.text}
              </h2>
            );
          case 'h3':
            return (
              <h3
                key={i}
                style={{
                  margin: '4px 0 0',
                  fontSize: 15,
                  fontWeight: 650,
                  color: '#F1F5F9',
                }}
              >
                {block.text}
              </h3>
            );
          case 'p':
            return (
              <p key={i} style={{ margin: 0, color: '#CBD5E1' }}>
                {block.text}
              </p>
            );
          case 'ol':
            return (
              <ol
                key={i}
                style={{
                  margin: 0,
                  paddingLeft: 22,
                  color: '#CBD5E1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ol>
            );
          case 'ul':
            return (
              <ul
                key={i}
                style={{
                  margin: 0,
                  paddingLeft: 22,
                  color: '#CBD5E1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            );
          case 'callout': {
            const warn = block.tone === 'warn';
            return (
              <div
                key={i}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: warn ? 'rgba(250,204,21,0.1)' : 'rgba(74,222,128,0.1)',
                  border: `1px solid ${warn ? 'rgba(250,204,21,0.35)' : 'rgba(74,222,128,0.35)'}`,
                  color: warn ? '#FDE68A' : '#BBF7D0',
                  fontSize: 14,
                }}
              >
                <strong style={{ display: 'block', marginBottom: 4, color: warn ? '#FACC15' : '#4ADE80' }}>
                  {warn ? 'Важно' : 'Подсказка'}
                </strong>
                {block.text}
              </div>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
}
