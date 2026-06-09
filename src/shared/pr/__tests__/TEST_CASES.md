# Test Cases: Shared PR utilities (`@src/shared/pr`)

Pure, cross-surface helpers consolidated from the WorkStation PR card,
WorkItems `PrSection`, and the chat `SessionLinkCard`. Logic is covered by
`prStatus.test.ts`, `types.test.ts`, and `formatStatNumber.test.ts`.

## Preconditions

- None — these are pure functions with no I/O, React, or i18n dependencies.

## Happy Path

| #   | Function                  | Input                               | Expected Result                                |
| --- | ------------------------- | ----------------------------------- | ---------------------------------------------- |
| 1   | `normalizePrStatus`       | `{ state: "OPEN" }`                 | `"open"` (lowercased)                          |
| 2   | `normalizePrStatus`       | `{ state: "closed", merged: true }` | `"merged"` (merged overrides state)            |
| 3   | `getPrStatusVariant`      | `"open"`                            | `{ badgeClass: success, dotClass: success }`   |
| 4   | `getPrStatusLabelKey`     | `"merged"`                          | `"labels.prStatus.merged"`                     |
| 5   | `getPrStatusIconName`     | `"closed"`                          | `"closed"`                                     |
| 6   | `toNormalizedPullRequest` | full GitHub PR JSON                 | `NormalizedPullRequest` with all fields mapped |
| 7   | `formatStatNumber`        | `12345`                             | `"12,345"`                                     |

## Edge Cases

| #   | Scenario                         | Function / Input                                 | Expected Result                  |
| --- | -------------------------------- | ------------------------------------------------ | -------------------------------- |
| 1   | Empty / missing state            | `normalizePrStatus({})`                          | `"open"` (default)               |
| 2   | Unknown / custom state           | `normalizePrStatus({ state: "pending_review" })` | `"pending_review"` (passthrough) |
| 3   | Unknown status variant           | `getPrStatusVariant("pending_review")`           | neutral fallback variant         |
| 4   | Empty status key                 | `getPrStatusVariant("")`                         | neutral fallback variant         |
| 5   | Unknown status icon              | `getPrStatusIconName("pending_review")`          | `"pull-request"` (default)       |
| 6   | Partial raw PR (url+status only) | `toNormalizedPullRequest({}, { url, number })`   | optional fields `undefined`      |
| 7   | Non-string/number raw fields     | `toNormalizedPullRequest({ html_url: 42 })`      | coerced defensively (`url: ""`)  |
| 8   | Fractional / negative stat       | `formatStatNumber(-45.9)`                        | `"-45"` (truncated, sign kept)   |
| 9   | NaN / Infinity stat              | `formatStatNumber(NaN)`                          | `"0"`                            |

## Error / Degraded States

| #   | Scenario                   | Expected Result                                            |
| --- | -------------------------- | ---------------------------------------------------------- |
| 1   | `null` / `undefined` state | `normalizePrStatus({ state: null })` → `"open"` (no throw) |

## Acceptance Criteria

- [ ] All four PR surfaces (PR card, `PrSection`, `SessionLinkCard`, `DiffSummary`) consume these helpers — no local status palettes or number formatters remain.
- [ ] Visual output (badge/dot Tailwind classes) is byte-identical to the pre-consolidation maps.
- [ ] Status labels resolve via i18n keys, never hardcoded English.
