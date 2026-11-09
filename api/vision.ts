import {
  applyRateLimit,
  getCaller,
  getTokenFromRequest,
  parseBody,
} from './_lib/http.js'

const DEFAULT_PROMPT =
  'Transcribe all visible text from this image exactly as written, preserving line breaks and the layout of questions and answers. Output only the transcribed text.'

const MAX_IMAGE_BYTES = 4_000_000
const MAX_PROMPT_CHARS = 8_000
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const FALLBACK_MODELS = ['gemini-3-flash-preview', 'gemini-3.8-flash']
const MODEL_TIMEOUT_MS = 30_000
const OVERALL_TIMEOUT_MS = 90_000

const GROQ_VISION_URL = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'
const GROQ_TIMEOUT_MS = 45_000

type VisionMode = 'text' | 'json'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry a fetch-like operation with exponential backoff on transient errors.
 * Returns the first successful result, or throws the last error.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 1000
  const maxDelayMs = opts.maxDelayMs ?? 8000
  let lastError: any

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err
      const message = String(err?.message || err).toLowerCase()
      const isRetryable =
        err?.name === 'AbortError' ||
        /timeout|timed out|503|502|504|network|econn|socket hang up/.test(message)
      if (!isRetryable || attempt === maxAttempts) throw err
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
      console.warn(`⚠️ Vision request attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms:`, message)
      await sleep(delay)
    }
  }
  throw lastError
}

function modelCandidates(): string[] {
  const configured = (process.env.GEMINI_MODEL || DEFAULT_MODEL)
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  return [...configured, ...FALLBACK_MODELS].filter((model) => {
    if (seen.has(model)) return false
    seen.add(model)
    return true
  })
}

function groqVisionModels(): string[] {
  const configured = process.env.GROQ_VISION_MODEL || DEFAULT_GROQ_VISION_MODEL
  return configured
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
}

function extractGeminiText(json: any): string {
  const parts = json?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((part: any) => !part?.thought)
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim()
}

function extractGroqText(json: any): string {
  const content = json?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : ''
}

async function requestGemini(
  apiKey: string,
  model: string,
  payload: unknown,
  timeoutMs: number,
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await withRetry(() =>
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      )
    )
    const json = await response.json().catch(() => null)
    return { response, json }
  } finally {
    clearTimeout(timer)
  }
}

async function requestGroqVision(
  apiKey: string,
  model: string,
  image: string,
  mimeType: string,
  prompt: string,
  mode: VisionMode,
  timeoutMs: number,
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await withRetry(() =>
      fetch(GROQ_VISION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: { url: `data:${mimeType};base64,${image}` },
                },
              ],
            },
          ],
          temperature: 0,
          max_completion_tokens: 8192,
          ...(mode === 'json' ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      }),
    )
    const json = await response.json().catch(() => null)
    return { response, json }
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed', text: null })
    return
  }

  // The student quiz page is public, so anonymous callers may use vision with a
  // tighter per-IP limit. Authenticated callers get a slightly higher budget.
  const token = getTokenFromRequest(req)
  const isAnonymous = !token
  if (!applyRateLimit(req, res, isAnonymous ? 10 : 20, 60_000)) return

  if (!isAnonymous) {
    const caller = await getCaller(req)
    if ('error' in caller) {
      res.status(caller.status).json({ error: caller.error, text: null })
      return
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY
  const groqKey = process.env.GROQ_API_KEY
  if (!geminiKey && !groqKey) {
    res.status(503).json({ error: 'Vision not configured', text: null })
    return
  }

  const body = parseBody(req)
  const image = body.image
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg'
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  const mode: VisionMode = body.mode === 'json' ? 'json' : 'text'

  if (typeof image !== 'string' || image.length === 0) {
    res.status(400).json({ error: 'Missing image data', text: null })
    return
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    res.status(415).json({ error: 'Unsupported image type', text: null })
    return
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    res.status(400).json({ error: 'Prompt is too long', text: null })
    return
  }

  let imageBytes: number
  try {
    imageBytes = Buffer.from(image, 'base64').length
  } catch {
    res.status(400).json({ error: 'Invalid base64 image', text: null })
    return
  }
  if (imageBytes > MAX_IMAGE_BYTES) {
    res.status(413).json({ error: 'Image too large', text: null })
    return
  }

  const effectivePrompt = prompt || DEFAULT_PROMPT
  const startedAt = Date.now()
  let lastDetail = 'Vision request failed'
  const tried: string[] = []

  if (geminiKey) {
    const payload = {
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mimeType, data: image } },
            { text: effectivePrompt },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: mode === 'json' ? 'application/json' : 'text/plain',
      },
    }

    for (const model of modelCandidates()) {
      const remaining = OVERALL_TIMEOUT_MS - (Date.now() - startedAt)
      if (remaining <= 0) break
      tried.push(model)

      try {
        const { response, json } = await requestGemini(
          geminiKey,
          model,
          payload,
          Math.min(MODEL_TIMEOUT_MS, remaining),
        )

        if (!response.ok) {
          lastDetail = json?.error?.message || `HTTP ${response.status}`
          console.error(
            `Gemini model ${model} failed (${response.status}):`,
            String(lastDetail).slice(0, 500),
          )
          continue
        }

        const text = extractGeminiText(json)
        if (!text) {
          lastDetail = `Empty response from ${model}`
          continue
        }

        res.status(200).json({ ok: true, text, model, provider: 'gemini', mode })
        return
      } catch (err: any) {
        lastDetail =
          err?.name === 'AbortError'
            ? `Timed out after ${MODEL_TIMEOUT_MS}ms`
            : String(err?.message || err)
        console.error(`Gemini model ${model} error:`, lastDetail)
      }
    }
  }

  // Fallback: Groq's multimodal Llama models (same key as text grading).
  if (groqKey) {
    for (const model of groqVisionModels()) {
      const remaining = OVERALL_TIMEOUT_MS - (Date.now() - startedAt)
      if (remaining <= 0) break
      tried.push(model)

      try {
        const { response, json } = await requestGroqVision(
          groqKey,
          model,
          image,
          mimeType,
          effectivePrompt,
          mode,
          Math.min(GROQ_TIMEOUT_MS, remaining),
        )

        if (!response.ok) {
          lastDetail = json?.error?.message || `HTTP ${response.status}`
          console.error(
            `Groq vision model ${model} failed (${response.status}):`,
            String(lastDetail).slice(0, 500),
          )
          continue
        }

        const text = extractGroqText(json)
        if (!text) {
          lastDetail = `Empty response from ${model}`
          continue
        }

        res.status(200).json({ ok: true, text, model, provider: 'groq', mode })
        return
      } catch (err: any) {
        lastDetail =
          err?.name === 'AbortError'
            ? `Timed out after ${GROQ_TIMEOUT_MS}ms`
            : String(err?.message || err)
        console.error(`Groq vision model ${model} error:`, lastDetail)
      }
    }
  }

  res.status(503).json({
    error: 'Vision temporarily unavailable',
    detail: lastDetail,
    tried,
    text: null,
  })
}
