export interface LinkedEmail {
  email: string;
  last_commit_date?: string;
}

export interface MemberEntry {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  /** GitHub username (optional, user-editable) */
  github_username?: string;
  /** ISO 8601 date of the most recent commit (e.g. "2025-12-24") */
  last_commit_date?: string;
  /** Whether this member is active on the team (defaults to true) */
  active: boolean;
  /** Emails claimed by this member (from other git identities) */
  linked_emails?: LinkedEmail[];
}

export interface MembersFile {
  members: MemberEntry[];
}
