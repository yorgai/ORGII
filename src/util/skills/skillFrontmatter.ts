export function formatSkillFrontmatterPropertyLabel(propKey: string): string {
  return propKey
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  license?: string;
  metadata?: Record<string, string>;
  "argument-hint"?: string;
  "disable-model-invocation"?: boolean | string;
  [key: string]: unknown;
}

export interface ParseResult {
  frontmatter: SkillFrontmatter;
  body: string;
}

interface BlockScalarParseResult {
  value: string;
  nextIndex: number;
}

const SKILL_PREVIEW_DESCRIPTION_MAX_LENGTH = 200;

function getLineIndent(line: string): number {
  const indentMatch = line.match(/^(\s*)/);
  return indentMatch ? indentMatch[1].length : 0;
}

function parseScalarValue(rawVal: string): string | boolean {
  if (rawVal === "true") return true;
  if (rawVal === "false") return false;

  return rawVal
    .replace(/^"(.*)"$/, "$1")
    .replace(/\\"/g, '"')
    .replace(/^'(.*)'$/, "$1");
}

function normalizeBlockLines(blockLines: string[]): string[] {
  const nonEmptyIndents = blockLines
    .filter((line) => line.trim().length > 0)
    .map(getLineIndent);
  const minIndent = nonEmptyIndents.length ? Math.min(...nonEmptyIndents) : 0;

  return blockLines.map((line) => line.slice(Math.min(minIndent, line.length)));
}

function formatBlockScalarValue(
  indicator: string,
  blockLines: string[]
): string {
  const normalizedLines = normalizeBlockLines(blockLines);
  const usesFoldedStyle = indicator.startsWith(">");
  const stripsTrailingNewline = indicator.endsWith("-");

  if (usesFoldedStyle) {
    return normalizedLines
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");
  }

  const literalValue = normalizedLines.join("\n");
  return stripsTrailingNewline
    ? literalValue.replace(/\n+$/, "")
    : literalValue;
}

function parseBlockScalar(
  lines: string[],
  startIndex: number,
  parentIndent: number,
  indicator: string
): BlockScalarParseResult {
  const blockLines: string[] = [];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index];
    const isBlank = line.trim().length === 0;
    const indent = getLineIndent(line);

    if (!isBlank && indent <= parentIndent) break;

    blockLines.push(line);
    index += 1;
  }

  return {
    value: formatBlockScalarValue(indicator, blockLines),
    nextIndex: index,
  };
}

function truncateSkillPreviewDescription(description: string): string {
  const trimmed = description.trim();
  return trimmed.length > SKILL_PREVIEW_DESCRIPTION_MAX_LENGTH
    ? `${trimmed.slice(0, SKILL_PREVIEW_DESCRIPTION_MAX_LENGTH)}…`
    : trimmed;
}

function normalizeDescriptionValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0
    ? truncateSkillPreviewDescription(trimmed)
    : undefined;
}

export function parseSkillFrontmatter(content: string): ParseResult | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return null;

  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) return null;

  const afterOpen = trimmed.slice(firstNewline + 1);
  const closingIdx = afterOpen.indexOf("\n---");
  if (closingIdx === -1) return null;

  const yamlBlock = afterOpen.slice(0, closingIdx);
  const body = afterOpen.slice(closingIdx + 4).replace(/^\n+/, "");

  const frontmatter: SkillFrontmatter = {};
  const lines = yamlBlock.split("\n");
  let currentKey: string | null = null;
  let currentIndent = -1;
  const nestedObj: Record<string, string> = {};
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) {
      index += 1;
      continue;
    }

    const indent = getLineIndent(line);

    if (indent > 0 && currentKey && indent > currentIndent) {
      const nestedMatch = line.trim().match(/^([^:]+):\s*"?(.+?)"?\s*$/);
      if (nestedMatch) {
        nestedObj[nestedMatch[1].trim()] = nestedMatch[2].trim();
        frontmatter[currentKey] = { ...nestedObj };
      }
      index += 1;
      continue;
    }

    const kvMatch = line.match(/^([^:]+):\s*(.*?)\s*$/);
    if (!kvMatch) {
      index += 1;
      continue;
    }

    const key = kvMatch[1].trim();
    const rawVal = kvMatch[2].trim();

    currentKey = null;
    currentIndent = indent;

    if (/^[>|][+-]?$/.test(rawVal)) {
      const parsedBlock = parseBlockScalar(lines, index, indent, rawVal);
      frontmatter[key] = parsedBlock.value;
      index = parsedBlock.nextIndex;
      continue;
    }

    if (rawVal === "") {
      currentKey = key;
      currentIndent = indent;
      Object.keys(nestedObj).forEach(
        (nestedKey) => delete nestedObj[nestedKey]
      );
      index += 1;
      continue;
    }

    frontmatter[key] = parseScalarValue(rawVal);
    index += 1;
  }

  return { frontmatter, body };
}

export function extractSkillPreviewDescription(
  raw: string | undefined
): string | undefined {
  if (!raw) return undefined;

  const parsedFullContent = parseSkillFrontmatter(raw);
  const frontmatterDescription = normalizeDescriptionValue(
    parsedFullContent?.frontmatter.description
  );
  if (frontmatterDescription) return frontmatterDescription;

  if (/^\s*description\s*:/m.test(raw)) {
    const parsedYamlFields = parseSkillFrontmatter(`---\n${raw.trim()}\n---\n`);
    const yamlDescription = normalizeDescriptionValue(
      parsedYamlFields?.frontmatter.description
    );
    if (yamlDescription) return yamlDescription;
  }

  const body = parsedFullContent?.body ?? raw;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("<!--")) continue;
    if (trimmed.startsWith("#")) continue;
    return truncateSkillPreviewDescription(trimmed);
  }

  return undefined;
}

export function serializeFrontmatter(
  frontmatter: SkillFrontmatter,
  body: string
): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === "object" && !Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const [nestedKey, nestedVal] of Object.entries(
        value as Record<string, string>
      )) {
        lines.push(`  ${nestedKey}: ${nestedVal}`);
      }
    } else {
      const str = String(value);
      const needsQuote =
        str.includes(":") ||
        str.includes("\n") ||
        str !== str.trim() ||
        str === "";
      if (needsQuote) {
        lines.push(`${key}: "${str.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${str}`);
      }
    }
  }

  lines.push("---");
  return lines.join("\n") + "\n" + (body ? "\n" + body : "");
}
