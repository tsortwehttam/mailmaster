import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { PWD_CONFIG_DIR } from "../CliConfig"

export type ServeLocalConfig = {
  serverUrl: string
  token?: string
  updatedAt: string
}

export let DEFAULT_SERVER_URL = "http://127.0.0.1:3271"

export let serveLocalConfigPath = () => path.resolve(PWD_CONFIG_DIR, "serve.json")

export let loadServeLocalConfig = (): ServeLocalConfig | undefined => {
  let filePath = serveLocalConfigPath()
  if (!fs.existsSync(filePath)) return undefined
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as ServeLocalConfig
}

export let saveServeLocalConfig = (config: { serverUrl: string; token?: string }) => {
  fs.mkdirSync(PWD_CONFIG_DIR, { recursive: true })
  let next: ServeLocalConfig = {
    serverUrl: config.serverUrl,
    token: config.token,
    updatedAt: new Date().toISOString(),
  }
  fs.writeFileSync(serveLocalConfigPath(), JSON.stringify(next, null, 2) + "\n")
  return next
}

export let generateServeToken = () => crypto.randomBytes(24).toString("base64url")
