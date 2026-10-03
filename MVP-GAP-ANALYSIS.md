# BRAICE MVP — Gap Analysis Against the Specification PDFs

**Date:** 2 October 2026
**Scope:** `braice_colosseum_bend` (NestJS API + Solana/Anchor) and `braice_colosseum_fend` (Next.js)
**Method:** All 7 specification PDFs in the repo root were extracted with `pdftotext -layout` and read in full. The codebase was then audited module-by-module against them, and the critical configuration claims were verified directly against the working tree.

---

## How to read this document

Section 2 records what is genuinely working, because two items that would normally be assumed to be faked in a hackathon build are real, and that materially changes the priority order.

Section 3 is the gap list, ordered by the specification's own P0/P1 ranking (§60) and its Definition of Done (§58).

Section 6 lists things that look like gaps but are **not** — they are explicitly out of scope per the MVP boundary. Do not spend hackathon time on them.

---

## 1. Source documents

| Document | Pages | Role |
|---|---|---|
| `BRAICE — Colosseum Hackathon Engineering Build Plan.pdf` | 62 | **Authoritative.** Defines the MVP boundary, priority order, and Definition of Done. |
| `AI Component of BRAICE.pdf` | 9 | Long-term three-AI product vision. |
| `BRAICE User Story (1).pdf` | 23 | Full product experience. |
| `BRAICE Community Governance Structure.pdf` | 6 | Long-term governance model. |
| `BRAICE Practical Community Governance Example.pdf` | 8 | Worked example. |
| `BRAICE Practical Community Governance Example (1).pdf` | 8 | **Byte-identical duplicate** of the above. |
| `BRIACE Community Offerings.pdf` | 12 | Full product. Note the typo in the filename ("BRIACE"). |

Where documents conflict, the **Build Plan** governs. The User Story, Governance Structure, and AI Component documents describe a platform several stages beyond the vertical slice the Build Plan scopes.

### The Build Plan's central thesis

> Community governance can be translated into machine-enforceable, revocable permissions that control how applications and AI access community-generated data.

The prototype must demonstrate one complete chain:

```
Community activity → Individual data → Aggregation → Access request → Governance decision
  → Permission → Authorized AI analysis → Revocation → Access prevented
```

---

## 2. What is genuinely done well

This is not a conventional mockup-heavy submission. Two components that could plausibly have been faked are real implementations, and they are the two the specification cares most about.

### 2.1 The permission engine is a real enforcement engine

Location: `packages/permission-engine/src/permission-engine.ts:30-113`, wrapped by `apps/api/src/modules/permissions/permissions.service.ts:53-83`.

All six reason codes required by Build Plan §19 are present and named **exactly** as specified:

| Required reason code | Present | Emitted at |
|---|---|---|
| `NO_PERMISSION` | Yes | `permission-engine.ts:40-43`, `:72-75` |
| `PERMISSION_NOT_ACTIVE` | Yes | `permission-engine.ts:50-53` |
| `PERMISSION_EXPIRED` | Yes | `permission-engine.ts:56-59` |
| `OPERATION_NOT_ALLOWED` | Yes | `permission-engine.ts:67-70` |
| `PURPOSE_MISMATCH` | Yes | `permission-engine.ts:62-65` |
| `INDIVIDUAL_DATA_RESTRICTED` | Yes | `permission-engine.ts:81-88`, `:100-106` |

Two additional codes exist beyond the spec: `PERMISSION_REVOKED` and `RESOURCE_NOT_FOUND`. Both are improvements.

Three properties that matter more than the code being present:

- **Expiry is enforced at check time**, against `expiresAt` compared to a caller-supplied clock (`permission-engine.ts:56-59`). It is not deferred to a scheduled job. `PermissionsService.expireLapsed()` (`permissions.service.ts:343-356`) exists but is explicitly documented as cosmetic for reporting honesty.
- **`allowIndividualData: false` is server-owned.** `buildDefaultConditions()` (`permission-engine.ts:136-142`) is the only construction site, called by `PermissionsService.createFromDecision()` (`permissions.service.ts:165`). There is no caller-supplied path that can set it true — this is the Build Plan §17 requirement that "this must not merely be a UI flag."
- **Denial ordering is deliberate and tested.** Revocation is reported ahead of an individual-data request (`permission-engine.spec.ts:263-291`), so the demo shows the more specific reason.

### 2.2 The Solana program is real, not a mock

A hand-written Anchor program in Rust:
- `programs/braice-governance/Anchor.toml`, `Cargo.toml`, 15 `.rs` files
- Program `braice_governance` (`src/lib.rs:38-41`)
- All four required instructions: `initialize_community` (`:45`), `create_permission` (`:61`), `revoke_permission` (`:82`), `record_governance_decision` (`:90`)
- All three required accounts: `CommunityState`, `PermissionState`, `GovernanceEvent`

The TypeScript client performs genuine Borsh transaction construction and submission:

```
apps/api/src/modules/blockchain/blockchain.service.ts:207-214
  → packages/blockchain-client/src/solana-client.ts:136-146
  → packages/blockchain-client/src/transaction-builder.ts:234-263
  → solana-client.ts:185   const raw = await this.connection.sendTransaction(transaction, [this.signer], options);
  → solana-client.ts:212   return raw;   // the RPC's own signature, not a generated one
```

A search for fabricated-signature patterns (`Math.random()`, `randomUUID()`, `Date.now()` in signature construction) returned **zero matches**. The client also inspects `confirmation.value.err` (`solana-client.ts:198-210`) specifically so a rejected transaction is never persisted as a valid anchor.

Also correctly honoured:
- **The chain is absent from the runtime authorization path** (Build Plan §34). Grepping `blockchain|solana|chain` across `authorization.service.ts`, `permission.guard.ts`, and both copies of the engine returns zero matches.
- **No PII reaches the chain** (Build Plan §31). The three `state/*.rs` files contain only `[u8; 32]`, `Pubkey`, `i64`, and enums. All free text is hashed before transmission (`transaction-builder.ts:175-176`).
- `policy_hash` is a real `SHA-256` over a recursively key-sorted canonical form (`apps/api/src/modules/blockchain/hash.service.ts:23-50`), stored on `permissions.policy_hash` (`001_init.sql:95`) and mirrored on-chain.

### 2.3 Verified working

Scenarios A–I of the Build Plan §58 Definition of Done all pass. 542 backend tests pass across 25 suites. The deny paths were additionally verified live against the running API:

| Scenario | Requirement | Result |
|---|---|---|
| A | Community generates activity | Pass |
| B | BRAICE generates community intelligence | Pass |
| C | Brand requests access | Pass |
| D | Governance approves | Pass |
| E | Permission is created | Pass |
| F | AI analyzes authorized data | Pass |
| G | AI attempts individual-level access | **Denied** — correct |
| H | Permission is revoked | Pass |
| I | AI tries again | **Denied** — correct |
| J | **State is verifiable** | **FAIL — see §3.1** |

The security boundaries the Build Plan calls "the critical security boundary" (§23) hold: no route returns individual activity records at all (removed, asserted 404 in `activity.controller.spec.ts:119-139`), and `AuthorizationService.loadAuthorizedDataset()` (`authorization.service.ts:91-119`) is the single choke point the AI layer uses.

---

## 3. Gaps

Ordered by the Build Plan's own §60 priority ranking.

### 3.1 P0 — Scenario J fails: the blockchain layer is not verifiable

**This is the single most important gap.** Build Plan §58 states: *"If any of these fail, the prototype is not ready."* Nine of ten scenarios pass; the tenth is the one that demonstrates the Colosseum thesis.

Verified configuration in the working tree:

| Item | Actual state |
|---|---|
| `SOLANA_KEYPAIR_PATH` (`.env:24`) | **empty** → `isEnabled()` returns false (`blockchain.service.ts:61-68`) |
| `SOLANA_PROGRAM_ID` (`.env:7`) | `CWbFGytKpFHyc89hiS6xumcSXuHiMcfXxdoji9LkxvPo` |
| `declare_id!` (`programs/.../src/lib.rs:38`) | `5kd7y5YMtwCEggyHQahFFgmS4CeTEdGeaGBjVfuz8p2b` — **does not match** |
| `Anchor.toml:16` | `cluster = "localnet"`; `[programs.localnet]` and `[programs.devnet]` (`:9-14`) declare the *same* ID, which a real devnet deploy would not |
| Devnet deployment | no evidence of a successful deploy anywhere in the repo |
| Explorer / verification link | **none exists** — grep for `explorer.solana`, `solscan`, `clusterApiUrl` across the frontend returns zero hits |
| Verification API | **none exists** — `confirmSignature()` and `fetchPermission()` are implemented (`solana-client.ts:156-171`) but never called from `apps/api` |

Consequences visible in the product:

- Every `permissions.blockchain_reference`, `governance_decisions.blockchain_tx`, and `audit_events.blockchain_tx` is **NULL**.
- The frontend renders the literal strings `"Chain disabled"` (`app/(dashboard)/permissions/[id]/page.tsx:193`) and `"Not anchored"` (`:180`).
- Blockchain references are rendered as **truncated, non-clickable text** — `shortHash(...)` at `permissions/[id]/page.tsx:185-192` and `audit/page.tsx:214-218`. There is no `<a href>`, no `target="_blank"`, no copy-to-clipboard.
- `lib/demo.ts:28-29` documents the state honestly: *"No Solana program is configured, so `policyHash` is present and `blockchainReference` is null."*

**Consequence for the pitch:** the answer to the judge's likely question *"Why do you need blockchain?"* currently renders as `Chain disabled`. The Build Plan §53 answer — *"we don't use blockchain as our database; it provides verifiable state where independent verification has value"* — cannot be demonstrated while the chain is switched off.

**To close it:** deploy to devnet, align `declare_id!` with the deployed program ID, supply a keypair, then add an explorer link and expose the already-built verification primitives behind an endpoint.

### 3.2 P0 — Screen 1 never displays community intelligence

Build Plan §44 Screen 1 requires the dashboard to show interest distribution (Streetwear 42%, Music 31%, …). **No per-category interest rendering exists anywhere in the frontend.** The only `%` renders in the app are governance thresholds.

`app/(dashboard)/community/[id]/page.tsx:125-155` shows three stat cards — member count, activity record count, approval mode. Datasets at `:305-327` render **metadata only** (`datasetType`, `version`, `sourceCount`, `createdAt`); the `data` payload is never read.

Every supporting artifact was written and then never wired:

| Artifact | Location | Call sites |
|---|---|---|
| `CommunityDataset.data: Record<string, number>` | `types/dataset.ts:27` | never read |
| `ProportionBar` — comment: *"used for the interest breakdown"* | `components/ui/status.tsx:116-138` | **zero** |
| `formatPercent` | `lib/utils.ts:83-85` | **zero** |
| `useDatasetContents` | `hooks/use-community.ts:89-101` | **zero** |
| `useGenerateDataset` (POST `datasets/generate`) | `hooks/use-community.ts:150-156` | **zero** |

This is the screen that shows the brand *what it is buying*. It is also mostly wiring rather than new code — the data path and the renderer both already exist.

`/communities` (`communities/page.tsx:83-108`) likewise shows no member count and no intelligence.

### 3.3 P1 — Screen 4 omits the resource and softens the individual-data signal

Build Plan §44 Screen 4 lists nine fields. Eight are present in `app/(dashboard)/permissions/[id]/page.tsx:116-195`; two problems:

- **`Resource` is absent from the permission detail screen.** There is no `DetailRow` for `data.resourceId`; it appears only on the *list* page (`permissions/page.tsx:83`). For a permission whose entire purpose is scoping a grant to one resource, omitting it is conspicuous.
- **`Individual Data: BLOCKED` is not stated explicitly.** The string `BLOCKED` appears nowhere in the repo. The page renders the inverse at `:132-141` — `<Badge tone="lime">Community-level only</Badge>`. Semantically equivalent, but the spec's Screen 4 mockup makes the *negative* assertion, which is the more persuasive thing to show a judge. The natural-language explanation exists at `types/permission.ts:107-108` but is reachable only via a transient toast.

Minor: `Status` has no labelled row; it renders as a badge in the header (`:66`).

### 3.4 P1 — Screen 3 omits the threshold requirement and creator approval

- **`Required: 60` does not exist.** The string `Required` appears nowhere in the frontend. `thresholdPercentage` renders only on the communities list (`communities/page.tsx:99`) and community detail (`community/[id]/page.tsx:152`) — never on the governance screen. The governance screen shows a server-derived *headcount* (`decision.threshold`), not the configured percentage.
- **No creator/operator approval row.** `GovernanceDecision.approvedBy` is **never rendered** — it appears only as a mutation argument (`governance/[id]/page.tsx:98`). The interactive approver checkbox list (`:212-242`) reflects local component state (`approvers`, `:69`), not the recorded decision. Build Plan §44 Screen 3 calls for an explicit `Creator Approval: ✓ Approved` line.
- The literal `63 / 100` tally form does exist, but on `/access-request/[id]` (`:158-162`) rather than the governance screen. `/governance/[id]` shows the equivalent `"63 of 100 approvals"` via `describeTally()` (`types/governance.ts:45-56`).

### 3.5 P1 — Required deliverables absent

| Deliverable (Build Plan §42) | State |
|---|---|
| `docs/architecture.md` | **missing** — the entire `docs/` directory does not exist |
| `docs/permission-model.md` | **missing** |
| `docs/governance-model.md` | **missing** |
| `docs/demo-script.md` | **missing** |
| `scripts/generate-activity.ts` | **stub** — 13 lines, comment-only |
| `scripts/deploy-devnet.ts` | **stub** — 10 lines, comment-only |

Two compounding problems:

- `README.md:623-628` advertises all four `docs/` files as though they exist. These are **broken links a judge will click**, and they are the first documentation a reviewer looks for.
- `scripts/deploy-devnet.ts:10` documents a `pnpm deploy:devnet` command. **That script is not defined in any `package.json`** (verified).

Partial credit elsewhere: `docker-compose.yml` is present (postgres:16-alpine, port 5433, healthcheck); `.github/workflows/ci.yml` is present with a Node job *and* a Rust job running `cargo test --locked` and `anchor build`; `database/migrations/` has four migrations; `scripts/seed-demo.ts` is a real 567-line script.

### 3.6 P1 — On-chain status enum is missing `EXPIRED`

Build Plan §32 requires `0 = ACTIVE, 1 = REVOKED, 2 = EXPIRED`.

`programs/braice-governance/programs/braice-governance/src/constants.rs:46-51`:
```rust
pub enum PermissionStatus {
    Active = 0,
    Revoked = 1,
    // no Expired = 2
}
```
`from_u8` (`:54-61`) returns `None` for 2+. Mirrored client-side at `packages/blockchain-client/src/types.ts:23-26`.

Expiry is instead evaluated at read time via `is_effective_at()` (`state/permission_state.rs:50-52`) — a defensible design, documented at `:46-49`. The off-chain `PermissionStatus` *does* include `EXPIRED` (`packages/permission-engine/src/types.ts:12`). So the three-state model exists; it just does not exist on chain where the spec asked for it.

### 3.7 P1 — `ACCESS_ATTEMPT` audit event does not exist

Build Plan §41 lists the required audit sequence:
```
ACCESS_REQUESTED → GOVERNANCE_APPROVED → PERMISSION_CREATED → AI_ACCESS_GRANTED
  → AI_ANALYSIS_COMPLETED → PERMISSION_REVOKED → ACCESS_ATTEMPT → ACCESS_DENIED
```
`ACCESS_ATTEMPT` is **absent from both** the backend enum (`apps/api/src/modules/audit/entities/audit-event.entity.ts:9-33`) and the frontend union (`types/audit.ts:1-12`). The backend uses `ACCESS_GRANTED` / `ACCESS_DENIED` instead, so the underlying data is captured under a different name — but the spec-named event is absent, and a reviewer checking §41 will not find it.

### 3.8 P2 — Seed data inconsistencies

Build Plan §46 requires ~1,000 activity records across eight categories including **Events**.

- **Counts are correct:** `seed-demo.ts:85-86` sets `MEMBER_COUNT = 100`, `ACTIVITY_COUNT = 1000`, both with real unbounded loops (`:263`, `:304`).
- **"Events" is missing** — `INTEREST_MIX` (`seed-demo.ts:75-83`) has seven categories: streetwear, music_festivals, sneakers, beauty, gaming, technology, travel.
- **The mix is relative weights, not percentages.** They sum to 154 and are normalised at `:201-211`, yielding streetwear ≈ 27.3% rather than the spec's 42%. The steep monotonic decline still produces the "obvious trends" §46 asks for, so this is cosmetic.
- **Three mutually inconsistent seed sources exist:**
  | Source | Categories | Actual rows |
  |---|---|---|
  | `scripts/seed-demo.ts:75-83` | 7 (spec-aligned minus Events) | 1000 ✅ |
  | `database/seeds/seed-activity.sql` | 7 (different header) | **3** (header claims 1000) |
  | `scripts/seed-demo.sh:69` | 9 — includes `food`, `nightlife`, `fitness`, `art`; omits gaming/travel/events | — |

### 3.9 P2 — Frontend/backend enum drift

`ROLE_ASSIGNED` exists in the backend audit enum (`audit-event.entity.ts:32`) but is **missing from the frontend `AuditEventType` union** (`types/audit.ts:1-12`). It degrades gracefully via the `humanize()` fallback at `audit/page.tsx:211`, rendering as "Role assigned" — but the type should carry it.

### 3.10 Scope call — the three-AI requirement is 0 of 3

`AI Component of BRAICE.pdf` §VII requires three clearly separated operator entry points:

| Required AI | In UI | In backend |
|---|---|---|
| ① Customer Relations AI ("Ask about your business") | **missing** | **missing** |
| ② Community Police AI ("Protect your community") | **missing** | **missing** |
| ③ Meta-Brain ("Understand your community") | partial — present but unlabelled | partial |

Grep for `meta.?brain|customer.?relation|community.?police|risk.?flag|anomal|spam|harassment|fraud|bot.?detect|manipulat` across **both** repos returns no matches. There is one generic `/ai` page and one backend route, annotated *"The only AI entry point"* (`ai.controller.ts:40`).

**This is a scoping decision, not a defect.** The Build Plan — which defines the MVP boundary and the P0/P1 ranking — asks for a single agent with one tool (`get_community_insight`, §24), and §54 states plainly that *"AI is an application of the permission architecture rather than the primary innovation thesis."* What is implemented is functionally the Meta-Brain. Customer Relations AI and Community Police AI belong to the long-term product described in the AI Component document.

Flagging it because the AI PDF asks for it explicitly and the two documents disagree about scope. Recommend: do not build these for the hackathon; describe the single AI as the Meta-Brain if asked.

### 3.11 Minor polish

- **AI denial wording.** The spec mockups read `ACCESS DENIED`. The app shows `"Refused"` (`ai/page.tsx:413`) — `RefusalNotice`'s own default is `"Access denied"` (`components/ui/status.tsx:15`) but `/ai` overrides it. The reason code is correctly persisted on screen in mono (`status.tsx:44-46`); the natural-language explanation (`types/permission.ts:112-115`) is **toast-only** and absent from the transcript that stays visible. Also `ai/page.tsx:117` passes the raw code to the toast instead of `explainDenial()`.
- **Revoke button label** is `"Revoke"` / `"Confirm revoke"`, not the spec's `[REVOKE ACCESS]` (`permissions/[id]/page.tsx:68-75`, `:89-106`).
- **Audit ordering** is newest-first (`hooks/use-audit.ts:101-105`); §41 asks for events "in sequence". `buildTimeline()` (`types/timeline.ts:46-60`) and `LIFECYCLE_EVENT_TYPES` (`types/audit.ts:56-62`) implement forward order and are **unused**.
- **Dead UI.** `components/shared/header.tsx` and `sidebar.tsx` are comment-only stubs exporting nothing. The `"Anything else?"` textarea (`access-request/page.tsx:243-253`) is bound to state and never sent — its own hint admits this.
- **After revocation**, `selectedGrant` becomes `null` on the AI page, so the `/authorize` pre-check (`ai/page.tsx:94-102`) is silently skipped. The denial still surfaces correctly via `AiResponse.denied`, so the demo outcome is right; only the pre-check disappears.

**No dangling API wiring was found.** All 24 endpoint builders in `lib/api-endpoints.ts` resolve to real backend routes.

---

## 4. Recommended order of work

1. **Turn the chain on** (§3.1) — deploy to devnet, align `declare_id!` with `.env`, set a keypair. Add the explorer link and expose `confirmSignature` behind a verify endpoint. **This is Scenario J and the entire Colosseum thesis.**
2. **Render the interest breakdown** (§3.2) — `ProportionBar`, `formatPercent`, and `useDatasetContents` already exist; this is wiring, not new code. Wire `useGenerateDataset` too, so an operator can create a dataset from the UI.
3. **Close Screen 4** (§3.3) — add the `resourceId` row and an explicit `Individual Data: BLOCKED` badge.
4. **Write `docs/`, or delete the four README links** (§3.5) — broken links are worse than absent features. At minimum `docs/demo-script.md`, which §50 specifies in full.
5. **Reconcile the seed sources** (§3.8) — delete or regenerate `seed-activity.sql`, and make `seed-demo.sh` use the same category set as `seed-demo.ts`.
6. **Add `Expired = 2` to the on-chain enum** (§3.6) and **`ACCESS_ATTEMPT`** to both enums (§3.7) — small, and each maps to an explicit spec line.

Items 1–4 are what a judge actually sees.

---

## 5. Verification commands

```bash
# Confirm the chain is disabled
grep -n "SOLANA" .env
grep -n "declare_id" programs/braice-governance/programs/braice-governance/src/lib.rs
grep -n "cluster\|\[programs" programs/braice-governance/Anchor.toml

# Confirm the advertised docs do not exist
ls docs                      # -> No such file or directory
sed -n '620,630p' README.md  # -> advertises all four

# Confirm the stub scripts and missing command
wc -l scripts/generate-activity.ts scripts/deploy-devnet.ts
grep -rn "deploy:devnet" package.json apps/api/package.json   # -> no match

# Confirm dead code for the interest breakdown
grep -rn "ProportionBar\|formatPercent\|useDatasetContents\|useGenerateDataset" \
  app components hooks lib types | grep -v "export function\|export const\|^.*: *\*"

# Confirm no external verification exists
grep -rn "explorer\|solscan\|clusterApiUrl" ../braice_colosseum_fend

# Confirm the three-AI requirement is absent
grep -rin "meta.brain\|customer.relation\|community.police\|risk.flag" \
  apps/api/src ../braice_colosseum_fend/app
```

---

## 6. Correctly out of scope — do not build

These appear in the User Story, Governance Structure, and AI Component PDFs but are explicitly excluded by Build Plan §4 ("Do NOT build") or fall below the §60 P2 line. The absence of these is **correct**, not a gap.

- Versioned Governance Constitutions with v1→v2→v3 transitions and amendment procedures
- Progressive shared-governance activation at a member threshold (e.g. 100 eligible members)
- Reserved operator rights; governance-by-domain
- Full community platform: feeds, public chat, DMs, voice, video
- Surveys and polls
- Community Offerings (products, services, campaigns, ideas)
- Marketplace, ecommerce, checkout, NFT infrastructure, token economy
- Multi-chain support; portable community identity across arbitrary applications
- Full CRM, general-purpose analytics, general-purpose identity provider

The current `governance_config` JSONB (`approvalMode` + `thresholdPercentage`) is a reasonable Governance-v1 stand-in. Note that the spec's own demo example in §36 uses `CREATOR_AND_THRESHOLD` at 60% — worth confirming the demo seed uses that mode rather than `CREATOR_ONLY`, since the demo script (Scene 4) calls for both creator approval *and* a passing threshold.

---

## 7. Bottom line

The hard part of this specification is genuinely built. A real permission engine with exact spec-conformant denial semantics, a real Anchor program in Rust, a real hand-rolled Borsh client submitting real transactions, and nine of ten Definition-of-Done scenarios passing is a strong submission.

The failure is narrow and fixable: the chain is switched off and misconfigured, so the one claim that distinguishes BRAICE from a well-engineered RBAC system — *that governance state is independently verifiable* — cannot currently be demonstrated. Fix §3.1 and the submission matches its own acceptance criteria.

Everything else on the list is presentation and packaging.