//! Prompt-section constants for memory.
//!
//! Every constant here is wired into either the session-start prefetch
//! prompt, the per-turn extraction prompt, or the `auto_dream` consolidation
//! prompt. Each one carries one or more eval-validated signals — the
//! regression tests in this file pin those signals so a future "token
//! diet" refactor can't silently flatten them.

/// Memory type descriptions for extraction prompts.
///
/// The long-form descriptions (build-up of user understanding,
/// record-from-success-and-failure, workspace-decays-fast, absolute-date rule)
/// are preserved because they carry the decay-rate and extraction-quality
/// signals a shorter variant would lose. The per-type `<examples>` blocks
/// (~600 extra tokens total) are intentionally omitted — the `when_to_save`
/// / `body_structure` guidance is sufficient at our current scale.
pub const TYPES_SECTION: &str = "\
## Types of memory

There are several discrete types of memory that you can store in your memory system:

<types>
<type>
    <name>user</name>
    <description>Contain information about the user's role, goals, responsibilities, and knowledge. \
Great user memories help you tailor your future behavior to the user's preferences and perspective. \
Your goal in reading and writing these memories is to build up an understanding of who the user is \
and how you can be most helpful to them specifically. For example, you should collaborate with a \
senior software engineer differently than a student who is coding for the very first time. Avoid \
writing memories about the user that could be viewed as a negative judgement or that are not \
relevant to the work you're trying to accomplish together.</description>
    <when_to_save>When you learn any details about the user's role, preferences, responsibilities, or knowledge.</when_to_save>
    <how_to_use>When your work should be informed by the user's profile or perspective — tailor \
explanations to the user's existing mental model and domain knowledge.</how_to_use>
</type>
<type>
    <name>feedback</name>
    <description>Guidance the user has given you about how to approach work — both what to avoid \
and what to keep doing. These are a very important type of memory to read and write as they allow \
you to remain coherent and responsive to the way you should approach work in the workspace. Record \
from failure AND success: if you only save corrections, you will avoid past mistakes but drift \
away from approaches the user has already validated, and may grow overly cautious.</description>
    <when_to_save>Any time the user corrects your approach (\"no not that\", \"don't\", \"stop doing X\") \
OR confirms a non-obvious approach worked (\"yes exactly\", \"perfect, keep doing that\", accepting \
an unusual choice without pushback). Corrections are easy to notice; confirmations are quieter — \
watch for them. In both cases, save what is applicable to future conversations, especially if \
surprising or not obvious from the code. Include *why* so you can judge edge cases later.</when_to_save>
    <how_to_use>Let these memories guide your behavior so that the user does not need to offer the \
same guidance twice.</how_to_use>
    <body_structure>Lead with the rule itself, then a **Why:** line (the reason the user gave — \
often a past incident or strong preference) and a **How to apply:** line (when/where this \
guidance kicks in). Knowing *why* lets you judge edge cases instead of blindly following the rule.</body_structure>
</type>
<type>
    <name>workspace</name>
    <description>Information that you learn about ongoing work, goals, initiatives, bugs, or \
incidents within the workspace that are not otherwise derivable from the code or git history. \
Workspace memories help you understand the broader context and motivation behind the work the user \
is doing within this working directory.</description>
    <when_to_save>When you learn who is doing what, why, or by when. These states change relatively \
quickly so try to keep your understanding of this up to date. Always convert relative dates in \
user messages to absolute dates when saving (e.g., \"Thursday\" → \"2026-03-05\"), so the memory \
remains interpretable after time passes.</when_to_save>
    <how_to_use>Use these memories to more fully understand the details and nuance behind the \
user's request and make better informed suggestions.</how_to_use>
    <body_structure>Lead with the fact or decision, then a **Why:** line (the motivation — often a \
constraint, deadline, or stakeholder ask) and a **How to apply:** line (how this should shape \
your suggestions). Workspace memories decay fast, so the why helps future-you judge whether the \
memory is still load-bearing.</body_structure>
</type>
<type>
    <name>reference</name>
    <description>Stores pointers to where information can be found in external systems. These \
memories allow you to remember where to look to find up-to-date information outside of the \
workspace directory.</description>
    <when_to_save>When you learn about resources in external systems and their purpose. For \
example, that bugs are tracked in a specific initiative in Linear or that feedback can be found in \
a specific Slack channel.</when_to_save>
    <how_to_use>When the user references an external system or information that may be in an \
external system.</how_to_use>
</type>
</types>";

/// What NOT to save as memories.
///
/// The final paragraph is the eval-validated explicit-save gate: prevents
/// users turning memory into an activity log.
pub const WHAT_NOT_TO_SAVE: &str = "\
## What NOT to save

- Code patterns, conventions, architecture, file paths, or workspace structure — these can be \
derived by reading the current workspace state.
- Git history, recent changes, or who-changed-what — `git log` / `git blame` are authoritative.
- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context.
- Anything already documented in workspace rules or config files.
- Ephemeral task details: in-progress work, temporary state, current conversation context.

These exclusions apply even when the user explicitly asks you to save. If they ask you to save a \
PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the \
part worth keeping.";

/// When to access memories (injected into system prompt).
///
/// The "ignore" bullet is eval-validated against branch-pollution evals:
/// the failure mode is the user saying "ignore memory about X" → model
/// acknowledges then overrides rather than treating memory as empty.
/// The bullet names that anti-pattern explicitly.
pub const WHEN_TO_ACCESS: &str = "\
## When to access memories

- When memories seem relevant, or the user references prior-conversation work.
- You MUST access memory when the user explicitly asks you to check, recall, or remember.
- If the user says to *ignore* or *not use* memory: proceed as if MEMORY.md were empty. Do not \
apply remembered facts, cite, compare against, or mention memory content.
- Memory records can become stale over time. Use memory as context for what was true at a given \
point in time. Before answering the user or building assumptions based solely on information in \
memory records, verify that the memory is still correct and up-to-date by reading the current \
state of the files or resources. If a recalled memory conflicts with current information, trust \
what you observe now — and update or remove the stale memory rather than acting on it.";

/// Before recommending from memory (injected into system prompt).
///
/// Header wording ("Before recommending") is eval-validated: the action-cue
/// framing went 3/3 where the abstract "Trusting what you recall" went 0/3
/// in-place — same body, different header. Paragraph framing (rather than
/// pure bullets) carries the "verify function/file claims" signal more
/// reliably.
pub const TRUSTING_RECALL: &str = "\
## Before recommending from memory

A memory that names a specific function, file, or flag is a claim that it existed *when the \
memory was written*. It may have been renamed, removed, or never merged. Before recommending it:

- If the memory names a file path: check the file exists.
- If the memory names a function or flag: grep for it.
- If the user is about to act on your recommendation (not just asking about history), verify first.

\"The memory says X exists\" is not the same as \"X exists now.\"

A memory that summarizes repo state (activity logs, architecture snapshots) is frozen in time. \
If the user asks about *recent* or *current* state, prefer `git log` or reading the code over \
recalling the snapshot.";

/// Single-line memory drift caveat.
pub const MEMORY_DRIFT_CAVEAT: &str =
    "Memory files are point-in-time observations. Verify claims against current code before asserting as fact.";

/// Frontmatter example template for extraction prompts.
pub const MEMORY_FRONTMATTER_EXAMPLE: &str = "\
---
name: {{memory name}}
description: {{one-line description — used to decide relevance in future conversations, so be specific}}
type: {{user, feedback, workspace, reference}}
---

{{memory content — for feedback/workspace types, structure as: rule/fact, then **Why:** and **How to apply:** lines}}";

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================
    // Prompt-signal regression guards
    //
    // Each assertion pins a specific signal in a prompt constant.
    // Don't delete these unless you also delete the corresponding sentence
    // in the constant — they exist to prevent silent "token diet"
    // regressions.
    // ============================================

    #[test]
    fn test_types_section_carries_decay_signal() {
        // The "decay fast" framing is how the model knows `workspace`
        // memories are weaker than `user` memories.
        assert!(
            TYPES_SECTION.contains("Workspace memories decay fast"),
            "workspace decay-rate signal missing from TYPES_SECTION"
        );
        // Anti-drift: record from success, not just correction.
        assert!(
            TYPES_SECTION.contains("failure AND success"),
            "feedback success-recording signal missing from TYPES_SECTION"
        );
        // body_structure is a hard requirement on both feedback and workspace
        // types.
        assert_eq!(
            TYPES_SECTION.matches("<body_structure>").count(),
            2,
            "expected body_structure tag on exactly two types (feedback + workspace)"
        );
        assert!(TYPES_SECTION.contains("**Why:**"));
        assert!(TYPES_SECTION.contains("**How to apply:**"));
        // Absolute-date rule for workspace memories.
        assert!(
            TYPES_SECTION.contains("absolute dates"),
            "absolute-date rule missing from workspace when_to_save"
        );
    }

    #[test]
    fn test_what_not_to_save_has_explicit_save_gate() {
        // Eval-validated: prevents turning memory into an activity log when
        // user insists.
        assert!(
            WHAT_NOT_TO_SAVE.contains("even when the user explicitly asks"),
            "explicit-save gate missing"
        );
        assert!(
            WHAT_NOT_TO_SAVE.contains("surprising") || WHAT_NOT_TO_SAVE.contains("non-obvious"),
            "surprising/non-obvious redirect missing"
        );
    }

    #[test]
    fn test_when_to_access_has_ignore_anti_pattern() {
        // Eval-validated against branch-pollution evals: prevents the
        // "acknowledge then override" failure mode when the user says
        // "ignore X".
        assert!(WHEN_TO_ACCESS.contains("ignore"));
        assert!(
            WHEN_TO_ACCESS.contains("proceed as if MEMORY.md were empty"),
            "ignore anti-pattern wording missing from WHEN_TO_ACCESS"
        );
        // Drift caveat must state the trust-observation-over-memory rule.
        assert!(
            WHEN_TO_ACCESS.contains("trust what you observe now"),
            "drift caveat missing from WHEN_TO_ACCESS"
        );
    }

    #[test]
    fn test_trusting_recall_paragraph_framing() {
        // The paragraph-level framing carries the "verify before
        // recommending" signal (3/3 paragraph vs 0/3 bullet in evals).
        // Presence of these sentences confirms we didn't accidentally
        // flatten it back into a bullet list.
        assert!(
            TRUSTING_RECALL.contains("renamed, removed, or never merged"),
            "file/function existence framing missing from TRUSTING_RECALL"
        );
        assert!(
            TRUSTING_RECALL.contains("frozen in time"),
            "snapshot framing missing from TRUSTING_RECALL"
        );
        // Verification is only required when the user is about to act.
        // Must be explicit, not implied.
        assert!(
            TRUSTING_RECALL.contains("about to act"),
            "action-point verification cue missing from TRUSTING_RECALL"
        );
    }
}
