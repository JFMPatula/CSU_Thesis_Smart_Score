import {
  applyRateLimit,
  getAdminClient,
  parseBody,
  validateEmail,
  validatePassword,
} from './_lib/http.js'

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!applyRateLimit(req, res, 10, 60_000)) return

  const admin = getAdminClient()
  if (!admin) {
    res.status(500).json({ error: 'Server is not configured' })
    return
  }

  const body = parseBody(req)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  const roleId = Number(body.roleId)

  // Only Student role can be self-assigned during signup
  const { data: role, error: roleError } = await admin
    .from('roles')
    .select('id,title')
    .eq('id', roleId)
    .maybeSingle()

  if (roleError || !role) {
    res.status(400).json({ error: 'Invalid role' })
    return
  }

  if (role.id === 1 || String(role.title || '').toLowerCase() === 'admin' || String(role.title || '').toLowerCase() === 'teacher') {
    res.status(400).json({ error: 'This role cannot be self-assigned. Teacher accounts require admin approval.' })
    return
  }

  const emailError = validateEmail(email)
  if (emailError) {
    res.status(400).json({ error: emailError })
    return
  }
  const passwordError = validatePassword(body.password)
  if (passwordError) {
    res.status(400).json({ error: passwordError })
    return
  }
  if (fullName.length < 2 || fullName.length > 100) {
    res.status(400).json({ error: 'Full name must be between 2 and 100 characters' })
    return
  }
  if (!Number.isInteger(roleId) || roleId <= 0) {
    res.status(400).json({ error: 'A valid role is required' })
    return
  }

  const { data, error } = await admin.auth.signUp({
    email,
    password: body.password,
    options: { data: { full_name: fullName } },
  })

  if (error) {
    res.status(400).json({ error: error.message })
    return
  }

  const user = data.user
  if (!user) {
    res.status(400).json({ error: 'Unable to create account' })
    return
  }
  if (Array.isArray(user.identities) && user.identities.length === 0) {
    res.status(400).json({ error: 'An account with this email already exists.' })
    return
  }

  const { error: roleUpdateError } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { ...(user.app_metadata || {}), role: roleId },
  })

  if (roleUpdateError) {
    await admin.auth.admin.deleteUser(user.id).catch(() => undefined)
    res.status(500).json({ error: 'Unable to finish creating your account. Please try again.' })
    return
  }

  res.status(200).json({
    user: { id: user.id, email: user.email },
    needsEmailConfirmation: !data.session,
  })
}
