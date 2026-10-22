import path from 'path';
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

async function remediate() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  console.log('Connected to MongoDB database:', db.databaseName);

  // 1. Clean Seyu Services lead (6ad50814c501c40783f2cc0d): remove internal colleague David Bozsik
  const seyuServicesRes = await db.collection('seyu_leads').updateOne(
    { _id: new ObjectId('6ad50814c501c40783f2cc0d') },
    {
      $set: {
        contacts: [],
        contactEmails: [],
      },
    }
  );
  console.log('1. Seyu Services lead contacts cleared:', seyuServicesRes.modifiedCount);

  // 2. Clean PSV Eindhoven lead (6a57c08110cd2d62348d3309): remove Inga Schuler (belongs to SCB)
  const psvRes = await db.collection('seyu_leads').updateOne(
    { _id: new ObjectId('6a57c08110cd2d62348d3309') },
    {
      $pull: {
        contacts: { email: 'inga.schuler@scb.ch' } as any,
        contactEmails: 'inga.schuler@scb.ch' as any,
      },
    }
  );
  console.log('2. PSV Eindhoven removed Inga Schuler:', psvRes.modifiedCount);

  // 3. Re-link activity logs for Inga Schuler to SCB (6ad7c73fb9e32a7106cb7787)
  const scbLogsRes = await db.collection('activityLog').updateMany(
    {
      brand: 'seyu',
      $or: [
        { fromAddress: 'inga.schuler@scb.ch' },
        { toAddresses: 'inga.schuler@scb.ch' },
      ],
    },
    {
      $set: {
        leadId: '6ad7c73fb9e32a7106cb7787',
        matchedContactKey: 'inga schuler|inga.schuler@scb.ch',
      },
    }
  );
  console.log('3. Re-linked activity logs to SCB:', scbLogsRes.modifiedCount);

  // 4. Fix direction on internal outbound emails sent to Inga Schuler
  const scbOutboundRes = await db.collection('activityLog').updateMany(
    {
      brand: 'seyu',
      fromAddress: { $in: ['david.bozsik@seyuselfies.com', 'coo@seyuselfies.com', 'moldovancsaba@gmail.com'] },
      toAddresses: 'inga.schuler@scb.ch',
    },
    {
      $set: {
        type: 'email-outbound',
        direction: 'outbound',
      },
    }
  );
  console.log('4. Fixed direction on outbound emails to SCB:', scbOutboundRes.modifiedCount);

  // 5. Re-link other prospect logs misattributed to Seyu Services
  const mappings = [
    { email: 'cristi.dima@frh.ro', leadId: '6a5e74167fa49c8951308260', key: 'cristi dima|cristi.dima@frh.ro' },
    { email: 'flavia.fontanelli@asroma.it', leadId: '6ad7c778b9e32a7106cb7789', key: 'flavia fontanelli|flavia.fontanelli@asroma.it' },
    { email: 'matteo.coggiola@asroma.it', leadId: '6ad7c778b9e32a7106cb7789', key: 'matteo coggiola|matteo.coggiola@asroma.it' },
    { email: 'balazs.pataki@sportfive.com', leadId: '6ad7c751b9e32a7106cb7788', key: 'balazs pataki|balazs.pataki@sportfive.com' },
    { email: 'zoltan.nemenyi@sportfive.com', leadId: '6ad7c751b9e32a7106cb7788', key: 'zoltan nemenyi|zoltan.nemenyi@sportfive.com' },
    { email: 'istvan.gabor@sportfive.com', leadId: '6ad7c751b9e32a7106cb7788', key: 'istvan gabor|istvan.gabor@sportfive.com' },
    { email: 'finn.roth@moltkesports.com', leadId: '6ad7c707b9e32a7106cb7786', key: 'finn roth|finn.roth@moltkesports.com' },
  ];

  for (const m of mappings) {
    const res = await db.collection('activityLog').updateMany(
      {
        brand: 'seyu',
        leadId: '6ad50814c501c40783f2cc0d',
        $or: [
          { fromAddress: new RegExp(m.email, 'i') },
          { toAddresses: new RegExp(m.email, 'i') },
        ],
      },
      {
        $set: {
          leadId: m.leadId,
          matchedContactKey: m.key,
        },
      }
    );
    console.log(`5. Re-linked ${m.email} -> ${m.leadId}:`, res.modifiedCount);
  }

  // 6. Fix any remaining outbound emails sent from internal staff that were marked as inbound
  const internalOutboundRes = await db.collection('activityLog').updateMany(
    {
      brand: 'seyu',
      fromAddress: { $regex: /@seyuselfies\.com$|@seyu\.hu$/i },
      direction: 'inbound',
    },
    {
      $set: {
        type: 'email-outbound',
        direction: 'outbound',
      },
    }
  );
  console.log('6. Fixed direction on all internal outbound emails:', internalOutboundRes.modifiedCount);

  // 7. Clean broken fromAddress / toAddresses / ccAddresses on Sportfive emails
  const cleanAddressMap = [
    { id: new ObjectId('6ad8b7c71616faea55868598'), from: 'zoltan.nemenyi@sportfive.com' },
    { id: new ObjectId('6ad50975dc502efcb3b72b97'), from: 'balazs.pataki@sportfive.com' },
    { id: new ObjectId('6ad50977dc502efcb3b72b99'), from: 'zoltan.nemenyi@sportfive.com' },
    { id: new ObjectId('6ad50978dc502efcb3b72b9a'), from: 'istvan.gabor@sportfive.com' },
    { id: new ObjectId('6ad5097edc502efcb3b72b9f'), from: 'istvan.gabor@sportfive.com' },
  ];
  for (const c of cleanAddressMap) {
    await db.collection('activityLog').updateOne(
      { _id: c.id },
      { $set: { fromAddress: c.from } }
    );
  }
  console.log('7. Cleaned broken fromAddress on 5 Sportfive records');

  // Strip non-email tokens from toAddresses and ccAddresses in all activityLog entries
  const allBroken = await db.collection('activityLog').find({
    brand: 'seyu',
    $or: [
      { toAddresses: { $regex: /\"/ } },
      { ccAddresses: { $regex: /\"/ } }
    ]
  }).toArray();
  for (const doc of allBroken) {
    const cleanList = (arr: any) => {
      if (!Array.isArray(arr)) return arr;
      return arr.filter((s: string) => typeof s === 'string' && s.includes('@') && !s.includes('"'));
    };
    await db.collection('activityLog').updateOne(
      { _id: doc._id },
      {
        $set: {
          toAddresses: cleanList(doc.toAddresses),
          ccAddresses: cleanList(doc.ccAddresses)
        }
      }
    );
  }
  console.log(`8. Cleaned non-email tokens in ${allBroken.length} activityLog entries`);

  // 9. Fix misattributed userEmail on outbound emails
  const staffUsers = [
    { email: 'david.bozsik@seyuselfies.com', userId: '5277db2c-b251-402b-831e-29aab81a3526' },
    { email: 'coo@seyuselfies.com', userId: '13c27f1a-1d8c-4108-96e3-c10e1dca4a09' },
    { email: 'moldovancsaba@gmail.com', userId: '5143beb1-9bb6-47e7-a099-e9eeb2d89e93' },
    { email: 'office@seyuselfies.com', userId: 'ac2021ea-cca7-4938-bf09-02705331c134' },
    { email: 'ricardo.maia@seyuselfies.com', userId: '25b1e7a3-f496-4155-8f04-e2bcf53bc571' },
    { email: 'mate.pecsi@seyuselfies.com', userId: 'b8eec566-71f4-460f-aa23-d4e18904576c' },
    { email: 'tom.vechy@seyuselfies.com', userId: 'e028f6c3-643e-4028-9a61-619ddebe2058' },
    { email: 'partnerships@seyuselfies.com', userId: 'da66899f-7492-447a-9803-7b96b9b9d068' },
  ];
  for (const staff of staffUsers) {
    const res = await db.collection('activityLog').updateMany(
      {
        brand: 'seyu',
        type: 'email-outbound',
        fromAddress: staff.email,
        userEmail: { $ne: staff.email }
      },
      {
        $set: {
          userEmail: staff.email,
          userId: staff.userId
        }
      }
    );
    if (res.modifiedCount > 0) {
      console.log(`9. Fixed userEmail for ${staff.email}: ${res.modifiedCount} updated`);
    }
  }

  // 10. Reset gmailSyncCursors for coo@seyuselfies.com and office@seyuselfies.com to 30 days ago
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const resetCursors = await db.collection('gmailSyncCursors').updateMany(
    {
      gmailAddress: { $in: ['coo@seyuselfies.com', 'office@seyuselfies.com', 'moldovancsaba@gmail.com'] }
    },
    {
      $set: {
        lastSyncedAt: thirtyDaysAgo,
        updatedAt: new Date().toISOString()
      }
    }
  );
  console.log(`10. Reset ${resetCursors.modifiedCount} Gmail sync cursors back to 30 days ago (${thirtyDaysAgo})`);

  // 11. Verify Seyu Services logs count
  const remainingSeyuServices = await db.collection('activityLog').countDocuments({ leadId: '6ad50814c501c40783f2cc0d' });
  console.log('11. Remaining logs on Seyu Services:', remainingSeyuServices);

  await client.close();
  console.log('Remediation completed successfully.');
}

remediate().catch((err) => {
  console.error('Remediation failed:', err);
  process.exit(1);
});
