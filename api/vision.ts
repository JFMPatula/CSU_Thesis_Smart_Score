import { applyRateLimit, getCaller, parseBody, roleIdOf } from './_lib/http.js'

const DEFAULT_PROMPT =
  'Transcribe all visible text from this image exactly as written, preserving line breaks and the layout of questions and answers. Output only the transcribed text.'

const MAX_IMAGE_BYTES = 4_000_000
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

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

  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

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

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    })

    const json = await resp.json().catch(() => null)
    if (!resp.ok) {
      console.error('Gemini error:', JSON.stringify(json?.error?.message || json).slice(0, 500))
      res.status(502).json({ error: 'Vision request failed', detail: json?.error?.message, text: null })
      return
    }

    const text =
      json?.candidates?.[0]?.content?.parts
        ?.filter((part: any) => !part.thought)
        .map((part: any) => part?.text || '')
        .join('')
        .trim() || ''

    res.status(200).json({ ok: true, text })
  } catch (err: any) {
    console.error('Vision endpoint error:', err)
    res.status(500).json({ error: String(err?.message || err), text: null })
  }
}
