import { z } from "zod/v4";

import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const workspaceMemory = {
  list: defineProcedure("workspace_memory_list")
    .input(schemas.workspaceMemory.ListInput)
    .output(z.array(schemas.workspaceMemory.EntrySchema))
    .build(),

  read: defineProcedure("workspace_memory_read")
    .input(schemas.workspaceMemory.ReadInput)
    .output(schemas.workspaceMemory.DetailSchema)
    .build(),

  write: defineProcedure("workspace_memory_write")
    .input(schemas.workspaceMemory.WriteInput)
    .output(z.void())
    .build(),

  status: defineProcedure("workspace_memory_status")
    .input(schemas.workspaceMemory.StatusInput)
    .output(schemas.workspaceMemory.StatusSchema)
    .build(),

  index: defineProcedure("workspace_memory_index")
    .input(schemas.workspaceMemory.IndexInput)
    .output(z.string())
    .build(),

  delete: defineProcedure("workspace_memory_delete")
    .input(schemas.workspaceMemory.DeleteInput)
    .output(z.void())
    .build(),

  clear: defineProcedure("workspace_memory_clear")
    .input(schemas.workspaceMemory.ClearInput)
    .output(z.number())
    .build(),
} as const;
