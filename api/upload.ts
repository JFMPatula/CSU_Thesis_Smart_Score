import { applyRateLimit, getAdminClient, parseBody } from './_lib/http.js'

const MAX_BYTES = 3 * 1024 * 1024
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const ALLOWED_BUCKETS = new Set(['student-answers'])
const FOLDER_PATTERN = /^[a-zA-Z0-9_-]+$/

function detectMime(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png'
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 3) === 'GIF') {
    return 'image/gif'
  }
  return null
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!applyRateLimit(req, res, 20, 60_000)) return

  const admin = getAdminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is not configured' })
    return
  }

  const body = parseBody(req)
  const bucket = typeof body.bucket === 'string' ? body.bucket : 'student-answers'
  const folder = typeof body.folder === 'string' && body.folder ? body.folder : 'answers'
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
  const data = typeof body.data === 'string' ? body.data : ''

  if (!ALLOWED_BUCKETS.has(bucket)) {
    res.status(400).json({ error: 'Invalid bucket' })
    return
  }
  if (!FOLDER_PATTERN.test(folder)) {
    res.status(400).json({ error: 'Invalid folder' })
    return
  }
  if (!ALLOWED_TYPES[mimeType]) {
    res.status(400).json({ error: 'Only JPEG, PNG, WebP, or GIF images are allowed' })
    return
  }
  if (!data) {
    res.status(400).json({ error: 'Missing file data' })
    return
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(data, 'base64')
  } catch {
    res.status(400).json({ error: 'Invalid file data' })
    return
  }

  if (buffer.length === 0) {
    res.status(400).json({ error: 'Empty file' })
    return
  }
  if (buffer.length > MAX_BYTES) {
    res.status(413).json({ error: 'Image is too large. Maximum size is 3 MB.' })
    return
  }

  const detected = detectMime(buffer)
  if (!detected || detected !== mimeType) {
    res.status(400).json({ error: 'File contents do not match the declared image type' })
    return
  }

  const extension = ALLOWED_TYPES[detected]
  const random = Math.random().toString(36).slice(2, 12)
  const path = `${folder}/${Date.now()}-${random}.${extension}`

  const { data: uploaded, error } = await admin.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType: detected,
      cacheControl: '3600',
      upsert: false,
    })

  if (error || !uploaded) {
    res.status(500).json({ error: 'Upload failed' })
    return
  }

  res.status(200).json({
    path: uploaded.path,
    url: `/api/signed-url?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(uploaded.path)}`,
  })
}
