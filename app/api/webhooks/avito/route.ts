import { NextRequest, NextResponse } from 'next/server';
import { registerAllMarketplaceAdapters } from '@/lib/integrations/registerAll';
import { getMarketplaceAdapter } from '@/lib/integrations/marketplaceAdapter';
import { upsertLead } from '@/lib/leadService';

function verifyWebhookSecret(request: NextRequest): boolean {
  const expected = process.env.AVITO_WEBHOOK_SECRET?.trim();
  // Без секрета webhook закрыт — не открываем его по факту наличия CLIENT_ID.
  if (!expected) return false;
  const header =
    request.headers.get('x-avito-webhook-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    request.nextUrl.searchParams.get('secret');
  return header === expected;
}

export async function POST(request: NextRequest) {
  if (!verifyWebhookSecret(request)) {
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

    const { leads } = await adapter.handleWebhook(body, request.headers);

    let created = 0;
    let skipped = 0;
    for (const draft of leads) {
      const result = await upsertLead(draft);
      if (!result) skipped += 1;
      else if (result.created) created += 1;
      else skipped += 1;
    }

    // Быстрый ответ Авито (лиды уже в БД + notifyManagers / realtime).
    return NextResponse.json({ success: true, created, skipped, total: leads.length });
  } catch (e: unknown) {
    console.error('[webhooks/avito]', e);
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/** Healthcheck для настройки webhook в кабинете Авито. */
export async function GET(request: NextRequest) {
  if (!verifyWebhookSecret(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    configured: Boolean(process.env.AVITO_CLIENT_ID),
    webhookSecretConfigured: Boolean(process.env.AVITO_WEBHOOK_SECRET?.trim()),
  });
}
