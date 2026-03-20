import { z } from "zod"

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export let AccountParam = z.object({
  account: z.string().default("default"),
})

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

export let MailSearchRequest = z.object({
  account: z.string().default("default"),
  query: z.string().min(1, "query is required"),
  maxResults: z.number().int().min(1).max(500).default(20),
  fetch: z.enum(["none", "metadata", "full", "summary"]).default("none"),
  previewChars: z.number().int().min(1).default(200),
})
export type MailSearchRequest = z.infer<typeof MailSearchRequest>

export let MailCountRequest = z.object({
  account: z.string().default("default"),
  query: z.string().min(1, "query is required"),
})
export type MailCountRequest = z.infer<typeof MailCountRequest>

export let MailThreadRequest = z.object({
  account: z.string().default("default"),
  threadId: z.string().min(1, "threadId is required"),
})
export type MailThreadRequest = z.infer<typeof MailThreadRequest>

export let MailReadRequest = z.object({
  account: z.string().default("default"),
  messageId: z.string().min(1, "messageId is required"),
})
export type MailReadRequest = z.infer<typeof MailReadRequest>

export let MailSendRequest = z.object({
  account: z.string().default("default"),
  to: z.string().min(1, "to is required"),
  cc: z.array(z.string()).default([]),
  bcc: z.array(z.string()).default([]),
  subject: z.string().default(""),
  body: z.string().default(""),
  from: z.string().optional(),
  replyTo: z.string().optional(),
  threadId: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  messageId: z.string().optional(),
})
export type MailSendRequest = z.infer<typeof MailSendRequest>

export let MailModifyRequest = z.object({
  account: z.string().default("default"),
  messageId: z.string().min(1, "messageId is required"),
})
export type MailModifyRequest = z.infer<typeof MailModifyRequest>

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

export let SlackSearchRequest = z.object({
  account: z.string().default("default"),
  query: z.string().min(1, "query is required"),
  maxResults: z.number().int().min(1).max(100).default(20),
})
export type SlackSearchRequest = z.infer<typeof SlackSearchRequest>

export let SlackReadRequest = z.object({
  account: z.string().default("default"),
  channel: z.string().min(1, "channel is required"),
  ts: z.string().min(1, "ts is required"),
})
export type SlackReadRequest = z.infer<typeof SlackReadRequest>

export let SlackSendRequest = z.object({
  account: z.string().default("default"),
  channel: z.string().min(1, "channel is required"),
  text: z.string().min(1, "text is required"),
  threadTs: z.string().optional(),
  asUser: z.boolean().default(true),
})
export type SlackSendRequest = z.infer<typeof SlackSendRequest>

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export let IngestRequest = z.object({
  accounts: z.array(z.string()).min(1).default(["default"]),
  query: z.string().default("is:unread"),
  maxResults: z.number().int().min(1).default(100),
  markRead: z.boolean().default(false),
  state: z.string().optional(),
})
export type IngestRequest = z.infer<typeof IngestRequest>

// ---------------------------------------------------------------------------
// API response envelope
// ---------------------------------------------------------------------------

export let ApiResponse = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
})
export type ApiResponse = z.infer<typeof ApiResponse>
