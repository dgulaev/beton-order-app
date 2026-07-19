'use client';

import { Truck } from 'lucide-react';
import MobileComingSoon from '../components/MobileComingSoon';

export default function MobileMixersPage() {
  return (
    <MobileComingSoon
      title="Миксеры"
      icon={<Truck size={32} />}
      description="Управление миксерами пока доступно только в полной версии админки на компьютере."
    />
  );
}
