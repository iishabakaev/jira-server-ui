import type { Config } from 'drizzle-kit'

// Конфиг drizzle-kit для генерации миграций и studio.
// Все файлы схемы лежат в src/schema/*.ts.
export default {
  schema: './src/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5432/jira_ui',
  },
  strict: true,
  verbose: true,
} satisfies Config
