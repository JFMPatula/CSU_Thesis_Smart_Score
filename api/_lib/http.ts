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

export function roleIdOf(user: any): number | null {
  const raw = user?.app_metadata?.role
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function isAdminUser(user: any): boolean {
  return roleIdOf(user) === 1
}

export async function getCaller(req: any) {
  const token = getBearerToken(req)
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

export function parseBody(req: any): any {
  if (!req?.body) return {}
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  return req.body
}
