'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { AppHeader } from './AppHeader';
import { AppNavSidebar } from './AppNav';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Public customer-facing calendar booking page (/schedule/[brand]),
  // public commercial proposal quote portal (/quotes/[quoteId]),
  // and public landing page (/) hide the internal authenticated app chrome entirely.
  if (pathname.startsWith('/schedule/') || pathname.startsWith('/quotes/') || pathname === '/') {
    return <>{children}</>;
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AppHeader />
      <div style={{ display: 'flex', flex: 1, minHeight: 'calc(100dvh - 48px)', position: 'relative', alignItems: 'flex-start' }}>
        <AppNavSidebar />
        <main
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflowX: 'auto',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
