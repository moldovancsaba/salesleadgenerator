import type { Metadata } from 'next';
import { WhatsNewClient } from './[brand]/whats-new-client';
import { getReleaseNotes } from '@/lib/release-notes';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "What's New & Release Notes — Sales Lead Generator",
  description: 'Chronological release notes, newly shipped capabilities, and continuous improvements.',
};

export default async function WhatsNewPage() {
  const notes = getReleaseNotes();

  return (
    <WhatsNewClient
      initialNotes={notes}
      brand=""
      label="Sales Lead Generator"
    />
  );
}
