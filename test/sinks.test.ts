import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createNdjsonSink, createJsonlFileSink, createExecSink } from "../src/ingest/sinks"
import type { UnifiedMessage } from "../src/types"

let tmpDir: string

let sampleMessage = (id = "msg-001"): UnifiedMessage => ({
  id,
  platform: "gmail",
  timestamp: "2024-01-15T10:30:00.000Z",
  subject: "Test subject",
  bodyText: "Hello world",
  bodyHtml: "<p>Hello world</p>",
  from: { name: "Alice", address: "alice@example.com" },
  to: [{ address: "bob@example.com" }],
  attachments: [{ filename: "report.pdf", mimeType: "application/pdf", sizeBytes: 1024 }],
  threadId: "thread-001",
  platformMetadata: {
    platform: "gmail",
    messageId: id,
    threadId: "thread-001",
    labelIds: ["INBOX"],
    headers: { from: "alice@example.com", subject: "Test subject" },
  },
})

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgmon-test-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("createNdjsonSink", () => {
  it("writes one JSON line per message to a file", async () => {
    let filePath = path.join(tmpDir, "out.jsonl")
    let sink = createNdjsonSink({ filePath })

    await sink.write(sampleMessage("msg-001"))
    await sink.write(sampleMessage("msg-002"))

    let lines = fs.readFileSync(filePath, "utf8").trim().split("\n")
    assert.equal(lines.length, 2)
    assert.equal(JSON.parse(lines[0]).id, "msg-001")
    assert.equal(JSON.parse(lines[1]).id, "msg-002")
  })

  it("writes valid JSON on each line", async () => {
    let filePath = path.join(tmpDir, "out.jsonl")
    let sink = createNdjsonSink({ filePath })

    await sink.write(sampleMessage())

    let parsed = JSON.parse(fs.readFileSync(filePath, "utf8").trim())
    assert.equal(parsed.platform, "gmail")
    assert.equal(parsed.subject, "Test subject")
  })
})

describe("createJsonlFileSink", () => {
  it("appends one json line per message", async () => {
    let filePath = path.join(tmpDir, "messages.jsonl")
    let sink = createJsonlFileSink({ filePath })

    await sink.write(sampleMessage("msg-001"))
    await sink.write(sampleMessage("msg-002"))

    let lines = fs.readFileSync(filePath, "utf8").trim().split("\n")
    assert.equal(lines.length, 2)
    assert.equal(JSON.parse(lines[0]).id, "msg-001")
    assert.equal(JSON.parse(lines[1]).id, "msg-002")
  })

  it("stores body fields in each jsonl payload", async () => {
    let filePath = path.join(tmpDir, "messages.jsonl")
    let sink = createJsonlFileSink({ filePath })

    await sink.write(sampleMessage())

    let unified = JSON.parse(fs.readFileSync(filePath, "utf8").trim())
    assert.equal(unified.bodyText, "Hello world")
    assert.equal(unified.bodyHtml, "<p>Hello world</p>")
  })

  it("stores headers in the unified payload", async () => {
    let filePath = path.join(tmpDir, "messages.jsonl")
    let sink = createJsonlFileSink({ filePath })

    await sink.write(sampleMessage())

    let unified = JSON.parse(fs.readFileSync(filePath, "utf8").trim())
    assert.equal(unified.platformMetadata.headers.subject, "Test subject")
  })

  it("keeps attachments in the json payload even when saveAttachments is true", async () => {
    let filePath = path.join(tmpDir, "messages.jsonl")
    let sink = createJsonlFileSink({
      filePath,
      saveAttachments: true,
      fetchAttachment: async () => Buffer.from("fake-pdf-content"),
    })

    await sink.write(sampleMessage())

    let unified = JSON.parse(fs.readFileSync(filePath, "utf8").trim())
    assert.equal(unified.attachments.length, 1)
    assert.equal(unified.attachments[0].filename, "report.pdf")
  })
})

describe("createExecSink", () => {
  it("runs a command with MSGMON_* env vars", async () => {
    let outFile = path.join(tmpDir, "exec-out.txt")
    let sink = createExecSink({
      command: `echo "$MSGMON_ID $MSGMON_PLATFORM $MSGMON_SUBJECT" > ${outFile}`,
    })

    await sink.write(sampleMessage())

    let output = fs.readFileSync(outFile, "utf8").trim()
    assert.equal(output, "msg-001 gmail Test subject")
  })

  it("passes MSGMON_JSON containing full message", async () => {
    let outFile = path.join(tmpDir, "exec-json.txt")
    let sink = createExecSink({
      command: `echo "$MSGMON_JSON" > ${outFile}`,
    })

    await sink.write(sampleMessage())

    let parsed = JSON.parse(fs.readFileSync(outFile, "utf8").trim())
    assert.equal(parsed.id, "msg-001")
    assert.equal(parsed.platform, "gmail")
  })

  it("rejects when command fails", async () => {
    let sink = createExecSink({ command: "exit 1" })
    await assert.rejects(() => sink.write(sampleMessage()), /exit code 1/)
  })
})
