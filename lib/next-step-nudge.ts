// Pure, rule-based "what to do next" hint for a lead — mirrors
// lib/kanban-column-visibility.ts's shape: no React, no Mongo, no internal
// Date.now(). Consumes the real output shapes of two sibling roadmap
// issues — lib/stale-deal.ts's computeStaleness() (issue #61) and
// lib/contact-freshness.ts's isContactStale() (issue #66) — not the
// speculative "StalenessSignal"/"FreshnessSignal" shapes issue #62 was
// originally scoped against before those two shipped. In particular,
// StaleDealResult carries a single `daysSince` derived from the lead's
// whole-record `updatedAt` (bumped by any mutation — drag, PIN, MODIFY),
// so it cannot distinguish "no outreach" from "stuck in this column" the
// way the issue's original two-flavor STALE_NO_OUTREACH/STALE_IN_COLUMN
// design assumed; there is one real staleness signal, not two, so the rule
// set below collapses to a single STALE nudge fed by that one signal.

import { getDecisionMakerContact } from './contacts'
import type { ContactInput, NormalizedContact } from './contacts'
import { isContactStale, DEFAULT_STALENESS_THRESHOLD_DAYS } from './contact-freshness'
import type { StaleDealResult } from './stale-deal'

export type NudgeLead = {
  kanbanColumn: string
  createdAt?: string
  contacts?: ContactInput[] | null
}

export type NudgeId = 'NO_CONTACTS' | 'DECISION_MAKER_MISSING' | 'NEEDS_VERIFICATION' | 'STALE'

export type Nudge = {
  id: NudgeId
  message: string
  actionable: boolean
  action?: 'REQUEST_REFRESH'
  severity: 'info' | 'warn'
}

// A lead this young hasn't had a fair chance to accumulate contacts or
// outreach yet — suppressed even if staleness/freshness would otherwise
// fire (lib/stale-deal.ts also naturally avoids this via its own threshold,
// but a lead with no updatedAt at all bypasses that path entirely, so this
// is enforced independently here too).
const CREATION_GRACE_DAYS = 3

function withinGracePeriod(createdAt: string | undefined, now: Date): boolean {
  if (!createdAt) return false
  const createdMs = new Date(createdAt).getTime()
  if (!Number.isFinite(createdMs)) return false
  return now.getTime() - createdMs < CREATION_GRACE_DAYS * 86_400_000
}

// Rules evaluated top-down, first match wins: missing contacts/decision-maker
// block outreach entirely (outrank generic staleness); stale decision-maker
// data outranks a generic "gone quiet" nudge (you can't act on staleness
// productively with unverified contact info); staleness is the fallback.
export function getNextStepNudge(
  lead: NudgeLead,
  staleness: StaleDealResult | null,
  now: Date,
  contactStalenessThresholdDays: number = DEFAULT_STALENESS_THRESHOLD_DAYS
): Nudge | null {
  try {
    if (lead.kanbanColumn === 'WON' || lead.kanbanColumn === 'LOST') return null
    if (withinGracePeriod(lead.createdAt, now)) return null

    const contacts = Array.isArray(lead.contacts) ? lead.contacts : []
    if (contacts.length === 0) {
      return {
        id: 'NO_CONTACTS',
        message: 'No contacts on this lead yet.',
        actionable: false,
        severity: 'info',
      }
    }

    const decisionMaker: NormalizedContact | null = getDecisionMakerContact(contacts)
    if (!decisionMaker) {
      return {
        id: 'DECISION_MAKER_MISSING',
        message: 'No decision maker identified yet.',
        actionable: true,
        action: 'REQUEST_REFRESH',
        severity: 'warn',
      }
    }

    if (isContactStale(decisionMaker, contactStalenessThresholdDays, now)) {
      return {
        id: 'NEEDS_VERIFICATION',
        message: 'Decision-maker contact info may be out of date.',
        actionable: true,
        action: 'REQUEST_REFRESH',
        severity: 'warn',
      }
    }

    if (staleness) {
      return {
        id: 'STALE',
        message: `No activity in ${staleness.daysSince} days.`,
        actionable: false,
        severity: staleness.severity === 'critical' ? 'warn' : 'info',
      }
    }

    return null
  } catch {
    // Any thrown error or unexpected input shape degrades to "no nudge
    // shown" — never a crashed card or modal.
    return null
  }
}
