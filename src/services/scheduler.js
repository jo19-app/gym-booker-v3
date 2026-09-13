import cron from 'node-cron'
import { getAllUsers, getUserBookings, updateBooking } from '../db/database.js'
import { findAndBook } from './gym.js'

const TIMEZONE = 'Europe/Berlin'
const BOOKING_WINDOW_HOURS = 48
const CHECK_WINDOW_MINUTES = 10

function isWindowOpen(weekday, time, frequency, date, now = new Date()) {
  const DAYS = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 }
  const [hh, mm] = time.split(':').map(Number)

  if (frequency === 'once' && date) {
    const [y, mo, d] = date.split('-').map(Number)
    const offset = getBerlinOffset(now)
    const classUTC = Date.UTC(y, mo-1, d, hh - offset, mm)
    if (now.getTime() >= classUTC) return false
    const opensAt = classUTC - BOOKING_WINDOW_HOURS * 3600000
    return Math.abs(now.getTime() - opensAt) <= CHECK_WINDOW_MINUTES * 60000
  }

  const targetDay = DAYS[weekday?.toLowerCase()]
  if (targetDay === undefined) return false

  for (let d = 0; d <= 7; d++) {
    const candidate = new Date(now.getTime() + d * 86400000)
    const berlinDate = candidate.toLocaleDateString('sv', { timeZone: TIMEZONE })
    const dow = new Date(`${berlinDate}T12:00:00`).getDay()
    if (dow !== targetDay) continue
    const [y, mo, day] = berlinDate.split('-').map(Number)
    const offset = getBerlinOffset(candidate)
    const classUTC = Date.UTC(y, mo-1, day, hh - offset, mm)
    const opensAt = classUTC - BOOKING_WINDOW_HOURS * 3600000
    if (Math.abs(now.getTime() - opensAt) <= CHECK_WINDOW_MINUTES * 60000) return true
  }
  return false
}

function getBerlinOffset(date) {
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }))
  const berlin = new Date(date.toLocaleString('en-US', { timeZone: TIMEZONE }))
  return (berlin - utc) / 3600000
}

export function startScheduler() {
  cron.schedule('*/5 * * * *', async () => {
    console.log(`[Cron] Running at ${new Date().toISOString()}`)
    const now = new Date()
    const users = getAllUsers()

    for (const user of users) {
      const bookings = getUserBookings(user.id).filter(b => b.enabled)
      for (const booking of bookings) {
        if (!isWindowOpen(booking.weekday, booking.time, booking.frequency, booking.date, now)) continue
        console.log(`[Cron] Booking "${booking.course_name}" for ${user.email}`)
        try {
          const result = await findAndBook(user.email, user.password, booking.course_name, booking.weekday, booking.time, booking.date)
          updateBooking(booking.id, {
            last_attempt: new Date().toISOString(),
            last_result: result.message,
            ...(result.success && { last_booked: new Date().toISOString() }),
            ...(result.success && booking.frequency === 'once' && { enabled: false }),
          })
          console.log(`[Cron] ${result.message}`)
        } catch (err) {
          updateBooking(booking.id, { last_attempt: new Date().toISOString(), last_result: `❌ ${err.message}` })
        }
      }
    }
  })
  console.log('[Cron] Scheduler started')
}
