/**
 * wizardBreadcrumbAtom
 *
 * Bridges an active wizard's title into the global Settings breadcrumb
 * (rendered in the workspace-header by `SettingsBreadcrumb`). Wizards
 * no longer carry their own 40px PanelHeader chrome — instead
 * `WizardShell` publishes its `title` here on mount and the breadcrumb
 * appends it as a trailing crumb (e.g.
 * `Settings › Models & Keys › Add Account`).
 *
 * Why an atom and not a React context?
 *   The breadcrumb is rendered far above the wizard subtree in the
 *   `SettingsSlot` workspace-header, so a context provider scoped
 *   around the wizard would not reach it. A jotai atom is the simplest
 *   global bridge that matches how the rest of the workspace-header
 *   surfaces (route toolbar, settings toolbar, etc.) talk to slot
 *   contents.
 *
 * Lifecycle:
 *   - Wizard mounts → `WizardShell` sets the atom to its title.
 *   - Title prop changes → atom updates (effect dependency).
 *   - Wizard unmounts → effect cleanup resets the atom to `null`.
 *
 * Multiple concurrent wizards are not supported (the wizard system
 * mounts one wizard at a time inside the Settings slot); the
 * last-writer-wins. If that ever changes we can lift this to a stack.
 */
import { atom } from "jotai";

export const wizardBreadcrumbTitleAtom = atom<string | null>(null);

/**
 * settingsSelectionTitleAtom
 *
 * Same bridge pattern, but for the *selection* leaf — what the user has
 * clicked on inside a section that lives inside Settings (currently:
 * Agent Teams, where the user picks one OS / SDE / CLI / custom agent
 * or one team in the sidebar).
 *
 * The breadcrumb renders the wizard title if present, otherwise this
 * selection title. They are conceptually exclusive: pages that own a
 * selection list also clear the selection when a wizard opens (see
 * `AgentOrgsPage`), so users never see both at once.
 *
 * Pages that publish must reset to `null` on unmount.
 */
export const settingsSelectionTitleAtom = atom<string | null>(null);
