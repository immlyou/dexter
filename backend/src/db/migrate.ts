import { migrateWithLock } from './migrateLocked'
import { db } from './client'

async function runMigrations() {
  console.log('⏳ Running database migrations...')

  try {
    await migrateWithLock(db.$client, './src/db/migrations')
    console.log('✅ Migrations completed successfully')
    process.exit(0)
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  }
}

runMigrations()
