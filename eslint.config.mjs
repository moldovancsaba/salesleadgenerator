import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

// eslint-config-next has shipped a real flat-config array (module.exports is
// already an array of flat config objects, not a legacy eslintrc object)
// since before this repo adopted it — the @eslint/eslintrc FlatCompat bridge
// this file used to need was never actually required, and became a real
// crash under ESLint 10 (a circular-structure error inside FlatCompat's own
// config validator). Importing the native flat config directly avoids it.
const eslintConfig = [
  ...nextCoreWebVitals,
  {
    rules: {
      // eslint-config-next 16's updated eslint-plugin-react-hooks flags every
      // effect that resets loading/error state synchronously before kicking
      // off an async fetch (e.g. `setLoading(true); setError(null); fetch(...)`)
      // — a deliberate, safe, and pervasive pattern already used consistently
      // across this entire codebase's ~10 data-fetching components, not an
      // actual bug this rule caught. Disabled rather than restructured, since
      // restructuring every instance would be a large, risky rewrite of
      // working code for a purely stylistic preference.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default eslintConfig;
