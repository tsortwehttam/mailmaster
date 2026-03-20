import { z } from "zod"

export let AccountConfig = z.object({
  name: z.string().min(1),
  platform: z.enum(["gmail", "slack"]),
  /** Query for ingest/watch (platform-native syntax) */
  query: z.string().default("is:unread"),
})
export type AccountConfig = z.infer<typeof AccountConfig>

export let WorkspaceConfig = z.object({
  /** Human-readable workspace name */
  name: z.string().min(1),
  /** ISO-8601 creation timestamp */
  createdAt: z.string(),
  /** Accounts to monitor */
  accounts: z.array(AccountConfig).min(1),
  /** Watch polling interval (ms) */
  watchIntervalMs: z.number().int().positive().default(30000),
  /** Mark messages as read after ingestion */
  markRead: z.boolean().default(false),
  /** Max messages per account per ingest cycle */
  maxResults: z.number().int().positive().default(100),
  /** Save attachments to message directories */
  saveAttachments: z.boolean().default(true),
  /** Path to default instructions file (relative to workspace root) */
  instructionsFile: z.string().default("instructions.md"),
})
export type WorkspaceConfig = z.infer<typeof WorkspaceConfig>
