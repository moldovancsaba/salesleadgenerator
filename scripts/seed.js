#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const mongoose = require('mongoose');
const fs = require('fs');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI not found in .env.local');
  process.exit(1);
}

async function seed() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected');

    // Clear existing data
    console.log('Clearing existing leads...');
    await mongoose.connection.db.collection('leads').deleteMany({});
    console.log('✓ Cleared');

    // Load and normalize all leads from public/ (where the JSON files are)
    console.log('Loading leads...');
    const usLeads = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/us-leads.json'), 'utf8')).map(lead => ({
      ...lead,
      pro_for_cogmap: Array.isArray(lead.pro_for_cogmap) ? lead.pro_for_cogmap : [lead.pro_for_cogmap],
      con_for_cogmap: Array.isArray(lead.con_for_cogmap) ? lead.con_for_cogmap : [lead.con_for_cogmap]
    }));

    const ceeLeads = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/cee-leads.json'), 'utf8')).map(lead => ({
      ...lead,
      pro_for_cogmap: Array.isArray(lead.pro_for_cogmap) ? lead.pro_for_cogmap : [lead.pro_for_cogmap],
      con_for_cogmap: Array.isArray(lead.con_for_cogmap) ? lead.con_for_cogmap : [lead.con_for_cogmap]
    }));

    const menaLeads = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/mena-leads.json'), 'utf8')).map(lead => ({
      ...lead,
      pro_for_cogmap: Array.isArray(lead.pro_for_cogmap) ? lead.pro_for_cogmap : [lead.pro_for_cogmap],
      con_for_cogmap: Array.isArray(lead.con_for_cogmap) ? lead.con_for_cogmap : [lead.con_for_cogmap]
    }));

    console.log(`✓ Loaded ${usLeads.length} US leads`);
    console.log(`✓ Loaded ${ceeLeads.length} CEE leads`);
    console.log(`✓ Loaded ${menaLeads.length} MENA leads`);

    // Insert all leads
    const allLeads = [...usLeads, ...ceeLeads, ...menaLeads];
    console.log(`Inserting ${allLeads.length} leads...`);
    await mongoose.connection.db.collection('leads').insertMany(allLeads);
    console.log('✓ Inserted');

    await mongoose.disconnect();
    console.log('✓ Database seeded successfully');
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
}

seed();
