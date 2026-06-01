import { z } from "zod/v4";

import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const terminal = {
  create: defineProcedure("create_pty")
    .input(schemas.terminal.CreatePtyInput)
    .build(),

  write: defineProcedure("write_pty")
    .input(schemas.terminal.WritePtyInput)
    .build(),

  resize: defineProcedure("resize_pty")
    .input(schemas.terminal.ResizePtyInput)
    .build(),

  close: defineProcedure("close_pty")
    .input(schemas.terminal.ClosePtyInput)
    .build(),

  checkExists: defineProcedure("check_pty_exists")
    .input(schemas.terminal.CheckPtyExistsInput)
    .output(z.boolean())
    .build(),

  getInfo: defineProcedure("get_pty_info")
    .input(schemas.terminal.GetPtyInfoInput)
    .output(schemas.terminal.PtyInfoSchema)
    .build(),

  getMemoryUsage: defineProcedure("get_pty_memory_usage")
    .output(z.array(schemas.terminal.PtyMemoryInfoSchema))
    .build(),
} as const;
