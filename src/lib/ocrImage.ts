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

export interface VisionImageSource {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
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
 * Downscale and re-encode an image for sending to a vision model.
 * Color is kept (vision models benefit from it) and the image is re-encoded as
 * JPEG so the payload stays well under the serverless request-body limit.
 */
export async function prepareImageSourceForVision(
  source: File | Blob | string,
  options: { maxDimension?: number; quality?: number } = {}
): Promise<VisionImageSource | null> {
  const opts = { maxDimension: 2048, quality: 0.85, ...options };
  if (typeof document === 'undefined') return null;

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
    return { base64, mimeType: 'image/jpeg', width: canvas.width, height: canvas.height };
  } catch (e) {
    console.warn('⚠️ Vision preprocessing failed.', e);
    return null;
  } finally {
    revoke();
  }
}
