import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export function getAdminClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function getBearerToken(req: any): string | null {
  const header = req?.headers?.authorization || req?.headers?.Authorization
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null
}

export function getTokenFromRequest(req: any): string | null {
  const bearer = getBearerToken(req)
  if (bearer) return bearer

  const cookieHeader = req?.headers?.cookie || req?.headers?.Cookie
  if (typeof cookieHeader !== 'string') return null

  const match = cookieHeader.match(/(?:^|;\s*)sb-access-token=([^;]+)/)
  if (!match) return null

  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export function roleIdOf(user: any): number | null {
  const raw = user?.app_metadata?.role
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function isPendingUser(user: any): boolean {
  return String(user?.app_metadata?.status || '').toLowerCase() === 'pending'
}

export function isAdminUser(user: any): boolean {
  return !isPendingUser(user) && roleIdOf(user) === 1
}

export async function getCaller(req: any) {
  const token = getTokenFromRequest(req)
  if (!token) return { status: 401, error: 'Missing authorization token' as const }
  const admin = getAdminClient()
  if (!admin) return { status: 500, error: 'Server is not configured' as const }
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return { status: 401, error: 'Invalid or expired session' as const }
  return { admin, user: data.user }
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long'
  }
  if (password.length > 128) return 'Password is too long'
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter'
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter'
  if (!/\d/.test(password)) return 'Password must include a number'
  if (!/[!@#$%&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return 'Password must include a special character'
  }
  return null
}

export function validateEmail(email: unknown): string | null {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return 'A valid email address is required'
  }
  return null
}

type RateState = { count: number; reset: number }
const rateBuckets = new Map<string, RateState>()

function clientKey(req: any): string {
  const forwarded = req?.headers?.['x-forwarded-for']
  const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return (typeof ip === 'string' && ip.split(',')[0].trim()) || req?.socket?.remoteAddress || 'unknown'
}

export function applyRateLimit(req: any, res: any, limit = 30, windowMs = 60_000): boolean {
  const key = clientKey(req)
  const now = Date.now()
  const state = rateBuckets.get(key)
  if (!state || state.reset <= now) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs })
    res.setHeader('X-RateLimit-Limit', String(limit))
    res.setHeader('X-RateLimit-Remaining', String(limit - 1))
    return true
  }
  if (state.count >= limit) {
    res.setHeader('Retry-After', String(Math.ceil((state.reset - now) / 1000)))
    res.status(429).json({ error: 'Too many requests. Please try again later.' })
    return false
  }
  state.count += 1
  res.setHeader('X-RateLimit-Limit', String(limit))
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - state.count)))
  return true
}

/**
 * Rate limit backed by Upstash Redis when configured, falling back to the
 * in-memory limiter for local development or when Upstash is unavailable.
 */
export async function applyDurableRateLimit(
  req: any,
  res: any,
  limit = 30,
  windowMs = 60_000,
  scope = 'global',
): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return applyRateLimit(req, res, limit, windowMs)

  const windowStart = Math.floor(Date.now() / windowMs)
  const key = `ratelimit:${scope}:${clientKey(req)}:${windowStart}`

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['PEXPIRE', key, windowMs, 'NX'],
      ]),
    })
    if (!response.ok) throw new Error(`Upstash HTTP ${response.status}`)

    const json = await response.json().catch(() => null)
    const count = Number(json?.[0]?.result)
    if (!Number.isFinite(count) || count <= 0) {
      throw new Error('Unexpected Upstash response')
    }

    res.setHeader('X-RateLimit-Limit', String(limit))
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - count)))
    if (count > limit) {
      const retryAfter = Math.ceil((((windowStart + 1) * windowMs) - Date.now()) / 1000)
      res.setHeader('Retry-After', String(Math.max(1, retryAfter)))
      res.status(429).json({ error: 'Too many requests. Please try again later.' })
      return false
    }
    return true
  } catch (err) {
    console.warn('Durable rate limit unavailable, falling back to in-memory:', err)
    return applyRateLimit(req, res, limit, windowMs)
  }
}

export function parseBody(req: any): any {
  // Vercel's dev/production runtime exposes `req.body` as a getter that parses
  // the stream on first access. Read it exactly once so we don't try to parse
  // an already-consumed body.
  const body = req?.body
  if (!body) return {}
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return {}
    }
  }
  return body
}
