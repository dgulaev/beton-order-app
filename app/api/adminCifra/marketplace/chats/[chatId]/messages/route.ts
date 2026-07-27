import { NextRequest, NextResponse } from 'next/server';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  fetchAvitoChatMessages,
  getAvitoUserId,
  isAvitoConfigured,
  markAvitoChatRead,
  sendAvitoMessage,
} from '@/lib/integrations/avito';

type Ctx = { params: Promise<{ chatId: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) return auth.error;

  if (!isAvitoConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Авито не настроено' },
      { status: 400 },
    );
  }

  const { chatId } = await context.params;
  if (!chatId?.trim()) {
    return NextResponse.json({ success: false, error: 'Нет chatId' }, { status: 400 });
  }

  const markRead = request.nextUrl.searchParams.get('mark_read') === '1';

  try {
    const messages = await fetchAvitoChatMessages(chatId, { limit: 100 });
    if (markRead) {
      await markAvitoChatRead(chatId).catch(() => undefined);
    }
    const ourId = Number(getAvitoUserId());
    const mapped = messages
      .map((m) => ({
        id: m.id,
        created: m.created ?? null,
        type: m.type ?? 'text',
        text: m.content?.text ?? '',
        direction:
          m.direction ||
          (m.author_id != null && m.author_id === ourId ? 'out' : 'in'),
        author_id: m.author_id ?? null,
      }))
      .sort((a, b) => (a.created ?? 0) - (b.created ?? 0));

    return NextResponse.json({ success: true, messages: mapped });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка Авито';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) return auth.error;

  if (!isAvitoConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Авито не настроено' },
      { status: 400 },
    );
  }

  const { chatId } = await context.params;
  if (!chatId?.trim()) {
    return NextResponse.json({ success: false, error: 'Нет chatId' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const text = String(body.text || '').trim();
    if (!text) {
      return NextResponse.json({ success: false, error: 'Пустое сообщение' }, { status: 400 });
    }

    await sendAvitoMessage(chatId, text);
    await markAvitoChatRead(chatId).catch(() => undefined);

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка отправки';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
