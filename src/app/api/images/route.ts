import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryAll, execute } from '@/lib/database';
import { getSession } from '@/lib/auth';
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
    SELECT t.id, t.title, t.brief, t.output_data, t.created_at, t.user_id, u.username, u.name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.output_data IS NOT NULL
    ORDER BY t.created_at DESC
  `) as Record<string, unknown>[];

  // Map task images: filename -> task info
  const taskImageMap = new Map<string, { taskId: string; title: string; brief: string; userId: string; username: string; name: string }>();
  for (const task of tasks) {
    try {
      const outputData = typeof task.output_data === 'string' ? JSON.parse(task.output_data as string) : task.output_data;
      if (outputData && typeof outputData === 'object') {
        // Check for imageUrl field
        const imageUrl = (outputData as Record<string, unknown>).imageUrl as string | undefined;
        if (imageUrl) {
          const fn = imageUrl.split('/').pop();
          if (fn) taskImageMap.set(fn, { 
            taskId: task.id as string, 
            title: (task.title as string) || '', 
            brief: (task.brief as string) || '', 
            userId: task.user_id as string,
            username: (task.username as string) || '',
            name: (task.name as string) || ''
          });
        }
        // Check for images array
        const images = (outputData as Record<string, unknown>).images;
        if (Array.isArray(images)) {
          for (const img of images) {
            if (typeof img === 'string') {
              const fn = img.split('/').pop();
              if (fn) taskImageMap.set(fn, { 
                taskId: task.id as string, 
                title: (task.title as string) || '', 
                brief: (task.brief as string) || '', 
                userId: task.user_id as string,
                username: (task.username as string) || '',
                name: (task.name as string) || ''
              });
            } else if (img && typeof img === 'object' && (img as Record<string, unknown>).url) {
              const fn = ((img as Record<string, unknown>).url as string).split('/').pop();
              if (fn) taskImageMap.set(fn, { 
                taskId: task.id as string, 
                title: (task.title as string) || '', 
                brief: (task.brief as string) || '', 
                userId: task.user_id as string,
                username: (task.username as string) || '',
                name: (task.name as string) || ''
              });
            }
          }
        }
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
