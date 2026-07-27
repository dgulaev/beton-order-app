import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { canProcessTenders } from '@/lib/demandProcessAccess';
import { writeLeadHistory } from '@/lib/leadHistory';
import { isAllowedContractFile, type LeadContract } from '@/lib/leadContracts';
import {
  createContractSignedUrl,
  uploadLeadContractFile,
} from '@/lib/leadContractsServer';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type Ctx = { params: Promise<{ id: string }> };

async function parseLeadId(context: Ctx): Promise<number | null> {
  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  return Number.isFinite(id) ? id : null;
}

/** GET — список контрактов лида (+ signed url). */
export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const leadId = await parseLeadId(context);
  if (leadId == null) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('lead_contracts')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[lead contracts GET]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const contracts: Array<LeadContract & { url?: string }> = [];
  for (const row of (data ?? []) as LeadContract[]) {
    try {
      const url = await createContractSignedUrl(row.storage_path, 3600);
      contracts.push({ ...row, url });
    } catch {
      contracts.push(row);
    }
  }

  return NextResponse.json({ success: true, contracts });
}

/** POST — загрузка одного или нескольких файлов (multipart). */
export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;
  if (!canProcessTenders(auth.user)) {
    return NextResponse.json(
      { success: false, error: 'Загрузку контрактов делают админы и специалист по торгам' },
      { status: 403 },
    );
  }

  const leadId = await parseLeadId(context);
  if (leadId == null) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) {
    return NextResponse.json({ success: false, error: 'Лид не найден' }, { status: 404 });
  }

  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    const single = form.get('file');
    if (single instanceof File) files.push(single);

    if (files.length === 0) {
      return NextResponse.json({ success: false, error: 'Нет файлов' }, { status: 400 });
    }

    const uploaded: LeadContract[] = [];
    const actorName = auth.user.full_name || 'Сотрудник';

    for (const file of files) {
      const bad = isAllowedContractFile(file);
      if (bad) {
        return NextResponse.json(
          { success: false, error: `${file.name}: ${bad}` },
          { status: 400 },
        );
      }
      const row = await uploadLeadContractFile({
        leadId,
        file,
        fileName: file.name,
        mimeType: file.type,
        uploadedBy: auth.user.user_id,
        uploadedByName: actorName,
      });
      uploaded.push(row);
      await writeLeadHistory({
        lead_id: leadId,
        action: 'Загрузил контракт',
        user_id: auth.user.user_id,
        user_name: actorName,
        user_role: auth.user.role,
        field_name: 'contract',
        old_value: null,
        new_value: file.name,
      });
    }

    return NextResponse.json({ success: true, contracts: uploaded });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка загрузки';
    console.error('[lead contracts POST]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
