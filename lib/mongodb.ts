import { MongoClient } from 'mongodb'

const uri = process.env.MONGODB_URI || ''

const options = {}

let client: MongoClient
let clientPromise: Promise<MongoClient>

if (uri) {
  if (process.env.NODE_ENV === 'development') {
    let globalWithMongo = global as typeof globalThis & {
      _mongoClientPromise?: Promise<MongoClient>
    }

    if (!globalWithMongo._mongoClientPromise) {
      client = new MongoClient(uri, options)
      globalWithMongo._mongoClientPromise = client.connect()
    }

    clientPromise = globalWithMongo._mongoClientPromise
  } else {
    client = new MongoClient(uri, options)
    clientPromise = client.connect()
  }
} else {
  // clientPromise is typed Promise<MongoClient> but actually resolves to null
  // here when MONGODB_URI is unset, so TypeScript can never catch a missing
  // guard. Every caller must check isMongoConfigured() / MONGODB_URI BEFORE
  // awaiting this promise, never by testing the awaited client's truthiness —
  // that pattern doesn't type-narrow and the branch silently never fires.
  clientPromise = Promise.resolve(null as any)
}

export function isMongoConfigured(): boolean {
  return !!uri
}

export function getClientPromise(): Promise<MongoClient> {
  return clientPromise
}

export default clientPromise
