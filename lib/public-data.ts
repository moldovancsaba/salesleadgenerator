import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'public')

function readJsonFile<T>(filename: string): T[] {
  const filePath = path.join(DATA_DIR, filename)
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw)
}

function normalizeLead(record: any, index: number): any {
  const sourceId =
    typeof record.id === 'number'
      ? String(record.id)
      : typeof record.id === 'string'
        ? record.id
        : `${record.region || 'x'}-${record.entity_name || 'lead'}-${index}`

  return {
    ...record,
    _id: record._id || sourceId,
    id: sourceId,
    kanbanColumn: record.kanbanColumn || record.kanban_column || 'DISCOVERED',
    sortOrder: typeof record.sortOrder === 'number' ? record.sortOrder : index,
    qualityStatus: record.qualityStatus || 'DRAFT',
    feedbackScore: record.feedbackScore ?? 0,
    declineCount: record.declineCount ?? 0,
    acceptanceCount: record.acceptanceCount ?? 0,
    ice: record.ice || { impact: record.impact ?? 5, confidence: record.confidence ?? 5, ease: record.ease ?? 5 },
    scoreProfile:
      record.scoreProfile ||
      {
        agentProposal: {
          impact: record.impact ?? 5,
          confidence: record.confidence ?? 5,
          effort: record.ease ?? 5,
        },
        calibratedHeuristic: {
          impact: record.impact ?? 5,
          confidence: record.confidence ?? 5,
          effort: record.ease ?? 5,
        },
        finalBlended: {
          ice: (record.impact ?? 5) * (record.confidence ?? 5) * (record.ease ?? 5),
          quality: Math.round(((record.impact ?? 5) / 10) * 100),
          urgency: Math.round(((record.confidence ?? 5) / 10) * 100),
          freshness: 50,
          humanSignal: 50,
          risk: Math.round(((10 - (record.ease ?? 5)) / 10) * 100),
        },
        qualityDimensions: {
          evidenceQuality: (record.confidence ?? 5) / 10,
          linguisticQuality: 0.8,
          actionabilityQuality: (record.impact ?? 5) / 10,
          strategicValue: (record.impact ?? 5) / 10,
        },
      },
    createdAt: record.createdAt || record.created_at || new Date(0),
    updatedAt: record.updatedAt || record.updated_at || new Date(0),
  }
}

function readFileWithFallback(files: string[]): any[] {
  for (const file of files) {
    if (fs.existsSync(path.join(DATA_DIR, file))) {
      return readJsonFile<any[]>(file)
    }
  }
    return []
}

export function getPublicLeads(): any[] {
  const usLeads = readFileWithFallback(['us-leads.json'])
  const menaLeads = readFileWithFallback(['mena-leads.json'])
  const ceeLeads = readFileWithFallback(['cee-leads.json'])

  const all = [
    ...usLeads.map((lead, i) => normalizeLead(lead, i)),
    ...menaLeads.map((lead, i) => normalizeLead(lead, usLeads.length + i)),
    ...ceeLeads.map((lead, i) => normalizeLead(lead, usLeads.length + menaLeads.length + i)),
  ]

  return all.sort((a, b) => {
    if (a.region === b.region) return String(a.entity_name).localeCompare(String(b.entity_name))
    return String(a.region).localeCompare(String(b.region))
  })
}

export function getPublicLeadById(id: string) {
  const leads = getPublicLeads()
  const primary = leads.find((lead) => String(lead._id) === id || String(lead.id) === id)
  if (primary) return primary

  const normalized = id.replace(/-/g, ' ').toLowerCase()
  return (
    leads.find((lead) => String(lead.entity_name).toLowerCase() === normalized) ||
    leads.find((lead) => String(lead.entity_name).toLowerCase().includes(normalized))
  )
}
