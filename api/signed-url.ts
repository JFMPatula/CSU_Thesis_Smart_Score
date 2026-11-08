import { applyRateLimit, getAdminClient } from './_lib/http.js'

const ALLOWED_BUCKETS = new Set(['answer_keys', 'student-answers', 'announcements'])
const DEFAULT_EXPIRES = 3600
const MAX_EXPIRES = 86_400

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!applyRateLimit(req, res, 120, 60_000)) return

  const bucket = typeof req.query.bucket === 'string' ? req.query.bucket : ''
  const rawPath = typeof req.query.path === 'string' ? req.query.path : ''
  const requestedExpiry = Number(req.query.expires)
  const expires = Number.isFinite(requestedExpiry)
    ? Math.min(MAX_EXPIRES, Math.max(60, Math.floor(requestedExpiry)))
    : DEFAULT_EXPIRES

  if (!ALLOWED_BUCKETS.has(bucket)) {
    res.status(400).json({ error: 'Invalid bucket' })
    return
  }
  if (!rawPath || rawPath.length > 1024 || rawPath.includes('..') || rawPath.startsWith('/')) {
    res.status(400).json({ error: 'Invalid path' })
    return
  }

  const admin = getAdminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is not configured' })
    return
  }

  const { data, error } = await admin.storage.from(bucket).createSignedUrl(rawPath, expires)
  if (error || !data?.signedUrl) {
    res.status(404).json({ error: 'File not found' })
    return
  }

  res.setHeader('Cache-Control', 'private, max-age=300')
  res.setHeader('Location', data.signedUrl)
  res.status(302).end()
}
