'use client'

import { usePathname } from 'next/navigation'
import { AppNav } from './AppNav'

// Issue #207 — the public, unauthenticated booking page (/schedule/[brand])
// is the first prospect-facing surface this app has ever shipped, and its
// own spec is explicit: it "must not import or expose anything from the
// SSO-gated admin chrome (nav, brand switcher, Kanban)." Before this, the
// header bar (including AppNav) was rendered unconditionally in the root
// layout for every route with no way to opt out. Extracted into its own
// small Client Component so it can check the current path and render
// nothing at all on a public booking page, rather than modifying the root
// layout (a shared file every other page depends on) with page-specific
// logic inline.
export function AppHeader() {
  const pathname = usePathname()
  if (pathname?.startsWith('/schedule/')) return null

  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--mantine-color-body)', borderBottom: '1px solid var(--mantine-color-gray-3)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
      <AppNav />
      <span style={{ fontWeight: 700, fontSize: '15px' }}>Sales Lead Generator</span>
    </div>
  )
}
