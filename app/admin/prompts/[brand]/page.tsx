import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { resolveSessionFromIdToken } from '@/lib/session'
import { isSuperAdminEmail } from '@/lib/sso-access'
import { PromptEditorClient } from './prompt-editor-client'
import { resolveBrand, BRAND_CONFIG } from '@/app/lib/brand'

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params
  const brand = resolveBrand(brandParam)
  return { title: `${BRAND_CONFIG[brand]?.label || brand} Prompts` }
}

// Same super-admin gate as app/admin/users/page.tsx and
// app/admin/duplicates/page.tsx — this page edits the autonomous research
// agent's discovery/enrichment prompts, previously reachable (and its
// underlying API writable) with no auth at all.
export default async function PromptEditorPage({ params }: { params: Promise<{ brand: string }> }) {
  const cookieStore = await cookies()
  const idToken = cookieStore.get('sso_id_token')?.value
  const claims = await resolveSessionFromIdToken(idToken)

  if (!claims) {
    redirect('/api/auth/login')
  }
  if (!isSuperAdminEmail(claims.email)) {
    redirect('/access-denied')
  }

  const { brand: brandParam } = await params
  const brand = resolveBrand(brandParam)

  return <PromptEditorClient brand={brand} />
}
