export let verboseLog = (enabled: boolean | undefined, ...parts: unknown[]) => {
  if (!enabled) return
  console.error("[mailmaster]", ...parts)
}
