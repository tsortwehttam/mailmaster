import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Platform } from "./types"

export let DEFAULT_ACCOUNT = "default"

export let APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export let LOCAL_CONFIG_DIRNAME = ".messagemon"
export let PWD_CONFIG_DIR = path.resolve(process.cwd(), LOCAL_CONFIG_DIRNAME)
export let APP_CONFIG_DIR = path.resolve(APP_DIR, LOCAL_CONFIG_DIRNAME)
export let GLOBAL_CONFIG_DIR = path.resolve(os.homedir(), ".messagemon")
export let TOKEN_FILE_EXTENSION = ".json"

// ---------------------------------------------------------------------------
// Config directory resolution (pwd → app-install → home)
// ---------------------------------------------------------------------------

let dedupe = (paths: string[]) => Array.from(new Set(paths.map(x => path.resolve(x))))

/** Returns the three-tier config directories (pwd, app-install, home) */
export let resolveConfigDirs = () => dedupe([PWD_CONFIG_DIR, APP_CONFIG_DIR, GLOBAL_CONFIG_DIR])

/** Platform-specific credentials file (e.g. .messagemon/mail/credentials.json) */
let platformCredentialsPaths = (platform: Platform) =>
  resolveConfigDirs().map(dir => path.resolve(dir, platform, "credentials.json"))

/** Platform-specific token directory (e.g. .messagemon/mail/tokens/) */
let platformTokenDirs = (platform: Platform) =>
  resolveConfigDirs().map(dir => path.resolve(dir, platform, "tokens"))

// ---------------------------------------------------------------------------
// Flat-layout paths (.messagemon/credentials.json, .messagemon/tokens/)
// Used when no platform arg is passed — the default for all current callers.
// ---------------------------------------------------------------------------

let flatCredentialsPaths = () =>
  resolveConfigDirs().map(dir => path.resolve(dir, "credentials.json"))

let flatTokenDirs = () =>
  resolveConfigDirs().map(dir => path.resolve(dir, "tokens"))

export let GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
]

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

export let resolveCredentialsPaths = (platform?: Platform) => {
  if (platform) return dedupe(platformCredentialsPaths(platform))
  return dedupe(flatCredentialsPaths())
}

export let resolveCredentialsPath = (platform?: Platform) => {
  let candidates = resolveCredentialsPaths(platform)
  // Also check flat-layout paths when using platform-specific resolution
  if (platform) {
    candidates = dedupe([...candidates, ...flatCredentialsPaths()])
  }
  return candidates.find(x => fs.existsSync(x)) ?? candidates[0]
}

export let resolveAllTokenDirs = (platform?: Platform) => {
  if (platform) {
    return dedupe([...platformTokenDirs(platform), ...flatTokenDirs()])
  }
  return dedupe(flatTokenDirs())
}

export let resolveTokenReadPathsForAccount = (account: string, platform?: Platform) =>
  resolveAllTokenDirs(platform).map(dir => path.resolve(dir, `${account}${TOKEN_FILE_EXTENSION}`))

export let resolveTokenReadPathForAccount = (account: string, platform?: Platform) => {
  let candidates = resolveTokenReadPathsForAccount(account, platform)
  let existing = candidates.find(x => fs.existsSync(x))
  if (!existing) {
    throw new Error(`Missing token for account "${account}". Checked: ${candidates.join(", ")}`)
  }
  return existing
}

export let resolveTokenWriteDir = (platform?: Platform) => {
  if (platform) return path.resolve(PWD_CONFIG_DIR, platform, "tokens")
  return path.resolve(PWD_CONFIG_DIR, "tokens")
}

export let resolveTokenWritePathForAccount = (account: string, platform?: Platform) =>
  path.resolve(resolveTokenWriteDir(platform), `${account}${TOKEN_FILE_EXTENSION}`)
