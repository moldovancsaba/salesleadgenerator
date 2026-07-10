import mongoose from 'mongoose';

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
  pro_for_cogmap: {
    type: [String],
    default: [],
  },
  con_for_cogmap: {
    type: [String],
    default: [],
  },
  value_proposition: {
    type: String,
    default: '',
  },
  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium',
  },
  status: {
    type: String,
    enum: ['new', 'contacted', 'qualified', 'proposal', 'closed'],
    default: 'new',
  },
  notes: {
    type: String,
    default: '',
  },
  tags: {
    type: [String],
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Create compound index for efficient querying
leadSchema.index({ region: 1, priority: 1 });
leadSchema.index({ entity_name: 'text', industry: 'text', sport_or_sector: 'text' });

// Update timestamp on save
leadSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);

export default Lead;
