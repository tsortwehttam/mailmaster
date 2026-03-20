import fs from "node:fs"
import path from "node:path"

export interface WorkspaceConfig {
  name: string
  accounts: string[]
  query: string
  watchIntervalMs: number
  onMessage?: string
  createdAt: string
}

let WORKSPACE_DIRS = ["inbox", "drafts", "corpus"] as const

let DEFAULT_INSTRUCTIONS = `# Agent Instructions

You are an AI assistant managing a message inbox on behalf of the user.
Read \`user-profile.md\` for the user's identity, contacts, and preferences.

## Workspace Layout

\`\`\`
workspace.json      — config (accounts, query, poll interval, hook)
instructions.md     — this file (your operating instructions)
user-profile.md     — user identity, contacts, preferences
status.md           — you maintain this: summaries, action items, drafts
on-message.sh       — hook that runs when new messages arrive
inbox/              — ingested messages (one directory per message)
  <msg-dir>/
    unified.json    — structured message data
    body.txt        — plain text body
    body.html       — HTML body (if available)
    headers.json    — email headers (Gmail only)
    attachments/    — downloaded attachments (if enabled)
drafts/             — pre-composed draft responses (managed via msgmon draft)
corpus/             — LLM-ready chunks/threads (built via msgmon corpus)
\`\`\`

## Responsibilities

1. **Process incoming messages** — when invoked for a new message, read
   \`$MSGMON_MSG_DIR/unified.json\` (or \`body.txt\` for the plain text).
   Cross-reference with existing messages in \`inbox/\` for thread context.
2. **Maintain status.md** — keep it up to date with:
   - Urgent items at the top
   - Action items and decisions needed
   - Index of draft responses pending review
   - Summary of recent activity
3. **Pre-compose drafts** — for messages that need a response, create drafts:
   \`\`\`bash
   # Gmail reply
   msgmon draft compose --platform=gmail \\
     --to=sender@example.com \\
     --subject="Re: Original Subject" \\
     --body="Draft response text" \\
     --thread-id=<threadId from unified.json> \\
     --in-reply-to=<messageId> \\
     --label="auto-draft"

   # Slack reply
   msgmon draft compose --platform=slack \\
     --channel=#channel-name \\
     --text="Draft response text" \\
     --thread-ts=<threadTs from unified.json> \\
     --label="auto-draft"
   \`\`\`
4. **Update as context changes** — when new messages make earlier items moot,
   remove or update the corresponding notes and drafts.
   \`\`\`bash
   msgmon draft delete <draft-id>      # remove obsolete draft
   msgmon draft edit <draft-id> --body="Updated text"  # revise
   \`\`\`

## Available Commands

\`\`\`bash
# List all drafts you've composed
msgmon draft list --format=text

# Show a specific draft
msgmon draft show <id-or-prefix>

# Edit a draft
msgmon draft edit <id> --body="new text" --subject="new subject"

# Send a draft (only during briefing, with user approval)
msgmon draft send <id> --yes

# Delete a draft
msgmon draft delete <id>

# Search for more context (Gmail)
msgmon gmail search "from:sender@example.com newer_than:7d"

# Get full thread for context
msgmon gmail thread <threadId>

# Build corpus for retrieval
msgmon corpus --from=./inbox --out-dir=./corpus
\`\`\`

## Tone & Style

- Professional but concise
- Match the formality level of the sender
- Default to brevity — say what needs to be said, nothing more

## Briefing Protocol

When the user says "brief me":
1. Read status.md for the current state
2. Walk through each section: urgent first, then action items, then drafts
3. For each draft, present it and accept one of:
   - **send** — \`msgmon draft send <id> --yes\`
   - **edit** — take user's edits, run \`msgmon draft edit <id> --body="..."\`, confirm
   - **drop** — \`msgmon draft delete <id>\`, remove from status.md
   - **wait** — leave as-is for next briefing
4. After processing all items, update status.md to reflect decisions made

## Rules

- Never send a message without explicit user approval
- Flag anything urgent at the top of status.md
- Group related messages by thread/topic
- Label auto-composed drafts with \`--label="auto-draft"\` so they're distinguishable
- When unsure about priority or tone, note it in status.md for the user to decide
`

let DEFAULT_USER_PROFILE = `# User Profile

<!-- Fill in your details so the agent can personalize responses -->

Name:
Role:
Organization:

## Key Contacts

<!-- List people the agent should recognize and how to address them -->
<!-- - Jane Doe (jane@example.com) — manager, address formally -->

## Preferences

<!-- Response preferences, working hours, priority rules, etc. -->
- Working hours: 9am–6pm
- Urgent = needs response within 1 hour
- Low priority = newsletters, notifications, FYI-only threads
`

let DEFAULT_STATUS = `# Status

> This file is maintained by the agent. Last updated: never

## Urgent

_Nothing urgent._

## Action Items

_No pending action items._

## Draft Responses

_No drafts pending review._

## Summary

_No messages processed yet._
`

let DEFAULT_ON_MESSAGE = `#!/usr/bin/env bash
# on-message.sh — called by "msgmon workspace watch" for each new message.
#
# Environment variables available:
#   MSGMON_WORKSPACE  — absolute path to the workspace root
#   MSGMON_ID         — message ID
#   MSGMON_PLATFORM   — gmail, slack, etc.
#   MSGMON_TIMESTAMP  — ISO-8601 timestamp
#   MSGMON_SUBJECT    — subject line (email) or synthesized
#   MSGMON_FROM       — sender address
#   MSGMON_THREAD_ID  — thread/conversation ID
#   MSGMON_JSON       — full UnifiedMessage as JSON
#   MSGMON_MSG_DIR    — directory where the message was saved (inbox/<dir>)
#
# Replace the example below with your agent CLI invocation.

set -euo pipefail

echo "[on-message] New message from $MSGMON_FROM: $MSGMON_SUBJECT" >&2

# ── Example: Claude Code agent ──────────────────────────────────────
# claude --print \\
#   "You are an inbox management agent. Read the instructions at
#    $MSGMON_WORKSPACE/instructions.md and the user profile at
#    $MSGMON_WORKSPACE/user-profile.md.
#
#    A new message just arrived. Process it:
#    - Message file: $MSGMON_MSG_DIR/unified.json
#    - Inbox: $MSGMON_WORKSPACE/inbox/
#    - Status file to update: $MSGMON_WORKSPACE/status.md
#
#    Read the message and existing status, then:
#    1. Update status.md with a summary of this message
#    2. If it needs a reply, compose a draft via msgmon draft compose
#    3. If it makes any existing action items moot, remove them"

# ── Example: custom agent script ────────────────────────────────────
# my-agent process \\
#   --workspace "$MSGMON_WORKSPACE" \\
#   --message "$MSGMON_MSG_DIR/unified.json" \\
#   --instructions "$MSGMON_WORKSPACE/instructions.md" \\
#   --status "$MSGMON_WORKSPACE/status.md"
`

export let initWorkspace = (targetDir: string, options: { name?: string; accounts?: string[]; query?: string } = {}) => {
  let resolved = path.resolve(targetDir)

  if (fs.existsSync(resolved)) {
    let entries = fs.readdirSync(resolved)
    if (entries.length > 0) {
      throw new Error(`Directory "${resolved}" already exists and is not empty`)
    }
  }

  fs.mkdirSync(resolved, { recursive: true })

  for (let dir of WORKSPACE_DIRS) {
    fs.mkdirSync(path.join(resolved, dir), { recursive: true })
  }

  let config: WorkspaceConfig = {
    name: options.name ?? path.basename(resolved),
    accounts: options.accounts ?? ["default"],
    query: options.query ?? "is:unread",
    watchIntervalMs: 5000,
    onMessage: "./on-message.sh",
    createdAt: new Date().toISOString(),
  }

  fs.writeFileSync(path.join(resolved, "workspace.json"), JSON.stringify(config, null, 2) + "\n")
  fs.writeFileSync(path.join(resolved, "instructions.md"), DEFAULT_INSTRUCTIONS)
  fs.writeFileSync(path.join(resolved, "user-profile.md"), DEFAULT_USER_PROFILE)
  fs.writeFileSync(path.join(resolved, "status.md"), DEFAULT_STATUS)

  let hookPath = path.join(resolved, "on-message.sh")
  fs.writeFileSync(hookPath, DEFAULT_ON_MESSAGE)
  fs.chmodSync(hookPath, 0o755)

  return { path: resolved, config }
}

export let loadWorkspaceConfig = (workspaceDir: string): WorkspaceConfig => {
  let configPath = path.join(path.resolve(workspaceDir), "workspace.json")
  if (!fs.existsSync(configPath)) {
    throw new Error(`Not a workspace: ${configPath} not found`)
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"))
}
