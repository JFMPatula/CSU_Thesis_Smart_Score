// Image transcription: Gemini vision model (via the /api/vision serverless
// function) first, falling back to local Tesseract when the endpoint is
// unavailable (e.g. local dev) or when no GEMINI_API_KEY is configured.

import { prepareImageSourceForOcr, prepareImageSourceForVision } from './ocrImage';

export interface TranscribeResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
  }>;
  engine: 'gemini' | 'tesseract' | 'none';
}

const DEFAULT_VISION_PROMPT =
  'Transcribe all visible text from this image exactly as written, preserving line breaks and the layout of questions and answers. Output only the transcribed text.';

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
 * Build a loadable URL from a File/Blob or string (base64 or data URL).
 */
function toImageUrl(source: File | Blob | string): string {
  if (typeof source !== 'string') return ''; // Files handled by prepareImageSourceForVision
  if (source.startsWith('data:')) return source;
  const mimeType = detectMimeFromBase64(source);
  return `data:${mimeType};base64,${source}`;
}

/**
 * Ask the Gemini vision model to transcribe the image via /api/vision.
 */
async function visionTranscribe(source: File | Blob | string, prompt?: string): Promise<string | null> {
  const prepared = await prepareImageSourceForVision(source);
  if (!prepared) return null;

  try {
    const res = await fetch('/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: prepared.base64,
        mimeType: prepared.mimeType,
        prompt: prompt || DEFAULT_VISION_PROMPT
      })
    });
    if (!res.ok) {
      console.warn(`⚠️ Vision endpoint failed (HTTP ${res.status})`);
      return null;
    }
    const json = await res.json();
    const text = typeof json?.text === 'string' ? json.text.trim() : '';
    return text.length > 0 ? text : null;
  } catch (e) {
    console.warn('⚠️ Vision request failed, falling back to Tesseract:', e);
    return null;
  }
}

/**
 * Transcribe text from an image using Gemini vision with a Tesseract fallback.
 */
export async function transcribeImage(
  source: File | Blob | string,
  prompt?: string
): Promise<TranscribeResult> {
  const visionText = await visionTranscribe(source, prompt);
  if (visionText) {
    return { text: visionText, confidence: 0.9, words: [], engine: 'gemini' };
  }

  return tesseractFallback(source);
}

/**
 * Local Tesseract OCR fallback (browser WASM, no API key needed).
 */
async function tesseractFallback(source: File | Blob | string): Promise<TranscribeResult> {
  let worker: Awaited<ReturnType<typeof import('tesseract.js').createWorker>> | null = null;
  try {
    const { createWorker } = await import('tesseract.js');
    const ocrSource = typeof source === 'string' ? toImageUrl(source) : source;
    const prepared = await prepareImageSourceForOcr(ocrSource);
    if (prepared === null) {
      console.warn('⚠️ OCR skipped: image could not be prepared for recognition');
      return { text: '', confidence: 0, words: [], engine: 'none' };
    }

    worker = await createWorker('eng');
    const { data } = await worker.recognize(prepared);
    const words = ((data as any).words || []).map((word: any) => ({
      text: word.text,
      bbox: word.bbox,
      confidence: word.confidence
    }));

    return {
      text: (data.text ?? '').toString(),
      confidence: data.confidence || 0,
      words,
      engine: 'tesseract'
    };
  } catch (e) {
    console.warn('⚠️ Tesseract OCR failed:', e);
    return { text: '', confidence: 0, words: [], engine: 'none' };
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        // Ignore termination errors on cleanup.
      }
    }
  }
}