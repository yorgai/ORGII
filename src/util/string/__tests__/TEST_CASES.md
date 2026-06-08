# Test Cases — `src/util/string/truncate.ts`

## `truncate(text, max, opts?)`

Consolidates 6 previously duplicated local `truncate` helpers (see commit for file list).

### Basic truncation

| Input           | max | Expected     | Notes                            |
| --------------- | --- | ------------ | -------------------------------- |
| `"hello"`       | 10  | `"hello"`    | Short string — no truncation     |
| `"hello"`       | 5   | `"hello"`    | Exactly at limit — no truncation |
| `"hello!"`      | 5   | `"hell…"`    | One over limit                   |
| `"hello world"` | 8   | `"hello w…"` | Typical mid-string cut           |
| `"abcdef"`      | 4   | `"abc…"`     | Ellipsis replaces last char      |

### Ellipsis length guarantee

The returned string is always `≤ max` characters. The ellipsis (`"…"`, 1 char) takes
the place of the last character; with a 3-char ASCII ellipsis (`"..."`), it takes the
last 3 characters.

| Input           | max | ellipsis | Expected length |
| --------------- | --- | -------- | --------------- |
| any long string | 10  | `"…"`    | 10              |
| any long string | 10  | `"..."`  | 10              |

### Edge: max = ellipsis length

| Input     | max | Expected |
| --------- | --- | -------- |
| `"hello"` | 1   | `"…"`    |

### `collapseNewlines` option

| Input                      | max | collapseNewlines | Expected              |
| -------------------------- | --- | ---------------- | --------------------- |
| `"  line one\nline two  "` | 100 | true             | `"line one line two"` |
| `"line one\nline two"`     | 12  | true             | `"line one li…"`      |
| `"line\none"`              | 100 | false (default)  | `"line\none"`         |
