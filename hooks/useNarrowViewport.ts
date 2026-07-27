'use client';

import { useEffect, useState } from 'react';

/** Узкий экран (мобилка / узкое окно) — для компактных модалок и кнопок. */
export function useNarrowViewport(query = '(max-width: 768px)'): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [query]);

  return narrow;
}
