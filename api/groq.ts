import { applyRateLimit, getCaller, parseBody } from './_lib/http'

const DEFAULT_MODEL = 'openai/gpt-oss-120b'
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant'])
const MAX_MESSAGES = 50
const MAX_CONTENT_CHARS = 120_000
const MAX_TOKENS = 4096

function allowedModels(): Set<string> {
  const configured = process.env.GROQ_ALLOWED_MODELS
  if (configured) {
    return new Set(configured.split(',').map((model) => model.trim()).filter(Boolean))
  }
  return new Set([DEFAULT_MODEL])
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!applyRateLimit(req, res, 30, 60_000)) return

  const caller = await getCaller(req)
  if ('error' in caller) {
    res.status(caller.status).json({ error: caller.error })
    return
  }

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    res.status(503).json({ error: 'Groq is not configured' })
    return
  }

  const body = parseBody(req)
  const messages = body.messages
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    res.status(400).json({ error: 'Invalid messages' })
    return
  }

  let totalChars = 0
  const safeMessages = messages.map((message: any) => {
    const role = String(message?.role || '')
    const content = typeof message?.content === 'string' ? message.content : ''
    if (!ALLOWED_ROLES.has(role) || content.length === 0) {
      throw new Error('Invalid message format')
    }
    totalChars += content.length
    return { role, content }
  })

  if (totalChars > MAX_CONTENT_CHARS) {
    res.status(413).json({ error: 'Request is too large' })
    return
  }

  const model = typeof body.model === 'string' ? body.model : DEFAULT_MODEL
  if (!allowedModels().has(model)) {
    res.status(400).json({ error: 'Model is not allowed' })
    return
  }

  const temperature = Number(body.temperature)
  const maxTokens = Number(body.max_completion_tokens || body.max_tokens || 2048)

  const payload: Record<string, any> = {
    model,
    messages: safeMessages,
    temperature: Number.isFinite(temperature) ? Math.min(2, Math.max(0, temperature)) : 0.1,
    max_completion_tokens: Number.isFinite(maxTokens)
      ? Math.min(MAX_TOKENS, Math.max(1, Math.floor(maxTokens)))
      : 2048,
  }

  if (body.response_format?.type === 'json_object') {
    payload.response_format = { type: 'json_object' }
  }

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    const json = await resp.json().catch(() => null)
    if (!resp.ok) {
      console.error('Groq error:', JSON.stringify(json?.error?.message || json).slice(0, 500))
      res.status(502).json({ error: 'Groq request failed', detail: json?.error?.message })
      return
    }

    res.status(200).json(json)
  } catch (err: any) {
    console.error('Groq endpoint error:', err)
    res.status(500).json({ error: String(err?.message || err) })
  }
}
