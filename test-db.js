const { MongoClient } = require('mongodb');

const uri = "REDACTED_ROTATE_ME_2026-08-14";

async function checkDatabase() {
  try {
    const client = new MongoClient(uri);
    await client.connect();
    console.log('Connected to MongoDB Atlas');
    
    const db = client.db('sales');
    const collections = await db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name));
    
    if (collections.length > 0) {
      const collection = db.collection('leads');
      const count = await collection.countDocuments();
      console.log(`Leads collection: ${count} documents`);
      
      const sample = await collection.find({}).limit(1).toArray();
      console.log('Sample document:', sample[0]);
    }
    
    await client.close();
  } catch (error) {
    console.error('Connection failed:', error.message);
  }
}

checkDatabase();
