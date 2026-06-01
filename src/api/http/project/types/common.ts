export interface TodoEntry {
  id: string;
  content: string;
  /** "pending" | "in_progress" | "completed" */
  status: string;
}

export interface CommentEntry {
  id: string;
  author: string;
  content: string;
  created_at: string;
}
