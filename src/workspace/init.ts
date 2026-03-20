import fs from "node:fs"
import path from "node:path"
import type { WorkspaceConfig, AccountConfig } from "./schema"

let DIRS = ["messages", "corpus", "notes", "briefing"] as const

let DEFAULT_INSTRUCTIONS = `# Response Instructions

## Tone & Style
- Professional but friendly
- Concise — prefer short, direct replies
- Match the formality level of the sender

## Priorities
- Urgent requests: flag immediately, draft a response
- Meeting requests: check for conflicts, propose alternatives if needed
- FYI / newsletters: summarize in one line, no draft needed
- Action items: extract clearly, note deadlines

## Draft Rules
- Always include a greeting and sign-off
- Quote or reference the original message when relevant
- If unsure about something, flag it for human review rather than guessing
- Never commit to deadlines or promises without explicit approval
`

export let initWorkspace = (opts: {
  dir: string
  name: string
  accounts: AccountConfig[]
  watchIntervalMs?: number
  markRead?: boolean
}) => {
  let root = path.resolve(opts.dir)
  let msgmonDir = path.resolve(root, ".msgmon")

  // Create directory structure
  for (let sub of DIRS) {
    fs.mkdirSync(path.resolve(root, sub), { recursive: true })
  }
  fs.mkdirSync(path.resolve(msgmonDir, "drafts"), { recursive: true })
  fs.mkdirSync(path.resolve(msgmonDir, "state"), { recursive: true })

  let config: WorkspaceConfig = {
    name: opts.name,
    createdAt: new Date().toISOString(),
    accounts: opts.accounts,
    watchIntervalMs: opts.watchIntervalMs ?? 30000,
    markRead: opts.markRead ?? false,
    maxResults: 100,
    saveAttachments: true,
    instructionsFile: "instructions.md",
  }

  let configPath = path.resolve(root, "workspace.json")
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")

  // Create default instructions file if it doesn't exist
  let instructionsPath = path.resolve(root, "instructions.md")
  if (!fs.existsSync(instructionsPath)) {
    fs.writeFileSync(instructionsPath, DEFAULT_INSTRUCTIONS)
  }

  // Create .gitignore for the workspace
  let gitignorePath = path.resolve(root, ".gitignore")
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(
      gitignorePath,
      [
        "# msgmon workspace",
        ".msgmon/tokens/",
        ".msgmon/gmail/tokens/",
        ".msgmon/slack/tokens/",
        ".msgmon/credentials.json",
        ".msgmon/gmail/credentials.json",
        ".msgmon/slack/credentials.json",
        "",
      ].join("\n"),
    )
  }

  return { root, configPath, config }
}

export let loadWorkspaceConfig = (dir: string): WorkspaceConfig => {
  let configPath = path.resolve(dir, "workspace.json")
  if (!fs.existsSync(configPath)) {
    throw new Error(`No workspace.json found in ${dir}. Run "msgmon workspace init" first.`)
  }
  let raw = JSON.parse(fs.readFileSync(configPath, "utf8"))
  return raw as WorkspaceConfig
}
