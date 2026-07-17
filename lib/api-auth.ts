import { NextResponse } from 'next/server';

const API_KEY = process.env.SLG_API_KEY || '';

export function requireApiKey(request: Request): NextResponse | null {
  if (!API_KEY) {
    return null;
  }

  const headerKey = request.headers.get('x-api-key');
  if (headerKey && headerKey === API_KEY) {
    return null;
  }

  return NextResponse.json(
    { error: 'Unauthorized', details: 'Missing or invalid x-api-key' },
    { status: 401 }
  );
}
