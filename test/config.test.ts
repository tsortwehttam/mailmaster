import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

let tmpDir: string
let prevCwd: string
let cliConfig: typeof import("../src/CliConfig")

before(async () => {
  prevCwd = process.cwd()
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "msgmon-config-test-")))
  fs.symlinkSync(path.join(prevCwd, "node_modules"), path.join(tmpDir, "node_modules"), "dir")
  process.chdir(tmpDir)
  cliConfig = await import("../src/CliConfig")
})

after(() => {
  process.chdir(prevCwd)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("config layout", () => {
  it("uses platform-specific paths for credentials and tokens", () => {
    let localRoot = path.resolve(tmpDir, ".msgmon")
    let gmailCredentials = cliConfig.resolveCredentialsPath("gmail")
    let slackCredentials = cliConfig.resolveCredentialsPath("slack")
    let gmailTokenDir = cliConfig.resolveTokenWriteDir("gmail")
    let slackTokenPath = cliConfig.resolveTokenWritePathForAccount("default", "slack")

    assert.equal(gmailCredentials, path.join(localRoot, "gmail", "credentials.json"))
    assert.equal(slackCredentials, path.join(localRoot, "slack", "credentials.json"))
    assert.equal(gmailTokenDir, path.join(localRoot, "gmail", "tokens"))
    assert.equal(slackTokenPath, path.join(localRoot, "slack", "tokens", "default.json"))
  })

  it("does not fall back to legacy flat token paths", () => {
    let localRoot = path.resolve(tmpDir, ".msgmon")
    let legacyDir = path.join(tmpDir, ".msgmon", "tokens")
    fs.mkdirSync(legacyDir, { recursive: true })
    fs.writeFileSync(path.join(legacyDir, "legacy.json"), "{}\n")

    let tokenDirs = cliConfig.resolveAllTokenDirs("gmail")
    assert.equal(tokenDirs[0], path.join(localRoot, "gmail", "tokens"))
    assert.ok(!tokenDirs.includes(path.join(localRoot, "tokens")))
    assert.throws(() => cliConfig.resolveTokenReadPathForAccount("legacy", "gmail"), /Missing token/)
  })
})
