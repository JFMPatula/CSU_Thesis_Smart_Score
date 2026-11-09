import {
  applyRateLimit,
  getAdminClient,
  getBearerToken,
  isAdminUser,
  parseBody,
  roleIdOf,
  validatePassword,
} from './_lib/http.js'

export default async function handler(req: any, res: any) {
  if (!applyRateLimit(req, res, 60, 60_000)) return

  const admin = getAdminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is not configured' })
    return
  }

  const token = getBearerToken(req)
  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' })
    return
  }

  const { data: callerData, error: callerError } = await admin.auth.getUser(token)
  if (callerError || !callerData?.user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return
  }

  const caller = callerData.user
  const isAdmin = isAdminUser(caller)
  const id = typeof req.query.id === 'string' ? req.query.id : undefined

  try {
    if (req.method === 'GET') {
      if (!isAdmin) {
        res.status(403).json({ error: 'Admin access required' })
        return
      }
      const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1)
      const perPageRaw = Number.parseInt(String(req.query.perPage || '50'), 10) || 50
      const perPage = Math.min(1000, Math.max(1, perPageRaw))

      const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
      if (error) {
        res.status(400).json({ error: error.message })
        return
      }
      const pageInfo = data as any
      res.status(200).json({
        users: data.users,
        pagination: {
          page,
          perPage,
          total: pageInfo.total,
          nextPage: pageInfo.nextPage,
          lastPage: pageInfo.lastPage,
        },
      })
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
      if (!id) {
        res.status(400).json({ error: 'Missing user id' })
        return
      }
      if (!isAdmin && caller.id !== id) {
        res.status(403).json({ error: 'Not allowed to update this user' })
        return
      }

      const body = parseBody(req)
      const updates: Record<string, any> = {}

      if (body.email !== undefined) updates.email = body.email
      if (body.phone !== undefined) updates.phone = body.phone

      if (body.password !== undefined) {
        const passwordError = validatePassword(body.password)
        if (passwordError) {
          res.status(400).json({ error: passwordError })
          return
        }
        updates.password = body.password
      }

      if (body.user_metadata && typeof body.user_metadata === 'object') {
        const metadata = { ...body.user_metadata }
        delete metadata.role
        updates.user_metadata = metadata
      }

      if (body.app_metadata && typeof body.app_metadata === 'object') {
        if (!isAdmin) {
          res.status(403).json({ error: 'Only admins may change app metadata' })
          return
        }
        const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(id)
        if (targetError || !targetData?.user) {
          res.status(404).json({ error: 'User not found' })
          return
        }
        const appMetadata = {
          ...(targetData.user.app_metadata || {}),
          ...body.app_metadata,
        }
        if (appMetadata.role !== undefined) {
          const roleId = Number(appMetadata.role)
          if (!Number.isInteger(roleId) || roleId <= 0) {
            res.status(400).json({ error: 'Invalid role' })
            return
          }
          appMetadata.role = roleId
        }
        updates.app_metadata = appMetadata
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: 'No supported fields to update' })
        return
      }

      const { data, error } = await admin.auth.admin.updateUserById(id, updates)
      if (error) {
        res.status(400).json({ error: error.message })
        return
      }
      res.status(200).json({
        user: data.user,
        role: roleIdOf(data.user),
      })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (err: any) {
    console.error('admin-users error:', err)
    res.status(500).json({ error: err?.message || 'Internal error' })
  }
}
