import { NextRequest, NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { requireSuperAdminSession } from '@/lib/session'
import { isSafeIdentifier } from '@/lib/safe-identifier'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const COLLECTION = 'prompts'
const PROMPTS_DIR = join(process.cwd(), '..', 'Agents', 'contentcreator', 'prompts')

export type PromptRecord = {
  brand: string
  tenantId: string
  type: 'discovery' | 'enrichment'
  content: string
  source: 'mongodb' | 'disk'
  updatedAt: string
}

function resolvePromptPath(tenantId: string, type: 'discovery' | 'enrichment'): string {
  return join(PROMPTS_DIR, type, `${tenantId}.md`)
}

function diskPromptExists(tenantId: string, type: 'discovery' | 'enrichment'): { path: string; exists: boolean } {
  const path = resolvePromptPath(tenantId, type)
  return { path, exists: existsSync(path) }
}

export async function GET(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  try {
    const { searchParams } = new URL(request.url)
    const brand = searchParams.get('brand') || 'cogmap'
    const tenantId = searchParams.get('tenantId') || brand
    const type = searchParams.get('type')

    if (!type || (type !== 'discovery' && type !== 'enrichment')) {
      return NextResponse.json({ error: 'type query param required: discovery or enrichment' }, { status: 400 })
    }
    if (!isSafeIdentifier(tenantId)) {
      return NextResponse.json({ error: 'tenantId must contain only letters, digits, hyphens, and underscores' }, { status: 400 })
    }

    if (!process.env.MONGODB_URI) {
      const { path: diskPath, exists } = diskPromptExists(tenantId, type as 'discovery' | 'enrichment')
      if (exists) {
        return NextResponse.json({ prompt: readFileSync(diskPath, 'utf-8'), source: 'disk' })
      }
      return NextResponse.json({ prompt: '', source: 'default', error: 'not found on disk' }, { status: 404 })
    }

    const client = await clientPromise
    const db = client.db()
    const collection = db.collection(COLLECTION)

    const doc = await collection.findOne({ brand, tenantId, type })

    if (!doc) {
      const { path: diskPath, exists } = diskPromptExists(tenantId, type as 'discovery' | 'enrichment')
      if (exists) {
        return NextResponse.json({ prompt: readFileSync(diskPath, 'utf-8'), source: 'disk' })
      }
      return NextResponse.json({ prompt: '', source: 'default', error: 'not found' }, { status: 404 })
    }

    const { _id, ...prompt } = doc as any
    return NextResponse.json({ prompt, source: 'mongodb' })
  } catch (error: any) {
    console.error('[API:prompts] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch prompt', details: error.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  try {
    const body = await request.json()
    const brand = body.brand || 'cogmap'
    const tenantId = body.tenantId || brand
    const type = body.type
    const content = body.content

    if (!type || (type !== 'discovery' && type !== 'enrichment')) {
      return NextResponse.json({ error: 'type required: discovery or enrichment' }, { status: 400 })
    }
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
    }
    if (!isSafeIdentifier(tenantId)) {
      return NextResponse.json({ error: 'tenantId must contain only letters, digits, hyphens, and underscores' }, { status: 400 })
    }

    if (process.env.MONGODB_URI) {
      const client = await clientPromise
      const db = client.db()
      const collection = db.collection(COLLECTION)

      await collection.updateOne(
        { brand, tenantId, type },
        { $set: { content, source: 'mongodb', updatedAt: new Date().toISOString() } },
        { upsert: true }
      )
    }

    // Also write to disk for cron jobs that read files directly
    const { path: diskPath } = diskPromptExists(tenantId, type as 'discovery' | 'enrichment')
    const dir = join(diskPath, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(diskPath, content, 'utf-8')

    return NextResponse.json({ ok: true, brand, tenantId, type, source: 'mongodb', updatedAt: new Date().toISOString() })
  } catch (error: any) {
    console.error('[API:prompts] PUT error:', error)
    return NextResponse.json({ error: 'Failed to save prompt', details: error.message }, { status: 500 })
  }
}
