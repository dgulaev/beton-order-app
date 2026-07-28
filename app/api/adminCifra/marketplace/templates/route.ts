import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  deleteListingTemplate,
  listListingTemplates,
  saveListingTemplate,
} from '@/lib/avitoListingTemplates';

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const result = await listListingTemplates();
  return NextResponse.json({
    success: true,
    templates: result.templates,
    persistable: result.persistable,
    persistError: result.persistError,
  });
}

async function upsertTemplate(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const template = await saveListingTemplate({
      key: String(body.key || ''),
      title: String(body.title || ''),
      description: String(body.description || ''),
      price: Number(body.price),
      grade: body.grade != null ? String(body.grade) : null,
    });
    return NextResponse.json({ success: true, template });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    const status = /таблиц|does not exist|relation/i.test(message) ? 503 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

/** Создать / обновить шаблон. */
export async function PUT(request: NextRequest) {
  return upsertTemplate(request);
}

/** Создать шаблон (алиас PUT). */
export async function POST(request: NextRequest) {
  return upsertTemplate(request);
}

/** Удалить пользовательский шаблон или сбросить переопределение дефолта. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  try {
    const key =
      request.nextUrl.searchParams.get('key') ||
      String((await request.json().catch(() => ({}))).key || '');
    if (!key) {
      return NextResponse.json({ success: false, error: 'Укажите key' }, { status: 400 });
    }
    const result = await deleteListingTemplate(key);
    return NextResponse.json({
      success: true,
      template: result.template,
      deleted: result.deleted,
      reset: result.reset,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
