import { NextRequest, NextResponse } from 'next/server';
import { registerAllMarketplaceAdapters } from '@/lib/integrations/registerAll';
import { getMarketplaceAdapter } from '@/lib/integrations/marketplaceAdapter';
import { getIntegrationSettings } from '@/lib/integrations/settings';
import { upsertDemandDraft } from '@/lib/demand/demandService';
import { upsertLead } from '@/lib/leadService';

async function verifyWebhookSecret(request: NextRequest): Promise<boolean> {
  const settings = await getIntegrationSettings();
  const expected = settings.avito.webhookSecret;
  // Без секрета webhook закрыт — не открываем его по факту наличия CLIENT_ID.
  if (!expected) return false;
  const header =
    request.headers.get('x-avito-webhook-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    request.nextUrl.searchParams.get('secret');
  return header === expected;
}

export async function POST(request: NextRequest) {
  if (!(await verifyWebhookSecret(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  registerAllMarketplaceAdapters();
  const adapter = getMarketplaceAdapter('avito');
  if (!adapter?.handleWebhook) {
    return NextResponse.json({ error: 'Avito adapter unavailable' }, { status: 503 });
  }

  try {
    // Авито может пинговать пустым телом — отвечаем 200 сразу.
    const raw = await request.text();
    if (!raw.trim() || raw.trim() === '{}') {
      return NextResponse.json({ success: true, created: 0, skipped: 0, total: 0, ping: true });
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ success: true, created: 0, skipped: 1, total: 0 });
    }

    const { leads = [], demands = [] } = await adapter.handleWebhook(body, request.headers);

    let created = 0;
    let skipped = 0;

    // Предпочтительный путь: Спрос → менеджер → лиды / отказ / спам.
    for (const draft of demands) {
      const result = await upsertDemandDraft(draft);
      if (!result) skipped += 1;
      else if (result.created) created += 1;
      else skipped += 1;
    }

    // Legacy: если адаптер ещё отдаёт leads (другие площадки).
    for (const draft of leads) {
      const result = await upsertLead(draft);
      if (!result) skipped += 1;
      else if (result.created) created += 1;
      else skipped += 1;
    }

    const total = demands.length + leads.length;
    return NextResponse.json({
      success: true,
      created,
      skipped,
      total,
      demands: demands.length,
      leads: leads.length,
    });
  } catch (e: unknown) {
    console.error('[webhooks/avito]', e);
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/** Healthcheck для настройки webhook в кабинете Авито. */
export async function GET(request: NextRequest) {
  if (!(await verifyWebhookSecret(request))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await getIntegrationSettings();
  return NextResponse.json({
    ok: true,
    configured: settings.avito.configured,
    webhookSecretConfigured: Boolean(settings.avito.webhookSecret),
  });
}
