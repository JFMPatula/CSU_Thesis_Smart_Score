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

  const { data: role, error: roleError } = await admin
    .from('roles')
    .select('id,title')
    .eq('id', roleId)
    .maybeSingle()

  if (roleError) {
    res.status(400).json({ error: roleError.message })
    return
  }
  if (!role || role.id === 1 || String(role.title || '').toLowerCase() === 'admin') {
    res.status(400).json({ error: 'This role cannot be self-assigned' })
    return
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: body.password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role: roleId },
  })

  if (error) {
    res.status(400).json({ error: error.message })
    return
  }

  res.status(200).json({ user: { id: data.user?.id, email: data.user?.email } })
}
