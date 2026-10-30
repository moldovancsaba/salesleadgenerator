import { NextRequest, NextResponse } from 'next/server';
import { getReleaseNotes, getReleaseNoteByVersion } from '@/lib/release-notes';
import { filterReleaseNotes, ReleaseCategory } from '@/lib/release-notes-parser';
import { APP_VERSION } from '@/lib/release-notes-dates';
import { resolveSessionFromIdToken } from '@/lib/session';

export async function GET(request: NextRequest) {
  try {
    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    if (!claims?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const versionParam = searchParams.get('version');

    if (versionParam) {
      const note = getReleaseNoteByVersion(versionParam);
      if (!note) {
        return NextResponse.json({ error: 'Release note not found' }, { status: 404 });
      }
      return NextResponse.json({ note });
    }

    const query = searchParams.get('query') || undefined;
    const category = (searchParams.get('category') as ReleaseCategory) || 'all';
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    const allNotes = getReleaseNotes();
    const filtered = filterReleaseNotes(allNotes, { query, category });
    const paginated = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      notes: paginated,
      total: filtered.length,
      hasMore: offset + limit < filtered.length,
      latestVersion: allNotes[0]?.version || APP_VERSION,
      latestDate: allNotes[0]?.date || '2026-10-22',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch release notes' },
      { status: 500 }
    );
  }
}
