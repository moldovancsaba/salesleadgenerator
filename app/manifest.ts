import type { MetadataRoute } from 'next';
import { APP_CHROME_COLORS } from '@/lib/theme/app-chrome-colors';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sales Lead Generator',
    short_name: 'Sales Leads',
    description: 'Sales lead generation, multi-pipeline CRM, and cadence outreach platform',
    start_url: '/sales/cogmap',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui', 'window-controls-overlay'],
    background_color: APP_CHROME_COLORS.backgroundColor,
    theme_color: APP_CHROME_COLORS.themeColor,
    orientation: 'any',
    categories: ['business', 'productivity', 'sales'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/maskable-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    shortcuts: [
      {
        name: "Today's Queue",
        short_name: 'Today',
        description: "View today's cadence tasks and due follow-ups",
        url: '/today/cogmap',
        icons: [{ src: '/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Pipelines',
        short_name: 'Pipelines',
        description: 'Interactive sales pipeline board',
        url: '/sales/cogmap',
        icons: [{ src: '/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}
