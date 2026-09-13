import { Router } from 'express'
import { getUser, upsertUser, getUserBookings, addBooking, updateBooking, deleteBooking } from '../db/database.js'
import { createToken, requireAuth } from '../services/auth.js'
import { fetchSchedule } from '../services/gym.js'
import { randomUUID } from 'crypto'

const router = Router()

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })

  try {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] })
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('https://member.peoplesfitness.de/studio/cGVvcGxlcy1neW06MTI1MzQxMzk0MA%3D%3D/course?v=1', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(3000)

    const loginResult = await page.evaluate(async ({ email, password }) => {
      const basic = btoa(email + ':' + password)
const res = await fetch('https://member.peoplesfitness.de/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + basic,
    'X-Tenant': 'peoples-gym',
    'X-Public-Facility-Group': 'BRANDENPEOPLESFITNESSCLUBS-9668881C08B84496B662DD3EB26D420C',
    'X-Nox-Client-Type': 'WEB',
    'X-Ms-Web-Context': '/studio/cGVvcGxlcy1neW06MTI1MzQxMzk0MA%3D%3D',
    'X-Nox-Web-Context': 'v=1',
  },
  credentials: 'include',
  body: JSON.stringify({ username: email, password }),
})
      const body = await res.text()
return { ok: res.ok, status: res.status, body }
    }, { email, password })

    await browser.close()

   if (!loginResult.ok) return res.status(401).json({ error: `Login fehlgeschlagen (${loginResult.status}): ${loginResult.body}` })

    const userId = email.toLowerCase().replace(/[^a-z0-9]/g, '_')
    upsertUser({ id: userId, email, password, createdAt: new Date().toISOString() })

    const token = createToken(userId, email)
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 30 * 24 * 3600000, sameSite: 'lax' })
    res.json({ ok: true })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Server error: ' + err.message })
  }
})

router.post('/auth/logout', (req, res) => {
  res.clearCookie('token')
  res.json({ ok: true })
})

router.get('/schedule', requireAuth, async (req, res) => {
  const user = getUser(req.user.email)
  if (!user) return res.status(404).json({ error: 'User not found' })
  try {
    const courses = await fetchSchedule(user.email, user.password)
    res.json({ courses })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/bookings', requireAuth, (req, res) => {
  const user = getUser(req.user.email)
  const bookings = getUserBookings(req.user.userId)
  res.json({ email: user?.email, bookings })
})

router.post('/bookings', requireAuth, (req, res) => {
  const { courseName, weekday, time, frequency, date } = req.body
  if (!courseName || !time || !frequency) return res.status(400).json({ error: 'Missing fields' })
  const booking = { id: randomUUID(), userId: req.user.userId, course_name: courseName, weekday: weekday || null, time, frequency, date: date || null, enabled: true, createdAt: new Date().toISOString() }
  addBooking(booking)
  res.json({ ok: true, id: booking.id })
})

router.patch('/bookings/:id', requireAuth, (req, res) => {
  updateBooking(req.params.id, { enabled: req.body.enabled })
  res.json({ ok: true })
})

router.delete('/bookings/:id', requireAuth, (req, res) => {
  deleteBooking(req.params.id)
  res.json({ ok: true })
})

router.get('/me', requireAuth, (req, res) => {
  const user = getUser(req.user.email)
  res.json(user ? { id: user.id, email: user.email } : {})
})
router.get('/debug', requireAuth, async (req, res) => {
  const user = getUser(req.user.email)
  if (!user) return res.status(404).json({ error: 'User not found' })

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('https://member.peoplesfitness.de/studio/cGVvcGxlcy1neW06MTI1MzQxMzk0MA%3D%3D/course?v=1', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2000)

  const basic = Buffer.from(`${user.email}:${user.password}`).toString('base64')
  await page.evaluate(async ({ basic, email, password }) => {
    await fetch('https://member.peoplesfitness.de/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${basic}`, 'X-Tenant': 'peoples-gym', 'X-Public-Facility-Group': 'BRANDENPEOPLESFITNESSCLUBS-9668881C08B84496B662DD3EB26D420C', 'X-Nox-Client-Type': 'WEB' },
      credentials: 'include',
      body: JSON.stringify({ username: email, password }),
    })
  }, { basic, email: user.email, password: user.password })

  const result = await page.evaluate(async () => {
    const res = await fetch('https://member.peoplesfitness.de/nox/public/v3/facility-booking/categories?facilityId=1253413940', {
      headers: { 'X-Tenant': 'peoples-gym', 'X-Public-Facility-Group': 'BRANDENPEOPLESFITNESSCLUBS-9668881C08B84496B662DD3EB26D420C', 'X-Nox-Client-Type': 'WEB' },
      credentials: 'include',
    })
    const text = await res.text()
    return { status: res.status, body: text.slice(0, 500) }
  })

  await browser.close()
  res.json(result)
})
export default router
