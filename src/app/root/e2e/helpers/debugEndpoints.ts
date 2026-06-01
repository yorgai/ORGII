import { asError } from "../result";
import type { Json, Result } from "../types";
import { e2eUrl } from "./e2eBaseUrl";

export function createDebugEndpointHelpers() {
  const readSessionPromptEnvironmentBlock = async (
    sessionId: string
  ): Promise<Result<{ result: Json }>> => {
    try {
      const response = await fetch(
        e2eUrl("/agent/test/session/prompt/environment-block"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        }
      );
      const result = (await response.json()) as Json;
      return { ok: true, result };
    } catch (err) {
      return asError(err);
    }
  };

  const readSdeTranscript = async (
    sessionId: string
  ): Promise<Result<{ result: Json }>> => {
    try {
      const response = await fetch(
        e2eUrl(`/agent/test/sde/transcript/${encodeURIComponent(sessionId)}`)
      );
      const result = (await response.json()) as Json;
      return { ok: true, result };
    } catch (err) {
      return asError(err);
    }
  };

  return {
    readSessionPromptEnvironmentBlock,
    readSdeTranscript,
  };
}
