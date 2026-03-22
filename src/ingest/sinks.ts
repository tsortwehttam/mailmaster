import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import type { UnifiedMessage } from "../types"

// ---------------------------------------------------------------------------
// Sink interface
// ---------------------------------------------------------------------------

export type Sink = {
  write(msg: UnifiedMessage): Promise<void>
}

// ---------------------------------------------------------------------------
// NDJSON sink — one JSON line per message to a Writable (stdout or file)
// ---------------------------------------------------------------------------

export let createNdjsonSink = (params: {
  stream?: NodeJS.WritableStream
  filePath?: string
}): Sink => {
  let stream = params.stream
  let fd: number | undefined
  if (params.filePath) {
    fs.mkdirSync(path.dirname(params.filePath), { recursive: true })
    fd = fs.openSync(params.filePath, "a")
  }
  return {
    async write(msg) {
      let line = JSON.stringify(msg) + "\n"
      if (fd != null) fs.writeSync(fd, line)
      if (stream) stream.write(line)
    },
  }
}

// ---------------------------------------------------------------------------
// JSONL file sink — one JSON line per message appended to a file
// ---------------------------------------------------------------------------

export let createJsonlFileSink = (params: {
  filePath: string
  saveAttachments?: boolean
  /** Called when attachment data is needed — platform adapter provides this */
  fetchAttachment?: (msg: UnifiedMessage, filename: string) => Promise<Buffer | undefined>
}): Sink => createNdjsonSink({ filePath: params.filePath })

// ---------------------------------------------------------------------------
// Exec sink — run a shell command per message with env vars
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Chain sink — runs multiple sinks in sequence per message
// ---------------------------------------------------------------------------

export let createChainSink = (sinks: Sink[]): Sink => ({
  async write(msg) {
    for (let sink of sinks) {
      await sink.write(msg)
    }
  },
})

// ---------------------------------------------------------------------------
// Exec sink — run a shell command per message with env vars
// ---------------------------------------------------------------------------

export let createExecSink = (params: {
  command: string
  cwd?: string
}): Sink => ({
  async write(msg) {
    let env: Record<string, string> = {
      MSGMON_ID: msg.id,
      MSGMON_PLATFORM: msg.platform,
      MSGMON_TIMESTAMP: msg.timestamp,
      MSGMON_SUBJECT: msg.subject ?? "",
      MSGMON_FROM: msg.from?.address ?? "",
      MSGMON_THREAD_ID: msg.threadId ?? "",
      MSGMON_JSON: JSON.stringify(msg),
    }
    if (msg.platformMetadata.platform === "gmail") {
      env.MSGMON_MESSAGE_ID = msg.platformMetadata.messageId
      env.MSGMON_ACCOUNT = ""
    }
    await new Promise<void>((resolve, reject) => {
      let child = spawn(params.command, {
        cwd: params.cwd,
        env: { ...process.env, ...env },
        shell: true,
        stdio: "inherit",
      })
      child.on("error", reject)
      child.on("exit", code => {
        if (code === 0) return resolve()
        reject(new Error(`Exec sink command failed with exit code ${code ?? "unknown"}`))
      })
    })
  },
})
