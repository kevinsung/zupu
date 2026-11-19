import { readFileSync } from 'node:fs'
import { cloudflare } from '@cloudflare/vite-plugin'
import { type Plugin, defineConfig } from 'vite'

const DEV_SUFFIX = ' dev'

/**
 * On the dev server only, the installed app is named "族譜 dev", so it can sit on a phone's home
 * screen next to the real one. Rewrites the manifest and the iOS title; the files and builds are untouched.
 */
function devAppName(): Plugin {
  return {
    name: 'dev-app-name',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))
        manifest.name += DEV_SUFFIX
        manifest.short_name += DEV_SUFFIX
        res.setHeader('Content-Type', 'application/manifest+json')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(JSON.stringify(manifest))
      })
    },
    transformIndexHtml: html => html.replace(
      /(<meta name="apple-mobile-web-app-title" content=")([^"]*)/, `$1$2${DEV_SUFFIX}`),
  }
}

// `vite dev` runs the Worker (worker/index.ts) in workerd with a local D1 database,
// and `vite build` outputs both the static site and the Worker for `wrangler deploy`.
export default defineConfig({
  plugins: [devAppName(), cloudflare()],
  server: {
    // IPv4 loopback explicitly: `tailscale serve` proxies to 127.0.0.1, while "localhost" may bind ::1 only.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Allow testing from other devices through `tailscale serve` (https://<machine>.<tailnet>.ts.net).
    allowedHosts: ['.ts.net'],
  },
})
