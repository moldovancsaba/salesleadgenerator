require('dotenv').config({ path: '.env.local' });
const mongoose = require('mongoose');
const fs = require('fs');

async function fixAllRegions() {
  console.log('🔧 Fixing all regional data...\n');
  
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  const usEntityNames = [
    "Kansas City Chiefs", "San Antonio Spurs", "Duke University Athletics",
    "University of Alabama Athletics", "IMG Academy", "Citadel LLC",
    "Renaissance Technologies", "Sullivan & Cromwell LLP", "Google DeepMind",
    "USOPC", "Nike Inc.", "Mayo Clinic", "Seattle Seahawks",
    "Stanford University Athletics", "Goldman Sachs", "Cleveland Browns",
    "Mass General Brigham", "Los Angeles Lakers", "MIT Sloan School of Management",
    "US Military Academy (West Point)"
  ];

  console.log('📝 Updating US leads (setting region to "US")...');
  const usResult = await mongoose.connection.collection('leads').updateMany(
    { entity_name: { $in: usEntityNames } },
    { $set: { region: 'US' } }
  );
  console.log(`✅ Updated ${usResult.modifiedCount} US leads\n`);

  // Verify final stats
  const stats = await mongoose.connection.collection('leads').aggregate([
    { $group: { _id: '$region', count: { $sum: 1 } } }
  ]).toArray();

  console.log('📊 Final regional distribution:');
  stats.forEach(s => console.log(`   ${s._id}: ${s.count} leads`));

  const total = stats.reduce((sum, s) => sum + s.count, 0);
  console.log(`\n   Total: ${total} leads`);

  await mongoose.disconnect();
  console.log('\n✅ All regions fixed!');
}

fixAllRegions().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
