import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/database';
import { getSession } from '@/lib/auth';
import { linkedGeneratedImages } from '@/lib/image-remix';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  const auth = await getSession(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = auth.userId;
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const filter = searchParams.get('filter') || 'all'; // 'all' | 'linked' | 'unlinked'

  // 1. Scan filesystem for all images
  const imagesDir = path.join(process.cwd(), 'public', 'outputs', 'images');
  let fsImages: { filename: string; createdAt: string }[] = [];

  if (fs.existsSync(imagesDir)) {
    const files = fs.readdirSync(imagesDir).filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.webp'));
    fsImages = files.map(filename => {
      return {
        filename,
        createdAt: fs.statSync(path.join(imagesDir, filename)).mtime.toISOString(),
      };
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // 2. Get task-linked images from the database (all users, not just current user)
  const tasks = await queryAll(`
    SELECT t.id, t.type, t.title, t.brief, t.output_data, t.created_at, t.user_id, u.username, u.name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.output_data IS NOT NULL
    ORDER BY t.created_at DESC
  `) as Record<string, unknown>[];

  // Map task images: filename -> task info. Same org-wide task scan the gallery
  // already uses; prompt fields come from that stored output and nowhere else.
  const taskImageMap = new Map<string, {
    taskId: string;
    title: string;
    brief: string;
    userId: string;
    username: string;
    name: string;
    type: string | null;
    prompt: string | null;
    aspectRatio: string | null;
    model: string | null;
    includeSwipeLeft: boolean | null;
  }>();
  for (const task of tasks) {
    try {
      const outputData = typeof task.output_data === 'string' ? JSON.parse(task.output_data as string) : task.output_data;
      const info = {
        taskId: task.id as string,
        title: (task.title as string) || '',
        brief: (task.brief as string) || '',
        userId: task.user_id as string,
        username: (task.username as string) || '',
        name: (task.name as string) || '',
        type: typeof task.type === 'string' ? task.type : null,
      };
      for (const linked of linkedGeneratedImages(outputData)) {
        taskImageMap.set(linked.filename, {
          ...info,
          prompt: linked.prompt,
          aspectRatio: linked.aspectRatio,
          model: linked.model,
          includeSwipeLeft: linked.includeSwipeLeft,
        });
      }
    } catch {
      // skip invalid JSON
    }
  }

  // 3. Build combined image list
  let allImages = fsImages.map(img => {
    const taskInfo = taskImageMap.get(img.filename);
    return {
      filename: img.filename,
      url: `/api/generated-images/${encodeURIComponent(img.filename)}`,
      createdAt: img.createdAt,
      taskId: taskInfo?.taskId || null,
      brief: taskInfo?.brief || null,
      title: taskInfo?.title || null,
      userId: taskInfo?.userId || null,
      username: taskInfo?.username || null,
      name: taskInfo?.name || null,
      type: taskInfo?.type || null,
      prompt: taskInfo?.prompt || null,
      aspectRatio: taskInfo?.aspectRatio || null,
      model: taskInfo?.model || null,
      includeSwipeLeft: taskInfo?.includeSwipeLeft ?? null,
      linked: !!taskInfo,
    };
  });

  // 4. Apply filter
  if (filter === 'linked') {
    allImages = allImages.filter(img => img.linked);
  } else if (filter === 'unlinked') {
    allImages = allImages.filter(img => !img.linked);
  }

  const total = allImages.length;
  const paginated = allImages.slice(offset, offset + limit);

  return NextResponse.json({ images: paginated, total, limit, offset });
}
