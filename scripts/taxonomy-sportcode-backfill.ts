#!/usr/bin/env npx tsx
// Phase 2 (issue #132) dry-run/sample/apply tool for docs/LEAD_TAXONOMY_MIGRATION_PLAN.md.
//
// Scope, deliberately narrow: this backfills ONLY `sportCode`, the one
// taxonomy field the rulebook treats as non-negotiable (§3.1) and the one
// field that's mechanically derivable from data already stored on every
// lead — `resolveSportAlias(sport_or_sector)` (lib/lead-taxonomy.ts, already
// unit-tested, unchanged here). The other identity fields (`orgTypeCode`,
// `businessUnitCode`, `genderCode`, `cityName`, `parentOrgName`, ...) do NOT
// have a reliable mechanical source and still require the same
// evidence-based agent research proven live in the 7-lead pilot loop
// (CHANGELOG 2.4.114-2.4.119) — this script does not attempt them.
//
// Deliberate deviation from this repo's other backfill scripts
// (scripts/backfill-ticket-size.ts, scripts/backfill-title-normalization.ts):
// those connect to MongoDB directly and are explicitly disclosed as
// "not run against production" from this sandbox, which has no network path
// to MongoDB Atlas (confirmed blocked, same gap documented elsewhere in this
// repo). This script instead reads/writes through the real deployed HTTPS
// API (`GET`/`PUT /api/leads`, `x-api-key` auth) — the same path this
// sandbox has used successfully all session (the enrichment loop, the
// issue #133 production phone-corruption scan) — specifically so it CAN be
// exercised and verified for real from here. Needs SLG_API_KEY, not
// MONGODB_URI.
//
// Usage:
//   npx tsx scripts/taxonomy-sportcode-backfill.ts                        # dry run (default), both brands, all leads
//   npx tsx scripts/taxonomy-sportcode-backfill.ts --brand=cogmap         # a single brand only
//   npx tsx scripts/taxonomy-sportcode-backfill.ts --apply --sample=50    # apply to a random 50-lead sample per brand
//   npx tsx scripts/taxonomy-sportcode-backfill.ts --apply                # apply to every mechanically-resolvable lead
//
// Idempotent: only ever targets leads with no `sportCode` set yet — a
// re-run after a partial apply skips everything already classified.

import { resolveSportAlias } from '../lib/lead-taxonomy';

const API_BASE = process.env.SLG_API_BASE || 'https://salesleadgenerator.vercel.app';
const API_KEY = process.env.SLG_API_KEY;

const APPLY = process.argv.includes('--apply');
const brandArg = process.argv.find((a) => a.startsWith('--brand='));
const sampleArg = process.argv.find((a) => a.startsWith('--sample='));
const SAMPLE_SIZE = sampleArg ? parseInt(sampleArg.split('=')[1], 10) : null;

const ALL_BRANDS = ['cogmap', 'seyu'] as const;
const BRANDS = brandArg ? [brandArg.split('=')[1] as (typeof ALL_BRANDS)[number]] : [...ALL_BRANDS];

type LeadSummary = {
  _id: string;
  entity_name: string;
  sport_or_sector?: string;
  sportCode?: string;
  kanbanColumn?: string;
};

async function fetchAllLeads(brand: string): Promise<LeadSummary[]> {
  const leads: LeadSummary[] = [];
  let page = 1;
  const limit = 1000;
  for (;;) {
    const res = await fetch(`${API_BASE}/api/leads?brand=${brand}&page=${page}&limit=${limit}`, {
      headers: { 'x-api-key': API_KEY! },
    });
    if (!res.ok) throw new Error(`GET /api/leads?brand=${brand} failed: HTTP ${res.status}`);
    const data = await res.json();
    leads.push(...(data.leads || []));
    if (!data.hasMore) break;
    page += 1;
  }
  return leads;
}

async function applySportCode(brand: string, leadId: string, sportCode: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/leads/${leadId}?brand=${brand}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY! },
    body: JSON.stringify({ sportCode }),
  });
  return res.ok;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function run() {
  if (!API_KEY) {
    console.error('ERROR: SLG_API_KEY not set in the environment.');
    process.exit(1);
  }

  console.log(APPLY ? 'Running in APPLY mode — this will write changes via real PUT requests.' : 'Running in DRY-RUN mode — no changes will be written. Pass --apply to write.');
  if (SAMPLE_SIZE) console.log(`Sample mode: applying to a random ${SAMPLE_SIZE} leads per brand.`);
  console.log('');

  const totals = { scanned: 0, alreadyClassified: 0, resolved: 0, unresolved: 0, applied: 0, applyFailed: 0 };
  const unresolvedByFreeText: Record<string, number> = {};

  for (const brand of BRANDS) {
    console.log(`--- ${brand} ---`);
    const leads = await fetchAllLeads(brand);
    console.log(`Fetched ${leads.length} leads.`);

    const candidates = leads.filter((l) => !l.sportCode);
    totals.alreadyClassified += leads.length - candidates.length;
    totals.scanned += leads.length;

    const resolvedThisBrand: Array<{ id: string; name: string; sportCode: string }> = [];
    for (const lead of candidates) {
      const resolved = resolveSportAlias(lead.sport_or_sector);
      if (resolved) {
        resolvedThisBrand.push({ id: lead._id, name: lead.entity_name, sportCode: resolved });
      } else {
        totals.unresolved += 1;
        const key = (lead.sport_or_sector || '(blank)').trim() || '(blank)';
        unresolvedByFreeText[key] = (unresolvedByFreeText[key] || 0) + 1;
      }
    }
    totals.resolved += resolvedThisBrand.length;

    console.log(`Already classified: ${leads.length - candidates.length}`);
    console.log(`Mechanically resolvable (sport_or_sector -> sportCode via alias table): ${resolvedThisBrand.length}`);
    console.log(`Unresolvable from stored free text (needs agent research or 'unknown'): ${candidates.length - resolvedThisBrand.length}`);

    if (APPLY) {
      const targets = SAMPLE_SIZE ? shuffle(resolvedThisBrand).slice(0, SAMPLE_SIZE) : resolvedThisBrand;
      console.log(`Applying sportCode to ${targets.length} leads...`);
      for (const t of targets) {
        const ok = await applySportCode(brand, t.id, t.sportCode);
        if (ok) {
          totals.applied += 1;
        } else {
          totals.applyFailed += 1;
          console.log(`  FAILED: ${t.id} (${t.name}) -> ${t.sportCode}`);
        }
      }
      console.log(`Applied: ${targets.length - totals.applyFailed} succeeded this brand.`);
    }
    console.log('');
  }

  console.log('=== Totals ===');
  console.log(`Leads scanned (both brands): ${totals.scanned}`);
  console.log(`Already classified (skipped): ${totals.alreadyClassified}`);
  console.log(`Mechanically resolvable: ${totals.resolved}`);
  console.log(`Unresolvable (need agent research): ${totals.unresolved}`);
  if (APPLY) {
    console.log(`Applied (written): ${totals.applied}`);
    console.log(`Apply failures: ${totals.applyFailed}`);
  }

  console.log('\n=== Unresolved sport_or_sector values, by frequency (top 20) ===');
  const sorted = Object.entries(unresolvedByFreeText).sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [value, count] of sorted) {
    console.log(`  ${count.toString().padStart(5)}  ${value}`);
  }

  if (!APPLY && totals.resolved > 0) {
    console.log('\nThis was a dry run. Re-run with --apply (optionally --sample=N) to write these changes.');
  }
}

run().catch((err) => {
  console.error('Backfill error:', err);
  process.exit(1);
});
