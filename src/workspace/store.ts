import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { z } from "zod"
import { PWD_CONFIG_DIR } from "../CliConfig"
import { Draft } from "../draft/schema"

export interface WorkspaceConfig {
  id: string
  name: string
  accounts: string[]
  query: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceExportFile = {
  path: string
  contentBase64: string
  mode: number
}

export type WorkspacePushFile = {
  path: string
  contentBase64?: string
  deleted?: boolean
}

let WORKSPACE_DIRS = ["inbox", "drafts", "corpus"] as const
let SERVER_DIRNAME = ".server"

let DEFAULT_INSTRUCTIONS = `# Agent Instructions

You are an AI assistant managing a message workspace.
You have a filesystem snapshot of the workspace, but you do not have direct
access to platform credentials or unrestricted local messaging tools.

## Workspace Layout

\`\`\`
workspace.json      — read-only workspace metadata
instructions.md     — this file
user-profile.md     — user identity, contacts, preferences
status.md           — working summary maintained by the agent
inbox/              — ingested messages (read-only input)
drafts/             — draft JSON files the agent may create/update/delete
corpus/             — optional derived artifacts for retrieval
\`\`\`

## Operating Model

1. Read messages from \`inbox/\` and update \`status.md\`.
2. Create or revise draft JSON files under \`drafts/\`.
3. Do not assume any local command can safely send or mutate remote state.
4. Privileged actions such as send, mark-read, or archive must go back through
   the msgmon server API.

## Rules

- Never send a message without explicit user approval.
- Treat \`workspace.json\` and \`inbox/\` as read-only.
- Keep \`status.md\` concise and current.
- Prefer editing existing drafts over creating duplicates.
`

let DEFAULT_USER_PROFILE = `# User Profile

Name:
Role:
Organization:

## Key Contacts

## Preferences

- Working hours: 9am-6pm
- Urgent = needs response within 1 hour
- Low priority = newsletters, notifications, FYI-only threads
`

let DEFAULT_STATUS = `# Status

> Last updated: never

## Urgent

_Nothing urgent._

## Action Items

_No pending action items._

## Draft Responses

_No drafts pending review._

## Summary

_No messages processed yet._
`

let WorkspaceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  accounts: z.array(z.string()).min(1),
  query: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

let relativePath = (workspaceId: string, ...parts: string[]) => path.resolve(PWD_CONFIG_DIR, "workspaces", workspaceId, ...parts)

export let workspaceRoot = (workspaceId: string) => relativePath(workspaceId)
export let workspaceServerRoot = (workspaceId: string) => relativePath(workspaceId, SERVER_DIRNAME)
export let workspaceStateRoot = (workspaceId: string) => relativePath(workspaceId, SERVER_DIRNAME, "state")
export let workspaceDraftsRoot = (workspaceId: string) => relativePath(workspaceId, "drafts")

let ensureSafeWorkspaceId = (workspaceId: string) => {
  if (!/^[A-Za-z0-9._-]+$/.test(workspaceId)) {
    throw new Error(`Invalid workspace id "${workspaceId}"`)
  }
  return workspaceId
}

let normalizeWorkspacePath = (workspaceId: string, relPath: string) => {
  let normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "")
  let resolved = path.resolve(workspaceRoot(workspaceId), normalized)
  let relative = path.relative(workspaceRoot(workspaceId), resolved)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid workspace path "${relPath}"`)
  }
  return { normalized: relative.replace(/\\/g, "/"), resolved }
}

let isExportablePath = (relPath: string) => {
  let first = relPath.split("/")[0] ?? ""
  return !first.startsWith(".")
}

let isWritablePath = (relPath: string) =>
  relPath === "status.md"
  || relPath === "instructions.md"
  || relPath === "user-profile.md"
  || relPath.startsWith("drafts/")
  || relPath.startsWith("corpus/")

let validateWorkspaceDraftFile = (relPath: string, content: string) => {
  if (!relPath.startsWith("drafts/") || !relPath.endsWith(".json")) return
  let draft = Draft.parse(JSON.parse(content))
  let expected = `drafts/${draft.id}.json`
  if (relPath !== expected) {
    throw new Error(`Draft file path must match draft id (${expected})`)
  }
}

let readFilesRecursive = (root: string, dir = root): WorkspaceExportFile[] => {
  let entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  let files: WorkspaceExportFile[] = []
  for (let entry of entries) {
    let abs = path.resolve(dir, entry.name)
    let rel = path.relative(root, abs).replace(/\\/g, "/")
    if (!isExportablePath(rel)) continue
    if (entry.isDirectory()) {
      files.push(...readFilesRecursive(root, abs))
      continue
    }
    if (!entry.isFile()) continue
    let stat = fs.statSync(abs)
    files.push({
      path: rel,
      contentBase64: fs.readFileSync(abs).toString("base64"),
      mode: stat.mode & 0o777,
    })
  }
  return files
}

let computeRevision = (files: WorkspaceExportFile[]) => {
  let hash = crypto.createHash("sha256")
  for (let file of files.sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path)
    hash.update("\0")
    hash.update(String(file.mode))
    hash.update("\0")
    hash.update(file.contentBase64)
    hash.update("\0")
  }
  return hash.digest("hex")
}

export let initWorkspace = (
  workspaceId: string,
  options: { name?: string; accounts?: string[]; query?: string } = {},
) => {
  let id = ensureSafeWorkspaceId(workspaceId)
  let root = workspaceRoot(id)

  if (fs.existsSync(root)) {
    let entries = fs.readdirSync(root)
    if (entries.length > 0) {
      throw new Error(`Workspace "${id}" already exists and is not empty`)
    }
  }

  fs.mkdirSync(root, { recursive: true })
  for (let dir of WORKSPACE_DIRS) {
    fs.mkdirSync(path.resolve(root, dir), { recursive: true })
  }
  fs.mkdirSync(workspaceStateRoot(id), { recursive: true })

  let now = new Date().toISOString()
  let config: WorkspaceConfig = {
    id,
    name: options.name ?? id,
    accounts: options.accounts ?? ["default"],
    query: options.query ?? "is:unread",
    createdAt: now,
    updatedAt: now,
  }

  fs.writeFileSync(path.resolve(root, "workspace.json"), JSON.stringify(config, null, 2) + "\n")
  fs.writeFileSync(path.resolve(root, "instructions.md"), DEFAULT_INSTRUCTIONS)
  fs.writeFileSync(path.resolve(root, "user-profile.md"), DEFAULT_USER_PROFILE)
  fs.writeFileSync(path.resolve(root, "status.md"), DEFAULT_STATUS)

  return { path: root, config }
}

export let listWorkspaceIds = () => {
  let root = path.resolve(PWD_CONFIG_DIR, "workspaces")
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

export let loadWorkspaceConfig = (workspaceId: string): WorkspaceConfig => {
  let id = ensureSafeWorkspaceId(workspaceId)
  let configPath = path.resolve(workspaceRoot(id), "workspace.json")
  if (!fs.existsSync(configPath)) {
    throw new Error(`Workspace "${id}" not found`)
  }
  return WorkspaceConfigSchema.parse(JSON.parse(fs.readFileSync(configPath, "utf8")))
}

export let saveWorkspaceConfig = (config: WorkspaceConfig) => {
  let next = { ...config, updatedAt: new Date().toISOString() }
  fs.writeFileSync(path.resolve(workspaceRoot(config.id), "workspace.json"), JSON.stringify(next, null, 2) + "\n")
  return next
}

export let exportWorkspaceSnapshot = (workspaceId: string) => {
  let config = loadWorkspaceConfig(workspaceId)
  let root = workspaceRoot(config.id)
  let files = readFilesRecursive(root).sort((a, b) => a.path.localeCompare(b.path))
  return {
    workspaceId: config.id,
    revision: computeRevision(files),
    config,
    files,
  }
}

export let applyWorkspacePush = (
  workspaceId: string,
  params: { baseRevision: string; files: WorkspacePushFile[] },
) => {
  let current = exportWorkspaceSnapshot(workspaceId)
  if (current.revision !== params.baseRevision) {
    throw new Error(`Workspace revision conflict: expected ${params.baseRevision}, current is ${current.revision}`)
  }

  for (let patch of params.files) {
    let target = normalizeWorkspacePath(workspaceId, patch.path)
    if (!isWritablePath(target.normalized)) {
      throw new Error(`Path "${target.normalized}" is read-only`)
    }

    if (patch.deleted) {
      if (fs.existsSync(target.resolved)) fs.rmSync(target.resolved, { recursive: true, force: true })
      continue
    }

    if (patch.contentBase64 == null) {
      throw new Error(`Missing contentBase64 for "${target.normalized}"`)
    }

    let content = Buffer.from(patch.contentBase64, "base64")
    if (target.normalized.startsWith("drafts/")) {
      validateWorkspaceDraftFile(target.normalized, content.toString("utf8"))
    }

    fs.mkdirSync(path.dirname(target.resolved), { recursive: true })
    fs.writeFileSync(target.resolved, content)
  }

  let nextConfig = saveWorkspaceConfig(loadWorkspaceConfig(workspaceId))
  return {
    ...exportWorkspaceSnapshot(workspaceId),
    config: nextConfig,
  }
}

export let loadWorkspaceDraft = (workspaceId: string, draftId: string) => {
  let filePath = path.resolve(workspaceDraftsRoot(workspaceId), `${draftId}.json`)
  if (!fs.existsSync(filePath)) throw new Error(`Draft "${draftId}" not found in workspace "${workspaceId}"`)
  return Draft.parse(JSON.parse(fs.readFileSync(filePath, "utf8")))
}

export let deleteWorkspaceDraft = (workspaceId: string, draftId: string) => {
  let filePath = path.resolve(workspaceDraftsRoot(workspaceId), `${draftId}.json`)
  if (!fs.existsSync(filePath)) throw new Error(`Draft "${draftId}" not found in workspace "${workspaceId}"`)
  fs.unlinkSync(filePath)
}

export let writeWorkspaceMessage = (workspaceId: string, msgDirName: string, files: Record<string, string | Buffer>) => {
  let root = path.resolve(workspaceRoot(workspaceId), "inbox", msgDirName)
  fs.mkdirSync(root, { recursive: true })
  for (let [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.resolve(root, name), content)
  }
}
