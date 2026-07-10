const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://moldovancsaba_cogmap:hDdCxB93I1U94Mpv@sales.8wytusk.mongodb.net/?retryWrites=true&w=majority&appName=Sales";

async function checkConnection() {
  try {
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✓ Connected to MongoDB Atlas');
    
    const db = client.db('sales');
    const collections = await db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name));
    
    const leadsCollection = db.collection('leads');
    const count = await leadsCollection.countDocuments();
    console.log(`Leads collection: ${count} documents`);
    
    await client.close();
    console.log('✓ Connection closed');
  } catch (error) {
    console.error('✗ Connection failed:', error.message);
  }
}

checkConnection();
