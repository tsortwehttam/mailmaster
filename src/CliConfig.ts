import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export let DEFAULT_ACCOUNT = "default"

export let LOCAL_CREDENTIALS_PATH = path.resolve("credentials.json")
export let LOCAL_TOKENS_DIR = path.resolve("tokens")
export let GLOBAL_CONFIG_DIR = path.resolve(os.homedir(), ".mailmaster")
export let GLOBAL_CREDENTIALS_PATH = path.resolve(GLOBAL_CONFIG_DIR, "credentials.json")
export let GLOBAL_TOKENS_DIR = path.resolve(GLOBAL_CONFIG_DIR, "tokens")
export let TOKEN_FILE_EXTENSION = ".json"

export let GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
]

export let resolveCredentialsPath = () => {
  if (fs.existsSync(LOCAL_CREDENTIALS_PATH)) return LOCAL_CREDENTIALS_PATH
  return GLOBAL_CREDENTIALS_PATH
}

export let resolveTokenReadPathsForAccount = (account: string) => [
  path.resolve(LOCAL_TOKENS_DIR, `${account}${TOKEN_FILE_EXTENSION}`),
  path.resolve(GLOBAL_TOKENS_DIR, `${account}${TOKEN_FILE_EXTENSION}`),
]

export let resolveTokenReadPathForAccount = (account: string) => {
  let candidates = resolveTokenReadPathsForAccount(account)
  let existing = candidates.find(x => fs.existsSync(x))
  if (!existing) {
    throw new Error(`Missing token for account "${account}". Checked: ${candidates.join(", ")}`)
  }
  return existing
}

export let resolveTokenWriteDir = () => {
  if (fs.existsSync(LOCAL_CREDENTIALS_PATH) || fs.existsSync(LOCAL_TOKENS_DIR)) return LOCAL_TOKENS_DIR
  return GLOBAL_TOKENS_DIR
}

export let resolveTokenWritePathForAccount = (account: string) =>
  path.resolve(resolveTokenWriteDir(), `${account}${TOKEN_FILE_EXTENSION}`)

export let resolveAllTokenDirs = () => [LOCAL_TOKENS_DIR, GLOBAL_TOKENS_DIR]
