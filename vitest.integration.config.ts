import { defineConfig } from 'vitest/config';
import path from 'path';

// Separate from vitest.config.ts (which excludes tests/integration/** from
// the default gate) specifically so `npm run test:integration` can target
// only this directory — these tests need a real MongoDB (mongodb-memory-server)
// and are not part of the always-on quality gate.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // See tests/helpers/server-only-noop.ts's own header comment — matches
      // Next.js's own server-side webpack aliasing of this package.
      'server-only': path.resolve(__dirname, 'tests/helpers/server-only-noop.ts'),
    },
  },
  test: {
    testTimeout: 60000,
    hookTimeout: 60000,
    include: ['tests/integration/**/*.test.ts'],
  },
});
