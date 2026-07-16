import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  if (pathname === '/cogmapsales' || pathname === '/seyusales') {
    const brand = pathname === '/cogmapsales' ? 'cogmap' : 'seyu'
    return NextResponse.redirect(new URL(`/sales/${brand}`, request.url))
  }
  
  return NextResponse.next()
}

export const config = {
  matcher: ['/cogmapsales', '/seyusales'],
}
