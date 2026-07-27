import type { DemandCollector } from './types';
import { feedCollector } from './feedCollector';
import { demoCollector } from './demoCollector';
import { gosplanCollector } from './gosplanCollector';

export type { DemandDraft, DemandCollector } from './types';

export function getDemandCollectors(): DemandCollector[] {
  return [gosplanCollector, feedCollector, demoCollector];
}
