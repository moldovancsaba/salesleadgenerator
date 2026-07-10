# CogMap Pipeline Architecture

## Overview
CogMap implements a Check-inspired sales intelligence pipeline with Kanban workflow, automated scoring, and feedback learning.

## Core Components

### 1. Kanban Pipeline (6 Stages)
```
DISCOVERED → QUALIFIED → ENGAGED → PROPOSAL → WON/LOST
```

**Stage Descriptions:**
- **DISCOVERED**: Initial lead discovery, raw data, awaiting enrichment
- **QUALIFIED**: Basic validation complete, ICE score ≥ 200
- **ENGAGED**: Active contact established, ICE score ≥ 480
- **PROPOSAL**: Formal offer/demonstration in progress
- **WON**: Successfully closed deal
- **LOST**: Declined or no longer viable

**Manual Override System:**
- Operators can drag cards between columns
- 24-hour cooldown prevents AI from reverting manual moves
- `manualLaneOverrideAt` timestamp tracks human intervention
- `manualLaneCooldownUntil` defines protection period

### 2. ICE Scoring System
```typescript
ICE = Impact × Confidence × Ease
Score Range: 1 - 1000
```

**Dimensions:**
- **Impact (1-10)**: Potential value to CogMap
- **Confidence (1-10)**: Data quality and verification level
- **Ease (1-10)**: Likelihood of successful engagement

**Automatic Stage Assignment:**
- Score 720+ → ENGAGED (high confidence leads)
- Score 480+ → QUALIFIED (mid-range viability)
- Score 200+ → DISCOVERED (initial prospecting)
- Score <200 → DISCOVERED (needs enrichment)

**Score Profile Structure:**
```typescript
{
  agentProposal: { impact, confidence, ease },
  calibratedHeuristic: { impact, confidence, ease },
  finalBlended: {
    ice: number,
    quality: number,
    urgency: number,
    freshness: number,
    humanSignal: number,
    risk: number
  },
  qualityDimensions: {
    evidenceQuality,
    linguisticQuality,
    actionabilityQuality,
    strategicValue
  }
}
```

### 3. Fingerprint Deduplication
```typescript
fingerprint = SHA1(url|entity_name|region)
```
- Prevents duplicate lead creation
- Checks existing fingerprints before insertion
- Unique index on fingerprint field

### 4. Quality Ceiling Enforcement
```typescript
Lead Quality Status: DRAFT → CHECKED → VERIFIED
```
- Lead quality cannot exceed quality of supporting evidence
- If upstream evidence is DRAFT, lead caps at DRAFT
- Prevents premature advancement of unverified leads

### 5. Structured Decline System
**10 Decline Reasons:**
1. WRONG_INDUSTRY
2. NO_DECISION_MAKER
3. TOO_SMALL
4. ALREADY_COMPETITOR
5. BAD_TIMING
6. BUDGET_CONSTRAINTS
7. NOT_RESPONSIVE
8. MISSING_CONTEXT
9. LOW_PRIORITY
10. OTHER

**Feedback Loop:**
- Each decline triggers search memory update
- System learns which queries/domains produce poor results
- Future lead generation improves based on patterns

### 6. Search Learning Analytics
**Tracked Metrics:**
- Query success/failure rates
- Domain performance scores
- Term effectiveness
- Average success rate per search

**Auto-Update Triggers:**
- Lead accepted → boost associated queries
- Lead declined → reduce associated query weights
- Continuous feedback improves search quality

### 7. Outcome Audit Log
Immutable record of all pipeline actions:
- CREATE: New lead creation
- COLUMN_MOVE: Stage transitions
- ACCEPT/DECLINE: Operator feedback
- MODIFY: Data updates
- PIN: Manual engagement freeze

Each log entry includes:
- Action type
- Before/after state
- Teaching weight (50-100)
- Annotation/feedback
- Timestamp

## API Endpoints

### `/api/leads`
- `GET`: Fetch leads with optional filters (region, kanbanColumn)
- `POST`: Create new lead (with dedup, scoring, fingerprint)
- `PATCH`: Update lead (actions, column moves, modifications)

### `/api/leads/[id]`
- `GET`: Fetch single lead with outcome history
- `DELETE`: Remove lead and associated logs

### `/api/search-learning`
- `GET`: Fetch search analytics (queries, terms, domains)
- `POST`: Update search memory after lead actions

## Database Schema

### Lead Model
```typescript
{
  // Core Identity
  id: number
  region: 'US' | 'CEE' | 'MENA'
  entity_name: string
  url?: string
  address?: string
  general_contact?: string
  size?: string
  industry?: string
  sport_or_sector?: string
  level_league?: string
  decision_maker_name?: string
  decision_maker_title?: string
  decision_maker_contact?: string
  
  // CogMap Analysis
  pro_for_cogmap?: string[]
  con_for_cogmap?: string[]
  value_proposition?: string
  
  // Pipeline State
  kanbanColumn: KanbanColumn
  sortOrder: number
  priority: 'high' | 'medium' | 'low'
  status: string
  qualityStatus: 'DRAFT' | 'CHECKED' | 'VERIFIED'
  
  // Scoring
  ice: { impact: number, confidence: number, ease: number }
  scoreProfile: ScoreProfile
  fingerprint: string
  
  // Feedback
  feedbackScore: number
  declineCount: number
  acceptanceCount: number
  declineReason?: DeclineReason
  declinedAt?: Date
  
  // Manual Override
  manualLaneOverrideAt?: Date
  manualLaneCooldownUntil?: Date
  manualLaneFloorColumn?: string
  manualLaneOverrideBy?: string
  
  // Metadata
  tags: string[]
  notes: string
  lastActionAt?: Date
  createdAt: Date
  updatedAt: Date
}
```

### OutcomeLog Model
```typescript
{
  leadId: string
  action: Action
  timestamp: Date
  annotation?: string
  declineReason?: DeclineReason
  beforeState: any
  afterState: any
  teachingWeight: number
}
```

### SearchLearning Model
```typescript
{
  companyId: string
  lastQueries: string[]
  topQueries: {
    query: string
    accepted: number
    declined: number
    createdLeads: number
  }[]
  topTerms: {
    key: string
    score: number
  }[]
  topDomains: {
    key: string
    score: number
  }[]
  avgSuccessRate: number
  searchRuns: number
}
```

## Migration History

### Initial State (50 leads)
- Created from 3 regional datasets (US: 20, CEE: 15, MENA: 15)
- Basic contact info and manual analysis

### Migration Script (July 10, 2026)
Applied Check-inspired architecture:
1. Added pipeline columns (all → DISCOVERED)
2. Computed initial ICE scores (default 5-5-5)
3. Generated fingerprints for deduplication
4. Initialized feedback counters
5. Set quality status to DRAFT
6. Created indexes for performance

## Future Extensions

### Planned Features
1. **Automated Lead Enrichment**
   - Web scraping for additional data points
   - Social media integration
   - Financial data lookup

2. **AI-Powered Scoring**
   - ML model for ICE calibration
   - Historical pattern recognition
   - Predictive success probability

3. **Integration Hooks**
   - CRM sync (Salesforce, HubSpot)
   - Email automation triggers
   - Notification systems

4. **Advanced Analytics**
   - Conversion funnel tracking
   - Regional performance comparison
   - Time-to-close metrics

## References
- Based on [Sovereign Squad Checklist](https://github.com/sovereignsquad/checklist) architecture
- Adapted for CogMap's lead generation workflow
- Maintains compatibility with existing MongoDB + Mongoose infrastructure
