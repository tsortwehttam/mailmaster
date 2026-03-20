import { z } from "zod"

export let BriefingItemType = z.enum(["new-message", "thread-update", "action-due", "draft-ready", "info"])
export type BriefingItemType = z.infer<typeof BriefingItemType>

export let BriefingStatus = z.enum(["pending", "reviewed", "acted"])
export type BriefingStatus = z.infer<typeof BriefingStatus>

export let BriefingAction = z.enum(["send", "edit", "drop", "wait", "defer"])
export type BriefingAction = z.infer<typeof BriefingAction>

export let BriefingItem = z.object({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  type: BriefingItemType,
  status: BriefingStatus,
  /** One-line summary shown during briefing */
  summary: z.string().min(1),
  /** Full detail (message excerpt, context, etc.) */
  detail: z.string().default(""),
  /** Related message IDs */
  messageIds: z.array(z.string()).default([]),
  /** Related thread IDs */
  threadIds: z.array(z.string()).default([]),
  /** Related note IDs */
  noteIds: z.array(z.string()).default([]),
  /** Related draft ID (for draft-ready items) */
  draftId: z.string().optional(),
  /** Priority for ordering in the briefing queue */
  priority: z.enum(["high", "normal", "low"]).default("normal"),
  /** Action taken during review (null until reviewed) */
  action: BriefingAction.optional(),
  /** Reviewer's note or instruction */
  reviewNote: z.string().optional(),
})
export type BriefingItem = z.infer<typeof BriefingItem>
