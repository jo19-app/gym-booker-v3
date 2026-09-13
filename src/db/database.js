import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB_PATH || join(__dirname, '../../data/gym-booker.db')

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH)

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL')

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    course_name TEXT NOT NULL,
    weekday TEXT,
    time TEXT NOT NULL,
    frequency TEXT NOT NULL DEFAULT 'weekly',
    date TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_attempt TEXT,
    last_result TEXT,
    last_booked TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`)

export default db
