import type { StatusPreset } from "../../types";

export const specialAgentToolPresets: Record<string, StatusPreset[]> = {
  approval_request: [
    {
      key: "pending",
      label: "Pending",
      status: "running",
      resultPatch: { pending: true, approved: null },
    },
    {
      key: "approved",
      label: "Approved",
      status: "completed",
      resultPatch: { pending: false, approved: true },
    },
    {
      key: "denied",
      label: "Denied",
      status: "completed",
      resultPatch: { pending: false, approved: false },
    },
  ],
  suggest_mode_switch: [
    { key: "pending", label: "Pending", status: "running", resultPatch: {} },
    {
      key: "switched",
      label: "Switched",
      status: "completed",
      resultPatch: { switched: true },
    },
    {
      key: "skipped",
      label: "Skipped",
      status: "completed",
      resultPatch: { skipped: true },
    },
  ],
  suggest_next_steps: [
    {
      key: "completed",
      label: "Completed",
      status: "completed",
      resultPatch: {
        content: JSON.stringify([
          {
            title: "Add unit tests for auth module",
            command:
              "Write unit tests for the authentication module covering login, logout, and token refresh flows.",
          },
          {
            title: "Refactor database layer",
            command:
              "Refactor the database access layer to use connection pooling and add retry logic.",
          },
          {
            title: "Update API documentation",
            command:
              "Update the REST API documentation to reflect the new endpoints.",
          },
        ]),
      },
    },
    {
      key: "running",
      label: "Running",
      status: "running",
      resultPatch: {},
    },
  ],
};
