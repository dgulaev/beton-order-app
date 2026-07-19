'use client';

import { Factory } from 'lucide-react';
import MobileComingSoon from '../components/MobileComingSoon';

export default function MobileWarehousePage() {
  return (
    <MobileComingSoon
      title="Склад"
      icon={<Factory size={32} />}
      description="Складские операции пока доступны только в полной версии админки на компьютере."
    />
  );
}
