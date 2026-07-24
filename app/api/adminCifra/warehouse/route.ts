import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  SILO_SPEC,
  syncAllSiloLowRateAlerts,
  syncSiloLowRateAlert,
} from '@/lib/siloConfig';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Гарантируем 3 силоса с правильными max (85 / 85 / 170). */
async function ensureSilos() {
  const { data: existing } = await supabase.from('warehouse_silos').select('silo_id, max, name');
  const byId = new Map((existing || []).map((s: any) => [Number(s.silo_id), s]));

  for (const spec of SILO_SPEC) {
    const row = byId.get(spec.silo_id);
    if (!row) {
      await supabase.from('warehouse_silos').insert({
        silo_id: spec.silo_id,
        name: spec.name,
        current: 0,
        max: spec.max,
        nominal: spec.max,
        updated_at: new Date().toISOString(),
      });
    } else if (Number(row.max) !== spec.max || row.name !== spec.name) {
      await supabase
        .from('warehouse_silos')
        .update({
          max: spec.max,
          nominal: spec.max,
          name: spec.name,
          updated_at: new Date().toISOString(),
        })
        .eq('silo_id', spec.silo_id);
    }
  }
}

export async function GET() {
  try {
    await ensureSilos();

    const [silosRes, additivesRes] = await Promise.all([
      supabase.from('warehouse_silos').select('*').order('silo_id'),
      supabase.from('warehouse_additives').select('*').order('additive_id')
    ]);

    // Синхронизация алертов глубокого минуса + список ещё не подтверждённых
    const lowRateAlerts = await syncAllSiloLowRateAlerts(supabase);

    return NextResponse.json({
      silos: silosRes.data || [],
      additives: additivesRes.data || [],
      lowRateAlerts,
    });
  } catch (error) {
    console.error('Ошибка GET склада:', error);
    return NextResponse.json({ error: 'Ошибка загрузки' }, { status: 500 });
  }
}

const FBS_ORDER_META_NAME = '__fbs_display_order__';
const FBS_ORDER_META_CODE = '__fbs_display_order__';

export async function POST(request: NextRequest) {
  try {
    const { silos, additives, fbs, fbsOrder } = await request.json();

    // Порядок строк ФБС в карточке склада (служебная запись).
    // Имена — в unit (JSON), code фиксирован: не конфликтует с unique(code).
    if (Array.isArray(fbsOrder)) {
      const names = fbsOrder
        .map((n: any) => String(n || '').trim())
        .filter((n: string) => n && n !== FBS_ORDER_META_NAME);
      const { data: existingOrder } = await supabase
        .from('fbs_blocks')
        .select('id')
        .eq('name', FBS_ORDER_META_NAME)
        .maybeSingle();

      const orderPayload = {
        code: FBS_ORDER_META_CODE,
        unit: JSON.stringify(names),
        current: 0,
        is_active: false,
        updated_at: new Date().toISOString(),
      };

      if (existingOrder?.id) {
        const { error } = await supabase
          .from('fbs_blocks')
          .update(orderPayload)
          .eq('id', existingOrder.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('fbs_blocks').insert({
          name: FBS_ORDER_META_NAME,
          ...orderPayload,
          price: 0,
          created_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
    }

    // Силосы
    if (silos && Array.isArray(silos)) {
      for (const s of silos) {
        const updateData: Record<string, unknown> = {
          current: Number(s.current),
          updated_at: new Date().toISOString(),
        };
        if (s.max !== undefined) updateData.max = Number(s.max);
        if (s.name !== undefined) updateData.name = String(s.name);
        await supabase
          .from('warehouse_silos')
          .update(updateData)
          .eq('silo_id', Number(s.silo_id));
        await syncSiloLowRateAlert(supabase, Number(s.silo_id));
      }
    }

    // === ДОБАВКИ — ИСПРАВЛЕНИЕ ===
    if (additives && Array.isArray(additives)) {
      for (const a of additives) {
        const updateData: any = {
          current: Number(a.current || 0),
          updated_at: new Date().toISOString()
        };

        // Добавляем обновление max, если оно пришло
        if (a.max !== undefined) {
          updateData.max = Number(a.max);
        }

        await supabase
          .from('warehouse_additives')
          .update(updateData)
          .eq('additive_id', Number(a.additive_id));
      }
    }

    // === ФБС — устойчивая версия к двойным вызовам ===
if (fbs && Array.isArray(fbs)) {
  for (const b of fbs) {
    const blockName = String(b.name || b.code || '').trim();
    const blockCode = String(b.code || b.name || '').trim();

    if (!blockName) continue;
    // Служебная запись порядка отображения — не трогаем как обычный остаток.
    if (blockName.startsWith('__') && blockName.endsWith('__')) continue;

    // Проверяем существование
    const { data: existing } = await supabase
      .from('fbs_blocks')
      .select('id, current')
      .eq('name', blockName)
      .maybeSingle();

    if (existing) {
      // Обновляем
      await supabase
        .from('fbs_blocks')
        .update({ 
          current: Number(b.current || 0),
          updated_at: new Date().toISOString() 
        })
        .eq('name', blockName);
    } else {
      // Создаём только если точно нет
      const { error } = await supabase
        .from('fbs_blocks')
        .insert({
          name: blockName,
          code: blockCode,
          unit: 'шт',
          price: 0,
          is_active: true,
          current: Number(b.current || 0),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error && error.code !== '23505') {
        console.error(`Ошибка создания ФБС "${blockName}":`, error);
      }
    }
  }
}

    return NextResponse.json({ success: true, message: 'Склад сохранён' });
  } catch (error: any) {
    console.error('Ошибка POST склада:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** Удалить вид ФБС: строка в fbs_blocks + рецепт (item_type=fbs) + порядок в карточке. */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fbsName = String(searchParams.get('fbs_name') || '').trim();
    const recipeIdRaw = searchParams.get('recipe_id');
    const fbsIdRaw = searchParams.get('fbs_id');

    if (!fbsName && !recipeIdRaw && !fbsIdRaw) {
      return NextResponse.json(
        { error: 'Укажите fbs_name, recipe_id или fbs_id' },
        { status: 400 },
      );
    }
    if (fbsName === FBS_ORDER_META_NAME || fbsName.startsWith('__')) {
      return NextResponse.json({ error: 'Нельзя удалить служебную запись' }, { status: 400 });
    }

    let resolvedName = fbsName;
    let stockDeleted = false;

    // 1) Остаток на складе
    if (fbsIdRaw) {
      const { data: byId } = await supabase
        .from('fbs_blocks')
        .select('id, name')
        .eq('id', Number(fbsIdRaw))
        .maybeSingle();
      if (byId?.name && byId.name !== FBS_ORDER_META_NAME) {
        resolvedName = String(byId.name);
        const { error } = await supabase.from('fbs_blocks').delete().eq('id', byId.id);
        if (error) throw error;
        stockDeleted = true;
      }
    }
    if (!stockDeleted && resolvedName) {
      const { error } = await supabase
        .from('fbs_blocks')
        .delete()
        .eq('name', resolvedName)
        .neq('name', FBS_ORDER_META_NAME);
      if (error) throw error;
    }

    // 2) Рецепт / каталог видов ФБС
    if (recipeIdRaw) {
      const { error } = await supabase.from('recipes').delete().eq('id', Number(recipeIdRaw));
      if (error) throw error;
    } else if (resolvedName) {
      const { error } = await supabase
        .from('recipes')
        .delete()
        .eq('item_type', 'fbs')
        .eq('name', resolvedName);
      if (error) throw error;
    }

    // 3) Убрать имя из порядка отображения
    if (resolvedName) {
      const { data: orderRow } = await supabase
        .from('fbs_blocks')
        .select('id, unit, code')
        .eq('name', FBS_ORDER_META_NAME)
        .maybeSingle();

      if (orderRow?.id) {
        let names: string[] = [];
        try {
          const fromUnit = String(orderRow.unit || '');
          const fromCode = String(orderRow.code || '').replace(/^__order__:/, '');
          const raw = fromUnit.startsWith('[') ? fromUnit : fromCode;
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) names = parsed.map((x) => String(x));
        } catch {
          names = [];
        }
        const next = names.filter((n) => n && n !== resolvedName);
        const { error } = await supabase
          .from('fbs_blocks')
          .update({
            unit: JSON.stringify(next),
            updated_at: new Date().toISOString(),
          })
          .eq('id', orderRow.id);
        if (error) throw error;
      }
    }

    return NextResponse.json({ success: true, deleted: resolvedName || null });
  } catch (error: any) {
    console.error('Ошибка DELETE вида ФБС:', error);
    return NextResponse.json({ error: error.message || 'Ошибка удаления' }, { status: 500 });
  }
}