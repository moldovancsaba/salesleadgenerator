import mongoose from 'mongoose';

const searchLearningSchema = new mongoose.Schema({
  companyId: { type: String, required: true, unique: true },
  
  lastQueries: [{ type: String }],
  
  topQueries: [{
    query: { type: String, required: true },
    accepted: { type: Number, default: 0 },
    declined: { type: Number, default: 0 },
    createdLeads: { type: Number, default: 0 },
  }],
  
  topTerms: [{
    key: { type: String, required: true },
    score: { type: Number, default: 0 },
  }],
  
  topDomains: [{
    key: { type: String, required: true },
    score: { type: Number, default: 0 },
  }],
  
  searchRuns: { type: Number, default: 0 },
  searchStateUpdatedAt: Date,
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

searchLearningSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const SearchLearning = mongoose.models.SearchLearning || mongoose.model('SearchLearning', searchLearningSchema);

export default SearchLearning;
