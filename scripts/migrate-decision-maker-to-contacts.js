#!/usr/bin/env node
// One-time production migration for issue #45's hard cutover: folds the
// top-level decision_maker_name/decision_maker_title/decision_maker_contact/
// contact_phone fields into a contacts[] entry with isDecisionMaker: true,
// then clears the old fields (matching the existing precedent set by
// POST /api/leads, which clears these to empty strings rather than $unset).
//
// MUST be run against real production data before (or atomically with)
// deploying the code in this change — see GitHub issue #45's "Production
// data migration" section. Skipping this means any lead whose decision-maker
// data lives ONLY in the top-level fields (anything edited via PUT or
// PATCH MODIFY since creation, per the bypass bug this change fixes) will
// have that data become invisible the moment the new code ships, with no
// error or warning.
//
// This sandbox has no MONGODB_URI and could not run this against real data —
// disclosed explicitly, consistent with every other DB-touching limitation
// in this repo's history (see docs/STACK_AND_DEPENDENCIES.md).
//
// Usage:
//   node scripts/migrate-decision-maker-to-contacts.js            # dry run (default)
//   node scripts/migrate-decision-maker-to-contacts.js --apply    # writes changes
//
// Idempotent: safe to re-run. Once a document's old fields are cleared,
// it's skipped on subsequent runs.

require('dotenv').config({ path: '.env.local' });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const COLLECTIONS = ['leads', 'seyu_leads'];

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function looksLikePhone(value) {
  return /^[+\d][\d\-\s()]{6,}$/.test(value.trim());
}

function normalizeContact(c) {
  return {
    name: typeof c.name === 'string' ? c.name.trim() : '',
    title: typeof c.title === 'string' ? c.title.trim() : '',
    email: typeof c.email === 'string' ? c.email.trim().toLowerCase() : '',
    phone: typeof c.phone === 'string' ? c.phone.trim() : '',
    linkedin: typeof c.linkedin === 'string' ? c.linkedin.trim() : '',
    role: typeof c.role === 'string' ? c.role.trim() : '',
    isDecisionMaker: c.isDecisionMaker === true,
  };
}

function contactKey(c) {
  const name = (c.name || '').toLowerCase();
  if (!name) return '';
  if (c.phone) return `${name}|${c.phone}`;
  if (c.email) return `${name}|${c.email}`;
  return name;
}

// Builds the contact to merge from a legacy document's top-level fields.
// decision_maker_contact is free-form (may be an email, a phone, or neither
// — see PIPELINE_ARCHITECTURE.md's historical schema note) so it's only
// assigned to email/phone when it's recognizably one of those.
function buildLegacyContact(doc) {
  const name = (doc.decision_maker_name || '').trim();
  const title = (doc.decision_maker_title || '').trim();
  const rawContact = (doc.decision_maker_contact || '').trim();
  const phone = (doc.contact_phone || '').trim();

  const email = looksLikeEmail(rawContact) ? rawContact : '';
  const resolvedPhone = phone || (looksLikePhone(rawContact) ? rawContact : '');

  if (!name && !email && !resolvedPhone) return null;

  return normalizeContact({
    name,
    title,
    email,
    phone: resolvedPhone,
    linkedin: '',
    role: '',
    isDecisionMaker: true,
  });
}

async function migrateCollection(db, collectionName) {
  const collection = db.collection(collectionName);
  const cursor = collection.find({
    $or: [
      { decision_maker_name: { $exists: true, $ne: '' } },
      { decision_maker_contact: { $exists: true, $ne: '' } },
      { decision_maker_title: { $exists: true, $ne: '' } },
      { contact_phone: { $exists: true, $ne: '' } },
    ],
  });

  let scanned = 0;
  let merged = 0;
  let alreadyRepresented = 0;
  let clearedOnly = 0;

  for await (const doc of cursor) {
    scanned++;
    const legacyContact = buildLegacyContact(doc);
    const existingContacts = Array.isArray(doc.contacts) ? doc.contacts.map(normalizeContact) : [];

    let newContacts = existingContacts;
    if (legacyContact) {
      const key = contactKey(legacyContact);
      const alreadyThere = key && existingContacts.some((c) => contactKey(c) === key);
      if (alreadyThere) {
        alreadyRepresented++;
      } else {
        newContacts = [legacyContact, ...existingContacts];
        merged++;
      }
    } else {
      clearedOnly++;
    }

    const update = {
      contacts: newContacts,
      decision_maker_name: '',
      decision_maker_title: '',
      decision_maker_contact: '',
      contact_phone: '',
    };

    console.log(
      `${APPLY ? 'UPDATE' : 'DRY-RUN'} ${collectionName}/${doc._id}: ` +
        `${legacyContact ? (newContacts !== existingContacts ? 'merged new contact' : 'already represented') : 'cleared only, no name/email/phone to merge'}`
    );

    if (APPLY) {
      await collection.updateOne({ _id: doc._id }, { $set: update });
    }
  }

  return { scanned, merged, alreadyRepresented, clearedOnly };
}

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI not found in .env.local');
    process.exit(1);
  }

  console.log(APPLY ? 'Running in APPLY mode — this will write changes.' : 'Running in DRY-RUN mode — no changes will be written. Pass --apply to write.');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  const db = mongoose.connection.db;
  const totals = { scanned: 0, merged: 0, alreadyRepresented: 0, clearedOnly: 0 };

  for (const collectionName of COLLECTIONS) {
    console.log(`--- ${collectionName} ---`);
    const result = await migrateCollection(db, collectionName);
    console.log(`${collectionName}: scanned=${result.scanned} merged=${result.merged} alreadyRepresented=${result.alreadyRepresented} clearedOnly=${result.clearedOnly}\n`);
    totals.scanned += result.scanned;
    totals.merged += result.merged;
    totals.alreadyRepresented += result.alreadyRepresented;
    totals.clearedOnly += result.clearedOnly;
  }

  console.log('=== Totals ===');
  console.log(`Documents scanned: ${totals.scanned}`);
  console.log(`New contacts[] entries merged: ${totals.merged}`);
  console.log(`Already represented (dedup skipped): ${totals.alreadyRepresented}`);
  console.log(`Cleared with nothing to merge: ${totals.clearedOnly}`);

  if (!APPLY && totals.scanned > 0) {
    console.log('\nThis was a dry run. Re-run with --apply to write these changes.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
