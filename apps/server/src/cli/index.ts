// CLI приложения: `bun run cli <command>`. Минимальный диспетчер.
// Подкоманды живут в отдельных файлах, чтобы CLI не пробуждал лишних модулей
// (например, http-сервер) при первом импорте.

import { runUsers } from './users'

function usage(): never {
  console.log('Usage: bun run cli <command>')
  console.log('Commands:')
  console.log('  users create  — create a local user (see `users help`)')
  console.log('  version       — print version')
  process.exit(1)
}

async function main(): Promise<void> {
  const [, , command, ...rest] = Bun.argv
  switch (command) {
    case undefined:
      usage()
      break
    case 'version':
      console.log(process.env.npm_package_version ?? '0.0.0')
      break
    case 'users': {
      const code = await runUsers(rest)
      process.exit(code)
    }
    default:
      console.error(`Unknown command: ${command}`)
      usage()
  }
}

void main()
