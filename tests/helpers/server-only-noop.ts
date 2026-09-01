// Issue #196 — Next.js's own webpack build aliases the real `server-only`
// package (which unconditionally throws on import) to a no-op specifically
// in its server compilation, so a Server Component/server-only module can
// import it safely while a Client Component importing the same module still
// gets a real, clear build-time error. Vitest doesn't go through that
// build, so importing a module marked `import 'server-only'` (e.g.
// app/lib/brand.ts) directly in a unit/integration test — the normal way
// this repo tests server-side modules — would otherwise always throw. This
// stub is aliased over the real package in vitest.config.ts and
// vitest.integration.config.ts, matching Next.js's own server-side behavior.
export {};
