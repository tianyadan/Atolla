/** Normalize Express 5 route param value to trimmed string */
export function routeParam(value: string | string[] | undefined): string {
  if (value == null) return ''
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw.trim() : ''
}
