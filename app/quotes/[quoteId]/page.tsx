import type { Metadata } from 'next';
import { QuotePortalClient } from './quote-portal-client';

export const metadata: Metadata = {
  title: 'Commercial Proposal & E-Signature Portal',
  robots: { index: false, follow: false },
};

export default async function QuotePortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { quoteId } = await params;
  const { token } = await searchParams;

  return <QuotePortalClient quoteId={quoteId} token={token || ''} />;
}
