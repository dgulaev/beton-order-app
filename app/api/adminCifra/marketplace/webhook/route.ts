import { NextRequest, NextResponse } from 'next/server';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  explainAvitoMessengerError,
  isAvitoConfigured,
  listAvitoWebhookSubscriptions,
  subscribeAvitoWebhook,
} from '@/lib/integrations/avito';

function buildWebhookUrl(request: NextRequest): string | null {
  const secret = process.env.AVITO_WEBHOOK_SECRET?.trim();
  if (!secret) return null;

  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null) ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    request.nextUrl.origin;

  // Авито принимает только публичный https — localhost отсекаем явно.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(base)) {
    return null;
  }

  return `${base}/api/webhooks/avito?secret=${encodeURIComponent(secret)}`;
}

/** Публичный вид URL без secret — только для диагностики в UI. */
function maskWebhookUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0] || null;
  }
}

function sameEndpoint(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch {
    return a.split('?')[0] === b.split('?')[0];
  }
}

function sameUrlExact(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      ua.origin === ub.origin &&
      ua.pathname === ub.pathname &&
      ua.searchParams.get('secret') === ub.searchParams.get('secret')
    );
  } catch {
    return a === b;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) return auth.error;

  const webhookUrl = buildWebhookUrl(request);
  const secretConfigured = Boolean(process.env.AVITO_WEBHOOK_SECRET?.trim());
  const webhookHost = maskWebhookUrl(webhookUrl);

  if (!isAvitoConfigured()) {
    return NextResponse.json({
      success: true,
      avitoConfigured: false,
      secretConfigured,
      webhookHost,
      subscribed: false,
    });
  }

  if (!webhookUrl && secretConfigured) {
    return NextResponse.json({
      success: true,
      avitoConfigured: true,
      secretConfigured,
      webhookHost: null,
      subscribed: false,
      needsResubscribe: false,
      error:
        'Нет публичного URL для webhook. Задай NEXT_PUBLIC_APP_URL=https://mostbeton.ru в Vercel (не localhost).',
    });
  }

  try {
    const subscriptions = await listAvitoWebhookSubscriptions();
    const exact = Boolean(
      webhookUrl && subscriptions.some((s) => s.url && sameUrlExact(s.url, webhookUrl)),
    );
    const pathOnly = Boolean(
      webhookUrl &&
        !exact &&
        subscriptions.some((s) => s.url && sameEndpoint(s.url, webhookUrl)),
    );

    return NextResponse.json({
      success: true,
      avitoConfigured: true,
      secretConfigured,
      webhookHost,
      subscribed: exact,
      needsResubscribe: pathOnly,
      subscriptionCount: subscriptions.length,
      error: pathOnly
        ? 'Секрет webhook сменился — нажми «Подключить webhook» ещё раз.'
        : undefined,
    });
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : 'Не удалось получить подписки';
    return NextResponse.json({
      success: true,
      avitoConfigured: true,
      secretConfigured,
      webhookHost,
      subscribed: false,
      needsResubscribe: false,
      error: explainAvitoMessengerError(raw),
    });
  }
}

/** Подписать URL Цифры на webhook Messenger Авито. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) return auth.error;

  if (!isAvitoConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Авито не настроено' },
      { status: 400 },
    );
  }

  const secretConfigured = Boolean(process.env.AVITO_WEBHOOK_SECRET?.trim());
  const webhookUrl = buildWebhookUrl(request);
  if (!webhookUrl) {
    return NextResponse.json(
      {
        success: false,
        error: !secretConfigured
          ? 'Задай AVITO_WEBHOOK_SECRET в env'
          : 'Нет публичного URL для webhook. Задай NEXT_PUBLIC_APP_URL=https://mostbeton.ru в Vercel.',
      },
      { status: 400 },
    );
  }

  try {
    await subscribeAvitoWebhook(webhookUrl);
    return NextResponse.json({
      success: true,
      subscribed: true,
      webhookHost: maskWebhookUrl(webhookUrl),
    });
  } catch (e: unknown) {
    const raw = e instanceof Error ? e.message : 'Ошибка подписки';
    return NextResponse.json(
      {
        success: false,
        error: explainAvitoMessengerError(raw),
        webhookHost: maskWebhookUrl(webhookUrl),
      },
      { status: 502 },
    );
  }
}
