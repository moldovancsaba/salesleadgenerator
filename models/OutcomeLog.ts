import mongoose from 'mongoose';

const outcomeLogSchema = new mongoose.Schema({
  leadId: { type: String, required: true },
  companyId: { type: String, default: 'cogmap' },
  
  action: {
    type: String,
    enum: ['ACCEPT', 'DECLINE', 'MODIFY', 'PIN', 'REQUEST_REFRESH', 'ARCHIVE', 'COLUMN_MOVE'],
    required: true,
  },
  
  outcomeType: { type: String },
  outcomeValue: { type: String },
  annotation: { type: String },
  teachingWeight: { type: Number, default: 50 },
  
  beforeState: { type: mongoose.Schema.Types.Mixed },
  afterState: { type: mongoose.Schema.Types.Mixed },
  
  actorType: { type: String, default: 'USER' },
  actedBy: { type: String, default: 'webapp-user' },
  
  createdAt: { type: Date, default: Date.now },
});

outcomeLogSchema.index({ leadId: 1, createdAt: -1 });
outcomeLogSchema.index({ companyId: 1, createdAt: -1 });

const OutcomeLog = mongoose.models.OutcomeLog || mongoose.model('OutcomeLog', outcomeLogSchema);

export default OutcomeLog;
