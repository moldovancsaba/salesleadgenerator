require('dotenv').config({ path: '.env.local' });
const mongoose = require('mongoose');
const fs = require('fs');

async function auditAndFixDatabase() {
  console.log('🔍 Auditing MongoDB database...\n');
  
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  const collection = mongoose.connection.collection('leads');
  
  // Check total count
  const total = await collection.countDocuments();
  console.log(`📊 Total documents: ${total}\n`);

  // Check for duplicates by entity_name
  const duplicates = await collection.aggregate([
    { $group: { _id: '$entity_name', count: { $sum: 1 }, docs: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  if (duplicates.length > 0) {
    console.log('⚠️  Found duplicates:');
    duplicates.forEach(d => {
      console.log(`   ${d._id}: ${d.count} entries`);
      // Keep first, remove rest
      for (let i = 1; i < d.docs.length; i++) {
        collection.deleteOne({ _id: d.docs[i] });
      }
    });
    console.log('   ✅ Removed duplicates\n');
  } else {
    console.log('✅ No duplicates found\n');
  }

  // Check regional distribution
  const stats = await collection.aggregate([
    { $group: { _id: '$region', count: { $sum: 1 } } }
  ]).toArray();

  console.log('📊 Regional distribution AFTER cleanup:');
  stats.forEach(s => console.log(`   ${s._id}: ${s.count} leads`));
  
  const totalAfterCleanup = stats.reduce((sum, s) => sum + s.count, 0);
  console.log(`\n   Total: ${totalAfterCleanup} leads\n`);

  // Find leads with null region
  const nullRegion = await collection.find({ region: { $eq: null } }).toArray();
  if (nullRegion.length > 0) {
    console.log('⚠️  Leads with null region:');
    nullRegion.forEach(l => console.log(`   - ${l.entity_name}`));
    console.log('   Fixing to "US"...\n');
    await collection.updateMany(
      { region: { $eq: null } },
      { $set: { region: 'US' } }
    );
  }

  // Final stats
  const finalStats = await collection.aggregate([
    { $group: { _id: '$region', count: { $sum: 1 } } }
  ]).toArray();

  console.log('📊 FINAL regional distribution:');
  finalStats.forEach(s => console.log(`   ${s._id}: ${s.count} leads`));

  await mongoose.disconnect();
  console.log('\n✅ Database audit complete!');
}

auditAndFixDatabase().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
