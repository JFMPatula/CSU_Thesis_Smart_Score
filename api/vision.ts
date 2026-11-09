import { applyRateLimit, getCaller, parseBody, roleIdOf } from './_lib/http.js'

const DEFAULT_PROMPT =
  'Transcribe all visible text from this image exactly as written, preserving line breaks and the layout of questions and answers. Output only the transcribed text.'

const MAX_IMAGE_BYTES = 4_000_000
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const DEFAULT_MODEL = 'gemini-3.8-flash'
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3-flash-preview']
const MODEL_TIMEOUT_MS = 15_000
const OVERALL_TIMEOUT_MS = 45_000

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

async function requestGemini(apiKey: string, model: string, payload: unknown, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(
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
  if (!applyRateLimit(req, res, 20, 60_000)) return

  const caller = await getCaller(req)
  if ('error' in caller) {
    res.status(caller.status).json({ error: caller.error, text: null })
    return
  }

  const callerRole = roleIdOf(caller.user)
  if (callerRole !== 1 && callerRole !== 2) {
    res.status(403).json({ error: 'Teacher or Admin access required', text: null })
    return
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    res.status(503).json({ error: 'Vision not configured', text: null })
    return
  }

  const { image, mimeType = 'image/jpeg', prompt } = parseBody(req)
  if (typeof image !== 'string' || image.length === 0) {
    res.status(400).json({ error: 'Missing image data', text: null })
    return
  }
  if (typeof mimeType !== 'string' || !ALLOWED_MIME_TYPES.has(mimeType)) {
    res.status(415).json({ error: 'Unsupported image type', text: null })
    return
  }
  if (typeof prompt === 'string' && prompt.length > 2000) {
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

  const payload = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: image } },
          { text: typeof prompt === 'string' && prompt.trim() ? prompt : DEFAULT_PROMPT },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'text/plain',
    },
  }

  const startedAt = Date.now()
  let lastDetail = 'Vision request failed'

  for (const model of modelCandidates()) {
    const remaining = OVERALL_TIMEOUT_MS - (Date.now() - startedAt)
    if (remaining <= 0) break

    try {
      const { response, json } = await requestGemini(
        apiKey,
        model,
        payload,
        Math.min(MODEL_TIMEOUT_MS, remaining),
      )

      if (!response.ok) {
        lastDetail = json?.error?.message || `HTTP ${response.status}`
        console.error(`Gemini model ${model} failed (${response.status}):`, String(lastDetail).slice(0, 500))
        continue
      }

      const text =
        json?.candidates?.[0]?.content?.parts
          ?.filter((part: any) => !part.thought)
          .map((part: any) => part?.text || '')
          .join('')
          .trim() || ''

      res.status(200).json({ ok: true, text, model })
      return
    } catch (err: any) {
      lastDetail =
        err?.name === 'AbortError'
          ? `Timed out after ${MODEL_TIMEOUT_MS}ms`
          : String(err?.message || err)
      console.error(`Gemini model ${model} error:`, lastDetail)
    }
  }

  res.status(503).json({ error: 'Vision temporarily unavailable', detail: lastDetail, text: null })
}
