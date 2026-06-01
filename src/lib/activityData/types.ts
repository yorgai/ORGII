/**
 * Unified Activity Data Types
 *
 * Single source of truth for activity data structures across:
 * - ChatPanel (SessionEvent)
 * - EventSystem (NormalizedActivityResult)
 * - Session Utils (ActivityChunk)
 */

// ============================================
// Core Types
// ============================================

/**
 * Result data from activity execution
 */
export interface ActivityResult {
  // Status
  success?: boolean;
  status?: string;

  // Primary output (check in order: observation > output > content > message)
  observation?: string;
  output?: unknown;
  content?: string;
  message?: string;
  summary?: string;

  // Error details
  error?: string;
  error_message?: string;
  error_type?: string;

  // Command execution
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  command?: string;

  // File operations
  file_path?: string;
  file_size?: string;
  files_changed?: string[];
  files_modified?: string[];

  // Diff information (for edits)
  diff?: {
    path: string;
    old_text?: string;
    new_text: string;
  };

  // Search matches
  matches?: Array<{
    file: string;
    score?: number;
    snippet: string;
  }>;
  results?: unknown[];

  // Task completion
  trajectory_count?: number;
  trajectory_text?: string;
  token_usage?: number;
  branch?: string;

  // Submit/Interaction
  accepted?: boolean;
  handled?: boolean;
  user_responded?: boolean;

  // Extensible
  [key: string]: unknown;
}

/**
 * Args data for activity
 */
export interface ActivityArgs {
  // Common
  agent_name?: string;
  thought?: string;

  // Task related
  thread_id?: string;
  description?: string;
  task_description?: string;
  assigned_agent?: string;
  base_branch?: string;
  acceptance_criteria?: string[];

  // File operations
  path?: string;
  file_path?: string;
  target_file?: string;
  file_name?: string;
  content?: string;
  old_string?: string;
  new_string?: string;
  old_text?: string;
  new_text?: string;
  edit_type?: string;
  operation?: string;
  line?: number;
  text?: string;

  // Command execution
  command?: string;

  // Search
  query?: string;
  pattern?: string;
  search_term?: string;

  // Question/Answer
  question?: string;
  options?: string[];

  // Session
  model?: string;
  cwd?: string;
  workspace?: string;

  // Submit output
  output?: Record<string, unknown>;

  // Extensible
  [key: string]: unknown;
}
