import mongoose from 'mongoose';
import { buildFingerprint } from '../lib/fingerprint';

const leadSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
  },
  region: {
    type: String,
    required: true,
    enum: ['US', 'CEE', 'MENA'],
  },
  entity_name: {
    type: String,
    required: true,
  },
  url: {
    type: String,
    default: '',
  },
  address: {
    type: String,
    default: '',
  },
  general_contact: {
    type: String,
    default: '',
  },
  size: {
    type: String,
    default: '',
  },
  industry: {
    type: String,
    default: '',
  },
  sport_or_sector: {
    type: String,
    default: '',
  },
  level_league: {
    type: String,
    default: '',
  },
  decision_maker_name: {
    type: String,
    default: '',
  },
  decision_maker_title: {
    type: String,
    default: '',
  },
  decision_maker_contact: {
    type: String,
    default: '',
  },
  pro_for_organization: {
    type: [String],
    default: [],
  },
  con_for_organization: {
    type: [String],
    default: [],
  },
  value_proposition: {
    type: String,
    default: '',
  },

  // ──── CogMap forecast / revenue planning ────
  recommended_tier: {
    type: String,
    enum: ['essential', 'performance', 'elite', 'multiple'],
    default: '',
  },
  estimated_participants: {
    type: Number,
    default: 0,
  },
  estimated_annual_revenue_usd: {
    type: Number,
    default: 0,
  },
  revenue_model: {
    type: String,
    enum: ['per_participant', 'revenue_share', 'hybrid'],
    default: '',
  },
  product_fit_notes: {
    type: String,
    default: '',
  },

  // ──── Check-inspired scoring ────
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium',
  },
  ice: {
    impact: { type: Number, default: 5 },
    confidence: { type: Number, default: 5 },
    ease: { type: Number, default: 5 },
  },
  scoreProfile: {
    agentProposal: {
      impact: Number,
      confidence: Number,
      effort: Number,
    },
    calibratedHeuristic: {
      impact: Number,
      confidence: Number,
      effort: Number,
    },
    finalBlended: {
      ice: Number,
      quality: Number,
      urgency: Number,
      freshness: Number,
      humanSignal: Number,
      risk: Number,
    },
    qualityDimensions: {
      evidenceQuality: Number,
      linguisticQuality: Number,
      actionabilityQuality: Number,
      strategicValue: Number,
    },
  },

  // ──── Check-inspired pipeline ────
  kanbanColumn: {
    type: String,
    enum: ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST'],
    default: 'DISCOVERED',
  },
  sortOrder: { type: Number, default: 0 },

  // ──── Fingerprint dedup ────
  fingerprint: { type: String, index: true },

  // ──── Quality ceiling (Check-inspired) ────
  qualityStatus: {
    type: String,
    enum: ['DRAFT', 'CHECKED', 'VERIFIED'],
    default: 'DRAFT',
  },
  upstreamCardIds: [{ type: String }], // Links to source/knowledge cards

  // ──── Feedback learning ────
  feedbackScore: { type: Number, default: 0 },
  declineCount: { type: Number, default: 0 },
  acceptanceCount: { type: Number, default: 0 },

  // ──── Structured decline ────
  declineReason: {
    type: String,
    enum: [
      'WRONG_INDUSTRY',
      'NO_DECISION_MAKER',
      'TOO_SMALL',
      'ALREADY_COMPETITOR',
      'BAD_TIMING',
      'BUDGET_CONSTRAINTS',
      'NOT_RESPONSIVE',
      'MISSING_CONTEXT',
      'LOW_PRIORITY',
      'OTHER',
    ],
  },
  declinedAt: Date,

  // ──── Manual lane override (human steering) ────
  manualLaneOverrideAt: Date,
  manualLaneCooldownUntil: Date,
  manualLaneFloorColumn: String,
  manualLaneOverrideBy: { type: String, default: 'webapp-user' },

  // ──── Legacy status / notes / tags ────
  status: {
    type: String,
    enum: ['new', 'contacted', 'qualified', 'proposal', 'closed'],
    default: 'new',
  },
  notes: { type: String, default: '' },
  tags: { type: [String], default: [] },

  lastActionAt: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },

  // Seyu company-specific optional pricing blocks
  pricingByCompany: { type: Object, default: {} },
});

// ──── Fingerprint on save ────
leadSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  if (
    this.isNew ||
    this.isModified('url') ||
    this.isModified('entity_name') ||
    this.isModified('region')
  ) {
    this.fingerprint = buildFingerprint(
      this.entity_name as string,
      (this as any).url as string,
      (this as any).region as string
    );
  }
  next();
});

// Indexes
leadSchema.index({ region: 1, kanbanColumn: 1 });
leadSchema.index({ kanbanColumn: 1, sortOrder: 1 });
leadSchema.index({ entity_name: 'text', industry: 'text', sport_or_sector: 'text' });
leadSchema.index({ fingerprint: 1 }, { unique: false });

const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);

export default Lead;
export { buildFingerprint };
