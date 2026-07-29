'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Редирект закладки /technika → /mixers (Фаза 1). */
export default function TechnikaRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/adminCifra/mixers');
  }, [router]);
  return (
    <div style={{ color: '#94A3B8', padding: 40, textAlign: 'center' }}>
      Переход в раздел «Техника»…
    </div>
  );
}
