import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { initWorkspace, loadWorkspaceConfig } from "../src/workspace/init"

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgmon-ws-test-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("initWorkspace", () => {
  it("creates directory structure and config", () => {
    let result = initWorkspace({
      dir: tmpDir,
      name: "test-workspace",
      accounts: [{ name: "work", platform: "gmail", query: "is:unread" }],
    })

    assert.equal(result.config.name, "test-workspace")
    assert.ok(fs.existsSync(path.resolve(tmpDir, "workspace.json")))
    assert.ok(fs.existsSync(path.resolve(tmpDir, "messages")))
    assert.ok(fs.existsSync(path.resolve(tmpDir, "corpus")))
    assert.ok(fs.existsSync(path.resolve(tmpDir, "notes")))
    assert.ok(fs.existsSync(path.resolve(tmpDir, "briefing")))
    assert.ok(fs.existsSync(path.resolve(tmpDir, ".msgmon", "drafts")))
    assert.ok(fs.existsSync(path.resolve(tmpDir, ".msgmon", "state")))
    assert.ok(fs.existsSync(path.resolve(tmpDir, "instructions.md")))
    assert.ok(fs.existsSync(path.resolve(tmpDir, ".gitignore")))
  })

  it("writes valid workspace.json", () => {
    initWorkspace({
      dir: tmpDir,
      name: "my-inbox",
      accounts: [
        { name: "work", platform: "gmail", query: "is:unread" },
        { name: "team", platform: "slack", query: "is:unread" },
      ],
      watchIntervalMs: 60000,
      markRead: true,
    })

    let config = JSON.parse(fs.readFileSync(path.resolve(tmpDir, "workspace.json"), "utf8"))
    assert.equal(config.name, "my-inbox")
    assert.equal(config.accounts.length, 2)
    assert.equal(config.accounts[0].platform, "gmail")
    assert.equal(config.accounts[1].platform, "slack")
    assert.equal(config.watchIntervalMs, 60000)
    assert.equal(config.markRead, true)
  })

  it("does not overwrite existing instructions.md", () => {
    let instructionsPath = path.resolve(tmpDir, "instructions.md")
    fs.writeFileSync(instructionsPath, "my custom instructions")

    initWorkspace({
      dir: tmpDir,
      name: "test",
      accounts: [{ name: "default", platform: "gmail", query: "is:unread" }],
    })

    assert.equal(fs.readFileSync(instructionsPath, "utf8"), "my custom instructions")
  })
})

describe("loadWorkspaceConfig", () => {
  it("loads a valid workspace config", () => {
    initWorkspace({
      dir: tmpDir,
      name: "loadable",
      accounts: [{ name: "x", platform: "gmail", query: "is:unread" }],
    })

    let config = loadWorkspaceConfig(tmpDir)
    assert.equal(config.name, "loadable")
    assert.equal(config.accounts.length, 1)
  })

  it("throws when no workspace.json exists", () => {
    assert.throws(() => loadWorkspaceConfig(tmpDir), /No workspace\.json/)
  })
})
