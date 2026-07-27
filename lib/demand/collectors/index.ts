import type { DemandCollector } from './types';
import { avitoMessengerCollector } from './avitoMessengerCollector';
import { feedCollector } from './feedCollector';
import { demoCollector } from './demoCollector';
import { gosplanCollector } from './gosplanCollector';

export type { DemandDraft, DemandCollector } from './types';

export function getDemandCollectors(): DemandCollector[] {
  // avito — только официальный Messenger по вашим объявлениям (тумблер в Интеграциях).
  return [gosplanCollector, feedCollector, avitoMessengerCollector, demoCollector];
}
