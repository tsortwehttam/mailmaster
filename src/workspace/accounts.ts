import fs from "node:fs"
import path from "node:path"
import { PWD_CONFIG_DIR, TOKEN_FILE_EXTENSION } from "../CliConfig"

let localPlatformAccounts = (platform: "gmail" | "slack") => {
  let tokenDir = path.resolve(PWD_CONFIG_DIR, platform, "tokens")
  if (!fs.existsSync(tokenDir)) return []
  return fs.readdirSync(tokenDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(TOKEN_FILE_EXTENSION))
    .map(entry => path.basename(entry.name, TOKEN_FILE_EXTENSION))
    .sort((a, b) => a.localeCompare(b))
}

export let inferWorkspaceAccounts = () => {
  let gmailAccounts = localPlatformAccounts("gmail")
  let slackAccounts = localPlatformAccounts("slack").map(account => `slack:${account}`)
  return [...gmailAccounts, ...slackAccounts]
}
