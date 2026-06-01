/**
 * Parses inbox-drain task-assignment prompts injected as subagent user turns.
 * Wire format mirrors Rust `render_plain` for `AgentMessage::TaskAssigned`:
 *   Task assigned by {assigned_by}: {subject}
 *   Task ID: {task_id}
 *   {description}
 */
export interface ParsedTaskAssignedPrompt {
  assignedBy: string;
  subject: string;
  taskId: string;
  description: string;
}

const TASK_ASSIGNED_HEADER_PATTERN =
  /^Task assigned by (.+?): (.+?)(?:\r?\n|$)/;

const TASK_ID_LINE_PATTERN = /^Task ID: (\S+)(?:\r?\n|$)/;

export function parseTaskAssignedPrompt(
  text: string
): ParsedTaskAssignedPrompt | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("Task assigned by ")) return null;

  const headerMatch = trimmed.match(TASK_ASSIGNED_HEADER_PATTERN);
  if (!headerMatch) return null;

  const assignedBy = headerMatch[1].trim();
  const subject = headerMatch[2].trim();
  if (!assignedBy || !subject) return null;

  let remainder = trimmed.slice(headerMatch[0].length);
  let taskId = "";

  const taskIdMatch = remainder.match(TASK_ID_LINE_PATTERN);
  if (taskIdMatch) {
    taskId = taskIdMatch[1];
    remainder = remainder.slice(taskIdMatch[0].length);
  }

  const description = remainder.trim();
  if (!description) return null;

  return { assignedBy, subject, taskId, description };
}
