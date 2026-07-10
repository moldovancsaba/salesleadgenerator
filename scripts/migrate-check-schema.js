/**
 * Migration: Update existing 50 leads to Check-inspired schema
 * Adds kanbanColumn, ICE scores, scoreProfile, fingerprint, qualityStatus
 * Run from workspace root: node scripts/migrate-check-schema.js
 */

const { MongoClient } = require('mongodb');
const crypto = require('crypto');

require('dotenv').config({ path: __dirname + '/../.env.local' });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('ERROR: MONGODB_URI not found in .env.local');
  process.exit(1);
}

function buildFingerprint(name, url, region) {
  const data = `${(url || '').trim().toLowerCase()}|${(name || '').trim().toLowerCase()}|${(region || '').toUpperCase()}`;
  return crypto.createHash('sha1').update(data).digest('hex');
}

function deriveKanbanColumn(priority, score) {
  if (priority === 'high' || score >= 480) return 'ENGAGED';
  if (priority === 'medium' || score >= 200) return 'QUALIFIED';
  return 'DISCOVERED';
}

function buildScoreProfile(impact, confidence, ease) {
  return {
    agentProposal: { impact, confidence, effort: ease },
    calibratedHeuristic: { impact, confidence, effort: ease },
    finalBlended: {
      ice: impact * confidence * ease,
      quality: Math.round((impact / 10) * 100),
      urgency: Math.round((confidence / 10) * 100),
      freshness: 50,
      humanSignal: 50,
      risk: Math.round(((10 - ease) / 10) * 100),
    },
    qualityDimensions: {
      evidenceQuality: confidence / 10,
      linguisticQuality: 0.8,
      actionabilityQuality: impact / 10,
      strategicValue: impact / 10,
    },
  };
}

async function migrate() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db();
    const leads = db.collection('leads');

    // Get all existing leads
    const allLeads = await leads.find({}).toArray();
    console.log(`Found ${allLeads.length} leads to migrate`);

    let migrated = 0;
    let skipped = 0;

    for (const lead of allLeads) {
      // Skip if already migrated (has kanbanColumn)
      if (lead.kanbanColumn && lead.kanbanColumn !== 'DISCOVERED') {
        skipped++;
        continue;
      }

      // Determine ICE scores from priority
      let impact, confidence, ease;
      switch (lead.priority) {
        case 'high':
          impact = 8; confidence = 7; ease = 7;
          break;
        case 'low':
          impact = 4; confidence = 5; ease = 6;
          break;
        default: // medium
          impact = 6; confidence = 6; ease = 6;
      }

      const iceScore = impact * confidence * ease;
      const fingerprint = buildFingerprint(
        lead.entity_name || '',
        lead.url || '',
        lead.region || 'US'
      );

      const kanbanColumn = lead.kanbanColumn 
        ? lead.kanbanColumn 
        : deriveKanbanColumn(lead.priority, iceScore);

      const scoreProfile = buildScoreProfile(impact, confidence, ease);

      // Build update
      const update = {
        $set: {
          kanbanColumn: lead.kanbanColumn || kanbanColumn,
          sortOrder: lead.sortOrder || 0,
          fingerprint,
          ice: { impact, confidence, ease },
          scoreProfile,
          qualityStatus: lead.qualityStatus || 'DRAFT',
          feedbackScore: lead.feedbackScore || 0,
          declineCount: lead.declineCount || 0,
          acceptanceCount: lead.acceptanceCount || 0,
          manualLaneOverrideBy: lead.manualLaneOverrideBy || 'webapp-user',
          lastActionAt: lead.lastActionAt || lead.updatedAt || lead.createdAt,
        },
      };

      await leads.updateOne({ _id: lead._id }, update);
      migrated++;
    }

    console.log(`\nMigration complete:`);
    console.log(`  Migrated: ${migrated}`);
    console.log(`  Skipped (already migrated): ${skipped}`);
    console.log(`  Total: ${allLeads.length}`);

    // Create indexes
    console.log('\nCreating indexes...');
    await leads.createIndex({ fingerprint: 1 }, { unique: false });
    await leads.createIndex({ kanbanColumn: 1, sortOrder: 1 });
    await leads.createIndex({ region: 1, kanbanColumn: 1 });
    console.log('Indexes created');

  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

migrate();
