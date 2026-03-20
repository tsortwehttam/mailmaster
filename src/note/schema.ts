import { z } from "zod"

export let NoteType = z.enum(["summary", "action", "decision", "info"])
export type NoteType = z.infer<typeof NoteType>

export let NoteStatus = z.enum(["pending", "done", "moot"])
export type NoteStatus = z.infer<typeof NoteStatus>

export let NotePriority = z.enum(["high", "normal", "low"])
export type NotePriority = z.infer<typeof NotePriority>

export let Note = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  type: NoteType,
  status: NoteStatus,
  priority: NotePriority,
  /** Short title / headline */
  title: z.string().min(1),
  /** Full content / body */
  content: z.string().default(""),
  /** Message IDs this note relates to */
  messageIds: z.array(z.string()).default([]),
  /** Thread IDs this note relates to */
  threadIds: z.array(z.string()).default([]),
  /** Optional tags for filtering */
  tags: z.array(z.string()).default([]),
  /** Optional deadline (ISO-8601) */
  deadline: z.string().optional(),
  /** ID of a related draft (if any) */
  draftId: z.string().optional(),
})
export type Note = z.infer<typeof Note>
