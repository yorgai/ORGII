/**
 * Singleton draft atom for the Skill Editor.
 *
 * Holds a single in-progress skill being created or edited.
 * Persists in memory across tab switches so the user can navigate
 * away and return without losing work.
 *
 * - `editingSkillPath` is null when creating a new skill.
 * - `editingSkillName` is null when creating a new skill.
 */
import { atom } from "jotai";

import { SKILL_SCOPE, type SkillScope } from "@src/types/extensions/types";

export { SKILL_SCOPE, type SkillScope };

export interface BundledFileDraft {
  relativePath: string;
  content: string;
}

export interface SkillEditorDraft {
  name: string;
  description: string;
  alwaysActive: boolean;
  version: string;
  license: string;
  compatibility: string;
  requiredBins: string[];
  requiredEnv: string[];
  scope: SkillScope;
  /**
   * Scope the skill currently has on disk when this draft was opened.
   * Stays stable while the user edits; `save()` compares it against
   * `scope` to decide whether to invoke `skills_move`. Null when
   * creating a new skill.
   */
  originalScope: SkillScope | null;
  /** SKILL.md body content (everything after frontmatter). */
  body: string;
  /** Path to existing SKILL.md when editing; null when creating new. */
  editingSkillPath: string | null;
  /** Original skill name when editing; null when creating new. */
  editingSkillName: string | null;
  /** Draft bundled files to write alongside SKILL.md on save. */
  bundledFileDrafts: BundledFileDraft[];
}

export function createEmptySkillDraft(): SkillEditorDraft {
  return {
    name: "",
    description: "",
    alwaysActive: false,
    version: "",
    license: "",
    compatibility: "",
    requiredBins: [],
    requiredEnv: [],
    scope: SKILL_SCOPE.GLOBAL,
    originalScope: null,
    body: "",
    editingSkillPath: null,
    editingSkillName: null,
    bundledFileDrafts: [],
  };
}

/** The singleton draft — null means no draft in progress. */
export const skillEditorDraftAtom = atom<SkillEditorDraft | null>(null);

/** Set or clear the draft. */
export const setSkillEditorDraftAtom = atom(
  null,
  (_get, set, draft: SkillEditorDraft | null) => {
    set(skillEditorDraftAtom, draft);
  }
);

/** Clear the draft (convenience alias). */
export const clearSkillEditorDraftAtom = atom(null, (_get, set) => {
  set(skillEditorDraftAtom, null);
});
