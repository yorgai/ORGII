# Test Cases: AgentErrorChatItem (error message sanitization)

Covers the defensive display layer for agent/LLM error messages, primarily the
`sanitizeAgentErrorMessage` helper that feeds `AgentErrorChatItem`.

## Preconditions

- An agent turn has failed and an `AgentErrorChatItem` is rendered with an
  `errorMessage` string produced by the Rust providers layer.
- The message is rendered as plain text inside a `whitespace-pre-wrap` block
  (never via `dangerouslySetInnerHTML`).

## Happy Path

| #   | Steps                                                                                       | Expected Result                          |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | Backend returns a clean message `LLM error: Request failed: HTTP 500 Internal Server Error` | Rendered verbatim (no HTML, single line) |
| 2   | Backend returns a structured JSON error `HTTP 400: {"error":{"message":"bad model"}}`       | Rendered verbatim, JSON preserved        |

## Edge Cases

| #   | Scenario                                        | Steps                                                                                                  | Expected Result                                                          |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1   | Raw HTML 500 page leaks through (older backend) | `errorMessage = "LLM error: Request failed: HTTP 500: <!doctype html>...500 Internal Server Error..."` | Collapsed to `LLM error: Request failed: HTTP 500 Internal Server Error` |
| 2   | HTML page with no surrounding prose             | `errorMessage = "<!doctype html>...<title>500 Internal Server Error</title>..."`                       | `HTTP 500 Internal Server Error`                                         |
| 3   | Unknown status code with `<title>`              | `errorMessage = "Request failed: HTTP 599: <html><title>Edge Gateway Down</title>..."`                 | `Request failed: HTTP 599 Edge Gateway Down`                             |
| 4   | HTML with neither status nor title              | `<html><body><h1>broken</h1></body></html>`                                                            | `Server error`                                                           |
| 5   | Empty / null message                            | `errorMessage = ""`                                                                                    | Empty string (panel shows title only)                                    |
| 6   | Leading `Error:` prefix                         | `"Error: something broke"`                                                                             | `something broke`                                                        |
| 7   | Excessive blank lines                           | `"line one\n\n\n\nline two"`                                                                           | Blank runs collapsed to a single blank line                              |
| 8   | Very long body (2000 chars)                     | `"x".repeat(2000)`                                                                                     | Truncated to 600 chars ending with `…`                                   |
| 9   | Multibyte / padded whitespace                   | `"   padded message   "`                                                                               | Trimmed to `padded message`                                              |

## Error / Degraded States

| #   | Scenario                          | Steps                 | Expected Result                            |
| --- | --------------------------------- | --------------------- | ------------------------------------------ |
| 1   | Backend offline / generic failure | Non-HTTP error string | Passed through, trimmed and length-bounded |

## Accessibility

- [x] Message is plain text (screen-reader friendly), never injected HTML.
- [x] Resume button keyboard-navigable (existing `Button` component).
- [x] Danger `InlineAlert` provides a titled, bordered region.

## Acceptance Criteria

- [x] Raw HTML error pages never render as markup or as multi-line raw HTML.
- [x] HTTP errors surface as `HTTP <code> <reason phrase>`.
- [x] Structured/plain messages are preserved unchanged.
- [x] Output is length-bounded and whitespace-normalized.
- [x] Logic is extracted to a tested `.ts` helper (`sanitizeAgentErrorMessage`).
