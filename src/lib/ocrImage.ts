// Shared Tesseract OCR image preparation.
//
// Tesseract's core emits "Image too small to scale!!" / "Line cannot be
// recognized!!" and returns no text when the input image is tiny or noisy.
// We normalize images (upscale + grayscale + contrast) before OCR so text is
// large enough to segment, for both uploaded files and base64 data URLs.

export interface OcrPrepOptions {
  /** Upscale images narrower than this towards this width. */
  targetWidth?: number;
  /** Hard cap on the longest edge after scaling (memory guard). */
  maxDimension?: number;
  /** Images smaller than this on either axis are considered unusable. */
  minDimension?: number;
  /** Apply grayscale + contrast stretch. */
  enhance?: boolean;
  /** Contrast factor used when `enhance` is on. */
  contrast?: number;
}

const DEFAULTS: Required<OcrPrepOptions> = {
  targetWidth: 1600,
  maxDimension: 3200,
  minDimension: 16,
  enhance: true,
  contrast: 1.4
};

const MAX_IMAGE_BYTES = 4_000_000;

/**
 * Detect the MIME type of a raw base64 payload from its header bytes.
 */
function detectMimeFromBase64(base64: string): string {
  const head = base64.slice(0, 16);
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('iVBORw0KGgo')) return 'image/png';
  if (head.startsWith('R0lGOD')) return 'image/gif';
  if (head.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * Normalize a string image source into something an <img> can load.
 *
 * Raw base64 (a bare payload without a `data:` prefix) is wrapped with its
 * detected MIME type. Without this, the browser treats the base64 as a
 * relative URL and issues a request like `GET https://app/9j/4AAQ...` -> 414.
 */
export function normalizeImageSource(source: string): string {
  if (/^(data:|https?:|blob:)/i.test(source)) return source;
  return `data:${detectMimeFromBase64(source)};base64,${source}`;
}

/**
 * Load an image element from a URL or data URL.
 */
function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image for OCR'));
    img.src = src;
  });
}

/**
 * Prepare an image source for Tesseract.
 * @param source A File/Blob or an image URL/data URL.
 * @returns A canvas ready for OCR, the original string source when the DOM is
 *          unavailable, or null when the image is too small to be meaningful.
 */
export async function prepareImageSourceForOcr(
  source: File | Blob | string,
  options: OcrPrepOptions = {}
): Promise<HTMLCanvasElement | string | null> {
  const opts = { ...DEFAULTS, ...options };

  // No DOM (SSR / node): let Tesseract handle string sources directly.
  if (typeof document === 'undefined') {
    return typeof source === 'string' ? source : null;
  }

  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
  const src = objectUrl ?? normalizeImageSource(source as string);

  try {
    const img = await loadImageElement(src);

    console.log('🔍 OCR source image dimensions:', {
      width: img.width,
      height: img.height
    });

    if (img.width < opts.minDimension || img.height < opts.minDimension) {
      console.warn(
        `⚠️ OCR skipped: image too small (${img.width}x${img.height}). Need at least ${opts.minDimension}x${opts.minDimension}.`
      );
      return null;
    }

    const longest = Math.max(img.width, img.height);
    let scale = img.width < opts.targetWidth ? Math.min(4, opts.targetWidth / img.width) : 1;
    if (longest * scale > opts.maxDimension) scale = opts.maxDimension / longest;
    scale = Math.max(1, scale);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return src;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Flatten transparency onto white before enhancement.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (opts.enhance) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const boosted = Math.max(0, Math.min(255, (gray - 128) * opts.contrast + 128));
        data[i] = data[i + 1] = data[i + 2] = boosted;
      }
      ctx.putImageData(imageData, 0, 0);
    }

    return canvas;
  } catch (e) {
    console.warn('⚠️ OCR preprocessing failed, using original source.', e);
    return typeof source === 'string' ? source : null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export interface ImageQualityReport {
  width: number;
  height: number;
  aspectRatio: number;
  estimatedFileSizeKB: number;
  isUsable: boolean;
  issues: string[];
}

export interface VisionImageSource {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Base64-decode a data URL or raw base64 payload into a Uint8Array.
 * Works in both browser and Node.js environments.
 */
function base64ToBytes(dataUrlOrBase64: string): Uint8Array {
  const base64 = dataUrlOrBase64.includes(',') ? dataUrlOrBase64.split(',')[1] : dataUrlOrBase64;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

/**
 * Inspect JPEG/PNG header to estimate dimensions without full decode.
 * Used as a lightweight pre-check in Node.js (no DOM available).
 */
function estimateDimensionsFromHeader(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length > 10 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i < bytes.length - 1; i++) {
      if (bytes[i] === 0xff && (bytes[i + 1] & 0xf0) === 0xc0) {
        const length = bytes[i + 2] * 256 + bytes[i + 3];
        if (i + 5 + length <= bytes.length) {
          const height = bytes[i + 5] * 256 + bytes[i + 6];
          const width = bytes[i + 7] * 256 + bytes[i + 8];
          return { width, height };
        }
      }
    }
  }
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return { width, height };
  }
  return null;
}

/**
 * Build an image URL / data URL from a File/Blob or string source.
 */
function resolveSourceUrl(source: File | Blob | string): { src: string; revoke: () => void } {
  if (typeof source === 'string') return { src: normalizeImageSource(source), revoke: () => {} };
  const url = URL.createObjectURL(source);
  return { src: url, revoke: () => URL.revokeObjectURL(url) };
}

/**
 * Validate image quality before sending to a vision model.
 * Checks dimensions, aspect ratio, and estimated file size.
 */
export function validateImageQuality(
  width: number,
  height: number,
  estimatedFileSizeKB: number,
  options: { minDimension?: number; maxFileSizeKB?: number } = {}
): ImageQualityReport {
  const opts = { minDimension: 32, maxFileSizeKB: 4000, ...options };
  const issues: string[] = [];

  if (width < opts.minDimension || height < opts.minDimension) {
    issues.push(`Image too small: ${width}x${height} (min ${opts.minDimension}x${opts.minDimension})`);
  }
  if (estimatedFileSizeKB > opts.maxFileSizeKB) {
    issues.push(`Image too large: ${estimatedFileSizeKB.toFixed(0)}KB (max ${opts.maxFileSizeKB}KB)`);
  }
  const aspectRatio = width / height;
  if (aspectRatio > 3 || aspectRatio < 0.33) {
    issues.push(`Unusual aspect ratio: ${aspectRatio.toFixed(2)}`);
  }

  return {
    width,
    height,
    aspectRatio,
    estimatedFileSizeKB,
    isUsable: issues.length === 0,
    issues,
  };
}

/**
 * Downscale and re-encode an image for sending to a vision model.
 * Color is kept (vision models benefit from it) and the image is re-encoded as
 * JPEG so the payload stays well under the serverless request-body limit.
 */
export async function prepareImageSourceForVision(
  source: File | Blob | string,
  options: { maxDimension?: number; quality?: number } = {}
): Promise<VisionImageSource | null> {
  const opts = { maxDimension: 2048, quality: 0.85, ...options };

  // ---- Node.js / SSR path: no DOM available ----
  if (typeof document === 'undefined') {
    if (typeof source !== 'string') return null;
    const dataUrl = normalizeImageSource(source);
    const mime = detectMimeFromBase64(source);
    const bytes = base64ToBytes(dataUrl);
    const estimatedKB = (bytes.length / 1024).toFixed(1);
    const dims = estimateDimensionsFromHeader(bytes);
    if (!dims) {
      console.warn('⚠️ Vision skipped: could not read image dimensions from header.');
      return null;
    }
    const quality = validateImageQuality(dims.width, dims.height, parseFloat(estimatedKB), {
      minDimension: DEFAULTS.minDimension,
      maxFileSizeKB: MAX_IMAGE_BYTES / 1024,
    });
    if (!quality.isUsable) {
      console.warn(`⚠️ Vision skipped: ${quality.issues.join('; ')}`);
      return null;
    }
    console.log('🔍 Vision source (Node) dimensions:', { width: dims.width, height: dims.height, estimatedKB });
    const base64 = dataUrl.split(',')[1];
    return { base64, mimeType: mime, width: dims.width, height: dims.height };
  }

  const { src, revoke } = resolveSourceUrl(source);
  try {
    const img = await loadImageElement(src);
    console.log('🔍 Vision source image dimensions:', { width: img.width, height: img.height });

    if (img.width < DEFAULTS.minDimension || img.height < DEFAULTS.minDimension) {
      console.warn(`⚠️ Vision skipped: image too small (${img.width}x${img.height}).`);
      return null;
    }

    const longest = Math.max(img.width, img.height);
    let scale = 1;
    if (longest > opts.maxDimension) scale = opts.maxDimension / longest;
    else if (longest < 400) scale = Math.min(4, 400 / longest);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', opts.quality);
    const base64 = dataUrl.split(',')[1];
    const estimatedKB = (base64.length * 0.75 / 1024).toFixed(1);
    const quality = validateImageQuality(canvas.width, canvas.height, parseFloat(estimatedKB), {
      minDimension: DEFAULTS.minDimension,
      maxFileSizeKB: MAX_IMAGE_BYTES / 1024,
    });
    if (!quality.isUsable) {
      console.warn(`⚠️ Vision skipped after preprocessing: ${quality.issues.join('; ')}`);
      return null;
    }

    return { base64, mimeType: 'image/jpeg', width: canvas.width, height: canvas.height };
  } catch (e) {
    console.warn('⚠️ Vision preprocessing failed.', e);
    return null;
  } finally {
    revoke();
  }
}
