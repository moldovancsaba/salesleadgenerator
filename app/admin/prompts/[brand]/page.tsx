import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { resolveSessionFromIdToken } from '@/lib/session'
import { isSuperAdminEmail, getUserAccess, getRoleForBrand } from '@/lib/sso-access'
import clientPromise, { isMongoConfigured } from '@/lib/mongodb'
import { PromptEditorClient } from './prompt-editor-client'
import { resolveBrand, getBrandConfig } from '@/app/lib/brand'

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params
  const brand = await resolveBrand(brandParam)
  if (!brand) return { title: 'Not Found' }
  const config = await getBrandConfig(brand)
  return { title: `${config?.label || brand} Prompts` }
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

  const { brand: brandParam } = await params
  const brand = await resolveBrand(brandParam)
  if (!brand) notFound()

  // Super admin, or the admin of exactly this workspace (client delivery #20).
  if (!isSuperAdminEmail(claims.email)) {
    let allowed = false
    if (isMongoConfigured()) {
      const db = (await clientPromise).db()
      const record = await getUserAccess(db, claims.sub)
      allowed = getRoleForBrand(claims.email, record?.orgAccess, brand) === 'admin'
    }
    if (!allowed) redirect('/access-denied')
  }
  const config = await getBrandConfig(brand)

  return <PromptEditorClient brand={brand} label={config?.label ?? brand} />
}
