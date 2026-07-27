import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/** Кто видит пункт «Задачи» в меню (не laborant / не operator). */
const TASKS_ROLES = ['admin', 'manager', 'dispatcher', 'guest'] as const;

function displayName(u: { full_name?: string | null; organization_name?: string | null } | null | undefined) {
  return u?.organization_name || u?.full_name || null;
}

// GET — задачи текущего пользователя (автор или исполнитель)
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, TASKS_ROLES);
  if (auth.error) return auth.error;

  const userId = auth.user.user_id;

  try {
    const { data: tasksData, error } = await supabaseAdmin
      .from('tasks')
      .select('*')
      .or(`created_by.eq.${userId},assigned_to.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!tasksData || tasksData.length === 0) {
      return NextResponse.json({ success: true, tasks: [] });
    }

    const userIds = [
      ...new Set(tasksData.flatMap((t) => [t.created_by, t.assigned_to]).filter(Boolean)),
    ];

    const { data: usersData, error: usersError } = await supabaseAdmin
      .from('users')
      .select('user_id, full_name, organization_name')
      .in('user_id', userIds);

    if (usersError) console.error('Users fetch error:', usersError);

    const usersMap = new Map((usersData || []).map((u) => [u.user_id, u]));

    const enrichedTasks = tasksData.map((task) => ({
      ...task,
      creator: usersMap.get(task.created_by) || null,
      assignee: usersMap.get(task.assigned_to) || null,
    }));

    return NextResponse.json({ success: true, tasks: enrichedTasks });
  } catch (error: unknown) {
    console.error('GET tasks error:', error);
    const message = error instanceof Error ? error.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// POST — создание задачи + уведомление
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, TASKS_ROLES);
  if (auth.error) return auth.error;

  const created_by = auth.user.user_id;

  try {
    const body = await request.json();
    const { title, description, assigned_to, due_date } = body;

    if (!title || !String(title).trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const assigneeId =
      assigned_to != null && assigned_to !== '' ? Number(assigned_to) : null;
    if (assigneeId != null && !Number.isFinite(assigneeId)) {
      return NextResponse.json({ error: 'Некорректный assigned_to' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .insert({
        title: String(title).trim(),
        description: description || null,
        assigned_to: assigneeId,
        due_date: due_date || null,
        created_by,
        status: 'new',
      })
      .select()
      .single();

    if (error) throw error;

    let creatorName = auth.user.full_name || 'Неизвестно';
    let assigneeName = 'Не назначен';

    const { data: creator } = await supabaseAdmin
      .from('users')
      .select('full_name, organization_name')
      .eq('user_id', created_by)
      .maybeSingle();
    creatorName = displayName(creator) || creatorName;

    if (data?.assigned_to) {
      const { data: assignee } = await supabaseAdmin
        .from('users')
        .select('full_name, organization_name')
        .eq('user_id', data.assigned_to)
        .maybeSingle();
      assigneeName = displayName(assignee) || 'Не назначен';
    }

    if (data && assigneeId && assigneeId !== created_by) {
      await supabaseAdmin.from('admin_notifications').insert({
        user_id: assigneeId,
        type: 'task',
        title: 'Новая задача',
        message: `Вам назначена задача: "${title}"\nОт: ${creatorName}\nКому: ${assigneeName}`,
        is_read: false,
      });
    }

    return NextResponse.json({ success: true, task: data });
  } catch (error: unknown) {
    console.error('POST task error:', error);
    const message = error instanceof Error ? error.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// PATCH — обновление задачи (статус или полные данные)
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, TASKS_ROLES);
  if (auth.error) return auth.error;

  const userId = auth.user.user_id;

  try {
    const body = await request.json();
    const { taskId, status, title, description, assigned_to, due_date, completion_note } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('tasks')
      .select('id, created_by, assigned_to')
      .eq('id', taskId)
      .maybeSingle();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const isCreator = String(existing.created_by) === String(userId);
    const isAssignee = String(existing.assigned_to) === String(userId);
    if (!isCreator && !isAssignee) {
      return NextResponse.json({ error: 'Нет доступа к задаче' }, { status: 403 });
    }

    // Полное редактирование полей — только автор; статус/комментарий — автор или исполнитель
    const editingFields =
      title != null ||
      description !== undefined ||
      assigned_to !== undefined ||
      due_date !== undefined;
    if (editingFields && !isCreator) {
      return NextResponse.json({ error: 'Редактировать может только автор' }, { status: 403 });
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (status) updateData.status = status;
    if (title) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (assigned_to !== undefined) {
      updateData.assigned_to =
        assigned_to === null || assigned_to === '' ? null : Number(assigned_to);
    }
    if (due_date !== undefined) updateData.due_date = due_date || null;
    if (completion_note) {
      updateData.completion_note = completion_note;
      updateData.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, task: data });
  } catch (error: unknown) {
    console.error('PATCH task error:', error);
    const message = error instanceof Error ? error.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// DELETE — удаление задачи (только автором)
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, TASKS_ROLES);
  if (auth.error) return auth.error;

  const userId = auth.user.user_id;

  try {
    const { taskId } = await request.json();

    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const { data: task, error: checkError } = await supabaseAdmin
      .from('tasks')
      .select('created_by')
      .eq('id', taskId)
      .maybeSingle();

    if (checkError || !task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (String(task.created_by) !== String(userId)) {
      return NextResponse.json({ error: 'Only creator can delete task' }, { status: 403 });
    }

    const { error } = await supabaseAdmin.from('tasks').delete().eq('id', taskId);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('DELETE task error:', error);
    const message = error instanceof Error ? error.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
