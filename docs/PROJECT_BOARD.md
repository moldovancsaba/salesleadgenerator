# Project Board (Label-Based)

**Version:** 2.4.164

---

## Why this exists

This session's toolset has no access to GitHub Projects (v2) or its GraphQL project-board API — there is no drag-and-drop board, no custom fields, no swimlanes available here. Rather than leave "where does this stand" unanswerable, every open issue carries a small, fixed set of labels that together work as a Kanban board: filter issues by `status:` label and you get a column. This is a deliberate, lightweight substitute — not a restoration of Projects v2 functionality. See `CLAUDE.md` Rule 2 for the standing rule this document backs.

---

## The label taxonomy

### `status:` — exactly one per open issue (this is the "column")

| Label | Meaning |
|---|---|
| `status: backlog` | Not started, not yet prioritized for active work |
| `status: ready` | Well-defined and actionable, no blocker |
| `status: in progress` | Actively being worked right now |
| `status: in review` | Implementation done, awaiting review/verification |
| `status: blocked` | Needs an external decision (owner adjudication, an upstream dependency) before it can proceed |

A **closed** issue is the "Done" column. There is no `status: done` label — closing the issue removes it from the board instead of adding a label for it. Never invent an off-taxonomy status value.

### `priority:` — at most one, optional

| Label | Meaning |
|---|---|
| `priority: p0` | Drop-everything, actively harming production or blocking other work |
| `priority: p1` | High — should be picked up in the next few work sessions |
| `priority: p2` | Normal — no particular urgency |

### `area:` — one or more, optional, extend as needed

| Label | Covers |
|---|---|
| `area: taxonomy` | Controlled sports-industry taxonomy schema, classification loop, rulebook questions |
| `area: leads` | Core lead CRUD, API, duplicate detection/merge |
| `area: enrichment` | The research-agent enrichment prompt/process |
| `area: kanban` | The kanban board UI itself |
| `area: admin` | Admin pages (`/admin/duplicates`, `/admin/users`, `/admin/prompts`) |
| `area: docs` | Documentation-only changes |
| `area: tooling` | Scripts, build/lint/test config, CI |

Add a new `area:` value here (and use it) the moment a genuinely new part of the codebase accumulates its own tracked work — don't force a lead into the closest-but-wrong existing bucket.

### Type — GitHub's own default labels, kept as-is

`bug`, `enhancement`, `documentation` are GitHub's stock labels for this repo; use them for what they already mean. No separate `type:` prefix is needed since these don't collide with anything above.

---

## How to move a card

Moving a card = swapping its `status:` label. Using this repo's GitHub MCP tooling, that's a single `issue_write` call with `method: "update"` and the full `labels` array for that issue (the array replaces the issue's labels, it does not merge — include every label the issue should keep, not just the one changing).

**Passing a label name that doesn't exist yet auto-creates it** (verified 2026-08-01 against this exact repo) — you do not need a separate label-creation step or direct GitHub API access. The auto-created label gets a blank/default gray color and no description; that's cosmetic only and doesn't block using the label. A human with GitHub UI access (Issues → Labels) can assign real colors/descriptions later if desired — this is the same kind of "hand off the polish step" pattern this repo already uses for the Projects v2 gap itself (see `CLAUDE.md` Rule 2).

---

## Current label set (as of 2026-08-01, initial provisioning)

| Issue | status | priority | area | notes |
|---|---|---|---|---|
| #132 | in progress | p1 | taxonomy | The active lead-taxonomy classification loop this board system was built alongside |
| #135 | blocked | p2 | taxonomy | Needs an owner decision on the `orgTypeCode` vocabulary |
| #136 | blocked | p2 | taxonomy | Needs owner adjudication across accumulated data points |
| #137 | ready | p1 | leads | Duplicate lead records at scale — well-defined, high-impact |
| #138 | backlog | p2 | leads | Sales support: outreach capture, Contacts view |
| #142 | backlog | p2 | enrichment | Reply matching + contact-enrichment suggestions |
| #143 | blocked | p2 | taxonomy | Needs an owner scope decision (non-sport entertainment properties) |
| #125 | blocked | p2 | kanban | Blocked on an upstream GDS feature |

This table is a snapshot, not the source of truth — the labels on the actual issues are authoritative. Update this table when the label set changes meaningfully, but don't treat a stale table entry as overriding what GitHub actually shows.

---

See also: `CLAUDE.md` Rule 2 (the standing rule this document backs), `README.md`'s documentation index.
