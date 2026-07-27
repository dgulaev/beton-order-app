import { NextRequest, NextResponse } from 'next/server';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isAvitoConfigured, updateAvitoItemPrice } from '@/lib/integrations/avito';
import { getListingTemplate } from '@/lib/avitoListingTemplates';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) return auth.error;

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const { data: listing, error: fetchError } = await supabaseAdmin
    .from('marketplace_listings')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !listing) {
    return NextResponse.json({ success: false, error: 'Объявление не найдено' }, { status: 404 });
  }

  try {
    const body = await request.json();
    const patch: Record<string, unknown> = {};

    if (body.status != null) patch.status = body.status;
    if (body.title != null) patch.title = body.title;
    if (body.description != null) patch.description = body.description;
    if (body.template_key != null) {
      patch.template_key = body.template_key;
      const tpl = await getListingTemplate(String(body.template_key));
      if (tpl && body.apply_template) {
        patch.title = tpl.title;
        patch.description = tpl.description;
        if (body.price == null) patch.price = tpl.price;
      }
    }

    if (body.price != null) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ success: false, error: 'Некорректная цена' }, { status: 400 });
      }
      patch.price = price;

      if (listing.source === 'avito' && isAvitoConfigured() && body.push_to_avito !== false) {
        try {
          await updateAvitoItemPrice(listing.external_id, price);
        } catch (e: unknown) {
          console.error('[listings PATCH] Avito price', e);
          return NextResponse.json(
            {
              success: false,
              error: e instanceof Error ? e.message : 'Не удалось обновить цену на Авито',
            },
            { status: 502 },
          );
        }
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: 'Нет полей' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('marketplace_listings')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, listing: data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
