import { NextResponse } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb'
import { migrateDecisionMakerCollection } from '../../../../lib/migrate-decision-maker'

export const dynamic = 'force-dynamic'

// TEMPORARY — one-time production migration for issue #45's hard cutover.
// Delete this route (and this comment) once it's been run successfully
// against production; it exists only because the repo owner has no
// terminal/DB access and needed a URL they could open on a phone instead
// of running scripts/migrate-decision-maker-to-contacts.ts directly.
//
// GET-triggerable from a browser, so it can't rely on a custom x-api-key
// header (lib/api-auth.ts's normal mechanism) — the key travels as a query
// param instead, reusing the existing SLG_API_KEY secret rather than
// inventing a new one. Fails closed (403) if SLG_API_KEY isn't configured,
// unlike this repo's general fail-open default for unset SLG_API_KEY — this
// route performs a bulk production write, not an ordinary lead mutation, so
// the usual local/dev convenience trade-off doesn't apply here.
//
// Dry run by default; add &apply=true to actually write.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key') || ''
  const apply = searchParams.get('apply') === 'true'

  const expectedKey = process.env.SLG_API_KEY || ''
  if (!expectedKey || key !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const client = await clientPromise
    const db = client.db()

    const collections = ['leads', 'seyu_leads']
    const results: Record<string, any> = {}
    const totals = { scanned: 0, merged: 0, alreadyRepresented: 0, clearedOnly: 0 }

    for (const collectionName of collections) {
      const result = await migrateDecisionMakerCollection(db, collectionName, { apply })
      results[collectionName] = {
        scanned: result.scanned,
        merged: result.merged,
        alreadyRepresented: result.alreadyRepresented,
        clearedOnly: result.clearedOnly,
      }
      totals.scanned += result.scanned
      totals.merged += result.merged
      totals.alreadyRepresented += result.alreadyRepresented
      totals.clearedOnly += result.clearedOnly
    }

    return NextResponse.json({
      mode: apply ? 'apply' : 'dry-run',
      note: apply ? 'Changes written.' : 'No changes written — add &apply=true to write.',
      collections: results,
      totals,
    })
  } catch (error: any) {
    console.error('[API:admin/migrate-decision-maker] GET error:', error)
    return NextResponse.json({ error: 'Migration failed', details: error.message }, { status: 500 })
  }
}
