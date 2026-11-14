import PDFDocument from 'pdfkit';
import JSZip from 'jszip';
import { VIDEO_FORMAT_LABELS, type StoryboardScene, type VideoFormat } from '@/lib/video-script-format';

export function storyboardImageFileName(imageUrl?: string): string | null {
  if (!imageUrl) return null;
  const match = imageUrl.match(/^\/api\/generated-images\/([A-Za-z0-9._-]+\.png)$/);
  return match ? match[1] : null;
}

export async function buildStoryboardPdf(input: {
  title: string;
  format: VideoFormat;
  scenes: StoryboardScene[];
  readImage?: (fileName: string) => Promise<Buffer | null>;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: input.title.slice(0, 180), Creator: 'MarketingOS' } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });
  doc.fontSize(18).text(input.title || 'Video storyboard', { ellipsis: true });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor('#444444').text(VIDEO_FORMAT_LABELS[input.format]);
  doc.fillColor('#000000');
  for (const scene of input.scenes) {
    doc.addPage();
    doc.fontSize(14).text(`Scene ${scene.number} · ${scene.duration}`);
    doc.moveDown(0.4);
    doc.fontSize(11).text(`Shot: ${scene.shot}`);
    if (scene.onScreenText) doc.text(`On-screen: ${scene.onScreenText}`);
    if (scene.vo) doc.text(`VO: ${scene.vo}`);
    const fileName = storyboardImageFileName(scene.imageUrl);
    const bytes = fileName && input.readImage ? await input.readImage(fileName) : null;
    if (bytes) {
      doc.moveDown(0.5);
      doc.image(bytes, { fit: [500, 360], align: 'center' });
    } else {
      doc.moveDown(0.4);
      doc.fillColor('#666666').text(scene.imageError || 'Image not available.');
      doc.fillColor('#000000');
    }
  }
  doc.end();
  await finished;
  return Buffer.concat(chunks);
}

export async function buildStoryboardZip(input: {
  title: string;
  scenes: StoryboardScene[];
  readImage?: (fileName: string) => Promise<Buffer | null>;
}): Promise<Buffer> {
  const zip = new JSZip();
  const lines = [input.title, ''];
  for (const scene of input.scenes) {
    lines.push(`Scene ${scene.number} (${scene.duration})`, scene.shot, scene.onScreenText, scene.vo, scene.imageError || '', '');
    const fileName = storyboardImageFileName(scene.imageUrl);
    const bytes = fileName && input.readImage ? await input.readImage(fileName) : null;
    if (bytes && fileName) zip.file(`scene-${scene.number}-${fileName}`, bytes);
  }
  zip.file('storyboard.txt', lines.join('\n'));
  return zip.generateAsync({ type: 'nodebuffer' });
}
