#!/usr/bin/env node
/**
 * CogMap Pipeline Monitor
 * Direct MongoDB connection for real-time status checks
 */

const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI not found in .env.local');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('cogmap');
    const leads = db.collection('leads');
    const outcomeLogs = db.collection('outcomelogs');
    const searchLearning = db.collection('searchlearnings');
    
    console.log('✓ Connected to MongoDB Atlas\n');
    
    // Pipeline stats
    const pipelineStats = await leads.aggregate([
      { $group: { _id: '$kanbanColumn', count: { $sum: 1 } } }
    ]).toArray();
    
    console.log('=== PIPELINE STATUS ===');
    const columns = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST'];
    columns.forEach(col => {
      const stat = pipelineStats.find(s => s._id === col);
      console.log(`${col}: ${stat ? stat.count : 0}`);
    });
    
    const total = await leads.countDocuments();
    console.log(`\nTotal leads: ${total}`);
    
    // ICE score stats
    const iceStats = await leads.aggregate([
      { $group: {
        _id: null,
        avgImpact: { $avg: '$ice.impact' },
        avgConfidence: { $avg: '$ice.confidence' },
        avgEase: { $avg: '$ice.ease' },
        totalAccepted: { $sum: '$acceptanceCount' },
        totalDeclined: { $sum: '$declineCount' }
      }}
    ]).toArray();
    
    if (iceStats[0]) {
      console.log(`\n=== ICE SCORES ===`);
      console.log(`Avg Impact: ${iceStats[0].avgImpact?.toFixed(1)}`);
      console.log(`Avg Confidence: ${iceStats[0].avgConfidence?.toFixed(1)}`);
      console.log(`Avg Ease: ${iceStats[0].avgEase?.toFixed(1)}`);
      console.log(`Acceptances: ${iceStats[0].totalAccepted || 0}`);
      console.log(`Declines: ${iceStats[0].totalDeclined || 0}`);
    }
    
    // Quality status
    const qualityStats = await leads.aggregate([
      { $group: { _id: '$qualityStatus', count: { $sum: 1 } } }
    ]).toArray();
    
    console.log(`\n=== QUALITY STATUS ===`);
    qualityStats.forEach(s => console.log(`${s._id}: ${s.count}`));
    
    // Outcome logs
    const outcomeCount = await outcomeLogs.countDocuments();
    console.log(`\n=== AUDIT LOG ===`);
    console.log(`Total outcome logs: ${outcomeCount}`);
    
    // Search learning
    const slDoc = await searchLearning.findOne({ companyId: 'cogmap' });
    console.log(`\n=== SEARCH LEARNING ===`);
    if (slDoc) {
      console.log(`Search runs: ${slDoc.searchRuns}`);
      console.log(`Tracked queries: ${slDoc.topQueries?.length || 0}`);
      console.log(`Avg success rate: ${((slDoc.avgSuccessRate || 0) * 100).toFixed(1)}%`);
    } else {
      console.log('No search learning data yet');
    }
    
    await client.close();
    console.log('\n✓ Direct MongoDB access confirmed!');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
