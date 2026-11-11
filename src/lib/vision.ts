// Image transcription/extraction: Gemini vision model (with a Groq multimodal
// fallback) via the /api/vision serverless function, falling back to local
// Tesseract when the endpoint is unavailable (e.g. local dev, no network) or
// when no vision provider is configured.

import { normalizeImageSource, prepareImageSourceForOcr, prepareImageSourceForVision } from './ocrImage';
import { supabase } from './supabase';

export interface TranscribeResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
  }>;
  engine: 'gemini' | 'groq' | 'tesseract' | 'none';
}

export interface ImageJsonResult {
  data: any;
  raw: string;
  engine: string;
}

const DEFAULT_VISION_PROMPT =
  'Transcribe all visible text from this image exactly as written, preserving line breaks and the layout of questions and answers. Output only the transcribed text.';

/**
 * Build a loadable URL from a File/Blob or string (base64 or data URL).
 */
function toImageUrl(source: File | Blob | string): string {
  if (typeof source !== 'string') return ''; // Files handled by prepareImageSourceForVision
  return normalizeImageSource(source);
}

async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a fetch operation with exponential backoff on transient errors.
 */
async function withRetryFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  opts: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(input, init);
      // Retry on 5xx (server errors) but not 4xx (client errors)
      if (response.status >= 500 && attempt < maxAttempts) {
        const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
        console.warn(`⚠️ Vision endpoint HTTP ${response.status}, retrying in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      return response;
    } catch (err: any) {
      lastError = err;
      const message = String(err?.message || err).toLowerCase();
      const isRetryable =
        err?.name === 'AbortError' ||
        /timeout|timed out|network|econn|socket hang up|failed to fetch/.test(message);
      if (!isRetryable || attempt === maxAttempts) throw err;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      console.warn(`⚠️ Vision fetch attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms:`, message);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Call the shared vision endpoint. Authenticated callers send a bearer token;
 * anonymous students (public quiz page) are allowed with a tighter rate limit.
 */
async function callVisionEndpoint(
  source: File | Blob | string,
  prompt: string,
  mode: 'text' | 'json',
  quizId?: number,
): Promise<{ text: string; provider: string; model: string } | null> {
  const prepared = await prepareImageSourceForVision(source);
  if (!prepared) return null;

  try {
    const token = await accessToken();
    const res = await withRetryFetch('/api/vision', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        image: prepared.base64,
        mimeType: prepared.mimeType,
        prompt,
        mode,
        ...(quizId ? { quizId } : {}),
      }),
    });
    if (!res.ok) {
      console.warn(`⚠️ Vision endpoint failed (HTTP ${res.status})`);
      return null;
    }
    const json = await res.json();
    const text = typeof json?.text === 'string' ? json.text.trim() : '';
    if (!text) return null;
    return {
      text,
      provider: typeof json?.provider === 'string' ? json.provider : 'gemini',
      model: typeof json?.model === 'string' ? json.model : 'unknown',
    };
  } catch (e) {
    console.warn('⚠️ Vision request failed:', e);
    return null;
  }
}

/**
 * Ask the vision model to transcribe the image via /api/vision.
 */
async function visionTranscribe(source: File | Blob | string, prompt?: string): Promise<string | null> {
  const result = await callVisionEndpoint(source, prompt || DEFAULT_VISION_PROMPT, 'text');
  return result?.text ?? null;
}

function parseJsonText(raw: string): any | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0].replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

/**
 * Ask the vision model to read the image directly and return structured JSON.
 * This replaces the OCR-then-text-model round trip when a vision provider is
 * available, which handles handwriting far better than Tesseract.
 */
export async function extractImageJson(
  source: File | Blob | string,
  prompt: string,
  quizId?: number,
): Promise<ImageJsonResult | null> {
  const result = await callVisionEndpoint(source, prompt, 'json', quizId);
  if (!result) return null;

  const data = parseJsonText(result.text);
  if (!data || typeof data !== 'object') {
    console.warn('⚠️ Vision returned non-JSON output, falling back.', {
      model: result.model,
      preview: result.text.slice(0, 200),
    });
    return null;
  }

  return { data, raw: result.text, engine: result.provider };
}

/**
 * Estimate a transcription confidence score from the raw text and engine.
 * Longer, well-formed text with sentence/line structure scores higher.
 */
function estimateTranscriptionConfidence(text: string, engine: string): number {
  const base = engine === 'tesseract' ? 0.65 : 0.85;
  const lengthBonus = Math.min(text.length / 500, 0.1);
  const lineBonus = Math.min((text.match(/\n/g) || []).length / 20, 0.05);
  return Math.min(Math.max(base + lengthBonus + lineBonus, 0.0), 1.0);
}

/**
 * Transcribe text from an image using the vision endpoint with a Tesseract fallback.
 * Reports the actual provider (gemini/groq) and an estimated confidence score.
 */
export async function transcribeImage(
  source: File | Blob | string,
  prompt?: string
): Promise<TranscribeResult> {
  const result = await callVisionEndpoint(source, prompt || DEFAULT_VISION_PROMPT, 'text');
  if (result?.text) {
    return {
      text: result.text,
      confidence: estimateTranscriptionConfidence(result.text, result.provider),
      words: [],
      engine: result.provider as 'gemini' | 'groq' | 'tesseract' | 'none',
    };
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
