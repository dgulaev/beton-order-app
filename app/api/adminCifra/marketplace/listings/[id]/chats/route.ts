import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  fetchAvitoChats,
  getAvitoUserId,
  isAvitoConfigured,
} from '@/lib/integrations/avito';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  if (!isAvitoConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Авито не настроено' },
      { status: 400 },
    );
  }

  const { data: listing, error } = await supabaseAdmin
    .from('marketplace_listings')
    .select('id, source, external_id, title')
    .eq('id', id)
    .single();

  if (error || !listing) {
    return NextResponse.json({ success: false, error: 'Объявление не найдено' }, { status: 404 });
  }

  if (listing.source !== 'avito') {
    return NextResponse.json(
      { success: false, error: 'Чаты доступны только для Авито' },
      { status: 400 },
    );
  }

  try {
    const chats = await fetchAvitoChats({
      itemIds: [listing.external_id],
      limit: 50,
    });
    const ourId = Number(getAvitoUserId());

    const mapped = chats.map((chat) => {
      const buyer = (chat.users || []).find((u) => u.id !== ourId);
      const last = chat.last_message;
      let lastText = last?.content?.text ?? null;
      // Без подписки API мессенджера Авито иногда кладёт текст ошибки в last_message.
      if (lastText && /подписк|api мессенджера|402/i.test(lastText)) {
        lastText = null;
      }
      return {
        id: chat.id,
        updated: chat.updated ?? null,
        buyer_name: buyer?.name ?? null,
        buyer_url: buyer?.public_user_profile?.url ?? null,
        last_text: lastText,
        last_direction: last?.direction ?? null,
        last_created: last?.created ?? null,
        chat_url: `https://www.avito.ru/profile/messenger/channel/${chat.id}`,
      };
    });

    return NextResponse.json({ success: true, chats: mapped });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка Авито';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
