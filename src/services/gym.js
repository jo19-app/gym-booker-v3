process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/render/project/src/.playwright'

import { chromium } from 'playwright'

const BASE = 'https://member.peoplesfitness.de'
const STUDIO_SLUG = 'cGVvcGxlcy1neW06MTI1MzQxMzk0MA%3D%3D'

const HEADERS = {
  'X-Tenant': 'peoples-gym',
  'X-Public-Facility-Group': 'BRANDENPEOPLESFITNESSCLUBS-9668881C08B84496B662DD3EB26D420C',
  'X-Nox-Client-Type': 'WEB',
  'X-Ms-Web-Context': `/studio/${STUDIO_SLUG}`,
  'X-Nox-Web-Context': 'v=1',
  'Content-Type': 'application/json',
}

async function getPage(email, password) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })
  const context = await browser.newContext()
  const page = await context.newPage()

  // Navigate to the site first so cookies are scoped correctly
  await page.goto(`${BASE}/studio/${STUDIO_SLUG}/course?v=1`, {
    waitUntil: 'domcontentloaded', timeout: 30000
  })
  await page.waitForTimeout(2000)

  // Login
  const basic = Buffer.from(`${email}:${password}`).toString('base64')
  const loginOk = await page.evaluate(async ({ base, headers, basic, email, password }) => {
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { ...headers, 'Authorization': `Basic ${basic}` },
      credentials: 'include',
      body: JSON.stringify({ username: email, password }),
    })
    return res.ok
  }, { base: BASE, headers: HEADERS, basic, email, password })

  if (!loginOk) {
    await browser.close()
    throw new Error('Login failed')
  }

  return { browser, page }
}

export async function fetchSchedule(email, password) {
  const { browser, page } = await getPage(email, password)

  try {
    const courses = await page.evaluate(async ({ base, headers, studioSlug }) => {
  // Fetch the weekly course schedule directly
  const now = new Date()
  const from = now.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })
  const to = new Date(now.getTime() + 8 * 86400000).toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })

  const res = await fetch(
    `${base}/nox/v1/studios/${studioSlug}/courses?from=${from}&to=${to}`,
    { headers, credentials: 'include' }
  )
  const data = await res.json()
  const list = Array.isArray(data) ? data : (data.courses || data.data || [])

  return list.map(c => ({
    id: String(c.id),
    optionId: String(c.benefitId || c.id),
    name: c.name || '',
    startTime: c.startDateTime || c.startTime || '',
    endTime: c.endDateTime || c.endTime || '',
    trainer: c.employees?.[0]?.displayedName || c.trainer || '',
    spotsAvailable: c.freeSlots ?? Math.max(0, (c.maxParticipants || 0) - (c.bookedParticipants || 0)),
    spotsTotal: c.maxParticipants || 0,
    bookable: c.bookable ?? false,
    alreadyBooked: c.alreadyBooked ?? false,
    waitlistAvailable: c.waitingListActive ?? false,
    earliestBookingDateTime: c.earliestBookingDateTime || null,
  }))
}, { base: BASE, headers: HEADERS, studioSlug: STUDIO_SLUG })

      const results = []
      for (const cat of categories) {
        if (!cat.id) continue
        const r = await fetch(`${base}/nox/v1/bookableitems/course/${cat.id}`, {
          headers, credentials: 'include'
        })
        if (!r.ok) continue
        const course = await r.json()
        for (const slot of course.slots || []) {
          results.push({
            id: String(cat.id),
            optionId: String(cat.benefitId || ''),
            name: course.name,
            startTime: slot.startDateTime,
            endTime: slot.endDateTime,
            trainer: slot.employees?.[0]?.displayedName || '',
            spotsAvailable: Math.max(0, (course.maxParticipants || 0) - (course.bookedParticipants || 0)),
            spotsTotal: course.maxParticipants || 0,
            bookable: slot.bookable || false,
            alreadyBooked: slot.alreadyBooked || false,
            waitlistAvailable: course.waitingListActive || false,
            earliestBookingDateTime: slot.earliestBookingDateTime || null,
          })
        }
      }
      return results
    }, { base: BASE, headers: HEADERS })

    return courses
  } finally {
    await browser.close()
  }
}

export async function findAndBook(email, password, courseName, weekday, time, date) {
  const { browser, page } = await getPage(email, password)

  try {
    // Get all courses
    const categories = await page.evaluate(async ({ base, headers }) => {
      const res = await fetch(`${base}/nox/public/v3/facility-booking/categories?facilityId=1253413940`, {
        headers, credentials: 'include'
      })
      return res.json()
    }, { base: BASE, headers: HEADERS })

    if (!Array.isArray(categories)) throw new Error('Could not fetch categories')

    // Find matching course
    let matchedId = null
    let matchedOptionId = null

    for (const cat of categories) {
      if (!cat.id) continue
      const course = await page.evaluate(async ({ base, headers, id }) => {
        const res = await fetch(`${base}/nox/v1/bookableitems/course/${id}`, {
          headers, credentials: 'include'
        })
        return res.ok ? res.json() : null
      }, { base: BASE, headers: HEADERS, id: cat.id })

      if (!course) continue
      if (!course.name?.toLowerCase().includes(courseName.toLowerCase())) continue

      for (const slot of course.slots || []) {
        const slotDate = new Date(slot.startDateTime)
        const slotDay = slotDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Europe/Berlin' }).toLowerCase()
        const slotTime = slotDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
        const slotDateStr = slotDate.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })

        if (slotDay !== weekday?.toLowerCase()) continue
        if (slotTime !== time) continue
        if (date && slotDateStr !== date) continue
        if (!slot.bookable || slot.alreadyBooked) continue

        matchedId = String(cat.id)
        matchedOptionId = String(cat.benefitId || cat.id)
        break
      }
      if (matchedId) break
    }

    if (!matchedId) {
      return { success: false, message: `Kein buchbarer Kurs gefunden für "${courseName}" am ${weekday} um ${time}` }
    }

    // Navigate to booking summary page and click "Jetzt buchen"
    await page.goto(
      `${BASE}/studio/${STUDIO_SLUG}/booking/course/${matchedId}/option/${matchedOptionId}/summary?v=1`,
      { waitUntil: 'networkidle', timeout: 30000 }
    )

    // Click the "Jetzt buchen" button
    const btn = await page.locator('button:has-text("Jetzt buchen"), button:has-text("Buchen")').first()
    if (!btn) return { success: false, message: 'Buchungsbutton nicht gefunden' }

    await btn.click()
    await page.waitForTimeout(3000)

    const success = await page.evaluate(() => {
      return document.body.innerText.includes('gebucht') ||
             document.body.innerText.includes('erfolgreich') ||
             document.body.innerText.includes('Terminbuchungen')
    })

    return {
      success,
      message: success ? `✅ "${courseName}" erfolgreich gebucht!` : `❌ Buchung fehlgeschlagen`
    }

  } finally {
    await browser.close()
  }
}
