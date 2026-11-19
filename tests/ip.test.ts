import { describe, expect, it } from 'vitest'
import { rateLimitKey } from '../worker/ip'

describe('rateLimitKey', () => {
  it('leaves IPv4 and non-IP values unchanged', () => {
    expect(rateLimitKey('198.51.100.7')).toBe('198.51.100.7')
    expect(rateLimitKey('unknown')).toBe('unknown')
  })

  it('keys IPv6 on the /64, handling :: compression', () => {
    expect(rateLimitKey('::1')).toBe('0:0:0:0::/64')
    expect(rateLimitKey('::')).toBe('0:0:0:0::/64')
    expect(rateLimitKey('2001:db8::')).toBe('2001:db8:0:0::/64')
    expect(rateLimitKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64')
    expect(rateLimitKey('2001:db8:1:2:abcd::5')).toBe('2001:db8:1:2::/64')
    expect(rateLimitKey('1::')).toBe('1:0:0:0::/64')
  })

  it('handles full form, leading zeros and mixed case', () => {
    expect(rateLimitKey('2001:0db8:0000:0001:0000:0000:0000:0001')).toBe('2001:db8:0:1::/64')
    expect(rateLimitKey('2001:DB8:A:B::F')).toBe('2001:db8:a:b::/64')
  })

  it('maps IPv4-mapped addresses to plain IPv4 and tolerates IPv4 tails', () => {
    expect(rateLimitKey('::ffff:192.0.2.1')).toBe('192.0.2.1')
    expect(rateLimitKey('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64')
  })

  it('strips zone ids', () => {
    expect(rateLimitKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
  })

  it('returns malformed input lowercased instead of throwing', () => {
    expect(rateLimitKey('1:2:3')).toBe('1:2:3')
    expect(rateLimitKey('1::2::3')).toBe('1::2::3')
    expect(rateLimitKey('1:2:3:4:5:6:7:8:9')).toBe('1:2:3:4:5:6:7:8:9')
    expect(rateLimitKey('GGGG::1')).toBe('gggg::1')
    expect(rateLimitKey('::1.2.3')).toBe('::1.2.3')
  })
})
