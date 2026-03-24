import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import http from "node:http"
import { spawnSync } from "node:child_process"

let tmpDir: string
let prevCwd: string
let serverModule: typeof import("../src/serve/server")
let sessionClient: typeof import("../src/session/client")
let cliConfig: typeof import("../src/CliConfig")
let workspaceStore: typeof import("../src/workspace/store")

before(async () => {
  prevCwd = process.cwd()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgmon-session-integration-"))
  fs.symlinkSync(path.join(prevCwd, "node_modules"), path.join(tmpDir, "node_modules"), "dir")
  process.chdir(tmpDir)
  cliConfig = await import("../src/CliConfig")
  serverModule = await import("../src/serve/server")
  sessionClient = await import("../src/session/client")
  workspaceStore = await import("../src/workspace/store")
})

after(() => {
  process.chdir(prevCwd)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("session sync integration", () => {
  it("exposes discovery endpoints and syncs a local mirror against serve", async () => {
    let serverDir = path.join(tmpDir, "server-workspace")
    let clientDir = path.join(tmpDir, "client-mirror")
    fs.mkdirSync(serverDir, { recursive: true })
    cliConfig.setWorkspaceDir(serverDir)

    let server = serverModule.createServer({
      host: "127.0.0.1",
      port: 0,
      tokens: [
        { token: "reader", capabilities: ["read", "workspace_read"] },
        { token: "writer", capabilities: ["workspace_write"] },
      ],
      verbose: false,
      gmailAllowTo: [],
      slackAllowChannels: [],
      sendRateLimit: 0,
    })

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => resolve())
    })

    try {
      let address = server.address()
      assert.ok(address && typeof address === "object")
      let serverUrl = `http://127.0.0.1:${address.port}`

      let bootstrap = await fetch(`${serverUrl}/api/workspace/bootstrap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": "writer",
        },
        body: JSON.stringify({ accounts: ["default"], query: "is:unread" }),
      })
      assert.equal(bootstrap.status, 200)

      let llms = await fetch(`${serverUrl}/.well-known/llms.txt`)
      assert.equal(llms.status, 200)
      assert.match(await llms.text(), /\/api\/agent\/manifest/)

      let manifestResponse = await fetch(`${serverUrl}/api/agent/manifest`, {
        headers: { "X-Auth-Token": "reader" },
      })
      assert.equal(manifestResponse.status, 200)
      let manifestPayload = await manifestResponse.json() as { ok: boolean; data: { auth: { tokenCapabilities: string[] } } }
      assert.deepEqual(manifestPayload.data.auth.tokenCapabilities, ["read", "workspace_read"])

      let pulled = await sessionClient.syncPull({
        serverUrl,
        token: "reader",
        dir: clientDir,
      })
      assert.equal(pulled.workspaceId, "default")
      assert.ok(fs.existsSync(path.join(clientDir, "state.jsonl")))
      assert.ok(fs.existsSync(path.join(clientDir, "AGENTS.md")))
      // Server connection info should be written into AGENTS.md
      let agentsMd = fs.readFileSync(path.join(clientDir, "AGENTS.md"), "utf8")
      assert.match(agentsMd, /## Server/)
      assert.match(agentsMd, new RegExp(serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

      let stateEntry = JSON.stringify({ id: "s1", type: "summary", status: "current", data: { text: "Local update" }, createdAt: "2026-03-20T00:00:00Z", updatedAt: "2026-03-20T00:00:00Z" }) + "\n"
      fs.writeFileSync(path.join(clientDir, "state.jsonl"), stateEntry)

      let pushed = await sessionClient.syncPush({
        serverUrl,
        token: "writer",
        dir: clientDir,
      })
      assert.equal(pushed.pushed, true)

      let exported = await fetch(`${serverUrl}/api/workspace/export`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": "reader",
        },
        body: JSON.stringify({}),
      })
      assert.equal(exported.status, 200)
      let exportedPayload = await exported.json() as { ok: boolean; data: { files: Array<{ path: string; contentBase64: string }> } }
      let stateFile = exportedPayload.data.files.find(file => file.path === "state.jsonl")
      assert.ok(stateFile)
      assert.match(Buffer.from(stateFile!.contentBase64, "base64").toString("utf8"), /Local update/)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    }
  })

  it("syncs a client mirror against generic pull and push URLs", async () => {
    let sourceDir = path.join(tmpDir, "generic-source")
    let clientDir = path.join(tmpDir, "generic-client")
    fs.mkdirSync(sourceDir, { recursive: true })
    cliConfig.setWorkspaceDir(sourceDir)
    workspaceStore.initWorkspace("default", {
      accounts: ["default"],
      query: "is:unread",
    })
    let snapshot = workspaceStore.exportWorkspaceSnapshot("default")

    let pushedBody = ""
    let pushedToken = ""
    let server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/workspace.json") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(snapshot))
        return
      }
      if (req.method === "POST" && req.url === "/workspace.push") {
        pushedToken = String(req.headers["x-auth-token"] ?? "")
        req.setEncoding("utf8")
        req.on("data", chunk => { pushedBody += chunk })
        req.on("end", () => {
          res.writeHead(204)
          res.end()
        })
        return
      }
      res.writeHead(404)
      res.end()
    })

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => resolve())
    })

    try {
      let address = server.address()
      assert.ok(address && typeof address === "object")
      let baseUrl = `http://127.0.0.1:${address.port}`

      let pulled = await sessionClient.syncPull({
        pullUrl: `${baseUrl}/workspace.json`,
        token: "generic-token",
        dir: clientDir,
      })
      assert.equal(pulled.workspaceId, "default")
      assert.ok(fs.existsSync(path.join(clientDir, "workspace.json")))
      assert.ok(fs.existsSync(path.join(clientDir, "AGENTS.md")))

      let stateEntry = JSON.stringify({ id: "s2", type: "summary", status: "current", data: { text: "Generic update" }, createdAt: "2026-03-20T00:00:00Z", updatedAt: "2026-03-20T00:00:00Z" }) + "\n"
      fs.writeFileSync(path.join(clientDir, "state.jsonl"), stateEntry)

      let pushed = await sessionClient.syncPush({
        pushUrl: `${baseUrl}/workspace.push`,
        token: "generic-token",
        dir: clientDir,
      })
      assert.equal(pushed.pushed, true)
      assert.equal(pushedToken, "generic-token")
      assert.ok(pushedBody.length > 0)

      let payload = JSON.parse(pushedBody) as {
        workspaceId: string
        files: Array<{ path: string; contentBase64: string }>
      }
      assert.equal(payload.workspaceId, "default")
      let stateFile = payload.files.find(file => file.path === "state.jsonl")
      assert.ok(stateFile)
      assert.match(Buffer.from(stateFile!.contentBase64, "base64").toString("utf8"), /Generic update/)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    }
  })

  it("pulls a workspace archive from a generic tar.gz URL", async () => {
    let sourceDir = path.join(tmpDir, "archive-source")
    let clientDir = path.join(tmpDir, "archive-client")
    let archivePath = path.join(tmpDir, "workspace.tgz")
    fs.mkdirSync(sourceDir, { recursive: true })
    cliConfig.setWorkspaceDir(sourceDir)
    workspaceStore.initWorkspace("default", {
      accounts: ["default"],
      query: "is:unread",
    })
    fs.writeFileSync(path.join(sourceDir, "state.jsonl"), JSON.stringify({
      id: "s3",
      type: "summary",
      status: "current",
      data: { text: "Archive payload" },
      createdAt: "2026-03-20T00:00:00Z",
      updatedAt: "2026-03-20T00:00:00Z",
    }) + "\n")

    let tar = spawnSync("tar", ["-czf", archivePath, "-C", sourceDir, "."])
    assert.equal(tar.status, 0, tar.stderr?.toString() ?? tar.stdout?.toString())

    let server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/workspace.tgz") {
        res.writeHead(200, { "Content-Type": "application/gzip" })
        res.end(fs.readFileSync(archivePath))
        return
      }
      res.writeHead(404)
      res.end()
    })

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => resolve())
    })

    try {
      let address = server.address()
      assert.ok(address && typeof address === "object")
      let baseUrl = `http://127.0.0.1:${address.port}`

      let pulled = await sessionClient.syncPull({
        pullUrl: `${baseUrl}/workspace.tgz`,
        dir: clientDir,
      })

      assert.equal(pulled.workspaceId, "default")
      assert.ok(fs.existsSync(path.join(clientDir, "workspace.json")))
      assert.match(fs.readFileSync(path.join(clientDir, "state.jsonl"), "utf8"), /Archive payload/)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    }
  })
})
