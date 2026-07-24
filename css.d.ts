// Next.js's own ambient types (next/types/global.d.ts) only declare
// `*.module.css`/`.sass`/`.scss` (CSS Modules, which export a classes
// object) — not plain side-effect imports like `import './globals.css'`.
// TypeScript 6+ enforces TS2882 for any side-effect import with no type
// declaration at all, which this repo's plain .css imports never had.
declare module '*.css';
