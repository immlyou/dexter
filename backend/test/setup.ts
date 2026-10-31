import { randomBytes } from 'node:crypto'

// Random per-run signing secrets so tests never depend on real configuration
process.env.JWT_SECRET = randomBytes(48).toString('base64')
process.env.JWT_REFRESH_SECRET = randomBytes(48).toString('base64')
// Never reach a real database from unit tests
process.env.DATABASE_URL = 'postgresql://test@127.0.0.1:1/unused'
