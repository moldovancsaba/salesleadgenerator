require('dotenv').config({ path: '.env.local' });
const mongoose = require('mongoose');

async function fixMenaRegion() {
  console.log('Fixing MENA region data...');
  
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB\n');

  const menaEntityNames = [
    "Al Hilal SFC", "Al Nassr FC", "Aspire Academy", "Emirates NBD",
    "Qatar Foundation", "KAUST (King Abdullah University of Science and Technology)",
    "Dubai Sports Council", "Al Ahly SC", "Al Ittihad Club",
    "Qatar Stars League", "Saudi Arabian Olympic Committee",
    "Dubai Holding", "Al Ain FC", "Egyptian Olympic Committee", "Dubai Future Foundation"
  ];

  const collection = mongoose.connection.db.collection('leads');
  const result = await collection.updateMany(
    { entity_name: { $in: menaEntityNames } },
    { $set: { region: 'MENA' } }
  );

  console.log('Updated', result.modifiedCount, 'leads to MENA\n');

  // Verify
  const stats = await collection.aggregate([
    { $group: { _id: '$region', count: { $sum: 1 } } }
  ]).toArray();

  console.log('Regional stats:');
  stats.forEach(s => console.log(`  ${s._id}: ${s.count}`));

  await mongoose.disconnect();
  console.log('\nDone!');
}

fixMenaRegion().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
