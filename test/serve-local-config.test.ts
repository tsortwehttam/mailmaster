import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

let tmpDir: string
let prevCwd: string
let localConfig: typeof import("../src/serve/localConfig")
let sessionClient: typeof import("../src/session/client")

before(async () => {
  prevCwd = process.cwd()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msgmon-serve-local-config-"))
  fs.symlinkSync(path.join(prevCwd, "node_modules"), path.join(tmpDir, "node_modules"), "dir")
  process.chdir(tmpDir)
  localConfig = await import("../src/serve/localConfig")
  sessionClient = await import("../src/session/client")
})

after(() => {
  process.chdir(prevCwd)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("serve local config", () => {
  it("saves and loads local server connection details", () => {
    let saved = localConfig.saveServeLocalConfig({
      serverUrl: "http://127.0.0.1:4040",
      token: "local-secret",
    })

    assert.equal(saved.serverUrl, "http://127.0.0.1:4040")
    assert.equal(saved.token, "local-secret")
    assert.equal(localConfig.loadServeLocalConfig()!.token, "local-secret")
    assert.ok(fs.existsSync(localConfig.serveLocalConfigPath()))
  })

  it("resolves session connection from local config when flags are omitted", () => {
    localConfig.saveServeLocalConfig({
      serverUrl: "http://127.0.0.1:4041",
      token: "local-token",
    })

    assert.deepEqual(
      sessionClient.resolveSessionConnection({}),
      { serverUrl: "http://127.0.0.1:4041", token: "local-token" },
    )
  })

  it("prefers explicit flags over local config", () => {
    localConfig.saveServeLocalConfig({
      serverUrl: "http://127.0.0.1:4041",
      token: "local-token",
    })

    assert.deepEqual(
      sessionClient.resolveSessionConnection({
        serverUrl: "http://127.0.0.1:5000",
        token: "override-token",
      }),
      { serverUrl: "http://127.0.0.1:5000", token: "override-token" },
    )
  })

  it("generates secure random tokens", () => {
    let a = localConfig.generateServeToken()
    let b = localConfig.generateServeToken()
    assert.notEqual(a, b)
    assert.ok(a.length >= 32)
  })
})
