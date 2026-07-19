'use client';

import { Users } from 'lucide-react';
import MobileComingSoon from '../components/MobileComingSoon';

export default function MobileClientsPage() {
  return (
    <MobileComingSoon
      title="Клиенты"
      icon={<Users size={32} />}
      description="Клиентская база пока доступна только в полной версии админки на компьютере."
    />
  );
}
