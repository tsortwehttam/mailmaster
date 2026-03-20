import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import {
  generateNoteId,
  saveNote,
  loadNote,
  listNotes,
  deleteNote,
  findNotesByMessage,
  findNotesByThread,
  resolveNote,
} from "../src/note/store"
import type { Note } from "../src/note/schema"

let tmpDir: string

let makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: generateNoteId(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  type: "action",
  status: "pending",
  priority: "normal",
  title: "Test note",
  content: "Some content",
  messageIds: [],
  threadIds: [],
  tags: [],
  ...overrides,
})

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgmon-note-test-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("note store", () => {
  it("saves and loads a note", () => {
    let note = makeNote({ title: "Follow up with Alice" })
    saveNote(tmpDir, note)
    let loaded = loadNote(tmpDir, note.id)
    assert.equal(loaded.id, note.id)
    assert.equal(loaded.title, "Follow up with Alice")
  })

  it("lists notes with filters", () => {
    saveNote(tmpDir, makeNote({ type: "action", status: "pending" }))
    saveNote(tmpDir, makeNote({ type: "summary", status: "pending" }))
    saveNote(tmpDir, makeNote({ type: "action", status: "done" }))

    assert.equal(listNotes(tmpDir).length, 3)
    assert.equal(listNotes(tmpDir, { type: "action" }).length, 2)
    assert.equal(listNotes(tmpDir, { status: "done" }).length, 1)
    assert.equal(listNotes(tmpDir, { type: "summary" }).length, 1)
  })

  it("sorts by priority then date", () => {
    let low = makeNote({ priority: "low", title: "low" })
    let high = makeNote({ priority: "high", title: "high" })
    let normal = makeNote({ priority: "normal", title: "normal" })
    saveNote(tmpDir, low)
    saveNote(tmpDir, normal)
    saveNote(tmpDir, high)

    let notes = listNotes(tmpDir)
    assert.equal(notes[0].priority, "high")
    assert.equal(notes[2].priority, "low")
  })

  it("deletes a note", () => {
    let note = makeNote()
    saveNote(tmpDir, note)
    assert.equal(listNotes(tmpDir).length, 1)
    deleteNote(tmpDir, note.id)
    assert.equal(listNotes(tmpDir).length, 0)
  })

  it("finds notes by message ID", () => {
    saveNote(tmpDir, makeNote({ messageIds: ["msg-1", "msg-2"] }))
    saveNote(tmpDir, makeNote({ messageIds: ["msg-3"] }))

    assert.equal(findNotesByMessage(tmpDir, "msg-1").length, 1)
    assert.equal(findNotesByMessage(tmpDir, "msg-999").length, 0)
  })

  it("finds notes by thread ID", () => {
    saveNote(tmpDir, makeNote({ threadIds: ["thread-1"] }))
    saveNote(tmpDir, makeNote({ threadIds: ["thread-2"] }))

    assert.equal(findNotesByThread(tmpDir, "thread-1").length, 1)
  })

  it("resolves by prefix", () => {
    let note = makeNote()
    saveNote(tmpDir, note)
    let resolved = resolveNote(tmpDir, note.id.slice(0, 8))
    assert.equal(resolved.id, note.id)
  })

  it("filters by tag", () => {
    saveNote(tmpDir, makeNote({ tags: ["urgent", "finance"] }))
    saveNote(tmpDir, makeNote({ tags: ["personal"] }))

    assert.equal(listNotes(tmpDir, { tag: "urgent" }).length, 1)
    assert.equal(listNotes(tmpDir, { tag: "nonexistent" }).length, 0)
  })
})
