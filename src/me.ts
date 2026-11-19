const KEY = 'ft-me'

/** Who this device's user is, for kinship terms; per device like the editor name. '' when unset. Callers treat an id no longer in the data as unset. */
export function getMe(): string {
  return localStorage.getItem(KEY) ?? ''
}

export function setMe(id: string) {
  if (id) localStorage.setItem(KEY, id)
  else localStorage.removeItem(KEY)
}
