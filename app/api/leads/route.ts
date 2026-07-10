import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';

export async function GET(request: NextRequest) {
  try {
    await dbConnect();

    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region');
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query
    const query: any = {};
    if (region && region !== 'all') query.region = region;
    if (status && status !== 'all') query.status = status;
    if (priority && priority !== 'all') query.priority = priority;
    if (search) {
      query.$or = [
        { entity_name: { $regex: search, $options: 'i' } },
        { industry: { $regex: search, $options: 'i' } },
        { sport_or_sector: { $regex: search, $options: 'i' } },
        { decision_maker_name: { $regex: search, $options: 'i' } },
        { level_league: { $regex: search, $options: 'i' } },
        { value_proposition: { $regex: search, $options: 'i' } },
      ];
    }

    const [leads, total] = await Promise.all([
      Lead.find(query).sort({ priority: 1, region: 1, id: 1 }).skip(offset).limit(limit).lean(),
      Lead.countDocuments(query),
    ]);

    // Also get counts by region
    const countsByRegion = await Lead.aggregate([
      { $group: { _id: '$region', count: { $sum: 1 } } },
    ]);
    const countsByStatus = await Lead.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const countsByPriority = await Lead.aggregate([
      { $group: { _id: '$priority', count: { $sum: 1 } } },
    ]);

    return NextResponse.json({
      leads,
      total,
      counts: {
        region: Object.fromEntries(countsByRegion.map(c => [c._id, c.count])),
        status: Object.fromEntries(countsByStatus.map(c => [c._id, c.count])),
        priority: Object.fromEntries(countsByPriority.map(c => [c._id, c.count])),
      },
    });
  } catch (error) {
    console.error('GET /api/leads error:', error);
    return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await dbConnect();
    const body = await request.json();

    const lead = new Lead({
      ...body,
      updatedAt: new Date(),
    });

    await lead.save();
    return NextResponse.json(lead, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/leads error:', error);
    return NextResponse.json({ error: error.message || 'Failed to create lead' }, { status: 400 });
  }
}
