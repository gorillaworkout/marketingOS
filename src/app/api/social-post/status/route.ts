import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { persistKnowledgeQuietly, primarySocialPostOutput } from '@/lib/knowledge-persist';

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

  // Verify task exists and belongs to user
  const task = await queryOne<{ id: string; status: string; output_data: string; brief: string | null }>('SELECT id, status, brief, output_data FROM tasks WHERE id = ? AND user_id = ? AND type = ?', [taskId, userId, 'social-post']);

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  // Update status
  await execute('UPDATE tasks SET status = ? WHERE id = ?', [status, taskId]);

  if (status === 'approved' || status === 'published') {
    const selectedOutput = primarySocialPostOutput(task.output_data);
    if (selectedOutput) {
      await persistKnowledgeQuietly({
        userId,
        taskType: 'social-post',
        taskId,
        brief: task.brief?.trim() || 'Social post',
        selectedOutput,
        action: status === 'published' ? 'publish' : 'approve',
      });
    }
  }

  return NextResponse.json({
    success: true,
    taskId,
    previousStatus: task.status,
    newStatus: status,
    message: status === 'published'
      ? 'Status changed to Published. Send this to the Social Media admin for posting.'
      : `Status updated to ${status}`,
  });
}
