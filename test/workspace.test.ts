import { before, after, describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

let tmpDir: string
let prevCwd: string
let workspaceStore: typeof import("../src/workspace/store")
let workspaceApi: typeof import("../src/workspace/api")

let makeDraft = (id: string) => ({
  id,
  platform: "gmail" as const,
  account: "default",
  to: "allowed@example.com",
  cc: [],
  bcc: [],
  subject: "Re: Test",
  body: "Draft body",
  attachments: [],
  createdAt: "2026-03-20T00:00:00.000Z",
  updatedAt: "2026-03-20T00:00:00.000Z",
})

before(async () => {
  prevCwd = process.cwd()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgmon-workspace-test-"))
  fs.symlinkSync(path.join(prevCwd, "node_modules"), path.join(tmpDir, "node_modules"), "dir")
  process.chdir(tmpDir)
  workspaceStore = await import("../src/workspace/store")
  workspaceApi = await import("../src/workspace/api")
})

after(() => {
  process.chdir(prevCwd)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("workspace store", () => {
  it("creates a server-managed workspace and exports only agent-safe files", () => {
    let result = workspaceStore.initWorkspace("alpha", {
      name: "Alpha Workspace",
      accounts: ["default", "slack:team"],
      query: "is:unread",
    })

    assert.equal(result.config.id, "alpha")
    assert.ok(fs.existsSync(path.join(result.path, "workspace.json")))
    assert.ok(fs.existsSync(path.join(result.path, "inbox")))
    assert.ok(fs.existsSync(path.join(result.path, ".server", "state")))

    fs.writeFileSync(path.join(result.path, ".server", "secret.txt"), "do not export")

    let snapshot = workspaceStore.exportWorkspaceSnapshot("alpha")
    let paths = snapshot.files.map(file => file.path)
    assert.ok(paths.includes("workspace.json"))
    assert.ok(paths.includes("status.md"))
    assert.ok(!paths.some(file => file.startsWith(".server/")))
  })

  it("applies bounded pushes, validates drafts, and detects stale revisions", () => {
    workspaceStore.initWorkspace("beta")
    let initial = workspaceStore.exportWorkspaceSnapshot("beta")
    let updatedStatus = Buffer.from("# Status\n\nUpdated\n", "utf8").toString("base64")
    let draft = Buffer.from(JSON.stringify(makeDraft("draft-1"), null, 2) + "\n", "utf8").toString("base64")

    let pushed = workspaceStore.applyWorkspacePush("beta", {
      baseRevision: initial.revision,
      files: [
        { path: "status.md", contentBase64: updatedStatus },
        { path: "drafts/draft-1.json", contentBase64: draft },
      ],
    })

    assert.notEqual(pushed.revision, initial.revision)
    assert.equal(workspaceStore.loadWorkspaceDraft("beta", "draft-1").id, "draft-1")

    assert.throws(
      () => workspaceStore.applyWorkspacePush("beta", {
        baseRevision: initial.revision,
        files: [{ path: "status.md", contentBase64: updatedStatus }],
      }),
      /revision conflict/,
    )

    assert.throws(
      () => workspaceStore.applyWorkspacePush("beta", {
        baseRevision: pushed.revision,
        files: [{ path: "workspace.json", contentBase64: updatedStatus }],
      }),
      /read-only/,
    )
  })
})

describe("workspace API handlers", () => {
  it("supports export, push, and actions against the server-owned model", async () => {
    workspaceStore.initWorkspace("gamma")
    let handlers = workspaceApi.createWorkspaceHandlers({
      gmailAllowTo: ["allowed@example.com"],
      slackAllowChannels: [],
      sendRateLimit: 0,
    })

    let exported = await handlers["POST /api/workspace/export"]({ workspaceId: "gamma" })
    assert.equal(exported.status, 200)
    let revision = (exported.data as { revision: string }).revision

    let push = await handlers["POST /api/workspace/push"]({
      workspaceId: "gamma",
      baseRevision: revision,
      files: [{
        path: "drafts/draft-2.json",
        contentBase64: Buffer.from(JSON.stringify(makeDraft("draft-2"), null, 2) + "\n", "utf8").toString("base64"),
      }],
    })
    assert.equal(push.status, 200)
    assert.equal(workspaceStore.loadWorkspaceDraft("gamma", "draft-2").id, "draft-2")

    let action = await handlers["POST /api/workspace/actions"]({
      workspaceId: "gamma",
      actions: [{ type: "draft.delete", draftId: "draft-2" }],
    })
    assert.equal(action.status, 200)
    assert.throws(() => workspaceStore.loadWorkspaceDraft("gamma", "draft-2"), /not found/)
  })
})
