#!/usr/bin/env node

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = 'mongodb+srv://moldovancsaba_cogmap:hDdCxB93I1U94Mpv@sales.8wytusk.mongodb.net/?appName=sales';

const leadSchema = new mongoose.Schema({
  id: Number,
  region: String,
  entity_name: String,
  url: String,
  address: String,
  general_contact: String,
  size: String,
  industry: String,
  sport_or_sector: String,
  level_league: String,
  decision_maker_name: String,
  decision_maker_title: String,
  decision_maker_contact: String,
  pro_for_cogmap: [String],
  con_for_cogmap: [String],
  value_proposition: String,
  priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  status: { type: String, enum: ['new', 'contacted', 'qualified', 'proposal', 'closed'], default: 'new' },
  notes: { type: String, default: '' },
  tags: [String],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Lead = mongoose.model('Lead', leadSchema);

async function seedDatabase() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB');

    console.log('\nClearing existing data...');
    await Lead.deleteMany({});
    console.log('✓ Database cleared');

    console.log('\nLoading lead data...');
    const base = path.join(__dirname, '..');
    const usLeads = JSON.parse(fs.readFileSync(path.join(base, 'public/us-leads.json'), 'utf8'));
    const ceeLeads = JSON.parse(fs.readFileSync(path.join(base, 'public/cee-leads.json'), 'utf8'));
    const menaLeads = JSON.parse(fs.readFileSync(path.join(base, 'public/mena-leads.json'), 'utf8'));

    console.log(`✓ Loaded ${usLeads.length} US leads`);
    console.log(`✓ Loaded ${ceeLeads.length} CEE leads`);
    console.log(`✓ Loaded ${menaLeads.length} MENA leads`);

    // Assign IDs sequentially and set reasonable priorities
    const allLeads = [
      ...usLeads.map((l, i) => ({ ...l, id: i + 1, priority: 'high' })),
      ...ceeLeads.map((l, i) => ({ ...l, id: usLeads.length + i + 1, priority: 'medium' })),
      ...menaLeads.map((l, i) => ({ ...l, id: usLeads.length + ceeLeads.length + i + 1, priority: 'medium' })),
    ];

    console.log('\nInserting leads into database...');
    await Lead.insertMany(allLeads);
    console.log(`✓ Inserted ${allLeads.length} leads`);

    const count = await Lead.countDocuments();
    console.log(`\n✓ Database seeded successfully! Total leads: ${count}`);

    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
}

seedDatabase();
