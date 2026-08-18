// Destination must be HTTPS, or an exact-match localhost dev URL over
// plain HTTP - anything else falls back to `fallback`. Used both before
// storing a push payload's destination in notification data, and again
// before opening/focusing on click.
export function resolveTrustedUrl(candidate: unknown, fallback = '/notifications'): string {
  if (typeof candidate !== 'string' || candidate.length === 0) return fallback
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return fallback
  }
  if (url.protocol === 'https:') return candidate
  if (url.protocol === 'http:' && url.hostname === 'localhost') return candidate
  return fallback
}
