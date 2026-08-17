import { z } from 'zod'

// Single source of truth for every notification event type this Glocke
// deployment accepts - config.ts validates configured producers against
// it, app.ts validates each inbound envelope's payload against it, and
// processor.ts renders every notification from it. A producer can never
// supply its own title/body/actionUrl (see app.ts's payload schemas
// below, all `.strict()` with no such fields) - presentation stays
// entirely under Glocke's control.

// z.iso.date() already rejects both malformed strings and out-of-range
// calendar dates (e.g. 2026-02-30), and maps to OpenAPI's `format: date`
// for free - no need for a hand-rolled round-trip check.
const isoDate = z.iso.date()

const recipientId = z.string().trim().min(1).max(4_000)
const shortText = z.string().trim().min(1).max(4_000)

export interface EventRegistryEntry<Payload extends z.ZodTypeAny = z.ZodTypeAny> {
  type: string
  source: string
  payloadSchema: Payload
  render: (payload: z.infer<Payload>) => { title: string; body: string; actionUrl: string | null }
}

function entry<Payload extends z.ZodTypeAny>(config: EventRegistryEntry<Payload>): EventRegistryEntry {
  return config as EventRegistryEntry
}

const passwordChanged = entry({
  type: 'schlussel.security.password_changed.v1',
  source: 'schlussel',
  payloadSchema: z.object({ recipientId }).strict(),
  render: () => ({
    title: 'Пароль изменён',
    body: 'Пароль вашей учётной записи был изменён.',
    actionUrl: '/settings',
  }),
})

const goalCompleted = entry({
  type: 'kuvert.goal.completed.v1',
  source: 'kuvert',
  payloadSchema: z.object({ recipientId, goalName: shortText }).strict(),
  render: (payload) => ({
    title: 'Цель достигнута',
    body: `Цель «${payload.goalName}» достигнута.`,
    actionUrl: '/goals',
  }),
})

const taskDue = entry({
  type: 'tafel.task.due.v1',
  source: 'tafel',
  payloadSchema: z.object({
    recipientId,
    taskTitle: shortText,
    dueDate: isoDate,
    overdue: z.boolean(),
  }).strict(),
  render: (payload) => payload.overdue
    ? {
      title: 'Задача просрочена',
      body: `Срок задачи «${payload.taskTitle}» истёк ${payload.dueDate}.`,
      actionUrl: '/tasks',
    }
    : {
      title: 'Срок задачи приближается',
      body: `Задачу «${payload.taskTitle}» нужно выполнить до ${payload.dueDate}.`,
      actionUrl: '/tasks',
    },
})

const backlinkAdded = entry({
  type: 'zettel.note.backlink_added.v1',
  source: 'zettel',
  payloadSchema: z.object({
    recipientId,
    sourceTitle: shortText,
    targetTitle: shortText,
  }).strict(),
  render: (payload) => ({
    title: 'Добавлена обратная ссылка',
    body: `Заметка «${payload.sourceTitle}» теперь ссылается на «${payload.targetTitle}».`,
    actionUrl: null,
  }),
})

export const eventRegistry: readonly EventRegistryEntry[] = [
  passwordChanged, goalCompleted, taskDue, backlinkAdded,
]

export const eventRegistryByType: ReadonlyMap<string, EventRegistryEntry> = new Map(
  eventRegistry.map((registered) => [registered.type, registered]),
)

export const registeredEventSources: ReadonlySet<string> = new Set(
  eventRegistry.map((registered) => registered.source),
)
