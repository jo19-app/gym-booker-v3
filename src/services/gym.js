process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/render/project/src/.playwright'
import { chromium } from 'playwright'

const BASE = 'https://member.peoplesfitness.de'
const STUDIO_SLUG = 'cGVvcGxlcy1neW06MTI1MzQxMzk0MA%3D%3D'

const NOX_HEADERS = {
  'X-Tenant': 'peoples-gym',
  'X-Public-Facility-Group': 'BRANDENPEOPLESFITNESSCLUBS-9668881C08B84496B662DD3EB26D420C',
  'X-Nox-Client-Type': 'WEB',
  'X-Ms-Web-Context': `/studio/${STUDIO_SLUG}`,
  'X-Nox-Web-Context': 'v=1',
  'Content-Type': 'application/json',
}

// Get a browser page with session cookies set
async function getAuthenticatedPage(email, password) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
  })

  const page = await context.newPage()

  // Set extra headers
  await page.setExtraHTTPHeaders(NOX_HEADERS)

  // Navigate to login page
  await page.goto(`${BASE}/studio/${STUDIO_SLUG}/course?v=1`, { waitUntil: 'networkidle' })

  // Login via API call within the browser context (so cookies are set)
  const loginResult = await page.evaluate(async ({ email, password, base, headers }) => {
    const res = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: email, password }),
    })
    return { ok: res.ok, status: res.status }
  }, { email, password, base: BASE, headers: NOX_HEADERS })

  if (!loginResult.ok) {
    await browser.close()
    throw new Error(`Login failed (${loginResult.status})`)
  }

  return { browser, context, page }
}

// Fetch course schedule for the next 8 days
export async function fetchSchedule(email, password) {
  const { browser, page } = await getAuthenticatedPage(email, password)

  try {
    const now = new Date()
    const from = now.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })
    const to = new Date(now.getTime() + 8 * 86400000).toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })

    // Fetch courses using the correct API endpoint
    const courses = await page.evaluate(async ({ base, headers, from, to }) => {
      // First get the list of bookable courses
      const res = await fetch(`${base}/nox/public/v3/facility-booking/categories?facilityId=1253413940`, {
        headers,
        credentials: 'include',
      })
      const categories = await res.json()

      // Get individual course slots
      const allCourses = []
      if (categories && Array.isArray(categories)) {
        for (const cat of categories.slice(0, 20)) {
          if (cat.id) {
            const courseRes = await fetch(`${base}/nox/v1/bookableitems/course/${cat.id}`, {
              headers,
              credentials: 'include',
            })
            if (courseRes.ok) {
              const course = await courseRes.json()
              if (course.slots) {
                for (const slot of course.slots) {
                  allCourses.push({
                    id: course.id,
                    name: course.name,
                    startTime: slot.startDateTime,
                    endTime: slot.endDateTime,
                    trainer: slot.employees?.[0]?.displayedName,
                    spotsAvailable: course.maxParticipants - course.bookedParticipants,
                    spotsTotal: course.maxParticipants,
                    bookable: slot.bookable,
                    alreadyBooked: slot.alreadyBooked,
                    waitlistAvailable: course.waitingListActive,
                    earliestBookingDateTime: slot.earliestBookingDateTime,
                  })
                }
              }
            }
          }
        }
      }
      return allCourses
    }, { base: BASE, headers: NOX_HEADERS, from, to })

    return courses
  } finally {
    await browser.close()
  }
}

// Book a specific course by ID
export async function bookCourse(email, password, courseId) {
  const { browser, page } = await getAuthenticatedPage(email, password)

  try {
    const result = await page.evaluate(async ({ base, headers, courseId }) => {
      const res = await fetch(`${base}/nox/v1/bookableitems/course/${courseId}/book`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      })
      const text = await res.text()
      return { ok: res.ok, status: res.status, body: text }
    }, { base: BASE, headers: NOX_HEADERS, courseId })

    if (result.ok || result.status === 200 || result.status === 201) {
      return { success: true, message: 'Booking confirmed!' }
    }

    // Check if already booked (500 with internal error often means already booked)
    if (result.status === 500) {
      return { success: false, message: 'Already booked or server error', alreadyBooked: true }
    }

    return { success: false, message: `Booking failed (${result.status}): ${result.body}` }
  } finally {
    await browser.close()
  }
}

// Find and book a course matching name + weekday + time
export async function findAndBook(email, password, courseName, weekday, time, date) {
  const { browser, page } = await getAuthenticatedPage(email, password)

  try {
    // Get all course IDs from categories
    const courseIds = await page.evaluate(async ({ base, headers }) => {
      const res = await fetch(`${base}/nox/public/v3/facility-booking/categories?facilityId=1253413940`, {
        headers,
        credentials: 'include',
      })
      const data = await res.json()
      return Array.isArray(data) ? data.map(c => c.id).filter(Boolean) : []
    }, { base: BASE, headers: NOX_HEADERS })

    // Find the matching course slot
    let matchedCourseId = null
    for (const id of courseIds) {
      const course = await page.evaluate(async ({ base, headers, id }) => {
        const res = await fetch(`${base}/nox/v1/bookableitems/course/${id}`, {
          headers,
          credentials: 'include',
        })
        if (!res.ok) return null
        return res.json()
      }, { base: BASE, headers: NOX_HEADERS, id })

      if (!course) continue

      const nameMatch = course.name?.toLowerCase().includes(courseName.toLowerCase())
      if (!nameMatch) continue

      for (const slot of course.slots || []) {
        const slotDate = new Date(slot.startDateTime)
        const slotDay = slotDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Europe/Berlin' }).toLowerCase()
        const slotTime = slotDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
        const slotDateStr = slotDate.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' })

        const dayMatch = slotDay === weekday.toLowerCase()
        const timeMatch = slotTime === time
        const dateMatch = !date || slotDateStr === date

        if (dayMatch && timeMatch && dateMatch && slot.bookable && !slot.alreadyBooked) {
          matchedCourseId = id
          break
        }
      }
      if (matchedCourseId) break
    }

    if (!matchedCourseId) {
      return { success: false, message: `No bookable slot found for "${courseName}" on ${weekday} at ${time}` }
    }

    // Book it
    const result = await page.evaluate(async ({ base, headers, courseId }) => {
      const res = await fetch(`${base}/nox/v1/bookableitems/course/${courseId}/book`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      })
      const text = await res.text()
      return { ok: res.ok, status: res.status, body: text }
    }, { base: BASE, headers: NOX_HEADERS, courseId: matchedCourseId })

    if (result.ok || result.status === 200 || result.status === 201) {
      return { success: true, message: `✅ Booked "${courseName}"!` }
    }

    return { success: false, message: `Booking failed (${result.status})` }

  } finally {
    await browser.close()
  }
}
