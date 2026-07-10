import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'

export async function GET(request: Request) {
  try {
    const client = await clientPromise
    const db = client.db()
    
    const leads = await db.collection('leads').find({}).toArray()
    
    return NextResponse.json({
      leads: leads.map(lead => ({
        _id: lead._id.toString(),
        entity_name: lead.entity_name,
        url: lead.url || '',
        address: lead.address || '',
        general_contact: lead.general_contact || '',
        size: lead.size || '',
        industry: lead.industry || '',
        sport_or_sector: lead.sport_or_sector || '',
        level_league: lead.level_league || '',
        decision_maker_name: lead.decision_maker_name || '',
        decision_maker_title: lead.decision_maker_title || '',
        decision_maker_contact: lead.decision_maker_contact || '',
        pro_for_cogmap: lead.pro_for_cogmap || [],
        con_for_cogmap: lead.con_for_cogmap || [],
        value_proposition: lead.value_proposition || '',
        priority: lead.priority || 'medium',
        status: lead.status || 'new',
        region: lead.region || 'US',
        notes: lead.notes || '',
        tags: lead.tags || []
      }))
    })
  } catch (error: any) {
    console.error('API Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch leads', details: error.message },
      { status: 500 }
    )
  }
}
