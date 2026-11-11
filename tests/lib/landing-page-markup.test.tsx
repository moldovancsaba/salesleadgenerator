import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { DEFAULT_VEGAS_CAMPAIGN, toPublicLandingPage } from '@/lib/landing-page-schema';

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: { src: string; alt: string }) => <img src={props.src} alt={props.alt} />,
}));

import { DynamicLandingClient } from '@/app/landing/[brand]/[campaign]/dynamic-landing-client';

// A paragraph inside a paragraph is invalid HTML: the browser closes the outer one early, the server markup then
// differs from what React builds, and hydration fails on every load (React error 418).
describe('landing page markup', () => {
  it('has no paragraph inside a paragraph', () => {
    const html = renderToStaticMarkup(
      <MantineProvider>
        <DynamicLandingClient
          page={toPublicLandingPage(DEFAULT_VEGAS_CAMPAIGN)}
          brand="vegas"
          brandLabel="Mr Vegas"
          campaignSlug="grand-slam-of-darts"
        />
      </MantineProvider>
    );
    expect(html).toContain('Date of Birth');
    const nested = /<p[\s>](?:(?!<\/p>)[\s\S])*<p[\s>]/.exec(html);
    expect(nested && nested[0].slice(0, 200)).toBeNull();
  });
});
