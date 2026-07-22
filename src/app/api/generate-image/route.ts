import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { exec, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function POST(request: NextRequest) {
  const rl = rateLimit(request);
  if (rl) return rl;

  const auth = await getSession(request);
  if (auth.error) return new Response(JSON.stringify({ error: auth.error }), { status: auth.status });

  const { prompt, taskId, type, brief } = await request.json();
  if (!prompt) return new Response(JSON.stringify({ error: 'Prompt is required' }), { status: 400 });

  const encoder = new TextEncoder();
  const cwd = process.cwd() || '/Users/bayudarmawan/marketingos';
  const sopName = generateSOPFileName(brief || prompt, type || 'social-post');

  // Write prompt to temp file
  const tmpFile = path.join(os.tmpdir(), `codex-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, prompt, 'utf-8');

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let childProc: ChildProcess | null = null;
      let aborted = false;

      const send = (d: Record<string, unknown>) => {
        if (!closed) try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(d)}\n\n`)); } catch {}
      };
      const done = () => {
        if (!closed) {
          closed = true;
          try { controller.close(); } catch {}
        }
      };

      // Handle client disconnect — kill the child process
      request.signal.addEventListener('abort', () => {
        aborted = true;
        if (childProc) {
          try { childProc.kill('SIGKILL'); } catch {}
        }
        cleanup();
        done();
      });

      send({ step: 'start', progress: 10, message: '🎨 Starting Codex image generation...' });
      send({ step: 'generating', progress: 30, message: '🤖 Codex generating image (30-90s)...' });

      try { fs.unlinkSync(path.join(cwd, 'output.png')); } catch {}

      const script = path.join(cwd, 'scripts', 'codex-image-gen.sh');
      const cmd = `bash "${script}" "${tmpFile}" "${cwd}"`;

      const cleanup = () => {
        try { fs.unlinkSync(tmpFile); } catch {}
      };

      childProc = exec(
        cmd,
        {
          cwd,
          timeout: 300_000, // 5 minutes — generous to avoid race with script's own 240s timeout
          env: { ...process.env, TERM: 'xterm' } as NodeJS.ProcessEnv,
          maxBuffer: 10 * 1024 * 1024, // 10MB for stdout
        },
        (err, stdout, stderr) => {
          if (aborted) {
            cleanup();
            done();
            return;
          }

          send({ step: 'processing', progress: 80, message: '📦 Processing image...' });

          const out = String(stdout || '');
          const errOut = String(stderr || '');

          if (out.includes('IMAGE_SUCCESS:')) {
            const m = out.match(/IMAGE_SUCCESS:(\S+)/);
            const src = m ? path.join(cwd, m[1]) : path.join(cwd, 'output.png');
            if (fs.existsSync(src)) {
              const dir = path.join(cwd, 'public', 'outputs', 'images');
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              const fn = `${sopName}.png`;
              fs.copyFileSync(src, path.join(dir, fn));
              try { fs.unlinkSync(src); } catch {}
              send({
                step: 'done', progress: 100,
                message: '✅ Image generated!',
                result: { success: true, imageUrl: `/outputs/images/${fn}`, fileName: fn, sopName, prompt, model: 'gpt-image-2 (Codex)' },
              });
            } else {
              send({ step: 'error', progress: 0, message: '❌ Image file not found (IMAGE_SUCCESS reported but file missing)' });
            }
          } else if (out.includes('IMAGE_FAILED:')) {
            const m = out.match(/IMAGE_FAILED:(.+)/);
            const reason = m ? m[1].trim() : 'unknown error';
            send({ step: 'error', progress: 0, message: `❌ Image generation failed: ${reason}` });
            console.error(`[generate-image] IMAGE_FAILED: ${reason} | stderr: ${errOut.slice(0, 500)}`);
          } else {
            // Script exited without IMAGE_SUCCESS or IMAGE_FAILED — include stderr for debugging
            const errorDetail = err?.message || 'unknown error';
            const stderrSnippet = errOut.slice(0, 500);
            send({ step: 'error', progress: 0, message: `❌ Image generation failed: ${errorDetail}` });
            console.error(`[generate-image] Script crashed: ${errorDetail} | stdout: ${out.slice(0, 200)} | stderr: ${stderrSnippet}`);
          }
          cleanup();
          done();
        }
      );
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
}

function generateSOPFileName(brief: string, type: string): string {
  const cleaned = brief.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).slice(0, 4).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  const contentName = cleaned || 'Content';
  const typeMap: Record<string, string> = { 'social-post': 'SocialPost', 'video-script': 'VideoScript', 'event-plan': 'EventPlan', 'generated': 'Image' };
  const fileType = typeMap[type] || 'Image';
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const dir = path.join(process.cwd(), 'public', 'outputs', 'images');
  const baseName = `DUPOIN_${contentName}_${fileType}`;
  let version = 1;
  if (fs.existsSync(dir)) {
    version = fs.readdirSync(dir).filter(f => f.startsWith(baseName)).length + 1;
  }
  return `DUPOIN_${contentName}_${fileType}_V${version}_${date}`;
}
