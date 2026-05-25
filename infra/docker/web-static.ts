// Статический сервер для роли `web`. `bun --static` не существует
// в Bun CLI; используем Bun.serve со встроенным static-роутингом и
// SPA-fallback на index.html для клиентского роутинга TanStack.

const dir = process.env.WEB_DIR ?? '/app/web'
const port = Number(process.env.PORT ?? 8080)

function safePath(pathname: string): string {
  // Нормализуем и блокируем path-traversal: ни '..', ни абсолютных путей.
  const decoded = decodeURIComponent(pathname)
  const stripped = decoded.replace(/\?.*$/, '')
  if (stripped.includes('..')) return '/index.html'
  return stripped === '/' ? '/index.html' : stripped
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)
    const candidate = safePath(url.pathname)
    const file = Bun.file(`${dir}${candidate}`)
    if (await file.exists()) {
      return new Response(file, {
        headers: {
          'cache-control': candidate === '/index.html'
            ? 'no-cache'
            : 'public, max-age=31536000, immutable',
        },
      })
    }
    // SPA fallback — клиентский роутер сам отдаст 404, если такого
    // маршрута действительно нет.
    return new Response(Bun.file(`${dir}/index.html`), {
      headers: { 'cache-control': 'no-cache' },
    })
  },
  error(err) {
    console.error(JSON.stringify({ service: 'web', msg: 'static.error', error: String(err) }))
    return new Response('Internal Error', { status: 500 })
  },
})

console.log(
  JSON.stringify({ service: 'web', msg: 'web.listening', port, dir }),
)
