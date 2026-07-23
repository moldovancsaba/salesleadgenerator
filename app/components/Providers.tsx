'use client';

import { MantineProvider, createTheme } from "@mantine/core";

// createTheme() must run in a Client Component: `Input.vars` below is a
// function, and functions can't be serialized across the Server -> Client
// Component boundary when passed as a prop (Next.js App Router would fail
// the build with "Functions cannot be passed directly to Client
// Components" if `theme` were built in the Server Component layout.tsx and
// handed to MantineProvider from there).
const theme = createTheme({
  defaultRadius: "md",
  focusRing: "auto",
  cursorType: "pointer",
  components: {
    // Mobile input-focus auto-zoom guard, adopted from GDS 3.11.0
    // (packages/gds-theme/src/theme.ts): iOS Safari/Chrome force-zoom the
    // whole page when a focused input's computed font-size is under 16px.
    // Mantine's "xs"/"sm" sizes (and the implicit default) render at
    // 12-14px. `Input.vars` sets the same CSS custom property
    // (--input-fz) Mantine's own size resolver uses, so this wins with no
    // specificity contest — unlike the previous global
    // `input, select, textarea { font-size: 16px !important }` rule this
    // replaces, which needed !important specifically because it couldn't
    // otherwise out-rank Mantine's generated class selector. "md"/"lg"/"xl"
    // already render >=16px and are left untouched (undefined falls
    // through to Mantine's default).
    Input: {
      vars: (_theme: unknown, props: { size?: string }) => ({
        wrapper: {
          "--input-fz":
            props.size === undefined || props.size === "xs" || props.size === "sm"
              ? "max(1rem, var(--mantine-font-size-sm))"
              : undefined,
        },
      }),
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return <MantineProvider theme={theme}>{children}</MantineProvider>;
}
