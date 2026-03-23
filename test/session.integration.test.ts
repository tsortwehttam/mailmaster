import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

let tmpDir: string
let prevCwd: string
let serverModule: typeof import("../src/serve/server")
let sessionClient: typeof import("../src/session/client")
let cliConfig: typeof import("../src/CliConfig")

before(async () => {
  prevCwd = process.cwd()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgmon-session-integration-"))
  fs.symlinkSync(path.join(prevCwd, "node_modules"), path.join(tmpDir, "node_modules"), "dir")
  process.chdir(tmpDir)
  cliConfig = await import("../src/CliConfig")
  serverModule = await import("../src/serve/server")
  sessionClient = await import("../src/session/client")
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
      assert.ok(fs.existsSync(path.join(clientDir, "status.md")))
      assert.ok(fs.existsSync(path.join(clientDir, "AGENTS.md")))
      // Server connection info should be written into AGENTS.md
      let agentsMd = fs.readFileSync(path.join(clientDir, "AGENTS.md"), "utf8")
      assert.match(agentsMd, /## Server/)
      assert.match(agentsMd, new RegExp(serverUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

      fs.writeFileSync(path.join(clientDir, "status.md"), "# Status\n\nLocal update.\n")

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
      let statusFile = exportedPayload.data.files.find(file => file.path === "status.md")
      assert.ok(statusFile)
      assert.match(Buffer.from(statusFile!.contentBase64, "base64").toString("utf8"), /Local update/)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    }
  })
})
