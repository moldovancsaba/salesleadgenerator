# DVSC test-record deletion (issue #193, D5)

**Date:** 2026-09-27
**Approved by:** owner, in chat, 2026-09-27 ("193 i approve")
**Executed via:** single-lead `DELETE /api/leads/[id]?brand=dvsc`, one record at a time, each re-confirmed via a fresh `GET` immediately before deleting and again immediately after (expected/confirmed 404).

## Why

Issue #193's D1–D4 (the `Lead.source` vocabulary questions) were resolved without any data writes in 2.4.235. D5 — four DVSC leads found by a `q=test` search that are test/fixture data, not real leads — was left open pending explicit owner approval, since deleting production data always needs it.

## What was deleted

| Id | Name | `source` | `url` | Created | `kanbanColumn` |
|---|---|---|---|---|---|
| `6a788c88b62830aabbcd15fc` | Test Company Ltd | `test` | example.com | 2026-08-09 | DISCOVERED |
| `6a78923c3a7e24a16a0a850a` | Test Company XYZ | `search-router-discovery` | test-company-xyz-12345.hu | 2026-08-09 | DISCOVERED |
| `6a7438602039035263bc3bb7` | Test Lead Discovery | `discovery-cron` | example.com | 2026-08-06 | DISCOVERED |
| `6a6ebf1c96510ccc7d2a13e0` | Test No Brand Field | `manual` | example.hu | 2026-08-02 | LOST |

Each record was re-read fresh immediately before deletion and matched the description already recorded on #193 exactly (name, `source`, `url`, creation date) — none had changed since that triage. Full pre-deletion snapshots (the complete stored document for each) were saved to this session's scratch space before any delete call; the table above is the durable record now that the scratch copies are gone with the session.

## Effect

DVSC's total lead count drops from 68 to 64. No other brand or record was touched. This closes issue #193 entirely — D1–D4 already resolved in 2.4.235, D5 resolved here.

## Rollback

None possible or intended — these were confirmed non-production test/fixture records (`example.com`/`example.hu` URLs, obviously placeholder names), not real leads. There is nothing to roll back to.
