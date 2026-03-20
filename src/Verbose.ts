export let verboseLog = (enabled: boolean | undefined, ...parts: unknown[]) => {
  if (!enabled) return
  console.error("[msgmon]", ...parts)
}
