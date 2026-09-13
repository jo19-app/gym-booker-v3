import { Router } from 'express'
import db from '../db/database.js'
import { createToken, requireAuth } from '../services/auth.js'
import { fetchSchedule } from '../services/gym.js'
import { randomUUID } from 'crypto'

const router = Router()

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })

  try {
    // Verify credentials by trying to fetch schedule (uses real browser)
    // Just do a quick login check instead of full schedule fetch
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] })
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto('https://member.peoplesfitness.de/studio/cGVvcGxlcy1neW06MTI1MzQxMzk0MA%3D%3D/course?v=1', { waitUntil: 'domcontentloaded', timeout: 15000 })

    const loginResult = await page.evaluate(async ({ email, password }) => {
      const res = await fetch('https://member.peoplesfitness.de/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant': 'peoples-gym',
          'X-Public-Facility-Group': 'BRANDENPEOPLESFITNESSCLUBS-9668881C08B84496B662DD3EB26D420C',
          'X-Nox-Client-Type': 'WEB',
        },
        credentials: 'include',
        body: JSON.stringify({ username: email, password }),
      })
      return { ok: res.ok, status: res.status }
    }, { email, password })

    await browser.close()

    if (!loginResult.ok) {
      return res.status(401).json({ error: 'Email oder Passwort falsch' })
    }

    // Upsert user
    const userId = email.toLowerCase().replace(/[^a-z0-9]/g, '_')
    db.prepare(`
      INSERT INTO users (id, email, password) VALUES (?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET password = excluded.password
    `).run(userId, email, password)

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

// ── Schedule ──────────────────────────────────────────────────────────────────

router.get('/schedule', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId)
  if (!user) return res.status(404).json({ error: 'User not found' })

  try {
    const courses = await fetchSchedule(user.email, user.password)
    res.json({ courses })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Bookings ──────────────────────────────────────────────────────────────────

router.get('/bookings', requireAuth, (req, res) => {
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.userId)
  const bookings = db.prepare('SELECT * FROM bookings WHERE user_id = ? ORDER BY created_at DESC').all(req.user.userId)
  res.json({ email: user?.email, bookings })
})

router.post('/bookings', requireAuth, (req, res) => {
  const { courseName, weekday, time, frequency, date } = req.body
  if (!courseName || !time || !frequency) return res.status(400).json({ error: 'Missing fields' })

  const id = randomUUID()
  db.prepare(`
    INSERT INTO bookings (id, user_id, course_name, weekday, time, frequency, date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.userId, courseName, weekday || null, time, frequency, date || null)

  res.json({ ok: true, id })
})

router.patch('/bookings/:id', requireAuth, (req, res) => {
  const { enabled } = req.body
  db.prepare('UPDATE bookings SET enabled = ? WHERE id = ? AND user_id = ?')
    .run(enabled ? 1 : 0, req.params.id, req.user.userId)
  res.json({ ok: true })
})

router.delete('/bookings/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM bookings WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.userId)
  res.json({ ok: true })
})

// ── User info ─────────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(req.user.userId)
  res.json(user || {})
})

export default router
