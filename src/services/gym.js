process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/render/project/src/.playwright'

import { chromium } from 'playwright'

const BASE = 'https://member.peoplesfitness.de'
const STUDIO_SLUG = 'cGVvcGxlcy1neW06MTI1MzQxMzk0MA=='
const STUDIO_SLUG_ENCODED = 'cGVvcGxlcy1neW06MTI1MzQxMzk0MA%3D%3D'

const HEADERS = {
  'X-Tenant': 'peoples-gym',
  'X-Public-Facility-Group': 'BRANDENPEOPLESFITNESSCLUBS-9668881C08B84496B662DD3EB26D420C',
  'X-Nox-Client-Type': 'WEB',
  'X-Ms-Web-Context': `/studio/${STUDIO_SLUG_ENCODED}`,
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

  await page.goto(`${BASE}/studio/${STUDIO_SLUG_ENCODED}/course?v=1`, {
    waitUntil: 'domcontentloaded', timeout: 30000
  })
  await page.waitForTimeout(2000)

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
    return courses
  } finally {
    await browser.close()
  }
}

export async function findAndBook(email, password, courseName, weekday, time, date) {
  const { browser, page } = await getPage(email, password)
  try {
    const categories = await page.evaluate(async ({ base, headers }) => {
      const res = await fetch(`${base}/nox/public/v3/facility-booking/categories?facilityId=1253413940`, {
        headers, credentials: 'include'
      })
      return res.json()
    }, { base: BASE, headers: HEADERS })

    if (!Array.isArray(categories?.benefitCategories) && !Array.isArray(categories)) {
      throw new Error('Could not fetch categories')
    }

    // Try direct studio courses endpoint instead
    const now = new Date()
    const from = now.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })
    const to = new Date(now.getTime() + 8 * 86400000).toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })

    const allCourses = await page.evaluate(async ({ base, headers, studioSlug, from, to }) => {
      const res = await fetch(
        `${base}/nox/v1/studios/${studioSlug}/courses?from=${from}&to=${to}`,
        { headers, credentials: 'include' }
      )
      const data = await res.json()
      return Array.isArray(data) ? data : (data.courses || data.data || [])
    }, { base: BASE, headers: HEADERS, studioSlug: STUDIO_SLUG, from, to })

    const match = allCourses.find(c => {
      const cDate = new Date(c.startDateTime || c.startTime)
      const cDay = cDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Europe/Berlin' }).toLowerCase()
      const cTime = cDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
      const cDateStr = cDate.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })
      const nameMatch = (c.name || '').toLowerCase().includes(courseName.toLowerCase())
      const dayMatch = cDay === weekday?.toLowerCase()
      const timeMatch = cTime === time
      const dateMatch = !date || cDateStr === date
      return nameMatch && dayMatch && timeMatch && dateMatch && c.bookable && !c.alreadyBooked
    })

    if (!match) {
      return { success: false, message: `Kein buchbarer Kurs gefunden für "${courseName}" am ${weekday} um ${time}` }
    }

    const courseId = match.id
    const optionId = match.benefitId || match.id

    await page.goto(
      `${BASE}/studio/${STUDIO_SLUG_ENCODED}/booking/course/${courseId}/option/${optionId}/summary?v=1`,
      { waitUntil: 'networkidle', timeout: 30000 }
    )
    await page.waitForTimeout(2000)

    const btn = page.locator('button:has-text("Jetzt buchen"), button:has-text("Buchen")').first()
    const visible = await btn.isVisible().catch(() => false)
    if (!visible) return { success: false, message: 'Buchungsbutton nicht gefunden' }

    await btn.click()
    await page.waitForTimeout(3000)

    const success = await page.evaluate(() =>
      document.body.innerText.includes('gebucht') ||
      document.body.innerText.includes('erfolgreich') ||
      document.body.innerText.includes('Terminbuchungen')
    )

    return {
      success,
      message: success ? `✅ "${courseName}" erfolgreich gebucht!` : `❌ Buchung fehlgeschlagen`
    }
  } finally {
    await browser.close()
  }
}
