import { createLocalUser } from '../modules/users/service'

// CLI: bun run cli users <subcommand>
// Подкоманды:
//   create --username NAME [--role user|team_admin|app_admin]... [--password PW] [--email E] [--display "Имя"]
// Пароль можно передать флагом (для CI), но в интерактивном режиме его читают
// без эха через Bun.stdin (raw mode + ручная буферизация).

type Args = {
  flags: Map<string, string[]>
  positional: string[]
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string[]>()
  const positional: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        const arr = flags.get(key) ?? []
        arr.push(next)
        flags.set(key, arr)
        i += 1
      } else {
        flags.set(key, [...(flags.get(key) ?? []), 'true'])
      }
    } else {
      positional.push(a)
    }
  }
  return { flags, positional }
}

function flag(args: Args, name: string): string | undefined {
  return args.flags.get(name)?.[0]
}

function flagAll(args: Args, name: string): string[] {
  return args.flags.get(name) ?? []
}

// Простой readline для пароля. ANSI-эхо выключаем через `setRawMode(true)`
// (доступен в Bun через node-совместимый API). Ctrl-C прерывает ввод,
// Backspace/DEL удаляют последний символ.
async function readPasswordHidden(prompt: string): Promise<string> {
  const ETX = String.fromCharCode(3)
  const BS = String.fromCharCode(8)
  const DEL = String.fromCharCode(127)
  process.stdout.write(prompt)
  const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void }
  if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true)
  stdin.resume()
  return new Promise<string>((resolve) => {
    let buf = ''
    const onData = (chunk: Buffer | string) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      for (const ch of s) {
        if (ch === '\n' || ch === '\r') {
          if (typeof stdin.setRawMode === 'function') stdin.setRawMode(false)
          stdin.pause()
          stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(buf)
          return
        }
        if (ch === ETX) {
          process.stdout.write('\n')
          process.exit(130)
        }
        if (ch === DEL || ch === BS) {
          buf = buf.slice(0, -1)
        } else {
          buf += ch
        }
      }
    }
    stdin.on('data', onData)
  })
}

export async function runUsers(rest: string[]): Promise<number> {
  const [sub, ...tail] = rest
  if (!sub || sub === 'help' || sub === '--help') {
    console.log('users create --username NAME [--role user|team_admin|app_admin]... [--password PW] [--email E] [--display "Имя"] [--must-change]')
    return 0
  }
  if (sub !== 'create') {
    console.error(`Unknown subcommand: ${sub}`)
    return 2
  }
  const args = parseArgs(tail)
  const username = flag(args, 'username')
  if (!username) {
    console.error('users create: --username is required')
    return 2
  }
  const rolesArg = flagAll(args, 'role')
  const allowedRoles = ['user', 'team_admin', 'app_admin'] as const
  for (const r of rolesArg) {
    if (!(allowedRoles as readonly string[]).includes(r)) {
      console.error(`Invalid role: ${r}`)
      return 2
    }
  }
  // 'user' добавляем всегда — это базовая роль, аддитивно сочетается с
  // team_admin/app_admin (см. docs/specs/03-auth.md).
  const roles = (rolesArg.length > 0
    ? Array.from(new Set(['user', ...rolesArg]))
    : ['user']) as Array<typeof allowedRoles[number]>

  let password = flag(args, 'password')
  if (!password) {
    password = await readPasswordHidden('Password: ')
    const confirm = await readPasswordHidden('Confirm:  ')
    if (password !== confirm) {
      console.error('Passwords do not match')
      return 2
    }
  }
  if (!password || password.length < 12) {
    console.error('Password must be at least 12 characters')
    return 2
  }

  const created = await createLocalUser({
    username,
    password,
    email: flag(args, 'email'),
    displayName: flag(args, 'display'),
    roles,
    mustChange: Boolean(flag(args, 'must-change')),
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Failed: ${message}`)
    return null
  })
  if (!created) return 1

  console.log(`Created user ${created.id} (${created.displayName}) with roles=${roles.join(',')}`)
  return 0
}
