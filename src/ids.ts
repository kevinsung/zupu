const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 16 random base-36 characters (~82 bits); works in browsers, Workers and Node. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, b => ALPHABET[b % 36]).join('')
}
