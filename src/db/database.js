import { JSONFilePreset } from 'lowdb/node'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '../../data')
mkdirSync(DATA_DIR, { recursive: true })

const defaultData = { users: [], bookings: [] }
export const db = await JSONFilePreset(join(DATA_DIR, 'db.json'), defaultData)

export function getUser(email) {
  return db.data.users.find(u => u.email === email)
}

export function upsertUser(user) {
  const idx = db.data.users.findIndex(u => u.email === user.email)
  if (idx >= 0) db.data.users[idx] = user
  else db.data.users.push(user)
  db.write()
}

export function getUserBookings(userId) {
  return db.data.bookings.filter(b => b.userId === userId)
}

export function addBooking(booking) {
  db.data.bookings.push(booking)
  db.write()
}

export function updateBooking(id, updates) {
  const idx = db.data.bookings.findIndex(b => b.id === id)
  if (idx >= 0) { db.data.bookings[idx] = { ...db.data.bookings[idx], ...updates }; db.write() }
}

export function deleteBooking(id) {
  db.data.bookings = db.data.bookings.filter(b => b.id !== id)
  db.write()
}

export function getAllUsers() {
  return db.data.users
}
