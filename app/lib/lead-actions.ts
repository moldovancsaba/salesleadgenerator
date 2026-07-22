import { BRAND_CONFIG } from './brand'
import { normalizeLead } from './normalize-lead'
import { validatePatchPayload } from '../../lib/validate-lead'
import { isMongoConfigured } from '../../lib/mongodb'

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

  const tenantFilter = tenantId === 'default' ? { $or: [{ tenantId: 'default' }, { tenantId: { $exists: false } }] } : { tenantId }

  const existing = await db.collection(config.dbCollection).findOne({ _id: new ObjectId(leadId), ...tenantFilter })
  if (!existing) return { success: false, error: 'Lead not found', requestId }

  const validation = validatePatchPayload({ action, ...payload }, brand)
  if (!validation.valid) return { success: false, error: validation.errors.join('; '), requestId }

  const normalizedBody = normalizeLead({ ...existing, ...payload, action }, brand)
  const updateData: Record<string, any> = { updatedAt: new Date() }
  let outcomeValue: string = action

  if (action === 'COLUMN_MOVE') {
    const now = new Date()
    updateData.kanbanColumn = normalizedBody.kanbanColumn
    updateData.sortOrder = normalizedBody.sortOrder || 0
    updateData.manualLaneOverrideAt = now
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
                    'sport_or_sector', 'level_league', 'decision_maker_name', 'decision_maker_title',
                    'decision_maker_contact', 'value_proposition', 'notes', 'tags']
    fields.forEach(field => {
      if (normalizedBody[field] !== undefined) updateData[field] = normalizedBody[field]
    })
    if (normalizedBody[config.proField]) updateData[config.proField] = normalizedBody[config.proField]
    if (normalizedBody[config.conField]) updateData[config.conField] = normalizedBody[config.conField]
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

  const updatedLead = (result as any)?.value || (result as any)
  if (!updatedLead) return { success: false, error: 'Lead not found after update', requestId }

  await db.collection('outcomelogs').insertOne({
    leadId,
    action,
    outcomeType: action,
    outcomeValue,
    annotation: payload.annotation || payload.notes || '',
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

  const normalizedLead = normalizeLead({ ...updatedLead, _id: updatedLead._id.toString() }, brand)

  return { success: true, lead: normalizedLead, requestId }
}
