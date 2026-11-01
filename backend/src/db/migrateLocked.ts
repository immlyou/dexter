import type { SQL } from 'bun'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'

/** Hold one session across version inspection and Drizzle's migration transaction. */
export async function migrateWithLock(client: SQL, migrationsFolder: string): Promise<void> {
  const connection = await client.reserve()
  try {
    await connection`SELECT pg_advisory_lock(1684370533, 1)`
    try {
      await migrate(drizzle(connection), { migrationsFolder })
    } finally {
      // Keep the migration error if the session is already broken (the lock dies with it)
      await connection`SELECT pg_advisory_unlock(1684370533, 1)`.catch(() => {})
    }
  } finally {
    connection.release()
  }
}
