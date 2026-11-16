import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

// `vite dev` runs the Worker (worker/index.ts) in workerd with a local D1 database,
// and `vite build` outputs both the static site and the Worker for `wrangler deploy`.
export default defineConfig({
  plugins: [cloudflare()],
  server: {
    // IPv4 loopback explicitly: `tailscale serve` proxies to 127.0.0.1, while "localhost" may bind ::1 only.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Allow testing from other devices through `tailscale serve` (https://<machine>.<tailnet>.ts.net).
    allowedHosts: ['.ts.net'],
  },
})
