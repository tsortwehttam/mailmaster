import fs from "node:fs"
import crypto from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { google } from "googleapis"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { DEFAULT_ACCOUNT, resolveCredentialsPath, resolveTokenReadPathForAccount } from "../src/CliConfig"
import { buildCorpus } from "../src/CorpusBuilder"
import { buildRunDirName, exportMessageArtifacts, headerMap } from "../src/MessageExport"
import type { Argv } from "yargs"
import { verboseLog } from "../src/Verbose"

let loadOAuth = (account: string, verbose = false) => {
  let credentialsPath = resolveCredentialsPath()
  let tokenPath = resolveTokenReadPathForAccount(account)
  verboseLog(verbose, "mail auth", { account, credentialsPath, tokenPath })

  let raw = JSON.parse(fs.readFileSync(credentialsPath, "utf8"))
  let c = raw.installed ?? raw.web
  if (!c?.client_id || !c?.client_secret) throw new Error("Bad credentials.json (missing client_id/client_secret)")
  let o = new google.auth.OAuth2(c.client_id, c.client_secret, (c.redirect_uris ?? [])[0])
  let t = JSON.parse(fs.readFileSync(tokenPath, "utf8"))
  o.setCredentials(t)
  return o
}

let gmail = (account: string, verbose = false) => google.gmail({ version: "v1", auth: loadOAuth(account, verbose) })

let base64url = (s: string) =>
  Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")

let chunk76 = (s: string) => (s.match(/.{1,76}/g) ?? []).join("\r\n")

let encodeQuotedPrintable = (input: string) => {
  let lines = input.split(/\r?\n/)
  let encoded: string[] = []
  for (let line of lines) {
    let current = ""
    for (let i = 0; i < line.length; i++) {
      let char = line[i]
      let code = line.charCodeAt(i)
      let bytes = Buffer.from(char, "utf8")
      let chunk: string
      if (bytes.length === 1 && code >= 33 && code <= 126 && code !== 61) {
        chunk = char
      } else if ((code === 9 || code === 32) && i < line.length - 1) {
        chunk = char
      } else {
        chunk = Array.from(bytes)
          .map(x => `=${x.toString(16).toUpperCase().padStart(2, "0")}`)
          .join("")
      }
      if (current.length + chunk.length > 75) {
        encoded.push(current + "=")
        current = chunk
      } else {
        current += chunk
      }
    }
    encoded.push(current)
  }
  return encoded.join("\r\n")
}

let normalizeMessageId = (value?: string) => {
  let trimmed = (value ?? "").trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed
  if (!trimmed.includes("@")) return undefined
  return `<${trimmed}>`
}

let dedupeReferences = (value?: string) => {
  let refs = (value ?? "")
    .split(/\s+/)
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => (x.startsWith("<") && x.endsWith(">") ? x : normalizeMessageId(x) ?? `<${x}>`))
  return Array.from(new Set(refs)).join(" ")
}

let buildMessageId = (from?: string) => {
  let domain = from?.split("@")[1] ?? "localhost"
  return `<${crypto.randomBytes(12).toString("hex")}.${Date.now()}@${domain}>`
}

let guessMimeType = (filePath: string) => {
  let ext = path.extname(filePath).toLowerCase()
  if (ext === ".txt") return "text/plain"
  if (ext === ".html" || ext === ".htm") return "text/html"
  if (ext === ".json") return "application/json"
  if (ext === ".pdf") return "application/pdf"
  if (ext === ".csv") return "text/csv"
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".gif") return "image/gif"
  if (ext === ".webp") return "image/webp"
  return "application/octet-stream"
}

let normalizeMultiValue = (value: unknown) => {
  if (value == null) return []
  let raw = Array.isArray(value) ? value : [value]
  return raw
    .flatMap(x => String(x).split(","))
    .map(x => x.trim())
    .filter(Boolean)
}

type ExportState = {
  exported: Record<string, string>
}

let readExportState = (statePath: string): ExportState => {
  if (!fs.existsSync(statePath)) return { exported: {} }
  try {
    let data = JSON.parse(fs.readFileSync(statePath, "utf8"))
    if (!data || typeof data !== "object" || typeof data.exported !== "object") return { exported: {} }
    return { exported: data.exported }
  } catch {
    return { exported: {} }
  }
}

let writeExportState = (statePath: string, state: ExportState) => {
  fs.mkdirSync(path.dirname(statePath), { recursive: true })
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

let appendJsonl = (outPath: string, record: unknown) => {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.appendFileSync(outPath, `${JSON.stringify(record)}\n`)
}

let quoteGmailTerm = (value: string) => `"${value.replace(/"/g, '\\"')}"`
let DEFAULT_EXPORT_MAX_MESSAGES = 100

let buildDefaultExportStatePath = (params: { account: string; query: string; outDir: string }) => {
  let key = JSON.stringify({
    account: params.account,
    query: params.query,
    outDir: params.outDir,
  })
  let digest = crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)
  return path.resolve(process.cwd(), ".mailmon", "state", `export-${params.account}-${digest}.json`)
}

let buildExportQuery = (params: {
  scope: "primary" | "inbox" | "all-mail"
  from: string[]
  to: string[]
  label: string[]
  newerThan?: string
  olderThan?: string
  after?: string
  before?: string
  hasAttachment: boolean
  includeRead: "any" | "unread" | "read"
  query?: string
}) => {
  let terms: string[] = []
  if (params.scope === "primary") terms.push("in:inbox", "category:primary")
  if (params.scope === "inbox") terms.push("in:inbox")
  for (let value of params.from) terms.push(`from:${quoteGmailTerm(value)}`)
  for (let value of params.to) terms.push(`to:${quoteGmailTerm(value)}`)
  for (let value of params.label) terms.push(`label:${quoteGmailTerm(value)}`)
  if (params.newerThan) terms.push(`newer_than:${params.newerThan}`)
  if (params.olderThan) terms.push(`older_than:${params.olderThan}`)
  if (params.after) terms.push(`after:${params.after}`)
  if (params.before) terms.push(`before:${params.before}`)
  if (params.hasAttachment) terms.push("has:attachment")
  if (params.includeRead === "unread") terms.push("is:unread")
  if (params.includeRead === "read") terms.push("-is:unread")
  let rawQuery = (params.query ?? "").trim()
  if (rawQuery) terms.push(rawQuery)
  return terms.join(" ").trim()
}

let iterateMessageRefs = async function* (params: {
  client: ReturnType<typeof gmail>
  query: string
  pageSize: number
  includeSpamTrash: boolean
  verbose: boolean
}) {
  let pageToken: string | undefined

  while (true) {
    let response = await params.client.users.messages.list({
      userId: "me",
      q: params.query || undefined,
      maxResults: params.pageSize,
      pageToken,
      includeSpamTrash: params.includeSpamTrash,
    })

    let pageRefs = (response.data.messages ?? []).filter(message => message.id).map(message => ({
      id: message.id as string,
      threadId: message.threadId ?? null,
    }))
    verboseLog(params.verbose, "export page", {
      fetched: pageRefs.length,
      nextPageToken: response.data.nextPageToken ?? null,
    })

    for (let ref of pageRefs) yield ref

    pageToken = response.data.nextPageToken ?? undefined
    if (!pageToken) break
  }
}

let buildRawMessage = (params: {
  from?: string
  to: string
  cc: string[]
  bcc: string[]
  replyTo?: string
  inReplyTo?: string
  references?: string
  messageId?: string
  subject: string
  body: string
  attach: string[]
}) => {
  let normalizedInReplyTo = normalizeMessageId(params.inReplyTo)
  let normalizedReferences = dedupeReferences(
    [params.references, normalizedInReplyTo].filter(Boolean).join(" ").trim() || undefined,
  )
  let headers = [
    ...(params.from ? [`From: ${params.from}`] : []),
    `To: ${params.to}`,
    ...(params.cc.length > 0 ? [`Cc: ${params.cc.join(", ")}`] : []),
    ...(params.bcc.length > 0 ? [`Bcc: ${params.bcc.join(", ")}`] : []),
    ...(params.replyTo ? [`Reply-To: ${params.replyTo}`] : []),
    ...(normalizedInReplyTo ? [`In-Reply-To: ${normalizedInReplyTo}`] : []),
    ...(normalizedReferences ? [`References: ${normalizedReferences}`] : []),
    `Subject: ${params.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${normalizeMessageId(params.messageId) ?? buildMessageId(params.from)}`,
    "MIME-Version: 1.0",
    "X-Mailer: mailmon/1.0",
  ]

  if (params.attach.length === 0) {
    return (
      headers.join("\r\n") +
      `\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${encodeQuotedPrintable(params.body)}`
    )
  }

  let boundary = `mailmon_${Date.now()}_${Math.random().toString(36).slice(2)}`
  let parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${encodeQuotedPrintable(params.body)}\r\n`,
    ...params.attach.map(filePath => {
      let filename = path.basename(filePath).replace(/"/g, "")
      let content = fs.readFileSync(filePath).toString("base64")
      return (
        `--${boundary}\r\n` +
        `Content-Type: ${guessMimeType(filePath)}; name="${filename}"\r\n` +
        "Content-Transfer-Encoding: base64\r\n" +
        `Content-Disposition: attachment; filename="${filename}"\r\n\r\n` +
        `${chunk76(content)}\r\n`
      )
    }),
    `--${boundary}--`,
  ]

  return headers.join("\r\n") + `\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` + parts.join("")
}

export let configureMailCli = (cli: Argv) =>
  cli
    .usage("Usage: $0 <command> [options]")
    .option("account", {
      type: "string",
      default: DEFAULT_ACCOUNT,
      describe: "Token account name (uses .mailmon/tokens/<account>.json)",
    })
    .option("verbose", {
      alias: "v",
      type: "boolean",
      default: false,
      describe: "Print diagnostic details to stderr",
    })
    .command(
    "search <query>",
    "Search messages by Gmail query; returns refs or hydrated message payloads",
    y =>
      y
        .positional("query", {
          type: "string",
          describe: 'Gmail query, e.g. "from:someone newer_than:7d"',
        })
        .option("max-results", {
          type: "number",
          default: 20,
          coerce: value => {
            if (!Number.isFinite(value) || value < 1 || value > 500) throw new Error("--max-results must be 1..500")
            return Math.floor(value)
          },
          describe: "Maximum matched messages to return",
        })
        .option("fetch", {
          type: "string",
          default: "none",
          choices: ["none", "metadata", "full"] as const,
          describe: "Optionally fetch matched message payloads: none, metadata, or full",
        }),
    async argv => {
      let client = gmail(argv.account, argv.verbose)
      let r = await client.users.messages.list({ userId: "me", q: argv.query, maxResults: argv.maxResults })
      let msgs = r.data.messages ?? []
      let resolvedMessages: unknown[] | undefined
      if (argv.fetch !== "none") {
        resolvedMessages = []
        for (let message of msgs) {
          if (!message.id) continue
          let fetched = await client.users.messages.get({
            userId: "me",
            id: message.id,
            format: argv.fetch,
            ...(argv.fetch === "metadata"
              ? { metadataHeaders: ["From", "To", "Subject", "Date", "Message-ID"] }
              : {}),
          })
          resolvedMessages.push(fetched.data)
        }
      }
      verboseLog(argv.verbose, "search results", { count: msgs.length, fetch: argv.fetch })
      if (resolvedMessages) {
        console.log(
          JSON.stringify(
            {
              query: argv.query,
              messages: msgs,
              resolvedMessages,
            },
            null,
            2,
          ),
        )
        return
      }
      console.log(JSON.stringify(msgs, null, 2))
    },
    )
    .command(
    "count <query>",
    "Return Gmail's resultSizeEstimate for a query",
    y =>
      y.positional("query", {
        type: "string",
        describe: 'Gmail query, e.g. "from:someone newer_than:7d"',
      }),
    async argv => {
      let client = gmail(argv.account, argv.verbose)
      let response = await client.users.messages.list({
        userId: "me",
        q: argv.query,
        maxResults: 1,
      })
      console.log(
        JSON.stringify(
          {
            account: argv.account,
            query: argv.query,
            resultSizeEstimate: response.data.resultSizeEstimate ?? 0,
          },
          null,
          2,
        ),
      )
    },
    )
    .command(
    "export",
    "Export matched messages into per-message directories",
    y =>
      y
        .option("out-dir", {
          type: "string",
          demandOption: true,
          describe: "Directory where exported message folders will be created",
        })
        .option("scope", {
          type: "string",
          default: "primary",
          choices: ["primary", "inbox", "all-mail"] as const,
          describe: "Default mailbox scope: Primary inbox, all inbox mail, or all mail",
        })
        .option("query", {
          type: "string",
          describe: "Additional raw Gmail query terms appended to the generated filter query",
        })
        .option("from", {
          type: "array",
          string: true,
          default: [],
          coerce: normalizeMultiValue,
          describe: "Filter sender(s), repeat flag or pass comma-separated values",
        })
        .option("to", {
          type: "array",
          string: true,
          default: [],
          coerce: normalizeMultiValue,
          describe: "Filter recipient(s), repeat flag or pass comma-separated values",
        })
        .option("label", {
          type: "array",
          string: true,
          default: [],
          coerce: normalizeMultiValue,
          describe: "Required Gmail label(s), repeat flag or pass comma-separated values",
        })
        .option("newer-than", {
          type: "string",
          describe: "Gmail relative age filter, for example 7d or 3m",
        })
        .option("older-than", {
          type: "string",
          describe: "Gmail relative age upper bound, for example 30d",
        })
        .option("after", {
          type: "string",
          describe: "Gmail date lower bound, for example 2025/01/01",
        })
        .option("before", {
          type: "string",
          describe: "Gmail date upper bound, for example 2025/02/01",
        })
        .option("read", {
          type: "string",
          default: "any",
          choices: ["any", "unread", "read"] as const,
          describe: "Read-state filter",
        })
        .option("has-attachment", {
          type: "boolean",
          default: false,
          describe: "Require attachments in matched messages",
        })
        .option("include-spam-trash", {
          type: "boolean",
          default: false,
          describe: "Include Spam and Trash in search results",
        })
        .option("page-size", {
          type: "number",
          default: 100,
          coerce: value => {
            if (!Number.isFinite(value) || value < 1 || value > 500) throw new Error("--page-size must be 1..500")
            return Math.floor(value)
          },
          describe: "Gmail API page size while paginating through matches",
        })
        .option("max-messages", {
          type: "number",
          coerce: value => {
            if (value == null) return undefined
            if (!Number.isFinite(value) || value < 1) throw new Error("--max-messages must be a positive number")
            return Math.floor(value)
          },
          describe: `Optional cap on the number of new messages to export in this run (default: ${DEFAULT_EXPORT_MAX_MESSAGES} unless --all)`,
        })
        .option("all", {
          type: "boolean",
          default: false,
          describe: "Export all matched messages by removing the default safety cap",
        })
        .option("resume", {
          type: "boolean",
          default: false,
          describe: "Resume from a default state file derived from account, query, and output directory",
        })
        .option("state", {
          type: "string",
          describe: "Optional explicit JSON state file path for incremental runs",
        })
        .option("jsonl-out", {
          type: "string",
          describe: "Optional JSONL manifest path; appends one record per exported or skipped message",
        }),
    async argv => {
      let client = gmail(argv.account, argv.verbose)
      let query = buildExportQuery({
        scope: argv.scope as "primary" | "inbox" | "all-mail",
        from: argv.from,
        to: argv.to,
        label: argv.label,
        newerThan: argv.newerThan,
        olderThan: argv.olderThan,
        after: argv.after,
        before: argv.before,
        hasAttachment: argv.hasAttachment,
        includeRead: argv.read as "any" | "unread" | "read",
        query: argv.query,
      })
      let outDir = path.resolve(argv.outDir)
      let jsonlOutPath = argv.jsonlOut ? path.resolve(argv.jsonlOut) : undefined
      let effectiveMaxMessages = argv.maxMessages ?? (argv.all ? undefined : DEFAULT_EXPORT_MAX_MESSAGES)
      let statePath = argv.state
        ? path.resolve(argv.state)
        : argv.resume
          ? buildDefaultExportStatePath({ account: argv.account, query, outDir })
          : undefined
      let state = statePath ? readExportState(statePath) : { exported: {} }

      verboseLog(argv.verbose, "export request", {
        account: argv.account,
        query,
        outDir,
        statePath: statePath ?? null,
        resume: argv.resume,
        jsonlOutPath: jsonlOutPath ?? null,
        pageSize: argv.pageSize,
        maxMessages: effectiveMaxMessages ?? null,
        all: argv.all,
        includeSpamTrash: argv.includeSpamTrash,
      })

      fs.mkdirSync(outDir, { recursive: true })

      let exported: Array<{ id: string; threadId?: string | null; dir: string }> = []
      let skipped: string[] = []
      let scannedCount = 0
      for await (let ref of iterateMessageRefs({
        client,
        query,
        pageSize: argv.pageSize,
        includeSpamTrash: argv.includeSpamTrash,
        verbose: argv.verbose,
      })) {
        if (effectiveMaxMessages != null && exported.length >= effectiveMaxMessages) break
        scannedCount += 1
        if (state.exported[ref.id]) {
          skipped.push(ref.id)
          if (jsonlOutPath) {
            appendJsonl(jsonlOutPath, {
              type: "message",
              status: "skipped",
              messageId: ref.id,
              threadId: ref.threadId ?? null,
              account: argv.account,
              query,
              skippedAt: new Date().toISOString(),
              reason: "already-exported",
            })
          }
          continue
        }

        let fetched = await client.users.messages.get({ userId: "me", id: ref.id, format: "full" })
        let headers = headerMap(fetched.data)
        let dir = path.resolve(outDir, buildRunDirName(ref.id, headers.subject))
        fs.mkdirSync(dir, { recursive: true })
        await exportMessageArtifacts({ client, messageId: ref.id, message: fetched.data, outDir: dir })

        state.exported[ref.id] = new Date().toISOString()
        if (statePath) writeExportState(statePath, state)
        exported.push({ id: ref.id, threadId: fetched.data.threadId ?? null, dir })
        if (jsonlOutPath) {
          appendJsonl(jsonlOutPath, {
            type: "message",
            status: "exported",
            messageId: ref.id,
            threadId: fetched.data.threadId ?? null,
            account: argv.account,
            query,
            exportedAt: state.exported[ref.id],
            dir,
          })
        }
      }

      console.log(
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            account: argv.account,
            query,
            outDir,
            scannedCount,
            exportedCount: exported.length,
            skippedCount: skipped.length,
            all: argv.all,
            maxMessages: effectiveMaxMessages ?? null,
            statePath: statePath ?? null,
            jsonlOutPath: jsonlOutPath ?? null,
            exported,
            skipped,
          },
          null,
          2,
        ),
      )
    },
    )
    .command(
    "corpus",
    "Build an LLM-oriented corpus from mail export directories",
    y =>
      y
        .option("from-export", {
          type: "string",
          demandOption: true,
          describe: "Root directory produced by `mail export` containing per-message folders",
        })
        .option("out-dir", {
          type: "string",
          demandOption: true,
          describe: "Directory where corpus files will be written",
        })
        .option("chunk-chars", {
          type: "number",
          default: 4000,
          coerce: value => {
            if (!Number.isFinite(value) || value < 500) throw new Error("--chunk-chars must be >= 500")
            return Math.floor(value)
          },
          describe: "Maximum characters per chunk written to chunks.jsonl",
        })
        .option("chunk-overlap-chars", {
          type: "number",
          default: 400,
          coerce: value => {
            if (!Number.isFinite(value) || value < 0) throw new Error("--chunk-overlap-chars must be >= 0")
            return Math.floor(value)
          },
          describe: "Character overlap between adjacent chunks",
        })
        .option("max-attachment-bytes", {
          type: "number",
          default: 250000,
          coerce: value => {
            if (!Number.isFinite(value) || value < 1) throw new Error("--max-attachment-bytes must be positive")
            return Math.floor(value)
          },
          describe: "Maximum bytes read from any one attachment when extracting text",
        })
        .option("max-attachment-chars", {
          type: "number",
          default: 20000,
          coerce: value => {
            if (!Number.isFinite(value) || value < 1) throw new Error("--max-attachment-chars must be positive")
            return Math.floor(value)
          },
          describe: "Maximum normalized characters kept from any one attachment",
        })
        .option("thread-excerpt-chars", {
          type: "number",
          default: 500,
          coerce: value => {
            if (!Number.isFinite(value) || value < 50) throw new Error("--thread-excerpt-chars must be >= 50")
            return Math.floor(value)
          },
          describe: "Excerpt length per message embedded in threads.jsonl",
        }),
    async argv => {
      let summary = buildCorpus({
        exportDir: argv.fromExport,
        outDir: argv.outDir,
        chunkChars: argv.chunkChars,
        chunkOverlapChars: argv.chunkOverlapChars,
        maxAttachmentBytes: argv.maxAttachmentBytes,
        maxAttachmentChars: argv.maxAttachmentChars,
        threadExcerptChars: argv.threadExcerptChars,
        verbose: argv.verbose,
      })
      console.log(JSON.stringify(summary, null, 2))
    },
    )
    .command(
    "read <messageId>",
    "Read message metadata; returns JSON object with payload headers and ids",
    y =>
      y.positional("messageId", {
        type: "string",
        describe: "Gmail message id",
      }),
    async argv => {
      let r = await gmail(argv.account, argv.verbose).users.messages.get({
        userId: "me",
        id: argv.messageId,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      })
      verboseLog(argv.verbose, "read message", { id: argv.messageId, threadId: r.data.threadId })
      console.log(JSON.stringify(r.data, null, 2))
    },
    )
    .command(
    "send",
    "Send a message with optional cc/bcc/attachments/threading headers; returns Gmail send response JSON",
    y =>
      y
        .option("to", {
          type: "string",
          demandOption: true,
          describe: "Recipient email address",
        })
        .option("cc", {
          type: "array",
          string: true,
          default: [],
          coerce: normalizeMultiValue,
          describe: "CC recipient(s), repeat flag or pass comma-separated values",
        })
        .option("bcc", {
          type: "array",
          string: true,
          default: [],
          coerce: normalizeMultiValue,
          describe: "BCC recipient(s), repeat flag or pass comma-separated values",
        })
        .option("reply-to", {
          type: "string",
          describe: "Reply-To header value",
        })
        .option("from", {
          type: "string",
          describe: "Optional From header (must be authorized in Gmail sender settings)",
        })
        .option("thread-id", {
          type: "string",
          describe: "Gmail threadId for threading",
        })
        .option("in-reply-to", {
          type: "string",
          describe: "In-Reply-To header (RFC 822 Message-ID)",
        })
        .option("references", {
          type: "string",
          describe: "References header value",
        })
        .option("message-id", {
          type: "string",
          describe: "Optional Message-ID header override",
        })
        .option("subject", {
          type: "string",
          default: "",
          describe: "Message subject",
        })
        .option("body", {
          type: "string",
          default: "",
          describe: "Message body",
        })
        .option("attach", {
          type: "array",
          string: true,
          default: [],
          coerce: normalizeMultiValue,
          describe: "Attachment file path(s), repeat flag to include multiple",
        })
        .option("yes", {
          type: "boolean",
          default: false,
          describe: "Required safety flag to actually send",
        }),
    async argv => {
      if (!argv.yes) throw new Error("Refusing to send without --yes")
      verboseLog(argv.verbose, "send request", {
        account: argv.account,
        to: argv.to,
        ccCount: argv.cc.length,
        bccCount: argv.bcc.length,
        attachments: argv.attach,
        threadId: argv.threadId,
      })

      let raw = buildRawMessage({
        from: argv.from,
        to: argv.to,
        cc: argv.cc,
        bcc: argv.bcc,
        replyTo: argv.replyTo,
        inReplyTo: argv.inReplyTo,
        references: argv.references,
        messageId: argv.messageId,
        subject: argv.subject,
        body: argv.body,
        attach: argv.attach,
      })

      let r = await gmail(argv.account, argv.verbose).users.messages.send({
        userId: "me",
        requestBody: {
          raw: base64url(raw),
          ...(argv.threadId ? { threadId: argv.threadId } : {}),
        },
      })
      verboseLog(argv.verbose, "send response", { id: r.data.id, threadId: r.data.threadId })
      console.log(JSON.stringify(r.data, null, 2))
    },
    )
    .command(
    "mark-read <messageId>",
    "Mark a message as read by removing the Gmail UNREAD label",
    y =>
      y.positional("messageId", {
        type: "string",
        describe: "Gmail message id",
      }),
    async argv => {
      let r = await gmail(argv.account, argv.verbose).users.messages.modify({
        userId: "me",
        id: argv.messageId,
        requestBody: {
          removeLabelIds: ["UNREAD"],
        },
      })
      verboseLog(argv.verbose, "mark-read message", { id: argv.messageId, labelIds: r.data.labelIds })
      console.log(JSON.stringify(r.data, null, 2))
    },
    )
    .command(
    "archive <messageId>",
    "Archive a message by removing the Gmail INBOX label",
    y =>
      y.positional("messageId", {
        type: "string",
        describe: "Gmail message id",
      }),
    async argv => {
      let r = await gmail(argv.account, argv.verbose).users.messages.modify({
        userId: "me",
        id: argv.messageId,
        requestBody: {
          removeLabelIds: ["INBOX"],
        },
      })
      verboseLog(argv.verbose, "archive message", { id: argv.messageId, labelIds: r.data.labelIds })
      console.log(JSON.stringify(r.data, null, 2))
    },
    )
    .example("$0 search \"from:alerts@example.com newer_than:7d\"", "Find recent messages")
    .example("$0 search \"in:inbox is:unread\" --fetch=metadata", "Find matches and include hydrated metadata payloads")
    .example("$0 count \"from:bactolac.com newer_than:1y\"", "Return Gmail's estimated match count for a query")
    .example("$0 export --out-dir=./exports", "Export up to 100 Primary inbox messages into per-message directories")
    .example("$0 export --out-dir=./exports --all", "Export all matched messages by removing the default cap")
    .example("$0 export --out-dir=./exports --resume", "Resume the same export using a default incremental state file")
    .example("$0 corpus --from-export=./exports --out-dir=./corpus", "Build messages.jsonl, chunks.jsonl, and threads.jsonl from exported mail")
    .example("$0 export --out-dir=./exports --scope=inbox --newer-than=7d --has-attachment", "Export recent inbox messages with attachments")
    .example("$0 export --out-dir=./exports --query='from:billing@example.com' --state=./.mailmon/state/export.json", "Export matching messages incrementally using a state file")
    .example("$0 export --out-dir=./exports --jsonl-out=./exports/export.jsonl", "Append one JSONL manifest record per exported or skipped message")
    .example("$0 read 190cf9f55b05efcc", "Read metadata for one Gmail message id")
    .example("$0 mark-read 190cf9f55b05efcc", "Mark one Gmail message as read")
    .example("$0 archive 190cf9f55b05efcc", "Archive one Gmail message (remove INBOX label)")
    .example("$0 send --to user@example.com --subject \"Hi\" --body \"Hello\" --yes", "Send plain-text email")
    .example(
      "$0 send --to user@example.com --cc a@example.com,b@example.com --bcc archive@example.com --subject \"Report\" --attach ./report.pdf --attach ./metrics.csv --yes",
      "Send with multiple recipients and attachments",
    )
    .example(
      "$0 send --to user@example.com --thread-id 190cb53f30f3d1aa --in-reply-to \"<orig@id>\" --references \"<orig@id>\" --body \"Following up\" --yes",
      "Reply in a Gmail thread using thread and message-id headers",
    )
    .epilog(
      [
        "Read state notes:",
        "- `export` defaults to `in:inbox category:primary` and excludes Spam/Trash unless `--include-spam-trash` is set.",
        `- \`export\` is capped at ${DEFAULT_EXPORT_MAX_MESSAGES} new exports per run by default; use \`--all\` to remove that safety cap or \`--max-messages\` to set your own cap.`,
        "- `export --query` appends raw Gmail search terms to the generated filter query.",
        "- `export --resume` reuses a default state file derived from account, query, and output directory.",
        "- `export --state` sets an explicit state file path for incremental runs.",
        "- `export --jsonl-out` appends per-message manifest records while export is in progress.",
        "- `corpus` consumes exported message folders and writes `messages.jsonl`, `chunks.jsonl`, `threads.jsonl`, and `summary.json`.",
        "- `mark-read` removes the `UNREAD` label from the specified message id.",
        "- `archive` removes the `INBOX` label from the specified message id.",
        "- Requires OAuth scope `https://www.googleapis.com/auth/gmail.modify`.",
        "- If your existing token predates this scope, rerun `mailmon auth --account=<name>`.",
        "",
        "Send behavior notes:",
        "- `--yes` is required to send (safety flag).",
        "- `--cc`, `--bcc`, and `--attach` accept repeated flags and comma-separated values.",
        "- `--thread-id` sets Gmail API thread routing.",
        "- `--in-reply-to` and `--references` set RFC 5322 threading headers.",
        "- If `--in-reply-to` is provided, it is normalized and merged into `References`.",
        "- `--verbose` prints resolved credential/token paths and operation diagnostics to stderr.",
      ].join("\n"),
    )
    .demandCommand(1, "Choose a command: search, count, export, corpus, read, mark-read, archive, or send.")
    .strict()
    .recommendCommands()
    .help()

export let parseMailCli = (args: string[], scriptName = "mail") => configureMailCli(yargs(args).scriptName(scriptName)).parseAsync()

export let runMailCli = (args = hideBin(process.argv), scriptName = "mail") =>
  parseMailCli(args, scriptName).catch(e => {
    console.error(e?.message ?? e)
    process.exit(1)
  })

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runMailCli()
}
