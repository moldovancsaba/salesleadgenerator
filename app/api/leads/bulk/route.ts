import { NextResponse, type NextRequest } from 'next/server'
import { executeLeadAction } from '../../../lib/lead-actions'
import { resolveBrand } from '../../../lib/brand'
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api'

// Issue #70. No requireApiKey — matches PATCH /api/leads (app/api/leads/
// route.ts), which dropped that guard for the same reason (issue #91): this
// is called from the browser (app/kanban.tsx's bulk action bar), which has
// no safe way to hold SLG_API_KEY. Issue #104: gated by
// requireBrandAccessApi instead, same as PATCH /api/leads. brand comes from
// the JSON body here (not the query string), so the body must be parsed
// before the auth check and reused, not read twice.
const MAX_BULK_SIZE = 100
const ALLOWED_BULK_ACTIONS = new Set(['DECLINE', 'PIN'])

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const brand = resolveBrand(body.brand)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })

    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const tenantId = (body.tenantId || 'default').trim() || 'default'
    const action = String(body.action || '').toUpperCase()
    // Issue #109: de-duplicated (stringified, first-seen order) before the
    // cap check and the processing loop — a duplicated id in the raw
    // request previously ran executeLeadAction twice for the same lead,
    // double-counting declineCount/feedbackScore and writing two
    // outcomelogs rows for what was really one logical action.
    const rawLeadIds = Array.isArray(body.leadIds) ? body.leadIds : []
    const leadIds = Array.from(new Set(rawLeadIds.map((id: unknown) => String(id))))
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}

    if (!ALLOWED_BULK_ACTIONS.has(action)) {
      return NextResponse.json({ error: 'action must be one of: DECLINE, PIN' }, { status: 400 })
    }

    if (leadIds.length === 0) {
      return NextResponse.json({ error: 'leadIds must be a non-empty array' }, { status: 400 })
    }

    if (leadIds.length > MAX_BULK_SIZE) {
      return NextResponse.json({ error: `leadIds exceeds the ${MAX_BULK_SIZE}-lead limit per request` }, { status: 400 })
    }

    // Sequential, not Promise.all — these are writes to shared per-lead
    // documents; reusing executeLeadAction exactly as the single-lead PATCH
    // route does (app/api/leads/route.ts) keeps this bulk path from ever
    // diverging from that business logic.
    const results: Array<{ leadId: string; success: boolean; error?: string }> = []
    for (const leadId of leadIds) {
      try {
        const result = await executeLeadAction({
          brand,
          tenantId,
          leadId: String(leadId),
          action: action as 'DECLINE' | 'PIN',
          payload,
        })
        results.push({ leadId: String(leadId), success: result.success, error: result.success ? undefined : result.error })
      } catch (itemError: any) {
        // A malformed leadId throws synchronously inside executeLeadAction
        // (invalid ObjectId) rather than returning a normal {success:false}
        // result — caught here so one bad ID can't fail the whole batch.
        results.push({ leadId: String(leadId), success: false, error: itemError?.message || 'Invalid lead id' })
      }
    }

    return NextResponse.json({ results })
  } catch (error: any) {
    console.error('[API:leads/bulk] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to process bulk action', details: error.message }, { status: 500 })
  }
}
