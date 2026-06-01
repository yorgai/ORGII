/**
 * Format a raw model ID into a human-readable display name.
 *
 * Handles:
 * - Trailing date stamps: `-20251219`, `-2024-08-06`, `-latest`
 * - Long hex hashes embedded in the slug
 * - Consecutive digit segments merged as versions: `3-5` → `3.5`
 * - Title-casing with special uppercase for GPT / O-series
 *
 * Examples:
 *   claude-opus-4.5-20251219   → Claude Opus 4.5
 *   claude-3-5-sonnet-20241022 → Claude 3.5 Sonnet
 *   gpt-4-turbo-2024-04-09     → GPT 4 Turbo
 *   gpt-5.3-codex              → GPT 5.3 Codex
 *   o3-mini-2025-01-31          → O3 Mini
 *   gemini-2.0-flash            → Gemini 2.0 Flash
 */
import { getModelAliasDisplayName } from "@src/hooks/models/modelAliasRegistry";

const UPPERCASE_TOKENS = new Set(["gpt", "o1", "o3", "o4"]);
const TRAILING_JUNK_RE = /(?:-\d{8,}|-\d{4}-\d{2}-\d{2}|-latest)$/;

export function formatModelName(model: string): string {
  if (!model || model === "default") return model;

  const cleaned = model.replace(TRAILING_JUNK_RE, "");
  const parts = cleaned.split("-");

  const filtered: string[] = [];
  for (const part of parts) {
    if (/^\d{6,}$/.test(part)) continue;
    if (part.length > 12 && /^[a-z0-9]+$/.test(part)) continue;
    filtered.push(part);
  }

  const merged: string[] = [];
  for (const part of filtered) {
    const prev = merged[merged.length - 1];
    if (prev && /^\d+$/.test(prev) && /^\d+$/.test(part)) {
      merged[merged.length - 1] = `${prev}.${part}`;
    } else {
      merged.push(part);
    }
  }

  return merged
    .map((part) => {
      if (/^\d/.test(part)) return part;
      if (UPPERCASE_TOKENS.has(part.toLowerCase())) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

/**
 * Like formatModelName but preserves trailing date suffixes.
 *
 * Examples:
 *   gpt-5.2-2025-12-11   → GPT 5.2 2025-12-11
 *   claude-opus-4.5-20251219 → Claude Opus 4.5 (20251219)
 *   o3-mini-2025-01-31   → O3 Mini 2025-01-31
 *   gemini-2.0-flash     → Gemini 2.0 Flash
 */
export function formatModelNameFull(model: string): string {
  if (!model || model === "default") return model;

  const dateMatch = model.match(TRAILING_JUNK_RE);
  const baseName = formatModelName(model);
  if (!dateMatch) return baseName;

  const raw = dateMatch[0].replace(/^-/, "");
  return `${baseName} ${raw}`;
}

/**
 * Strip redundant provider prefix from an already-formatted model label.
 *
 * "Claude" is stripped because Opus / Sonnet / Haiku are self-identifying.
 * "GPT", "Gemini", "O3" etc. are kept — they ARE the identifier.
 *
 * Works on any label source (API display_name, formatModelName output, etc.).
 *
 * Examples:
 *   Claude Opus 4.5   → Opus 4.5
 *   Claude 3.5 Sonnet  → 3.5 Sonnet
 *   GPT 4 Turbo        → GPT 4 Turbo  (unchanged)
 *   Gemini 2.0 Flash   → Gemini 2.0 Flash  (unchanged)
 */
const STRIP_PREFIX_RE = /^Claude\s+/i;

export function compactModelLabel(label: string): string {
  return label.replace(STRIP_PREFIX_RE, "");
}

// ─── Version-aware sorting ───────────────────────────────────────────────────

function extractModelVersion(modelId: string): {
  family: string;
  version: number;
} {
  const cleaned = modelId.replace(TRAILING_JUNK_RE, "");
  const versionMatch = cleaned.match(/(\d+\.\d+)/);
  const version = versionMatch ? parseFloat(versionMatch[1]) : 0;
  const family = versionMatch
    ? cleaned
        .slice(0, versionMatch.index)
        .replace(/[-\s]+$/, "")
        .toLowerCase()
    : cleaned.toLowerCase();
  return { family, version };
}

/**
 * Compare two model IDs for sorting: same family -> higher version first,
 * different family -> alphabetical. Trailing dates are stripped so
 * "gpt-5.4" correctly sorts above "gpt-5.2-2025-12-11".
 */
export function compareModelsByVersion(idA: string, idB: string): number {
  const sortKeyA = extractModelVersion(idA);
  const sortKeyB = extractModelVersion(idB);
  if (sortKeyA.family === sortKeyB.family) {
    if (sortKeyB.version !== sortKeyA.version)
      return sortKeyB.version - sortKeyA.version;
    return idA.localeCompare(idB);
  }
  return sortKeyA.family.localeCompare(sortKeyB.family);
}

// ─── Shared model display resolution ─────────────────────────────────────────

interface ModelSelection {
  model?: string;
  provider?: string;
  listingModel?: string;
  listingModelDisplay?: string;
  listingName?: string;
  selectedSourceLabel?: string;
}

interface ProviderWithModels {
  provider_name: string;
  models: { id: string; display_name: string }[];
}

/**
 * Resolve a model selection to a compact, normalized display label.
 *
 * Tries (in order): listingModelDisplay → listingName → listingModel →
 * provider-matched display_name → any-provider display_name → formatModelNameFull.
 *
 * Raw model IDs are normalized with formatModelNameFull (title-cased, trailing
 * date stamps preserved) before compactModelLabel.
 *
 * Used by: ControlButtons (via useModelPillLabel), other surfaces needing
 * listing/tier-aware labels.
 */
export function resolveModelDisplayLabel(
  selection: ModelSelection,
  providers: ProviderWithModels[],
  fallback: string = "Model"
): string {
  if (selection.listingModelDisplay) {
    return compactModelLabel(selection.listingModelDisplay);
  }
  if (selection.listingName) {
    return compactModelLabel(selection.listingName);
  }
  if (selection.listingModel) {
    const alias = getModelAliasDisplayName(selection.listingModel);
    if (alias) return alias;
    return compactModelLabel(formatModelNameFull(selection.listingModel));
  }

  if (!selection.model) return fallback;

  const alias = getModelAliasDisplayName(selection.model);
  if (alias) return alias;

  if (selection.provider) {
    const provider = providers.find(
      (prov) => prov.provider_name === selection.provider
    );
    const model = provider?.models.find((mod) => mod.id === selection.model);
    if (model) return compactModelLabel(formatModelNameFull(model.id));
  }

  for (const provider of providers) {
    const model = provider.models.find((mod) => mod.id === selection.model);
    if (model) return compactModelLabel(formatModelNameFull(model.id));
  }

  return compactModelLabel(formatModelNameFull(selection.model));
}

/**
 * Compact label for toolbar model pills — always derived from the model id
 * (alias → formatted id). Skips listing display names / provider labels so
 * the pill shows only the model name (e.g. "GPT 5.5"), not tier or source
 * metadata.
 */
export function resolveModelPillLabel(
  selection: ModelSelection,
  fallback: string = "Model"
): string {
  const modelId = selection.model || selection.listingModel;
  if (!modelId) return fallback;

  const alias = getModelAliasDisplayName(modelId);
  if (alias) return alias;

  return compactModelLabel(formatModelNameFull(modelId));
}

/** Account / source label for model-pill breadcrumb tooltips. */
export function resolveModelPillAccountName(
  selection: ModelSelection
): string | undefined {
  if (selection.selectedSourceLabel) return selection.selectedSourceLabel;
  if (selection.listingName) return selection.listingName;
  return undefined;
}

/**
 * Like resolveModelDisplayLabel but preserves date suffixes.
 * Used for tooltips / hover states where the full version info is useful.
 */
export function resolveModelFullLabel(
  selection: ModelSelection,
  fallback: string = "Model"
): string {
  if (selection.listingModelDisplay) {
    return selection.listingModelDisplay;
  }
  if (selection.listingName) {
    return selection.listingName;
  }
  if (selection.listingModel) {
    const alias = getModelAliasDisplayName(selection.listingModel);
    if (alias) return alias;
    return formatModelNameFull(selection.listingModel);
  }

  if (!selection.model) return fallback;

  const alias = getModelAliasDisplayName(selection.model);
  if (alias) return alias;

  return formatModelNameFull(selection.model);
}
