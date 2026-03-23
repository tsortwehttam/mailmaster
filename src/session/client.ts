import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { currentWorkspaceDir } from "../CliConfig"
import { DEFAULT_WORKSPACE_ID } from "../defaults"
import { DEFAULT_SERVER_URL, loadServeLocalConfig } from "../serve/localConfig"
import { defaultAgentInstructions } from "../workspace/store"

export type WorkspaceExportFile = {
  path: string
  contentBase64: string
  mode: number
}

export type WorkspaceSnapshot = {
  workspaceId: string
  revision: string
  config: {
    id: string
    name: string
    accounts: string[]
    query: string
    createdAt: string
    updatedAt: string
  }
  files: WorkspaceExportFile[]
}

export type AgentManifest = {
  name: string
  version: string
  protocolVersion: string
  recommendedPollingIntervalMs: number
  auth: {
    header: string
    tokenCapabilities: string[]
  }
}

type WorkspacePushFile =
  | { path: string; contentBase64: string }
  | { path: string; deleted: true }

let normalizeServerUrl = (serverUrl: string) => serverUrl.replace(/\/+$/, "")

export let defaultSessionDir = () => currentWorkspaceDir()

export let resolveSessionConnection = (params: { serverUrl?: string; token?: string }) => {
  let localConfig = loadServeLocalConfig()
  let serverUrl = normalizeServerUrl(params.serverUrl ?? localConfig?.serverUrl ?? DEFAULT_SERVER_URL)
  let token = params.token ?? localConfig?.token
  if (!token) {
    throw new Error("No token provided and none found in ./.msgmon/serve.json")
  }
  return { serverUrl, token }
}

let writablePath = (relPath: string) =>
  relPath === "status.md"
  || relPath === "AGENTS.md"
  || relPath.startsWith("drafts/")

let exportablePath = (relPath: string) => !(relPath.split("/")[0] ?? "").startsWith(".")

let request = async <T>(params: {
  serverUrl: string
  token?: string
  route: string
  method?: "GET" | "POST"
  body?: unknown
  responseType?: "json" | "text"
}): Promise<T> => {
  let headers: Record<string, string> = {}
  if (params.token) headers["X-Auth-Token"] = params.token
  if (params.body != null) headers["Content-Type"] = "application/json"

  let response = await fetch(`${normalizeServerUrl(params.serverUrl)}${params.route}`, {
    method: params.method ?? "POST",
    headers,
    body: params.body == null ? undefined : JSON.stringify(params.body),
  })

  if (params.responseType === "text") {
    let text = await response.text()
    if (!response.ok) throw new Error(text || `HTTP ${response.status}`)
    return text as T
  }

  let payload = await response.json() as { ok: boolean; data?: T; error?: string }
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `HTTP ${response.status}`)
  }
  return payload.data as T
}

let ensureDir = (dir: string) => fs.mkdirSync(dir, { recursive: true })

let listLocalFiles = (root: string, dir = root): string[] => {
  if (!fs.existsSync(root)) return []
  let entries = fs.readdirSync(dir, { withFileTypes: true })
  let files: string[] = []
  for (let entry of entries) {
    let abs = path.resolve(dir, entry.name)
    let rel = path.relative(root, abs).replace(/\\/g, "/")
    if (entry.isDirectory()) {
      files.push(...listLocalFiles(root, abs))
      continue
    }
    if (entry.isFile()) files.push(rel)
  }
  return files.sort()
}

let readLocalFileBase64 = (dir: string, relPath: string) =>
  fs.readFileSync(path.resolve(dir, relPath)).toString("base64")

let writeSnapshot = (dir: string, snapshot: WorkspaceSnapshot) => {
  ensureDir(dir)
  let incoming = new Map(snapshot.files.map(file => [file.path, file]))
  let existing = listLocalFiles(dir)

  for (let relPath of existing) {
    if (!exportablePath(relPath)) continue
    if (!incoming.has(relPath)) {
      fs.rmSync(path.resolve(dir, relPath), { recursive: true, force: true })
    }
  }

  for (let file of snapshot.files) {
    let target = path.resolve(dir, file.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, Buffer.from(file.contentBase64, "base64"))
    fs.chmodSync(target, file.mode)
  }
}

let writeAgentInstructions = (dir: string, serverUrl: string, token?: string) => {
  let agentsPath = path.resolve(dir, "AGENTS.md")
  let content: string
  if (fs.existsSync(agentsPath)) {
    // Replace or append server section to existing AGENTS.md
    let existing = fs.readFileSync(agentsPath, "utf8")
    let serverSection = `\n## Server\n\nThe messaging proxy server is available at \`${serverUrl}\`.`
    if (token) {
      serverSection += `\nAuthenticate with header: \`X-Auth-Token: ${token}\``
    }
    serverSection += `\nUse the server API for privileged actions such as send, mark-read, archive, and pulling new messages.\n`

    let serverHeadingPattern = /\n## Server\n[\s\S]*$/
    if (serverHeadingPattern.test(existing)) {
      content = existing.replace(serverHeadingPattern, serverSection)
    } else {
      content = existing.trimEnd() + "\n" + serverSection
    }
  } else {
    content = defaultAgentInstructions({ serverUrl, token })
  }
  fs.writeFileSync(agentsPath, content)
}

export let syncPull = async (params: {
  serverUrl?: string
  token?: string
  workspaceId?: string
  dir?: string
  force?: boolean
}) => {
  let workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID
  let dir = path.resolve(params.dir ?? defaultSessionDir())
  let connection = resolveSessionConnection({ serverUrl: params.serverUrl, token: params.token })

  ensureDir(dir)
  let entries = fs.readdirSync(dir)
  if (entries.length > 0 && !params.force) {
    throw new Error(`Refusing to initialize non-empty directory "${dir}". Use --force to overwrite.`)
  }

  let manifest = await request<AgentManifest>({
    serverUrl: connection.serverUrl,
    token: connection.token,
    route: "/api/agent/manifest",
    method: "GET",
  })
  let snapshot = await request<WorkspaceSnapshot>({
    serverUrl: connection.serverUrl,
    token: connection.token,
    route: "/api/workspace/export",
    body: { workspaceId, format: "snapshot" },
  })

  writeSnapshot(dir, snapshot)
  writeAgentInstructions(dir, connection.serverUrl, connection.token)

  return {
    workspaceId: snapshot.workspaceId,
    revision: snapshot.revision,
    fileCount: snapshot.files.length,
    path: dir,
    capabilities: manifest.auth.tokenCapabilities,
  }
}

export let syncPush = async (params: {
  dir?: string
  serverUrl?: string
  token?: string
  workspaceId?: string
}) => {
  let dir = path.resolve(params.dir ?? defaultSessionDir())
  let connection = resolveSessionConnection({ serverUrl: params.serverUrl, token: params.token })
  let workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID

  let localPaths = listLocalFiles(dir).filter(writablePath)

  let files: WorkspacePushFile[] = localPaths.map(relPath => ({
    path: relPath,
    contentBase64: readLocalFileBase64(dir, relPath),
  }))

  if (files.length === 0) {
    return { workspaceId, pushed: false, changedFiles: 0 }
  }

  await request<WorkspaceSnapshot>({
    serverUrl: connection.serverUrl,
    token: connection.token,
    route: "/api/workspace/push",
    body: { workspaceId, files },
  })

  return { workspaceId, pushed: true, changedFiles: files.length }
}

export let startSession = async (params: {
  serverUrl?: string
  token?: string
  workspaceId?: string
  dir?: string
  agentCommand?: string
  force?: boolean
}) => {
  let workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID
  let dir = path.resolve(params.dir ?? defaultSessionDir())
  let connection = resolveSessionConnection({ serverUrl: params.serverUrl, token: params.token })

  // Trigger a server-side pull of new messages before syncing
  try {
    await request({
      serverUrl: connection.serverUrl,
      token: connection.token,
      route: "/api/workspace/pull",
      body: { workspaceId },
    })
  } catch {
    // Best-effort; read-only tokens can't pull
  }

  let pull = await syncPull({
    serverUrl: connection.serverUrl,
    token: connection.token,
    workspaceId,
    dir,
    force: params.force,
  })

  if (params.agentCommand) {
    let child = spawn(params.agentCommand, {
      cwd: dir,
      stdio: "inherit",
      shell: true,
    })

    await new Promise<void>((resolve, reject) => {
      child.on("close", () => resolve())
      child.on("error", reject)
    })

    // Push changes back after agent exits
    let pushResult = await syncPush({
      dir,
      serverUrl: connection.serverUrl,
      token: connection.token,
      workspaceId,
    })

    return { ...pull, pushed: pushResult.pushed, changedFiles: pushResult.changedFiles }
  }

  return { ...pull, pushed: false, changedFiles: 0 }
}
