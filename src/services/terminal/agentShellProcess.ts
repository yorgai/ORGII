import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { updateShellProcessAtom } from "@src/store/session/shellProcessAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { invokeTauri } from "@src/util/platform/tauri/init";

export interface KillAgentShellProcessOptions {
  pid: number;
  sessionId?: string;
}

export async function killAgentShellProcess({
  pid,
  sessionId,
}: KillAgentShellProcessOptions): Promise<string> {
  const result = await invokeTauri<string>("agent_kill_shell_process", { pid });
  const alreadyExited =
    typeof result === "string" && result.includes("already exited");
  const status = alreadyExited ? "exited" : "killed";

  if (sessionId) {
    getInstrumentedStore().set(updateShellProcessAtom, {
      type: "exit",
      sessionId,
      pid,
      killed: !alreadyExited,
    });
  }

  eventStoreProxy.updateLastShellProcess(
    pid,
    status,
    undefined,
    undefined,
    sessionId
  );
  return result;
}
