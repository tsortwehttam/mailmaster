import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { spawn, spawnSync } from "node:child_process"
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

type RawWorkspaceBundle = {
  format: "msgmon.workspace.bundle.v1"
  workspaceId: string
  revision: string
  config: WorkspaceSnapshot["config"]
  files: WorkspaceExportFile[]
}

type EncodedWorkspaceBundle = {
  workspaceId: string
  revision: string
  encoding: "base64"
  compression: "gzip"
  mediaType: string
  bundleBase64: string
}

type PullDescriptor =
  | { kind: "server"; serverUrl: string; token: string }
  | { kind: "url"; pullUrl: string; token?: string }

type PushDescriptor =
  | { kind: "server"; serverUrl: string; token: string }
  | { kind: "url"; pushUrl: string; token?: string }

type SessionMetadata = {
  workspaceId: string
  revision?: string
}

let normalizeServerUrl = (serverUrl: string) => serverUrl.replace(/\/+$/, "")

export let defaultSessionDir = () => currentWorkspaceDir()

export let resolveSessionConnection = (params: { serverUrl?: string; token?: string }) => {
  let connection = resolvePullConnection(params)
  if (connection.kind !== "server") {
    throw new Error("Generic pull URLs do not expose a msgmon serve session connection")
  }
  return {
    serverUrl: connection.serverUrl,
    token: connection.token,
  }
}

let metadataPath = (dir: string) => path.resolve(dir, ".msgmon-client.json")

let readSessionMetadata = (dir: string): SessionMetadata | undefined => {
  let filePath = metadataPath(dir)
  if (!fs.existsSync(filePath)) return undefined
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as SessionMetadata
}

let writeSessionMetadata = (dir: string, metadata: SessionMetadata) => {
  fs.writeFileSync(metadataPath(dir), JSON.stringify(metadata, null, 2) + "\n")
}

let resolvePullConnection = (params: { serverUrl?: string; token?: string; pullUrl?: string }): PullDescriptor => {
  if (params.pullUrl) return { kind: "url", pullUrl: params.pullUrl, token: params.token }

  let localConfig = loadServeLocalConfig()
  let serverUrl = normalizeServerUrl(params.serverUrl ?? localConfig?.serverUrl ?? DEFAULT_SERVER_URL)
  let token = params.token ?? localConfig?.token
  if (!token) {
    throw new Error("No token provided and none found in ./.msgmon/serve.json")
  }
  return { kind: "server", serverUrl, token }
}

let resolvePushConnection = (params: { serverUrl?: string; token?: string; pushUrl?: string }): PushDescriptor => {
  if (params.pushUrl) return { kind: "url", pushUrl: params.pushUrl, token: params.token }

  let localConfig = loadServeLocalConfig()
  let serverUrl = normalizeServerUrl(params.serverUrl ?? localConfig?.serverUrl ?? DEFAULT_SERVER_URL)
  let token = params.token ?? localConfig?.token
  if (!token) {
    throw new Error("No token provided and none found in ./.msgmon/serve.json")
  }
  return { kind: "server", serverUrl, token }
}

let writablePath = (relPath: string) =>
  relPath === "state.jsonl"

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

let requestUrl = async (params: {
  url: string
  token?: string
  method?: "GET" | "POST"
  body?: string
  contentType?: string
}) => {
  let headers: Record<string, string> = {}
  if (params.token) headers["X-Auth-Token"] = params.token
  if (params.contentType) headers["Content-Type"] = params.contentType
  let response = await fetch(params.url, {
    method: params.method ?? "GET",
    headers,
    body: params.body,
  })
  if (!response.ok) {
    let text = await response.text().catch(() => "")
    throw new Error(text || `HTTP ${response.status}`)
  }
  return response
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

let clearExportableFiles = (dir: string) => {
  for (let relPath of listLocalFiles(dir)) {
    if (!exportablePath(relPath)) continue
    fs.rmSync(path.resolve(dir, relPath), { recursive: true, force: true })
  }
}

let writeSnapshot = (dir: string, snapshot: Pick<WorkspaceSnapshot, "files">) => {
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
    let existing = fs.readFileSync(agentsPath, "utf8")
    let serverSection = `\n## Server\n\nThe messaging proxy server is available at \`${serverUrl}\`.`
    if (token) {
      serverSection += `\nAuthenticate with header: \`X-Auth-Token: ${token}\``
    }
    serverSection += "\nUse the server API for privileged actions such as send, mark-read, archive, and pulling new messages.\n"

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

let isWorkspaceSnapshot = (value: unknown): value is WorkspaceSnapshot =>
  !!value
  && typeof value === "object"
  && Array.isArray((value as WorkspaceSnapshot).files)
  && typeof (value as WorkspaceSnapshot).workspaceId === "string"
  && typeof (value as WorkspaceSnapshot).revision === "string"

let isRawWorkspaceBundle = (value: unknown): value is RawWorkspaceBundle =>
  !!value
  && typeof value === "object"
  && (value as RawWorkspaceBundle).format === "msgmon.workspace.bundle.v1"
  && Array.isArray((value as RawWorkspaceBundle).files)

let isEncodedWorkspaceBundle = (value: unknown): value is EncodedWorkspaceBundle =>
  !!value
  && typeof value === "object"
  && typeof (value as EncodedWorkspaceBundle).bundleBase64 === "string"
  && (value as EncodedWorkspaceBundle).encoding === "base64"
  && (value as EncodedWorkspaceBundle).compression === "gzip"

let normalizeWorkspaceSnapshot = (value: unknown): WorkspaceSnapshot => {
  let candidate = value as { ok?: boolean; data?: unknown }
  let payload = candidate?.ok === true && candidate.data != null ? candidate.data : value

  if (isWorkspaceSnapshot(payload)) return payload
  if (isRawWorkspaceBundle(payload)) {
    return {
      workspaceId: payload.workspaceId,
      revision: payload.revision,
      config: payload.config,
      files: payload.files,
    }
  }
  if (isEncodedWorkspaceBundle(payload)) {
    let raw = zlib.gunzipSync(Buffer.from(payload.bundleBase64, "base64")).toString("utf8")
    return normalizeWorkspaceSnapshot(JSON.parse(raw))
  }
  throw new Error("Unsupported workspace payload received from pull URL")
}

let parseWorkspaceIdFromDir = (dir: string) => {
  let workspacePath = path.resolve(dir, "workspace.json")
  if (!fs.existsSync(workspacePath)) return DEFAULT_WORKSPACE_ID
  try {
    let raw = JSON.parse(fs.readFileSync(workspacePath, "utf8")) as { id?: string }
    return raw.id && raw.id.length > 0 ? raw.id : DEFAULT_WORKSPACE_ID
  } catch {
    return DEFAULT_WORKSPACE_ID
  }
}

let guessArchiveFormat = (url: string, contentType: string | null): "tar" | "tgz" | "zip" | undefined => {
  let cleanUrl = url.toLowerCase().split("?")[0] ?? ""
  let ct = (contentType ?? "").toLowerCase()

  if (cleanUrl.endsWith(".tar.gz") || cleanUrl.endsWith(".tgz")) return "tgz"
  if (cleanUrl.endsWith(".tar")) return "tar"
  if (cleanUrl.endsWith(".zip")) return "zip"
  if (ct.includes("application/gzip") || ct.includes("application/x-gzip") || ct.includes("application/gzip-compressed")) return "tgz"
  if (ct.includes("application/zip") || ct.includes("application/x-zip-compressed")) return "zip"
  if (ct.includes("application/x-tar")) return "tar"

  return undefined
}

let normalizeExtractedRoot = (extractDir: string) => {
  let entries = fs.readdirSync(extractDir, { withFileTypes: true })
    .filter(entry => entry.name !== "__MACOSX")
  if (entries.length === 1 && entries[0] && entries[0].isDirectory()) {
    return path.resolve(extractDir, entries[0].name)
  }
  return extractDir
}

let copyDirContents = (sourceDir: string, targetDir: string) => {
  ensureDir(targetDir)
  for (let entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    let sourcePath = path.resolve(sourceDir, entry.name)
    let targetPath = path.resolve(targetDir, entry.name)
    if (entry.isDirectory()) {
      copyDirContents(sourcePath, targetPath)
      continue
    }
    if (!entry.isFile()) continue
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.copyFileSync(sourcePath, targetPath)
    fs.chmodSync(targetPath, fs.statSync(sourcePath).mode & 0o777)
  }
}

let extractArchiveToDir = (archive: Buffer, dir: string, sourceUrl: string, contentType: string | null) => {
  let format = guessArchiveFormat(sourceUrl, contentType)
  if (!format) throw new Error("Could not determine archive format from pull URL response")

  let tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "msgmon-client-archive-"))
  let archivePath = path.resolve(tempRoot, format === "zip" ? "workspace.zip" : format === "tar" ? "workspace.tar" : "workspace.tgz")
  let extractDir = path.resolve(tempRoot, "extract")

  try {
    fs.mkdirSync(extractDir, { recursive: true })
    fs.writeFileSync(archivePath, archive)

    let result = format === "zip"
      ? spawnSync("unzip", ["-q", archivePath, "-d", extractDir], { encoding: "utf8" })
      : spawnSync("tar", ["-xf", archivePath, "-C", extractDir], { encoding: "utf8" })

    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || `Failed to extract ${format} archive`).trim())
    }

    copyDirContents(normalizeExtractedRoot(extractDir), dir)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

let syncPullFromUrl = async (params: {
  pullUrl: string
  token?: string
  dir: string
}) => {
  let response = await requestUrl({ url: params.pullUrl, token: params.token, method: "GET" })
  let contentType = response.headers.get("content-type")
  let body = Buffer.from(await response.arrayBuffer())
  let looksJson = (contentType ?? "").toLowerCase().includes("json") || ["{", "["].includes(body.toString("utf8", 0, 1))

  if (looksJson) {
    let snapshot = normalizeWorkspaceSnapshot(JSON.parse(body.toString("utf8")))
    writeSnapshot(params.dir, snapshot)
    writeSessionMetadata(params.dir, { workspaceId: snapshot.workspaceId, revision: snapshot.revision })
    return {
      workspaceId: snapshot.workspaceId,
      revision: snapshot.revision,
      fileCount: snapshot.files.length,
      path: params.dir,
      capabilities: [] as string[],
    }
  }

  extractArchiveToDir(body, params.dir, params.pullUrl, contentType)
  let workspaceId = parseWorkspaceIdFromDir(params.dir)
  writeSessionMetadata(params.dir, { workspaceId })
  return {
    workspaceId,
    revision: "archive",
    fileCount: listLocalFiles(params.dir).filter(exportablePath).length,
    path: params.dir,
    capabilities: [] as string[],
  }
}

export let syncPull = async (params: {
  serverUrl?: string
  token?: string
  workspaceId?: string
  dir?: string
  force?: boolean
  pullUrl?: string
}) => {
  let workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID
  let dir = path.resolve(params.dir ?? defaultSessionDir())
  let connection = resolvePullConnection({ serverUrl: params.serverUrl, token: params.token, pullUrl: params.pullUrl })

  ensureDir(dir)
  let entries = fs.readdirSync(dir)
  if (entries.length > 0 && !params.force) {
    throw new Error(`Refusing to initialize non-empty directory "${dir}". Use --force to overwrite.`)
  }
  if (entries.length > 0 && params.force) {
    clearExportableFiles(dir)
  }

  if (connection.kind === "url") {
    return syncPullFromUrl({
      pullUrl: connection.pullUrl,
      token: connection.token,
      dir,
    })
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
  writeSessionMetadata(dir, { workspaceId: snapshot.workspaceId, revision: snapshot.revision })

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
  pushUrl?: string
}) => {
  let dir = path.resolve(params.dir ?? defaultSessionDir())
  let connection = resolvePushConnection({ serverUrl: params.serverUrl, token: params.token, pushUrl: params.pushUrl })
  let metadata = readSessionMetadata(dir)
  let workspaceId = params.workspaceId ?? metadata?.workspaceId ?? DEFAULT_WORKSPACE_ID

  let localPaths = listLocalFiles(dir).filter(writablePath)
  let files: WorkspacePushFile[] = localPaths.map(relPath => ({
    path: relPath,
    contentBase64: readLocalFileBase64(dir, relPath),
  }))

  if (files.length === 0) {
    return { workspaceId, pushed: false, changedFiles: 0 }
  }

  let payload = {
    workspaceId,
    baseRevision: metadata?.revision,
    files,
  }

  if (connection.kind === "url") {
    await requestUrl({
      url: connection.pushUrl,
      token: connection.token,
      method: "POST",
      body: JSON.stringify(payload),
      contentType: "application/json",
    })
    return { workspaceId, pushed: true, changedFiles: files.length }
  }

  await request<WorkspaceSnapshot>({
    serverUrl: connection.serverUrl,
    token: connection.token,
    route: "/api/workspace/push",
    body: payload,
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
  pullUrl?: string
  pushUrl?: string
}) => {
  let workspaceId = params.workspaceId ?? DEFAULT_WORKSPACE_ID
  let dir = path.resolve(params.dir ?? defaultSessionDir())
  if (params.pullUrl && params.agentCommand && !params.pushUrl && !params.serverUrl) {
    throw new Error("Generic client sessions need --push-url when using --pull-url with --agent-command")
  }
  let pullConnection = resolvePullConnection({ serverUrl: params.serverUrl, token: params.token, pullUrl: params.pullUrl })

  if (pullConnection.kind === "server") {
    try {
      await request({
        serverUrl: pullConnection.serverUrl,
        token: pullConnection.token,
        route: "/api/workspace/pull",
        body: { workspaceId },
      })
    } catch {
      // Best-effort; read-only tokens can't pull.
    }
  }

  let pull = await syncPull({
    serverUrl: params.serverUrl,
    token: params.token,
    workspaceId,
    dir,
    force: params.force,
    pullUrl: params.pullUrl,
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

    let pushResult = await syncPush({
      dir,
      serverUrl: params.serverUrl,
      token: params.token,
      workspaceId,
      pushUrl: params.pushUrl,
    })

    return { ...pull, pushed: pushResult.pushed, changedFiles: pushResult.changedFiles }
  }

  return { ...pull, pushed: false, changedFiles: 0 }
}
