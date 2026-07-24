/**
 * Verification: Confirm migration success
 * Reads the first 3 migrated leads
 */
const { MongoClient } = require('mongodb');

require('dotenv').config({ path: __dirname + '/../.env.local' });

async function verify() {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI not found');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const db = client.db();
    const leads = db.collection('leads');

    const count = await leads.countDocuments({});
    console.log(`Total leads in database: ${count}\n`);

    // Sample first 3 migrated leads
    const sample = await leads.find({}).limit(3).toArray();

    console.log('=== Sample Migrated Leads ===\n');
    sample.forEach((lead, i) => {
      console.log(`[${i + 1}] ${lead.entity_name || lead.name}`);
      console.log(`   Region: ${lead.region}`);
      console.log(`   Fingerprint: ${lead.fingerprint || 'MISSING'}`);
      console.log(`   Ice: ${lead.ice || 'MISSING'}`);

      if (lead.ice) {
        const score = (lead.ice.impact || 0) * (lead.ice.confidence || 0) * (lead.ice.ease || 0);
        console.log(`   ICE Score: ${score} (I:${lead.ice.impact} × C:${lead.ice.confidence} × E:${lead.ice.ease})`);
      }

      console.log(`   Score Profile: ${lead.scoreProfile ? '✓' : 'MISSING'}`);
      console.log(`   Quality Status: ${lead.qualityStatus || 'DRAFT'}`);
      console.log('');
    });

    // Count leads with ICE scores
    const withIce = await leads.countDocuments({ ice: { $exists: true } });
    console.log(`\nLeads with ICE scores: ${withIce} / ${count}`);

    // Count leads with fingerprints
    const withFingerprint = await leads.countDocuments({ fingerprint: { $exists: true } });
    console.log(`Leads with fingerprints: ${withFingerprint} / ${count}`);

    console.log('\n✅ Migration verification complete');

  } catch (error) {
    console.error('Verification error:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

verify();
