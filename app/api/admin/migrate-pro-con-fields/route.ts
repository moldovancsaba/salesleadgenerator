import { NextResponse } from 'next/server'
import { getClientPromise, isMongoConfigured } from '../../../../lib/mongodb'

// TEMPORARY one-time migration for issue #20's generic-field rename.
// Renames pro_for_cogmap/con_for_cogmap -> pro_for_organization/con_for_organization
// in `leads`, and pro_for_seyu/con_for_seyu -> pro_for_organization/con_for_organization
// in `seyu_leads`. Delete this file once the migration has run successfully.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const { searchParams } = new URL(request.url)
    if (searchParams.get('confirm') !== 'migrate') {
      return NextResponse.json({ error: 'Add ?confirm=migrate to the URL to run this migration' }, { status: 400 })
    }

    const client = await getClientPromise()
    const db = client.db()

    const cogmapResult = await db.collection('leads').updateMany(
      { $or: [{ pro_for_cogmap: { $exists: true } }, { con_for_cogmap: { $exists: true } }] },
      { $rename: { pro_for_cogmap: 'pro_for_organization', con_for_cogmap: 'con_for_organization' } }
    )

    const seyuResult = await db.collection('seyu_leads').updateMany(
      { $or: [{ pro_for_seyu: { $exists: true } }, { con_for_seyu: { $exists: true } }] },
      { $rename: { pro_for_seyu: 'pro_for_organization', con_for_seyu: 'con_for_organization' } }
    )

    const remainingOldFields = await Promise.all([
      db.collection('leads').countDocuments({ $or: [{ pro_for_cogmap: { $exists: true } }, { con_for_cogmap: { $exists: true } }] }),
      db.collection('seyu_leads').countDocuments({ $or: [{ pro_for_seyu: { $exists: true } }, { con_for_seyu: { $exists: true } }] }),
    ])

    const newFieldCounts = await Promise.all([
      db.collection('leads').countDocuments({ $or: [{ pro_for_organization: { $exists: true } }, { con_for_organization: { $exists: true } }] }),
      db.collection('seyu_leads').countDocuments({ $or: [{ pro_for_organization: { $exists: true } }, { con_for_organization: { $exists: true } }] }),
    ])

    return NextResponse.json({
      note: 'Migration for issue #20 — safe to delete after use',
      leads: { matched: cogmapResult.matchedCount, modified: cogmapResult.modifiedCount },
      seyu_leads: { matched: seyuResult.matchedCount, modified: seyuResult.modifiedCount },
      verification: {
        remainingWithOldFieldNames: { leads: remainingOldFields[0], seyu_leads: remainingOldFields[1] },
        nowWithNewFieldName: { leads: newFieldCounts[0], seyu_leads: newFieldCounts[1] },
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: 'Migration failed', details: error.message }, { status: 500 })
  }
}
