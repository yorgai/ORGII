# @orgii/marketplace

This directory will hold the **commercial marketplace overlay**:
marketplace UI (modules/Market, MarketListing feature, MarketAuth
components), market HTTP client, market hooks, market-key session
runner gating, listing/provider wizards, and the Rust marketplace
crate (proxy release, MITM cert, Stripe glue, payout, market_key
session enforcement).

**Status:** skeleton only. PR 1 establishes the directory shape;
no real code has been moved yet. Marketplace frontend extraction
lands in PR 4a, the auth/login surface extraction in PR 4b, and
the Rust marketplace crate extraction in PR 5.

License: **proprietary / UNLICENSED**. This package is NOT
open-sourced — it contains matching algorithms, key validators
with provider-specific error parsing, MITM CA logic, and billing
integration that must remain closed.

See `Documentation/RustBackend/oss-boundary--0506.md` for the full
boundary design and the rationale for keeping this layer private.
