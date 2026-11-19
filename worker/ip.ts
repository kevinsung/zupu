// Pure helper, kept free of Worker types so tests can import it.
/**
 * Rate-limit key for a client address. An IPv6 /64 is one network and devices pick random
 * interface IDs inside it, so key on the /64; IPv4 (and IPv4-mapped IPv6) is kept as is.
 */
export function rateLimitKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const bad = ip.toLowerCase()
  let addr = bad.split('%')[0]
  let v4: string | null = null
  const dot = addr.lastIndexOf(':') + 1
  if (addr.slice(dot).includes('.')) {
    const o = addr.slice(dot).split('.')
    if (o.length !== 4 || !o.every(x => /^\d{1,3}$/.test(x) && +x < 256)) return bad
    const n = o.map(Number)
    v4 = n.join('.')
    addr = addr.slice(0, dot) + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16)
  }
  const halves = addr.split('::')
  if (halves.length > 2) return bad
  const side = (h: string) => (h === '' ? [] : h.split(':'))
  const head = side(halves[0])
  const tail = halves.length === 2 ? side(halves[1]) : []
  const fill = 8 - head.length - tail.length
  if (halves.length === 2 ? fill < 1 : fill !== 0) return bad
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail]
  if (groups.length !== 8 || !groups.every(g => /^[0-9a-f]{1,4}$/.test(g))) return bad
  if (v4 && groups.slice(0, 5).every(g => +('0x' + g) === 0) && groups[5] === 'ffff') return v4
  return groups.slice(0, 4).map(g => g.replace(/^0+/, '') || '0').join(':') + '::/64'
}
