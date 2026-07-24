import { BRAND_CONFIG, PRO_FIELD, CON_FIELD } from './brand'
import { normalizeLead } from './normalize-lead'
import { validatePatchPayload } from '../../lib/validate-lead'
import { isMongoConfigured } from '../../lib/mongodb'
import { tenantFilter as buildTenantFilter } from '../../lib/tenant'
import { dedupeContacts } from '../../lib/contacts'

export type LeadActionInput = {
  brand: string
  tenantId: string
  leadId: string
  action: 'ACCEPT' | 'DECLINE' | 'MODIFY' | 'PIN' | 'REQUEST_REFRESH' | 'COLUMN_MOVE'
  payload: Record<string, any>
}

export type LeadActionResult = {
  success: boolean
  lead?: Record<string, any>
  error?: string
  requestId?: string
}

export async function executeLeadAction(input: LeadActionInput): Promise<LeadActionResult> {
  const { brand, tenantId, leadId, action, payload } = input
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

  if (!isMongoConfigured()) {
    return { success: false, error: 'Database not configured', requestId }
  }

  const config = BRAND_CONFIG[brand]

  const client = await (await import('../../lib/mongodb')).getClientPromise()
  const db = client.db()
  const { ObjectId } = await import('mongodb')

  const tenantFilter = buildTenantFilter(tenantId)

  const existing = await db.collection(config.dbCollection).findOne({ _id: new ObjectId(leadId), ...tenantFilter })
  if (!existing) return { success: false, error: 'Lead not found', requestId }

  const validation = validatePatchPayload({ action, ...payload }, brand)
  if (!validation.valid) return { success: false, error: validation.errors.join('; '), requestId }

  const normalizedBody = normalizeLead({ ...existing, ...payload, action })
  const updateData: Record<string, any> = { updatedAt: new Date() }
  let outcomeValue: string = action

  if (action === 'COLUMN_MOVE') {
    const now = new Date()
    updateData.kanbanColumn = normalizedBody.kanbanColumn
    updateData.sortOrder = normalizedBody.sortOrder || 0
    updateData.manualLaneOverrideAt = now
    // 24h cooldown: a drag-and-drop move to an arbitrary column is a lighter-weight
    // signal than an explicit PIN below, so it protects the lead from auto-reclassification
    // for a shorter window.
    updateData.manualLaneCooldownUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    updateData.manualLaneFloorColumn = normalizedBody.kanbanColumn
    updateData.manualLaneOverrideBy = normalizedBody.manualLaneOverrideBy || 'webapp-user'
    outcomeValue = `Moved to ${normalizedBody.kanbanColumn}`
  }

  if (action === 'ACCEPT') {
    updateData.status = 'qualified'
    updateData.acceptanceCount = (existing.acceptanceCount || 0) + 1
    updateData.feedbackScore = (existing.feedbackScore || 0) + 1
  }

  if (action === 'DECLINE') {
    updateData.status = 'lost'
    updateData.kanbanColumn = 'LOST'
    updateData.declineReason = normalizedBody.declineReason || 'OTHER'
    updateData.declinedAt = new Date()
    updateData.declineCount = (existing.declineCount || 0) + 1
    updateData.feedbackScore = (existing.feedbackScore || 0) - 1
    outcomeValue = normalizedBody.declineReason || 'DECLINED'
  }

  if (action === 'MODIFY') {
    const fields = ['entity_name', 'url', 'address', 'general_contact', 'size', 'industry',
                    'sport_or_sector', 'level_league', 'value_proposition', 'notes', 'tags']
    fields.forEach(field => {
      if (normalizedBody[field] !== undefined) updateData[field] = normalizedBody[field]
    })
    // Previously MODIFY had no way to touch contacts[] at all — the only path
    // that could write it was PUT. Added so decision-maker status (a flag on a
    // contact, not a top-level field — see lib/contacts.ts, issue #45) can
    // actually be edited via the same action the detail modal already uses.
    if (Array.isArray(normalizedBody.contacts)) {
      updateData.contacts = dedupeContacts(normalizedBody.contacts)
    }
    if (normalizedBody[PRO_FIELD]) updateData[PRO_FIELD] = normalizedBody[PRO_FIELD]
    if (normalizedBody[CON_FIELD]) updateData[CON_FIELD] = normalizedBody[CON_FIELD]
    if (normalizedBody.qualityStatus) {
      const { enforceQualityCeiling } = await import('../../lib/quality-registry')
      const upstreamQuality = normalizedBody.upstreamQualityStatuses || ['DRAFT']
      updateData.qualityStatus = enforceQualityCeiling(normalizedBody.qualityStatus, upstreamQuality)
    }
  }

  if (action === 'PIN') {
    updateData.kanbanColumn = 'ENGAGED'
    const now = new Date()
    updateData.manualLaneOverrideAt = now
    // 48h cooldown: PIN is a deliberate "I'm actively working this lead" signal
    // (vs. an incidental drag), so it earns double COLUMN_MOVE's protection window.
    updateData.manualLaneCooldownUntil = new Date(now.getTime() + 48 * 60 * 60 * 1000)
    outcomeValue = 'Pinned to ENGAGED'
  }

  if (action === 'REQUEST_REFRESH') {
    outcomeValue = 'Refresh requested'
  }

  const result = await db.collection(config.dbCollection).findOneAndUpdate(
    { _id: new ObjectId(leadId), ...tenantFilter },
    { $set: updateData },
    { returnDocument: 'after' }
  )

  if (!result) return { success: false, error: 'Lead not found after update', requestId }
  const updatedLead = result

  await db.collection('outcomelogs').insertOne({
    leadId,
    action,
    outcomeType: action,
    outcomeValue,
    annotation: payload.annotation || payload.notes || '',
    // Relative confidence recorded in the outcome-log audit trail for this action
    // type: DECLINE is the strongest signal (explicit rejection), MODIFY is a close
    // second (a human corrected the record), everything else is weaker/implicit.
    // Not currently read back by any scoring or learning code in this repo — see
    // docs/ARCHITECTURE.md's Outcome Log section.
    teachingWeight: action === 'MODIFY' ? 95 : action === 'DECLINE' ? 100 : 70,
    actorType: 'USER',
    actedBy: 'webapp-user',
    beforeState: {
      kanbanColumn: existing.kanbanColumn,
      status: existing.status,
    },
    afterState: {
      kanbanColumn: updateData.kanbanColumn || existing.kanbanColumn,
      status: updateData.status || existing.status,
    },
    createdAt: new Date(),
    tenantId,
  })

  const normalizedLead = normalizeLead({ ...updatedLead, _id: updatedLead._id.toString() })

  return { success: true, lead: normalizedLead, requestId }
}
