import { z } from "zod"

export let StateEntry = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type StateEntry = z.infer<typeof StateEntry>
