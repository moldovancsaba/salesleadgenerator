import { NextResponse } from 'next/server'
import { getClientPromise, isMongoConfigured } from '../../../../lib/mongodb'

// TEMPORARY diagnostic endpoint for issue #11 (outcomeLogs vs outcomelogs
// collection-name split). Read-only, aggregate counts only (no lead PII).
// Delete this file once the split is resolved.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()

    const inspect = async (name: string) => {
      const collection = db.collection(name)
      const count = await collection.countDocuments()
      const latest = await collection.find().sort({ createdAt: -1 }).limit(1).toArray()
      return {
        count,
        latestCreatedAt: latest[0]?.createdAt || null,
        latestAction: latest[0]?.action || null,
      }
    }

    const [camelCase, lowerCase] = await Promise.all([
      inspect('outcomeLogs'),
      inspect('outcomelogs'),
    ])

    return NextResponse.json({
      note: 'Temporary diagnostic for issue #11 — safe to delete after use',
      outcomeLogs_camelCase: camelCase,
      outcomelogs_lowercase: lowerCase,
    })
  } catch (error: any) {
    return NextResponse.json({ error: 'Diagnostic failed', details: error.message }, { status: 500 })
  }
}
