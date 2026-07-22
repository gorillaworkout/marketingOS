import { NextRequest, NextResponse } from 'next/server';
import { getDb, saveDbToDisk } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const VALID_STATUSES = ['draft', 'review', 'approved', 'published', 'archived'];

export async function PUT(request: NextRequest) {
  const rl = rateLimit(request);
  if (rl) return rl;

  const auth = await getSession(request);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const userId = auth.userId as string;

  const { taskId, status } = await request.json();
  if (!taskId || !status) {
    return NextResponse.json({ error: 'taskId and status are required' }, { status: 400 });
  }

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
  }

  const db = await getDb();

  // Verify task exists and belongs to user
  const task = db.prepare(
    'SELECT id, status, output_data FROM tasks WHERE id = ? AND user_id = ? AND type = ?'
  ).get(taskId, userId, 'social-post') as { id: string; status: string; output_data: string } | undefined;

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  // Update status
  db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, taskId);
  saveDbToDisk();

  return NextResponse.json({
    success: true,
    taskId,
    previousStatus: task.status,
    newStatus: status,
    message: status === 'published'
      ? '📢 Status changed to Published! Kirim ke Admin Social Media untuk posting.'
      : `Status updated to ${status}`,
  });
}
