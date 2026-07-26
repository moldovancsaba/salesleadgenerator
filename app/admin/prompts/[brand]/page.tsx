import type { Metadata } from 'next'
import { PromptEditorClient } from './prompt-editor-client'
import { resolveBrand, BRAND_CONFIG } from '@/app/lib/brand'

export async function generateMetadata({ params }: { params: Promise<{ brand: string }> }): Promise<Metadata> {
  const { brand: brandParam } = await params
  const brand = resolveBrand(brandParam)
  return { title: `${BRAND_CONFIG[brand]?.label || brand} Prompts` }
}

export default async function PromptEditorPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params
  const brand = resolveBrand(brandParam)

  return <PromptEditorClient brand={brand} />
}
