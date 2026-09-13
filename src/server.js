import express from 'express'
import cookieParser from 'cookie-parser'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import apiRoutes from './routes/api.js'
import { startScheduler } from './services/scheduler.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(cookieParser())
app.use(express.static(join(__dirname, 'public')))

// API routes
app.use('/api', apiRoutes)

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`🏋️ Gym Booker running on port ${PORT}`)
  startScheduler()
})
