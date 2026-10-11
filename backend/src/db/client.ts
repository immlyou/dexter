import { drizzle } from 'drizzle-orm/bun-sql'
import * as schema from './schema'

// Get database URL from environment
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/dexter'

// Create Drizzle instance with schema and connection
export const db = drizzle(DATABASE_URL, { schema })
