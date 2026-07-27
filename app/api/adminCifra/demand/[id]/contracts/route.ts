import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { canProcessTenders } from '@/lib/demandProcessAccess';
import {
  DEMAND_CONTRACT_ACCEPT,
  isAllowedContractFile,
  type DemandContract,
} from '@/lib/demandContracts';
import {
  createDemandContractSignedUrl,
  uploadDemandContractFile,
} from '@/lib/demandContractsServer';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type Ctx = { params: Promise<{ id: string }> };

async function parseDemandId(context: Ctx): Promise<number | null> {
  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  return Number.isFinite(id) ? id : null;
}

/** GET — список документов обработки (+ signed url). */
export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const demandId = await parseDemandId(context);
  if (demandId == null) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('demand_contracts')
    .select('*')
    .eq('demand_id', demandId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[demand contracts GET]', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error.message.includes('demand_contracts')
            ? 'Таблица demand_contracts не найдена — выполните scripts/demand-contracts-schema.sql'
            : error.message,
      },
      { status: 500 },
    );
  }

  const contracts: Array<DemandContract & { url?: string }> = [];
  for (const row of (data ?? []) as DemandContract[]) {
    try {
      const url = await createDemandContractSignedUrl(row.storage_path, 3600);
      contracts.push({ ...row, url });
    } catch {
      contracts.push(row);
    }
  }

  return NextResponse.json({ success: true, contracts, accept: DEMAND_CONTRACT_ACCEPT });
}

/** POST — загрузка файлов на этапе обработки. */
export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;
  if (!canProcessTenders(auth.user)) {
    return NextResponse.json(
      { success: false, error: 'Обработку ведут админы и специалист по торгам' },
      { status: 403 },
    );
  }

  const demandId = await parseDemandId(context);
  if (demandId == null) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const { data: item } = await supabaseAdmin
    .from('demand_items')
    .select('id, status, lead_id')
    .eq('id', demandId)
    .maybeSingle();

  if (!item) {
    return NextResponse.json({ success: false, error: 'Не найдено' }, { status: 404 });
  }
  if (item.lead_id || item.status === 'taken') {
    return NextResponse.json(
      { success: false, error: 'Уже в лидах — документы загружайте на карточке лида' },
      { status: 409 },
    );
  }
  if (item.status === 'ignored') {
    return NextResponse.json(
      { success: false, error: 'Запись в игноре — сначала верните в работу' },
      { status: 409 },
    );
  }

  // Автоматически переводим в processing при первой загрузке документов.
  if (item.status !== 'processing') {
    await supabaseAdmin
      .from('demand_items')
      .update({ status: 'processing' })
      .eq('id', demandId)
      .is('lead_id', null);
  }

  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    const single = form.get('file');
    if (single instanceof File) files.push(single);

    if (files.length === 0) {
      return NextResponse.json({ success: false, error: 'Нет файлов' }, { status: 400 });
    }

    const uploaded: DemandContract[] = [];
    const actorName = auth.user.full_name || 'Сотрудник';

    for (const file of files) {
      const bad = isAllowedContractFile(file);
      if (bad) {
        return NextResponse.json(
          { success: false, error: `${file.name}: ${bad}` },
          { status: 400 },
        );
      }
      uploaded.push(
        await uploadDemandContractFile({
          demandId,
          file,
          fileName: file.name,
          mimeType: file.type,
          uploadedBy: auth.user.user_id,
          uploadedByName: actorName,
        }),
      );
    }

    return NextResponse.json({ success: true, contracts: uploaded });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка загрузки';
    console.error('[demand contracts POST]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
