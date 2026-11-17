/**
 * One small drawing surface with two backends (pdfkit and pptxgenjs), so the
 * 16:9 slide layout is written once and the PDF and PPTX look the same.
 * Coordinates are points on a 960 x 540 slide. Server only.
 */
import PDFDocument from 'pdfkit';
import PptxGenJS from 'pptxgenjs';
import { fontPath, slideBackground, starPoints, type BackgroundVariant, type FontWeight } from './proposal-art';

export const SLIDE_W = 960;
export const SLIDE_H = 540;

export interface TextOpts {
  x: number; y: number; w: number; h: number;
  size: number;
  weight?: FontWeight;
  color?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  lineGap?: number;
  link?: string;
  italic?: boolean;
}

export interface RectOpts {
  x: number; y: number; w: number; h: number;
  fill?: string;
  /** PDF draws a left-to-right gradient; PPTX uses the first color. */
  gradient?: [string, string];
  opacity?: number;
  line?: string;
  lineWidth?: number;
  radius?: number;
}

export interface TableOpts {
  x: number; y: number;
  colW: number[];
  size: number;
  headFill: string;
  headColor: string;
  lineColor: string;
  bodyColor?: string;
  padding?: number;
  minRowH?: number;
  align?: Array<'left' | 'center' | 'right'>;
}

export interface Canvas {
  newSlide(background: BackgroundVariant): Promise<void>;
  text(value: string, o: TextOpts): void;
  bullets(items: string[], o: TextOpts & { numbered?: boolean; gap?: number }): void;
  rect(o: RectOpts): void;
  ellipse(o: { x: number; y: number; w: number; h: number; fill: string; rotate?: number }): void;
  line(o: { x1: number; y1: number; x2: number; y2: number; color: string; width?: number; arrow?: boolean }): void;
  star(cx: number, cy: number, r: number, color: string): void;
  image(data: Buffer, o: { x: number; y: number; w: number; h: number }, size: { width: number; height: number }): void;
  /** Draws a table and returns its height. */
  table(rows: string[][], o: TableOpts): number;
  /** Height a wrapped text block needs. */
  measure(value: string, size: number, width: number, weight?: FontWeight, lineGap?: number): number;
  finish(): Promise<Buffer>;
}

const FONT_NAMES: Record<FontWeight, string> = { light: 'Fira-Light', regular: 'Fira-Regular', semibold: 'Fira-SemiBold', bold: 'Fira-Bold' };

/** Fits an image inside a box keeping its aspect ratio, centered. */
export function containBox(box: { x: number; y: number; w: number; h: number }, size: { width: number; height: number }) {
  const scale = Math.min(box.w / size.width, box.h / size.height);
  const w = size.width * scale;
  const h = size.height * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/* ---------------- PDF ---------------- */

export function registerFonts(doc: PDFKit.PDFDocument) {
  for (const weight of Object.keys(FONT_NAMES) as FontWeight[]) doc.registerFont(FONT_NAMES[weight], fontPath(weight));
}

export const pdfFont = (weight: FontWeight = 'regular') => FONT_NAMES[weight];

export function createPdfCanvas(): Canvas {
  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, size: [SLIDE_W, SLIDE_H], info: { Title: 'Dupoin collaboration proposal', Author: 'Dupoin Futures Indonesia' } });
  registerFonts(doc);
  const chunks: Buffer[] = [];
  doc.on('data', chunk => chunks.push(chunk as Buffer));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Each background is embedded once and reused on every page.
  // pdfkit has openImage at runtime; its types do not declare it.
  const opener = doc as unknown as { openImage(src: Buffer): unknown; image(src: unknown, x: number, y: number, options: object): unknown };
  const opened = new Map<BackgroundVariant, unknown>();
  const measure = (value: string, size: number, width: number, weight: FontWeight = 'regular', lineGap = 0) =>
    doc.font(pdfFont(weight)).fontSize(size).heightOfString(value || ' ', { width, lineGap });

  const canvas: Canvas = {
    async newSlide(background) {
      doc.addPage({ size: [SLIDE_W, SLIDE_H], margin: 0 });
      if (!opened.has(background)) opened.set(background, opener.openImage(await slideBackground(background)));
      opener.image(opened.get(background), 0, 0, { width: SLIDE_W, height: SLIDE_H });
    },
    text(value, o) {
      const lineGap = o.lineGap ?? 0;
      const height = measure(value, o.size, o.w, o.weight, lineGap);
      const offset = o.valign === 'middle' ? Math.max(0, (o.h - height) / 2) : o.valign === 'bottom' ? Math.max(0, o.h - height) : 0;
      doc.font(pdfFont(o.weight)).fontSize(o.size).fillColor(o.color ?? '#1D1D1F').fillOpacity(1)
        .text(value, o.x, o.y + offset, { width: o.w, height: o.h - offset + 1, align: o.align ?? 'left', lineGap, link: o.link, ellipsis: true, underline: Boolean(o.link), oblique: o.italic ? 8 : undefined });
    },
    bullets(items, o) {
      const gap = o.gap ?? 4;
      const indent = o.size * (o.numbered ? 1.6 : 1.3);
      let y = o.y;
      items.forEach((item, index) => {
        const height = measure(item, o.size, o.w - indent, o.weight, o.lineGap ?? 0);
        if (y + Math.min(height, o.size * 1.3) > o.y + o.h) return;
        doc.font(pdfFont(o.weight)).fontSize(o.size).fillColor(o.color ?? '#1D1D1F');
        if (o.numbered) doc.text(`${index + 1}.`, o.x, y, { width: indent, lineBreak: false });
        else doc.circle(o.x + o.size * 0.35, y + o.size * 0.58, o.size * 0.22).fill(o.color ?? '#1D1D1F');
        doc.font(pdfFont(o.weight)).fontSize(o.size).fillColor(o.color ?? '#1D1D1F')
          .text(item, o.x + indent, y, { width: o.w - indent, lineGap: o.lineGap ?? 0, height: o.y + o.h - y, ellipsis: true });
        y += height + gap;
      });
    },
    rect(o) {
      doc.save();
      const path = () => (o.radius ? doc.roundedRect(o.x, o.y, o.w, o.h, o.radius) : doc.rect(o.x, o.y, o.w, o.h));
      if (o.gradient || o.fill) {
        path();
        if (o.gradient) {
          const gradient = doc.linearGradient(o.x, o.y, o.x + o.w, o.y);
          gradient.stop(0, o.gradient[0]).stop(1, o.gradient[1]);
          doc.fillOpacity(o.opacity ?? 1).fill(gradient);
        } else doc.fillOpacity(o.opacity ?? 1).fill(o.fill!);
      }
      if (o.line) {
        path();
        doc.lineWidth(o.lineWidth ?? 1).strokeOpacity(1).stroke(o.line);
      }
      doc.restore();
    },
    ellipse(o) {
      doc.save();
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      if (o.rotate) doc.rotate(o.rotate, { origin: [cx, cy] });
      doc.ellipse(cx, cy, o.w / 2, o.h / 2).fill(o.fill);
      doc.restore();
    },
    line(o) {
      doc.save().lineWidth(o.width ?? 1).moveTo(o.x1, o.y1).lineTo(o.x2, o.y2).stroke(o.color);
      if (o.arrow) {
        const angle = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
        const size = 4 + (o.width ?? 1) * 2;
        doc.moveTo(o.x2, o.y2)
          .lineTo(o.x2 - size * Math.cos(angle - 0.45), o.y2 - size * Math.sin(angle - 0.45))
          .lineTo(o.x2 - size * Math.cos(angle + 0.45), o.y2 - size * Math.sin(angle + 0.45))
          .closePath().fill(o.color);
      }
      doc.restore();
    },
    star(cx, cy, r, color) {
      const points = starPoints(cx, cy, r);
      doc.save().polygon(...points).fill(color).restore();
    },
    image(data, o, size) {
      const box = containBox(o, size);
      doc.image(data, box.x, box.y, { width: box.w, height: box.h });
    },
    table(rows, o) {
      const padding = o.padding ?? 6;
      let y = o.y;
      rows.forEach((row, rowIndex) => {
        const head = rowIndex === 0;
        const weight: FontWeight = head ? 'semibold' : 'regular';
        const height = Math.max(o.minRowH ?? 0, ...row.map((cell, index) => measure(cell, o.size, o.colW[index] - padding * 2, weight) + padding * 2));
        let x = o.x;
        row.forEach((cell, index) => {
          const w = o.colW[index];
          doc.save();
          doc.rect(x, y, w, height).fillOpacity(1).fill(head ? o.headFill : '#FFFFFF');
          doc.rect(x, y, w, height).lineWidth(0.6).stroke(o.lineColor);
          doc.restore();
          doc.font(pdfFont(weight)).fontSize(o.size).fillColor(head ? o.headColor : (o.bodyColor ?? '#1D1D1F'))
            .text(cell, x + padding, y + padding, { width: w - padding * 2, align: o.align?.[index] ?? 'left' });
          x += w;
        });
        y += height;
      });
      return y - o.y;
    },
    measure,
    async finish() {
      doc.end();
      return done;
    },
  };
  return canvas;
}

/* ---------------- PPTX ---------------- */

const IN = (points: number) => points / 96;
/** A 10in slide is 720pt wide; our layout is 960 units wide. */
const PT = (size: number) => Math.round(size * 0.75 * 10) / 10;
const hex = (color?: string) => (color ?? '#1D1D1F').replace('#', '').toUpperCase();
const FACE: Record<FontWeight, { fontFace: string; bold: boolean }> = {
  light: { fontFace: 'Fira Sans Light', bold: false },
  regular: { fontFace: 'Fira Sans', bold: false },
  semibold: { fontFace: 'Fira Sans SemiBold', bold: false },
  bold: { fontFace: 'Fira Sans', bold: true },
};

/** Rough wrapped-text height used where PowerPoint cannot measure for us. */
export function estimateTextHeight(value: string, size: number, width: number, lineGap = 0): number {
  const charsPerLine = Math.max(1, Math.floor(width / (size * 0.5)));
  const lines = (value || ' ').split('\n').reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / charsPerLine)), 0);
  return lines * (size * 1.2 + lineGap);
}

export function createPptxCanvas(title = 'Dupoin collaboration proposal'): Canvas {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_16x9';
  pres.author = 'Dupoin Futures Indonesia';
  pres.company = 'PT Dupoin Futures Indonesia';
  pres.title = title;
  let slide: PptxGenJS.Slide | null = null;
  const masters = new Set<string>();
  const current = () => {
    if (!slide) throw new Error('newSlide() first');
    return slide;
  };
  const textOptions = (o: TextOpts) => ({
    x: IN(o.x), y: IN(o.y), w: IN(o.w), h: IN(o.h),
    fontSize: PT(o.size), color: hex(o.color), ...FACE[o.weight ?? 'regular'], italic: o.italic,
    align: o.align ?? 'left', valign: o.valign ?? 'top', margin: 0, fit: 'shrink' as const,
    lineSpacingMultiple: o.lineGap ? 1 + o.lineGap / o.size : undefined,
  });

  return {
    async newSlide(background) {
      // One slide master per background, so each image is stored once in the file.
      const masterName = `Dupoin ${background}`;
      if (!masters.has(masterName)) {
        pres.defineSlideMaster({ title: masterName, background: { data: `image/jpeg;base64,${(await slideBackground(background)).toString('base64')}` } });
        masters.add(masterName);
      }
      slide = pres.addSlide({ masterName });
    },
    text(value, o) {
      current().addText(o.link ? [{ text: value, options: { hyperlink: { url: o.link } } }] : value, textOptions(o));
    },
    bullets(items, o) {
      if (!items.length) return;
      current().addText(items.map(item => ({
        text: item,
        options: { bullet: o.numbered ? { type: 'number' as const } : { indent: PT(o.size) }, breakLine: true, paraSpaceAfter: PT(o.gap ?? 4) },
      })), textOptions(o));
    },
    rect(o) {
      current().addShape(o.radius ? pres.ShapeType.roundRect : pres.ShapeType.rect, {
        x: IN(o.x), y: IN(o.y), w: IN(o.w), h: IN(o.h),
        fill: o.fill || o.gradient ? { color: hex(o.gradient?.[0] ?? o.fill), transparency: Math.round((1 - (o.opacity ?? 1)) * 100) } : { type: 'none' as never },
        line: o.line ? { color: hex(o.line), width: PT(o.lineWidth ?? 1) } : { type: 'none' },
        rectRadius: o.radius ? Math.min(0.5, o.radius / Math.min(o.w, o.h)) : undefined,
      });
    },
    ellipse(o) {
      current().addShape(pres.ShapeType.ellipse, { x: IN(o.x), y: IN(o.y), w: IN(o.w), h: IN(o.h), fill: { color: hex(o.fill) }, line: { type: 'none' }, rotate: o.rotate });
    },
    line(o) {
      const x = Math.min(o.x1, o.x2);
      const y = Math.min(o.y1, o.y2);
      current().addShape(pres.ShapeType.line, {
        x: IN(x), y: IN(y), w: IN(Math.abs(o.x2 - o.x1)), h: IN(Math.abs(o.y2 - o.y1)),
        flipH: o.x2 < o.x1, flipV: o.y2 < o.y1,
        line: { color: hex(o.color), width: PT(o.width ?? 1), endArrowType: o.arrow ? 'triangle' : undefined },
      });
    },
    star(cx, cy, r, color) {
      current().addShape(pres.ShapeType.star5, { x: IN(cx - r), y: IN(cy - r), w: IN(r * 2), h: IN(r * 2), fill: { color: hex(color) }, line: { type: 'none' } });
    },
    image(data, o, size) {
      const box = containBox(o, size);
      const mime = data[0] === 0xff && data[1] === 0xd8 ? 'image/jpeg' : 'image/png';
      current().addImage({ data: `${mime};base64,${data.toString('base64')}`, x: IN(box.x), y: IN(box.y), w: IN(box.w), h: IN(box.h) });
    },
    table(rows, o) {
      const padding = o.padding ?? 6;
      const heights = rows.map(row => Math.max(o.minRowH ?? 0, ...row.map((cell, index) => estimateTextHeight(cell, o.size, o.colW[index] - padding * 2) + padding * 2)));
      current().addTable(rows.map((row, rowIndex) => row.map((cell, index) => ({
        text: cell,
        options: {
          bold: rowIndex === 0,
          fill: { color: hex(rowIndex === 0 ? o.headFill : '#FFFFFF') },
          color: hex(rowIndex === 0 ? o.headColor : o.bodyColor),
          align: o.align?.[index] ?? 'left',
        },
      }))), {
        x: IN(o.x), y: IN(o.y), colW: o.colW.map(IN), rowH: heights.map(IN),
        fontFace: 'Fira Sans', fontSize: PT(o.size), valign: 'top', margin: PT(padding) / 72,
        border: { type: 'solid', pt: 0.6, color: hex(o.lineColor) },
      });
      return heights.reduce((sum, height) => sum + height, 0);
    },
    measure(value, size, width, _weight, lineGap) {
      return estimateTextHeight(value, size, width, lineGap);
    },
    async finish() {
      const output = await pres.write({ outputType: 'nodebuffer' });
      return output as Buffer;
    },
  };
}
