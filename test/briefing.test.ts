import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import {
  generateBriefingId,
  saveBriefingItem,
  loadBriefingItem,
  listBriefingItems,
  deleteBriefingItem,
  resolveBriefingItem,
  clearActed,
} from "../src/briefing/store"
import type { BriefingItem } from "../src/briefing/schema"

let tmpDir: string

let makeItem = (overrides: Partial<BriefingItem> = {}): BriefingItem => ({
  id: generateBriefingId(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  type: "new-message",
  status: "pending",
  summary: "New email from Alice about project update",
  detail: "",
  messageIds: [],
  threadIds: [],
  noteIds: [],
  priority: "normal",
  ...overrides,
})

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgmon-briefing-test-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("briefing store", () => {
  it("saves and loads an item", () => {
    let item = makeItem({ summary: "Follow up needed" })
    saveBriefingItem(tmpDir, item)
    let loaded = loadBriefingItem(tmpDir, item.id)
    assert.equal(loaded.id, item.id)
    assert.equal(loaded.summary, "Follow up needed")
  })

  it("lists items with status filter", () => {
    saveBriefingItem(tmpDir, makeItem({ status: "pending" }))
    saveBriefingItem(tmpDir, makeItem({ status: "pending" }))
    saveBriefingItem(tmpDir, makeItem({ status: "reviewed", action: "send" }))
    saveBriefingItem(tmpDir, makeItem({ status: "acted", action: "drop" }))

    assert.equal(listBriefingItems(tmpDir).length, 4)
    assert.equal(listBriefingItems(tmpDir, { status: "pending" }).length, 2)
    assert.equal(listBriefingItems(tmpDir, { status: "reviewed" }).length, 1)
    assert.equal(listBriefingItems(tmpDir, { status: "acted" }).length, 1)
  })

  it("sorts by priority then chronologically", () => {
    let a = makeItem({ priority: "low", createdAt: "2024-01-01T00:00:00Z" })
    let b = makeItem({ priority: "high", createdAt: "2024-01-02T00:00:00Z" })
    let c = makeItem({ priority: "normal", createdAt: "2024-01-03T00:00:00Z" })
    saveBriefingItem(tmpDir, a)
    saveBriefingItem(tmpDir, c)
    saveBriefingItem(tmpDir, b)

    let items = listBriefingItems(tmpDir)
    assert.equal(items[0].priority, "high")
    assert.equal(items[2].priority, "low")
  })

  it("deletes an item", () => {
    let item = makeItem()
    saveBriefingItem(tmpDir, item)
    assert.equal(listBriefingItems(tmpDir).length, 1)
    deleteBriefingItem(tmpDir, item.id)
    assert.equal(listBriefingItems(tmpDir).length, 0)
  })

  it("resolves by prefix", () => {
    let item = makeItem()
    saveBriefingItem(tmpDir, item)
    let resolved = resolveBriefingItem(tmpDir, item.id.slice(0, 8))
    assert.equal(resolved.id, item.id)
  })

  it("clears acted items", () => {
    saveBriefingItem(tmpDir, makeItem({ status: "pending" }))
    saveBriefingItem(tmpDir, makeItem({ status: "acted", action: "send" }))
    saveBriefingItem(tmpDir, makeItem({ status: "acted", action: "drop" }))

    let cleared = clearActed(tmpDir)
    assert.equal(cleared, 2)
    assert.equal(listBriefingItems(tmpDir).length, 1)
    assert.equal(listBriefingItems(tmpDir)[0].status, "pending")
  })

  it("supports review workflow: pending → reviewed → acted", () => {
    let item = makeItem()
    saveBriefingItem(tmpDir, item)

    // Review
    item.status = "reviewed"
    item.action = "send"
    item.reviewNote = "Looks good, send it"
    item.updatedAt = new Date().toISOString()
    saveBriefingItem(tmpDir, item)

    let reviewed = loadBriefingItem(tmpDir, item.id)
    assert.equal(reviewed.status, "reviewed")
    assert.equal(reviewed.action, "send")

    // Act
    item.status = "acted"
    item.updatedAt = new Date().toISOString()
    saveBriefingItem(tmpDir, item)

    let acted = loadBriefingItem(tmpDir, item.id)
    assert.equal(acted.status, "acted")
  })
})
