import { NextResponse } from 'next/server'
import clientPromise from '../../../lib/mongodb'

/**
 * Search Memory API (Check-inspired Phase 5)
 * Tracks which queries/domains produce good leads
 * Teaches the system what works
 */

export async function GET(request: Request) {
  try {
    const client = await clientPromise
    const db = client.db()

    const { searchParams } = new URL(request.url)
    const company = searchParams.get('company') || 'cogmap'

    const learning = await db.collection('searchlearnings').findOne({ companyId: company })

    if (!learning) {
      return NextResponse.json({
        totalRuns: 0,
        lastQueries: [],
        updatedAt: null,
        topQueries: [],
        topTerms: [],
        topDomains: [],
        avgSuccessRate: 0,
      })
    }

    // Calculate average success rate
    const totalQueries = learning.topQueries?.length || 0
    const totalAccepted = learning.topQueries?.reduce((sum: number, q: any) => sum + (q.accepted || 0), 0) || 0
    const totalDeclined = learning.topQueries?.reduce((sum: number, q: any) => sum + (q.declined || 0), 0) || 0
    const avgSuccessRate = totalQueries > 0 ? totalAccepted / (totalAccepted + totalDeclined) : 0

    return NextResponse.json({
      totalRuns: learning.searchRuns || 0,
      lastQueries: learning.lastQueries || [],
      updatedAt: learning.searchStateUpdatedAt || learning.updatedAt,
      topQueries: learning.topQueries || [],
      topTerms: learning.topTerms || [],
      topDomains: learning.topDomains || [],
      avgSuccessRate,
    })

  } catch (error: any) {
    console.error('[API:search-learning] GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST: Update search memory based on operator feedback
 *
 * Body: {
 *   query: string,
 *   domain?: string,
 *   terms?: string[],
 *   outcome: 'ACCEPT' | 'DECLINE' | 'CREATED',
 *   teachingWeight?: number
 * }
 */
export async function POST(request: Request) {
  try {
    const client = await clientPromise
    const db = client.db()
    const body = await request.json()

    const company = body.company || 'cogmap'
    const query = body.query
    const domain = body.domain
    const terms = body.terms || []
    const outcome = body.outcome
    const teachingWeight = body.teachingWeight || 50

    if (!query) {
      return NextResponse.json({ error: 'query required' }, { status: 400 })
    }

    const now = new Date()

    // Upsert search learning record
    await db.collection('searchlearnings').updateOne(
      { companyId: company },
      {
        $setOnInsert: {
          companyId: company,
          createdAt: now,
          lastQueries: [],
          topQueries: [],
          topTerms: [],
          topDomains: [],
          searchRuns: 0,
        },
        $set: {
          updatedAt: now,
          searchStateUpdatedAt: now,
        },
        $inc: {
          searchRuns: 1,
        },
        $push: {
          lastQueries: { $each: [query], $slice: -10 } as any,
        },
      },
      { upsert: true }
    )

    // Update topQueries with this query's outcome
    if (outcome === 'ACCEPT' || outcome === 'CREATED') {
      await db.collection('searchlearnings').updateOne(
        { companyId: company, 'topQueries.query': query },
        { $inc: { 'topQueries.$.accepted': 1 } }
      )
      // If query doesn't exist yet, add it
      await db.collection('searchlearnings').updateOne(
        { companyId: company, 'topQueries.query': { $ne: query } },
        {
          $push: {
            topQueries: {
              $each: [{ query, accepted: 1, declined: 0, createdLeads: outcome === 'CREATED' ? 1 : 0 }],
              $slice: -50 // Keep top 50 queries
            }
          } as any
        }
      )
    } else if (outcome === 'DECLINE') {
      await db.collection('searchlearnings').updateOne(
        { companyId: company, 'topQueries.query': query },
        { $inc: { 'topQueries.$.declined': 1 } }
      )
    }

    // Update topTerms
    for (const term of terms) {
      const termScore = outcome === 'ACCEPT' || outcome === 'CREATED' ? 1 : -0.5
      await db.collection('searchlearnings').updateOne(
        { companyId: company, 'topTerms.key': term },
        { $inc: { 'topTerms.$.score': termScore } }
      )
      // If term doesn't exist, add it
      await db.collection('searchlearnings').updateOne(
        { companyId: company, 'topTerms.key': { $ne: term } },
        { $push: { topTerms: { $each: [{ key: term, score: termScore }], $slice: -100 } as any } }
      )
    }

    // Update topDomains
    if (domain) {
      const domainScore = outcome === 'ACCEPT' || outcome === 'CREATED' ? 1 : -0.5
      await db.collection('searchlearnings').updateOne(
        { companyId: company, 'topDomains.key': domain },
        { $inc: { 'topDomains.$.score': domainScore } }
      )
      await db.collection('searchlearnings').updateOne(
        { companyId: company, 'topDomains.key': { $ne: domain } },
        { $push: { topDomains: { $each: [{ key: domain, score: domainScore }], $slice: -100 } as any } }
      )
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('[API:search-learning] POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
