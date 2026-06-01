# Rust Backend Conventions

This document captures the naming conventions and patterns used in the Rust backend.

## Constant Naming

### Limits and Thresholds

| Pattern       | Usage             | Example                                     |
| ------------- | ----------------- | ------------------------------------------- |
| `MAX_*`       | Upper bound       | `MAX_FILE_SIZE_BYTES`, `MAX_RETRIES`        |
| `MIN_*`       | Lower bound       | `MIN_SIMILARITY`, `MIN_IMPORTANCE`          |
| `DEFAULT_*`   | Default value     | `DEFAULT_TIMEOUT_SECS`, `DEFAULT_PAGE_SIZE` |
| `*_LIMIT`     | Rate/count limit  | `RATE_LIMIT_PER_MINUTE`                     |
| `*_THRESHOLD` | Decision boundary | `PENDING_STALE_THRESHOLD_MS`                |

### Timeouts and Intervals

| Pattern                          | Usage             | Example                         |
| -------------------------------- | ----------------- | ------------------------------- |
| `*_TIMEOUT` / `*_TIMEOUT_SECS`   | Operation timeout | `GIT_TIMEOUT_SECONDS`           |
| `*_INTERVAL` / `*_INTERVAL_SECS` | Periodic interval | `HEALTH_CHECK_INTERVAL_SECONDS` |
| `*_DELAY` / `*_DELAY_MS`         | Backoff delay     | `RETRY_BASE_DELAY_MS`           |
| `*_TTL` / `*_TTL_SECONDS`        | Cache TTL         | `CACHE_TTL_SECONDS`             |

### Sizes

| Pattern                   | Usage             | Example             |
| ------------------------- | ----------------- | ------------------- |
| `*_SIZE` / `*_SIZE_BYTES` | Size in bytes     | `MAX_ARCHIVE_SIZE`  |
| `*_SIZE_MB`               | Size in megabytes | `MAX_CACHE_SIZE_MB` |
| `*_CHARS`                 | Character count   | `MAX_OUTPUT_CHARS`  |
| `*_TOKENS`                | Token count       | `MAX_TOKENS`        |
| `*_LINES`                 | Line count        | `MAX_LINES_TO_READ` |

### Counts and Entries

| Pattern            | Usage                 | Example                  |
| ------------------ | --------------------- | ------------------------ |
| `MAX_*_ENTRIES`    | Collection size limit | `MAX_RECENT_ENTRIES`     |
| `MAX_*_PER_*`      | Per-scope limit       | `MAX_FACTS_PER_SESSION`  |
| `MAX_CONCURRENT_*` | Concurrency limit     | `MAX_CONCURRENT_GIT_OPS` |

## Environment Variables

### Naming

- Use `ORGII_` prefix for application-specific variables
- Use `SCREAMING_SNAKE_CASE`
- Examples: `ORGII_GPU_LAYERS`, `ORGII_EMBEDDER_INPROCESS`

### Feature Flags (if needed)

```rust
// Pattern for future feature flags:
const ENABLE_FEATURE_X: bool = cfg!(feature = "feature_x");

// Or via environment:
fn is_feature_enabled(name: &str) -> bool {
    std::env::var(format!("ORGII_ENABLE_{}", name.to_uppercase()))
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
}
```

## Duration Constants

Prefer explicit unit suffixes:

```rust
// ✅ Good - explicit unit
const SESSION_IDLE_TIMEOUT_SECS: u64 = 3600;
const DEBOUNCE_DELAY_MS: u64 = 100;

// ❌ Avoid - ambiguous unit
const SESSION_TIMEOUT: u64 = 3600; // seconds? ms?
```

## Documentation

All public constants should have doc comments explaining:

1. What the value controls
2. Why this default was chosen (if non-obvious)
3. Valid range (if applicable)

```rust
/// Maximum file size for inline reading (256 KB).
///
/// Files larger than this are truncated or require streaming.
/// Chosen to balance memory usage with typical source file sizes.
const MAX_FILE_SIZE_BYTES: u64 = 256 * 1024;
```
