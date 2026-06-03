# Test Cases: `pill_resolver` — PDF Pill Expansion Fix

## Preconditions

- The agent-core crate builds cleanly (`cargo check -p agent_core` exits 0).
- A user has attached a file via the composer pill UI, producing a message like:
  `Read this document filename [file:/absolute/path/to/file.pdf]`
- The pill is serialized as `[file:/absolute/path]` with no `::` separator
  (i.e. not already carrying inline base64 content).

---

## Happy Path

| #   | Steps                                                         | Expected Result                                                                                                                |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Attach a text-layer PDF pill in the composer                  | `expand_pill_references` produces a `### File:` block containing the extracted PDF text, _not_ `*(Binary or unreadable file)*` |
| 2   | Attach a small plain-text `.txt` file pill                    | Content is inlined verbatim under a fenced code block                                                                          |
| 3   | Attach a `.pdf` pill whose embedded text contains "Hello PDF" | Expanded message contains "Hello PDF"                                                                                          |
| 4   | Message contains no pills                                     | Message is returned unchanged                                                                                                  |
| 5   | Message contains a base64 pill (`[file:path::dGVzdA==]`)      | Pill is skipped; message returned unchanged                                                                                    |

---

## Edge Cases

| #   | Scenario                                                      | Steps                                                   | Expected Result                                                             |
| --- | ------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Scanned PDF (no text layer)                                   | Attach a PDF whose extracted text is blank              | Output: `*(Scanned PDF with no extractable text layer)*`                    |
| 2   | Corrupt / truncated PDF bytes                                 | Write broken PDF bytes to a `.pdf` file; attach as pill | Output: `*(PDF text extraction failed: …)*` with error detail; no panic     |
| 3   | Binary non-PDF file (`.bin`)                                  | Attach a `.bin` file containing non-UTF-8 bytes         | Output: `*(Binary or unreadable file)*`                                     |
| 4   | Text file exactly at the 256 KB cap                           | Create a 262,144-byte text file; attach as pill         | Content is inlined (boundary is inclusive)                                  |
| 5   | Text file just over 256 KB (257 KB)                           | Create a 263,168-byte text file; attach as pill         | Output: `*(File too large: N bytes — showing path only)*`                   |
| 6   | Non-existent file path in pill                                | Use a path that does not exist on disk                  | Pill produces no expansion; original message returned unchanged             |
| 7   | PDF larger than 256 KB text-file cap                          | Attach a PDF > 256 KB                                   | PDF is still processed (size cap does not apply to PDFs); text is extracted |
| 8   | `truncate_content` with multibyte codepoint at limit boundary | String `"a€b"` (€ = 3 bytes) truncated to 2 bytes       | Returns `"a"` — never splits a UTF-8 codepoint                              |
| 9   | Empty string through `truncate_content`                       | `""` truncated to any limit                             | Returns `""`                                                                |

---

## Error / Degraded States

| #   | Scenario                              | Steps                                                                          | Expected Result                                                                                      |
| --- | ------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 1   | `pdf-extract` returns an error        | Feed `extract_pdf_text` a file with `.pdf` extension but invalid PDF structure | `read_file_preview` returns `*(PDF text extraction failed: …)*`; warning logged via `tracing::warn!` |
| 2   | File permissions prevent read         | Create a PDF with mode `000`; attach as pill                                   | `std::fs::read` returns `Err`; `read_file_preview` returns `None`; pill is omitted silently          |
| 3   | File disappears between stat and read | Race: file deleted after `is_file()` check                                     | `std::fs::read` returns `Err`; `?` propagates `None`; pill omitted                                   |

---

## Accessibility

_Not applicable — this module is a backend Rust service with no UI surface._

---

## Acceptance Criteria

- [x] Attaching a PDF pill produces the document's text content, not `*(Binary or unreadable file)*`
- [x] Scanned PDFs (no text layer) produce a legible fallback string
- [x] PDF extraction errors produce a descriptive message, never a panic
- [x] Non-PDF binary files still produce `*(Binary or unreadable file)*`
- [x] The file size cap for plain-text pills is 256 KB (matching `ReadFileTool`)
- [x] `truncate_content` never splits a UTF-8 multi-byte codepoint
- [x] `cargo check -p agent_core` exits 0 with no new warnings
- [x] `cargo test -p agent_core pill_resolver` exits 0 with all tests green
