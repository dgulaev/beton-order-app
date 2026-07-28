/**
 * Локальная проверка decideLeadLinkForCopy (без сети / БД).
 * Запуск: npx tsx scripts/verify-lead-order-copy.ts
 */
import { decideLeadLinkForCopy } from '../lib/leadOrderCopy';

let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('1) Исполненный лид → без связи');
{
  const r = decideLeadLinkForCopy({
    leadId: 1,
    leadStatus: 'fulfilled',
    plan_m3: 20,
    remaining_m3: 0,
    copyVolume: 6,
  });
  assert('lead_id null', r.lead_id === null);
}

console.log('2) Остаток 0 при converted → без связи');
{
  const r = decideLeadLinkForCopy({
    leadId: 1,
    leadStatus: 'converted',
    plan_m3: 20,
    remaining_m3: 0,
    copyVolume: 6,
  });
  assert('lead_id null', r.lead_id === null);
}

console.log('3) Открытый лид, volume > remaining → кламп + связь');
{
  const r = decideLeadLinkForCopy({
    leadId: 7,
    leadStatus: 'converted',
    leadSource: 'demand',
    plan_m3: 20,
    remaining_m3: 3,
    copyVolume: 6,
  });
  assert('lead_id = 7', r.lead_id === 7);
  assert('volume = 3', r.volume === 3, `got ${r.volume}`);
  assert('source demand', r.lead_source === 'demand');
}

console.log('4) Открытый лид, volume <= remaining → полный volume');
{
  const r = decideLeadLinkForCopy({
    leadId: 5,
    leadStatus: 'in_progress',
    plan_m3: 20,
    remaining_m3: 10,
    copyVolume: 6,
  });
  assert('lead_id = 5', r.lead_id === 5);
  assert('volume = 6', r.volume === 6);
}

console.log('5) Без плана (volume_m3 null) → связь сохраняется');
{
  const r = decideLeadLinkForCopy({
    leadId: 9,
    leadStatus: 'new',
    plan_m3: null,
    remaining_m3: null,
    copyVolume: 100,
    fallbackLeadSource: 'avito',
  });
  assert('lead_id = 9', r.lead_id === 9);
  assert('source fallback', r.lead_source === 'avito');
}

console.log('6) rejected / spam → без связи');
{
  for (const status of ['rejected', 'spam'] as const) {
    const r = decideLeadLinkForCopy({
      leadId: 2,
      leadStatus: status,
      plan_m3: 10,
      remaining_m3: 10,
      copyVolume: 5,
    });
    assert(`${status} → null`, r.lead_id === null);
  }
}

console.log('7) remaining крошечный → без связи');
{
  const r = decideLeadLinkForCopy({
    leadId: 3,
    leadStatus: 'converted',
    plan_m3: 10,
    remaining_m3: 0.04,
    copyVolume: 6,
  });
  assert('lead_id null', r.lead_id === null);
}

if (failed > 0) {
  console.error(`\nFAIL: ${failed} проверок`);
  process.exit(1);
}
console.log('\nOK: все проверки decideLeadLinkForCopy прошли');
