export interface PushPayload {
  id: string
  text: string
  url: string
}

// Wire payload carries only a generic delivery id, neutral text, and a
// trusted destination - never event title/body/domain data (see
// backend/src/push-worker.ts, which sends the exact same shape). Strict
// shape validation, not free-form passthrough, so an accidental extra key
// (e.g. a producer bug leaking domain content) is dropped rather than
// surfaced.
export function parsePushPayload(raw: string): PushPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const { id, text, url } = parsed as Record<string, unknown>
  if (typeof id !== 'string' || typeof text !== 'string' || typeof url !== 'string') return null
  return { id, text, url }
}

export function buildNotificationOptions(payload: PushPayload): { body: string; tag: string; data: { url: string; id: string } } {
  return {
    body: payload.text,
    tag: payload.id,
    data: { url: payload.url, id: payload.id },
  }
}
