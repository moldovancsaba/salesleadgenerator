import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

// Mirrors tsconfig.json's "paths": { "@/*": ["./*"] } — vitest/vite don't read
// tsconfig paths automatically, so route files that import via "@/..." (some
// do, some use relative imports) fail to resolve under plain `vitest run`
// without this. Needed for tests/integration/* to import route handlers
// directly.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    testTimeout: 10000,
    // Integration tests need a real MongoDB instance (mongodb-memory-server,
    // which downloads a mongod binary from fastdl.mongodb.org at test-run
    // time) and are excluded from the default `vitest run` gate for exactly
    // that reason — that host isn't reachable in every environment this repo
    // is developed from (confirmed blocked in this session's own sandbox).
    // Run them explicitly via `npm run test:integration`.
    exclude: [...configDefaults.exclude, 'tests/integration/**'],
  },
});
