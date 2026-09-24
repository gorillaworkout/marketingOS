import {
  AI_RESEARCH_MAX_IMAGE_BYTES,
  fileExtension,
  isAllowedImageType,
  type AiResearchImageType,
} from '@/lib/ai-research';

const CAMERA_MIME_ALIASES: Record<string, AiResearchImageType> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
};

const EXTENSION_BY_MIME: Record<AiResearchImageType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const AI_RESEARCH_CAMERA_ACCEPT = 'image/*';
export const AI_RESEARCH_CAMERA_CAPTURE = 'environment';

export function prefersOsCamera(input: {
  userAgent?: string;
  coarsePointer?: boolean;
  hoverNone?: boolean;
}): boolean {
  const ua = input.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  if (/Macintosh/i.test(ua) && input.coarsePointer) return true;
  return Boolean(input.coarsePointer && input.hoverNone);
}

export function inPageCameraBlockReason(input: {
  secureContext?: boolean;
  hasGetUserMedia?: boolean;
}): string | null {
  if (!input.secureContext) {
    return 'Kamera di halaman butuh HTTPS. Pilih foto dari galeri, atau buka situs lewat HTTPS.';
  }
  if (!input.hasGetUserMedia) {
    return 'Browser ini tidak mendukung pratinjau kamera. Pilih foto dari galeri.';
  }
  return null;
}

export function cameraCaptureErrorMessage(errorName?: string): string {
  if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError' || errorName === 'SecurityError') {
    return 'Izin kamera ditolak. Izinkan kamera di browser, atau pilih foto dari galeri.';
  }
  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError' || errorName === 'OverconstrainedError') {
    return 'Kamera tidak ditemukan. Pilih foto dari galeri.';
  }
  if (errorName === 'NotReadableError' || errorName === 'TrackStartError' || errorName === 'AbortError') {
    return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu, atau pilih foto dari galeri.';
  }
  return 'Kamera tidak bisa dibuka. Pilih foto dari galeri.';
}

function sniffImageType(bytes: Uint8Array): AiResearchImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (
    bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  return null;
}

function extensionMatches(name: string, mime: AiResearchImageType): boolean {
  const ext = fileExtension(name);
  if (ext === EXTENSION_BY_MIME[mime]) return true;
  return mime === 'image/jpeg' && ext === '.jpeg';
}

function namedForMime(name: string, mime: AiResearchImageType, now: number): string {
  const ext = EXTENSION_BY_MIME[mime];
  const trimmed = name.trim();
  if (!trimmed) return `camera-${now}${ext}`;
  if (extensionMatches(trimmed, mime)) return trimmed.slice(0, 120);
  const dot = trimmed.lastIndexOf('.');
  const base = (dot > 0 ? trimmed.slice(0, dot) : trimmed).trim() || `camera-${now}`;
  return `${base.slice(0, 110)}${ext}`;
}

export async function cameraFileForAttachment(file: File, now = Date.now()): Promise<File> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = header.length > 0 ? sniffImageType(header) : null;
  const alias = CAMERA_MIME_ALIASES[file.type];
  const declared = alias || (isAllowedImageType(file.type) ? file.type : null);
  const mime = sniffed || declared;
  if (!mime) return file;
  const name = namedForMime(file.name || '', mime, now);
  if (file.type === mime && file.name === name) return file;
  return new File([file], name, { type: mime, lastModified: file.lastModified || now });
}

export function cameraPhotoWithinLimit(bytes: number): boolean {
  return bytes > 0 && bytes <= AI_RESEARCH_MAX_IMAGE_BYTES;
}
