import { MongoMemoryServer } from 'mongodb-memory-server';

// lib/mongodb.ts reads process.env.MONGODB_URI once, at module load time, and
// creates its client/clientPromise synchronously from that value. Route
// modules must therefore be dynamically imported (`await import(...)`) AFTER
// this resolves and sets MONGODB_URI — a static top-of-file `import` would
// already have executed (and cached a configured-vs-unconfigured client)
// before this function ever runs, since ES module imports are hoisted.
export async function startTestMongo(): Promise<MongoMemoryServer> {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  return mongod;
}

export async function stopTestMongo(mongod: MongoMemoryServer | undefined): Promise<void> {
  delete process.env.MONGODB_URI;
  if (mongod) await mongod.stop();
}
