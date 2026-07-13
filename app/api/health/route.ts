import { NextResponse } from 'next/server'
import clientPromise from '../../../lib/mongodb'

export async function GET() {
  try {
    let db = 'unavailable'
    try {
      const client = await clientPromise
      db = client.db().databaseName || 'connected'
    } catch {
      db = 'unavailable'
    }

    return NextResponse.json({
      status: 'ok',
      database: db,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    return NextResponse.json(
      { status: 'error', details: error.message },
      { status: 500 }
    )
  }
}
