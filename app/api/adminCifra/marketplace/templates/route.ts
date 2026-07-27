import { NextRequest, NextResponse } from 'next/server';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  listListingTemplates,
  resetListingTemplate,
  saveListingTemplate,
} from '@/lib/avitoListingTemplates';

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) return auth.error;

  const result = await listListingTemplates();
  return NextResponse.json({
    success: true,
    templates: result.templates,
    persistable: result.persistable,
    persistError: result.persistError,
  });
}

/** Создать / обновить шаблон. */
export async function PUT(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
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

/** Сбросить к дефолту (удалить переопределение) или удалить кастомный. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const key =
      request.nextUrl.searchParams.get('key') ||
      String((await request.json().catch(() => ({}))).key || '');
    if (!key) {
      return NextResponse.json({ success: false, error: 'Укажите key' }, { status: 400 });
    }
    const template = await resetListingTemplate(key);
    return NextResponse.json({ success: true, template, deleted: !template });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
