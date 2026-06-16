# Collaboration / Team Collaboration Hub — Review (2026-06-16, branch `Dev`)

Read-only audit of the cloud collaboration feature: "Add ORG → Cloud → Join" flow,
group chat (群聊), members (成员), session sharing, and the Cloudflare hub worker.
No source files were modified.

Scope read:

- `src/store/collaboration/protocol.ts`, `types.ts`, `collabOrgsAtom.ts`
- `src/features/TeamCollaboration/collabHubClient.ts`,
  `useCollaborationMetadataSync.ts`,
  `components/CreateCollabOrgView/index.tsx`
- `src/engines/ChatPanel/panels/CollabOrgPanelView.tsx`
- `src/hooks/platform/useDeepLinkHandler.ts`, `src-tauri/tauri.conf.json`
- `cloudflare/collab-hub/src/index.ts`, `route.ts`, `migrations/0001_initial.sql`,
  `wrangler.jsonc`

---

## TL;DR — If you only do 3 things (the join/invite pain)

1. **Make the join form accept just the link.** In JOIN mode, auto-fill the hub URL
   from the pasted `orgii://` invite (it already carries `hub=`), and relax
   `canSubmit` so the user doesn't have to paste the hub URL separately. (B2)
2. **Stop the "Invite already used" dead-end.** Default invites to multi-use (or
   mint a fresh one per copy), map hub errors (`409/410/404`) to friendly localized
   messages, and detect "you're already a member of this ORG → just open it"
   instead of re-accepting. (B3, B4, F9)
3. **Make the invite link actually clickable.** Register the `orgii://` scheme and
   add a `collaboration/join` deep-link route that opens the prefilled join flow (or
   auto-accepts). Today the link is inert. (B1, F1)

**Also treat as a must-fix (not join-specific but serious):** access tokens are
currently broadcast to every member over the presence channel and persisted to
other members' `localStorage` (S1). This should be fixed before promoting the
feature.

### Couldn't verify

- Whether the OS actually registers the deep-link scheme at install time (only the
  Tauri config + handler were inspected, not a built bundle).
- Runtime D1/Durable Object behavior (static read only).
- The generated copy under `cloudflare/collab-hub/templates/worker/**` was not
  diffed against `src/**`; assumed to mirror it.

---

## Bugs to fix

| #   | Sev     | Eff | Location                                                                   | Problem                                                                                                                                                                                                                                                                                             | Suggested fix                                                                                                                                                                             |
| --- | ------- | --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Blocker | M   | `protocol.ts:165`; `tauri.conf.json:64-67`; `useDeepLinkHandler.ts:36`     | Invite links are `orgii://collaboration/join?…` but Tauri only registers the `yorgai` scheme, and the deep-link handler only strips `yorgai://` and maps to `/orgii/...` router paths. No `collaboration/join` route exists. Clicking an invite link does nothing.                                  | Register `orgii` in `deep-link.desktop.schemes` (or emit `yorgai://`), add a branch in the handler for `collaboration/join`, and route it to the join flow with `hub`/`invite` prefilled. |
| B2  | High    | S   | `CreateCollabOrgView/index.tsx:208,252-258`                                | `canSubmit` always requires `hubUrl.trim()` for cloud, even in JOIN mode where the pasted link already embeds `hub=` (`parseCollabInviteInput` returns it). User is forced to paste the hub URL twice.                                                                                              | In JOIN mode derive hub from `inviteInput`; auto-fill `hubUrl` state on change; drop the `hubUrl` requirement from `canSubmit` when the parsed invite carries a hub.                      |
| B3  | High    | M   | worker `index.ts:295,349`; `CreateCollabOrgView/index.tsx:218-222,263-264` | Invites default to `usageLimit: 1`; the org-creation auto-invite is minted with no `usageLimit` → 1; reusing a link returns raw `409 "Invite already used"` shown verbatim. No "already a member" handling.                                                                                         | Default to multi-use (or mint fresh invite each copy); map `404/409/410` to friendly localized copy; detect existing local membership and offer "Open ORG" instead of re-accept.          |
| B4  | High    | M   | worker `index.ts:366-383`                                                  | `handleAcceptInvite` always INSERTs a brand-new member with a new token on every accept — no idempotency. Rejoining/duplicate clicks create duplicate members and orphaned tokens.                                                                                                                  | Dedupe by (org, displayName, identityKind) or return existing member; or bind invites to an identity.                                                                                     |
| B5  | High    | M   | `collabHubClient.ts:223-260`; `useCollaborationMetadataSync.ts:194`        | No WebSocket reconnect/backoff. `onClose` just sets `DISCONNECTED`; the socket is only rebuilt when effect deps change, so a dropped connection stays dead (no presence, no live updates).                                                                                                          | Add exponential-backoff reconnect (with jitter + cap) in the client or hook.                                                                                                              |
| B6  | High    | S   | `useCollaborationMetadataSync.ts:180-192,259-266`                          | The connection effect lists `sessions` in its dependency array, so **every local session change tears down and recreates all sockets**, re-emits presence, and re-sends all session metadata → flapping + redundant traffic.                                                                        | Split connection lifecycle from session broadcasting; keep `sessions` in a ref and push updates over the existing socket instead of reconnecting.                                         |
| B7  | High    | M   | worker `index.ts:419-441`, `route.ts:76-83`; no client caller              | The hub exposes `GET /orgs/{id}/bootstrap` (org + **all** members) but nothing in `src/**` calls it. The 成员 tab is populated only by inference from presence/session/chat (`useCollaborationMetadataSync.ts:133-142`), so members who aren't currently active — notably the admin — never appear. | Call `bootstrap` on org load/connect to seed `collabMembersAtom` authoritatively (roles included).                                                                                        |
| B8  | Medium  | S   | `useCollaborationMetadataSync.ts:199-206`                                  | `PRESENCE_UPDATE` only upserts _active_ members; `active:false` and `removedAt` are ignored, so members never show offline and removed members linger. "Active today" in the panel is derived from session `lastActivityAt`, not real presence.                                                     | Handle `active:false` (mark offline) and `removedAt` (drop); surface real presence.                                                                                                       |
| B9  | Medium  | S   | `collabHubClient.ts:247-250`                                               | `onmessage` does `JSON.parse` + `parseCollabMessageEnvelope` (zod) with no try/catch; a malformed or forward-incompatible envelope throws unhandled inside the listener.                                                                                                                            | Wrap parse in try/catch, log and drop unknown messages (forward-compat).                                                                                                                  |
| B10 | Medium  | S   | `CollabOrgPanelView.tsx:195-198,288-307`                                   | "current member" is "first member with an `accessToken`". If tokens leak via presence (S1), multiple members match. The no-token chat fallback writes purely local messages that are never synced — silent divergence.                                                                              | Track the self member id explicitly per org; remove the local-only chat fallback or label it clearly.                                                                                     |

## Security concerns

| #   | Sev         | Eff | Location                                                                   | Problem                                                                                                                                                                                                                                                                         | Suggested fix                                                                                                                                     |
| --- | ----------- | --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Blocker     | S   | `useCollaborationMetadataSync.ts:168-179,199-206`; `protocol.ts:58,96-102` | Presence sends `payload.member`, and `CollabMemberRecordSchema` allows `accessToken`, so the sender's **bearer token is broadcast to every connected member** and receivers `upsert` + persist it to `localStorage`. Any org member can harvest others' (incl. admin's) tokens. | Strip `accessToken` before sending/broadcasting; remove it from the presence payload type; have the hub reject/strip tokens in relayed envelopes. |
| S2  | Medium/High | M   | `collabOrgsAtom.ts:70-76`                                                  | `collabMembersAtom` (which carries `accessToken`) is persisted via `atomWithStorage` to `localStorage`; XSS → token theft, and it's the vehicle that makes S1 persistent.                                                                                                       | Keep tokens out of synced/persisted member records; store in OS keychain / Tauri secure store keyed by member id.                                 |
| S3  | Medium      | M   | `collabHubClient.ts:241`; worker `index.ts:182-189`                        | Access token is passed as a `?access_token=` query param on the WS URL; query strings are commonly logged by proxies/CF.                                                                                                                                                        | Authenticate via `Sec-WebSocket-Protocol` or a first-message handshake instead of the query string.                                               |
| S4  | Medium      | M   | worker `route.ts:26-28`; `index.ts:221-279`                                | `POST /orgs` (create org) is fully unauthenticated and unthrottled — anyone who knows the hub URL can spam orgs/members.                                                                                                                                                        | Add an optional hub provisioning secret and/or rate limiting.                                                                                     |
| S5  | Medium      | M   | worker `index.ts:597-616`                                                  | The Durable Object relays client WS messages verbatim (`broadcast(event.data)`) with no validation that `senderMemberId` matches the authenticated member. Clients can forge presence/session/chat envelopes on behalf of others.                                               | Validate/stamp identity server-side; don't trust client `senderMemberId`.                                                                         |
| S6  | Low         | S   | worker `route.ts:97-101`                                                   | `access-control-allow-origin: *`. Token-based so limited blast radius, but broad.                                                                                                                                                                                               | Acceptable for a desktop client; note and revisit if a web client is added.                                                                       |
| S7  | Low         | S   | `protocol.ts:140-145`                                                      | `normalizeCollabHubUrl` accepts any URL scheme/host (no https allowlist). Minor SSRF-ish surface from the desktop app.                                                                                                                                                          | Require `https` (allow `localhost`/`http` only in dev).                                                                                           |

## Missing features / enhancements

| #   | Sev    | Eff | Area                | Gap                                                                                                                                                                                          | Suggested fix                                                                        |
| --- | ------ | --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| F1  | High   | M   | Join                | No deep-link auto-join (depends on B1).                                                                                                                                                      | Clicking an invite opens Add ORG prefilled, or auto-accepts with a confirm.          |
| F2  | High   | M   | Lifecycle           | No "leave ORG" / remove-local-org UI; `collabOrgsAtom` never deletes; hub has no self-leave endpoint (only admin `removeMember`).                                                            | Add self-leave (client + hub endpoint) and local-org removal.                        |
| F3  | Medium | S   | Members             | Hub `removeMember` (`index.ts:400`, `route.ts:48`, tested in `collabHubRoute.test.ts`) has **no frontend caller**.                                                                           | Wire an admin "remove member" action in the 成员 tab.                                |
| F4  | Medium | M   | Invites             | Schema has `revoked_at` / `expires_at` / `usage_limit`, but there's no revoke endpoint/route, no UI to set expiry or usage, and no invite list. `CollabInviteRecord.revokedAt` is never set. | Add revoke + expiry/usage controls and an invite list.                               |
| F5  | Medium | M   | Presence            | "Active today" is a proxy from session metadata; no heartbeat, and the DO doesn't persist presence, so late joiners see no one online.                                                       | Add presence heartbeat + DO-side roster so new connections get current online state. |
| F6  | Low    | S   | Reliability surface | `collabConnectionStatesAtom` is maintained but the panel doesn't surface per-org connection state prominently.                                                                               | Show connection/error state in the panel header.                                     |
| F7  | Low    | S   | Schema              | The `events` table (migration `0001_initial.sql:41-52`) is dead — the worker never reads/writes it; member "sync from activity" is purely client-side inference.                             | Either implement an activity feed/member sync endpoint or drop the table.            |
| F8  | Low    | S   | i18n                | Hub errors are raw English strings surfaced directly (`CreateCollabOrgView:264`, `CollabOrgPanelView:267,310,383`). UI key coverage itself looks complete across locales.                    | Map known hub error codes to localized keys.                                         |

---

## Notes on the originally-surfaced gaps

1. **Deep link mismatch** — Confirmed (B1). Scheme + handler + missing route all broken.
2. **Hub URL required despite embedded `hub`** — Confirmed (B2).
3. **Single-use invite / raw error / no already-member handling** — Confirmed (B3, B4, F9-style detection).
4. **成员 may not show all members** — Confirmed (B7). `bootstrap` exists server-side but is never called; member list is inference-only. The "sync members from activity" work is client-side inference (`memberFromRemoteSession`/`memberFromChatMessage`), not an authoritative hub sync; the `events` table is unused (F7).
5. **`PRESENCE_UPDATE` not handled** — Partially inaccurate: it _is_ handled in `useCollaborationMetadataSync.ts:199-206`, but only for active members (offline/removed ignored — B8), and the handler is the vector for the token-leak (S1).
