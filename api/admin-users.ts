import { createClient } from '@supabase/supabase-js'

// Server-only configuration. These must NOT be prefixed with VITE_ so they are
// never inlined into the client bundle.
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const isAdminRole = (role: unknown) => role === 1 || role === '1'

export default async function handler(req: any, res: any) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is not configured' })
    return
  }

  const authHeader = req.headers['authorization'] || req.headers['Authorization']
  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null

  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' })
    return
  }

  // One client with the service role key, used both to verify the caller's
  // token and to perform the privileged admin operation.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: callerData, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !callerData?.user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return
  }

  const caller = callerData.user
  const isAdmin = isAdminRole(caller.user_metadata?.role)
  const id = typeof req.query.id === 'string' ? req.query.id : undefined

  try {
    if (req.method === 'GET') {
      if (!isAdmin) {
        res.status(403).json({ error: 'Admin access required' })
        return
      }
      const { data, error } = await admin.auth.admin.listUsers()
      if (error) {
        res.status(400).json({ error: error.message })
        return
      }
      res.status(200).json({ users: data.users })
      return
    }

    if (req.method === 'DELETE') {
      if (!isAdmin) {
        res.status(403).json({ error: 'Admin access required' })
        return
      }
      if (!id) {
        res.status(400).json({ error: 'Missing user id' })
        return
      }
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) {
        res.status(400).json({ error: error.message })
        return
      }
      res.status(200).json({ success: true })
      return
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      // Admins may update anyone; users may update only their own account.
      if (!isAdmin && caller.id !== id) {
        res.status(403).json({ error: 'Not allowed to update this user' })
        return
      }
      if (!id) {
        res.status(400).json({ error: 'Missing user id' })
        return
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
      const updates: Record<string, any> = {}
      if (body.email) updates.email = body.email
      if (body.password) updates.password = body.password
      if (body.phone) updates.phone = body.phone
      if (body.user_metadata && typeof body.user_metadata === 'object') {
        updates.user_metadata = { ...body.user_metadata }
        // Never let a non-admin grant/change roles (prevents privilege escalation).
        if (!isAdmin) {
          delete updates.user_metadata.role
        }
      }

      const { data, error } = await admin.auth.admin.updateUserById(id, updates)
      if (error) {
        res.status(400).json({ error: error.message })
        return
      }
      res.status(200).json({ user: data.user })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (err: any) {
    console.error('admin-users error:', err)
    res.status(500).json({ error: err?.message || 'Internal error' })
  }
}
