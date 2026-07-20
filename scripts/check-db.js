const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const uri = process.env.MONGODB_URI || 'mongodb+srv://moldovancsaba_salesleadgenerator:***@sales.8wytusk.mongodb.net/sales?retryWrites=true&w=majority';

mongoose.connect(uri)
  .then(async () => {
    console.log('Connected to MongoDB');
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name));
    
    if (collections.length === 0) {
      console.log('Database appears empty');
    } else {
      for (const col of collections) {
        const count = await mongoose.connection.db.collection(col.name).countDocuments();
        console.log(col.name + ':', count, 'documents');
      }
    }
    
    await mongoose.disconnect();
  })
  .catch(e => { console.error('Error:', e.message); process.exit(1); });
