// Serverless proxy for image transcription using Google's Gemini vision model.
// The GEMINI_API_KEY stays server-side and is never shipped to the browser.

const DEFAULT_PROMPT =
  'Transcribe all visible text from this image exactly as written, preserving line breaks and the layout of questions and answers. Output only the transcribed text.'

const MAX_IMAGE_BYTES = 4_000_000

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed', text: null })
    return
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    res.status(503).json({ error: 'Vision not configured', text: null })
    return
  }

  const { image, mimeType = 'image/jpeg', prompt } = req.body || {}
  if (typeof image !== 'string' || image.length === 0) {
    res.status(400).json({ error: 'Missing image data', text: null })
    return
  }

  let imageBytes: number
  try {
    imageBytes = Buffer.from(image, 'base64').length
  } catch (e) {
    res.status(400).json({ error: 'Invalid base64 image', text: null })
    return
  }
  if (imageBytes > MAX_IMAGE_BYTES) {
    res.status(413).json({ error: 'Image too large', text: null })
    return
  }

  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`

  const payload = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: image } },
          { text: typeof prompt === 'string' && prompt.trim() ? prompt : DEFAULT_PROMPT }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'text/plain'
    }
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const json = await resp.json().catch(() => null)
    if (!resp.ok) {
      console.error('Gemini error:', JSON.stringify(json?.error?.message || json).slice(0, 500))
      res.status(502).json({ error: 'Vision request failed', detail: json?.error?.message, text: null })
      return
    }

    // Gemini 2.x may include "thought" parts; only keep the actual text.
    const text =
      json?.candidates?.[0]?.content?.parts
        ?.filter((p: any) => !p.thought)
        .map((p: any) => p?.text || '')
        .join('')
        .trim() || ''

    res.status(200).json({ ok: true, text })
  } catch (e: any) {
    console.error('Vision endpoint error:', e)
    res.status(500).json({ error: String(e?.message || e), text: null })
  }
}