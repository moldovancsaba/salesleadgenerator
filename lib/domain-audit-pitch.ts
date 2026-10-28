/**
 * Domain & Digital Presence Audit Pitch Generator (Issue 293)
 * Inspired by Venture OS Lite's website audit & outreach pitch module.
 * Generates tailored, data-driven sales conversation hooks and email icebreakers
 * based on the prospective organization's detected technology signals and web infrastructure.
 */

export type DigitalPitchAngle = {
  id: string;
  category: 'ecommerce' | 'analytics' | 'cms_modernization' | 'crm_integration' | 'fan_engagement';
  headline: string;
  talkTrack: string;
  icebreakerSnippet: string;
};

export type DomainAuditSummary = {
  scannedAt?: string;
  detectedSignals: string[];
  hasAnalytics: boolean;
  hasEcommerce: boolean;
  hasModernFrontend: boolean;
  hasCrm: boolean;
  primaryCms?: string;
  pitchAngles: DigitalPitchAngle[];
  recommendedPitch: string;
};

export function generateDomainAuditPitch(
  entityName: string,
  signals: string[] = [],
  scannedAt?: string
): DomainAuditSummary {
  const signalSet = new Set(signals.map((s) => s.toLowerCase()));

  const hasAnalytics = signalSet.has('google-analytics') || signalSet.has('gtm') || signalSet.has('meta-pixel');
  const hasEcommerce = signalSet.has('shopify');
  const hasModernFrontend = signalSet.has('nextjs') || signalSet.has('react') || signalSet.has('vue');
  const hasCrm = signalSet.has('hubspot');

  let primaryCms: string | undefined;
  if (signalSet.has('wordpress')) primaryCms = 'WordPress';
  else if (signalSet.has('shopify')) primaryCms = 'Shopify';
  else if (signalSet.has('webflow')) primaryCms = 'Webflow';
  else if (signalSet.has('squarespace')) primaryCms = 'Squarespace';
  else if (signalSet.has('wix')) primaryCms = 'Wix';

  const pitchAngles: DigitalPitchAngle[] = [];

  // 1. E-Commerce / Merchandise Monetization Angle
  if (hasEcommerce) {
    pitchAngles.push({
      id: 'ecommerce_monetization',
      category: 'ecommerce',
      headline: 'Matchday Merchandising & Sponsor Bundle Monetization',
      talkTrack: `We noticed ${entityName} runs an active Shopify store. You can pair matchday fan selfie campaigns and sponsor activations with direct, 1-click discount voucher redemptions in your official team store.`,
      icebreakerSnippet: `I noticed ${entityName}'s official online store on Shopify — we recently helped commercial partners tie matchday activations directly into official store conversions with trackable fan promo codes.`,
    });
  }

  // 2. Modern Frontend / Fan Portal Experience
  if (hasModernFrontend) {
    pitchAngles.push({
      id: 'digital_stadium_portal',
      category: 'cms_modernization',
      headline: 'High-Performance Fan Experience & Interactive Matchday Widgets',
      talkTrack: `${entityName}'s website uses a modern web stack (${signalSet.has('nextjs') ? 'Next.js' : 'React'}). Our embeddable web modules and real-time Jumbotron selfie streams integrate seamlessly without slowing down your core web vitals.`,
      icebreakerSnippet: `I noticed your engineering team built ${entityName}'s digital presence on a modern React/Next.js architecture — our matchday engagement widgets embed natively into your web portal with zero performance drag.`,
    });
  }

  // 3. Analytics & Attribution Angle
  if (hasAnalytics) {
    pitchAngles.push({
      id: 'sponsor_roi_attribution',
      category: 'analytics',
      headline: 'Quantifiable Digital Fan Attribution & Sponsor ROI Reporting',
      talkTrack: `${entityName} already tracks digital engagement via ${signalSet.has('gtm') ? 'Google Tag Manager' : 'analytics'}. Our platform feeds verifiable, zero-party fan engagement data and click-through metrics straight into your corporate sponsor recap decks.`,
      icebreakerSnippet: `Given your focus on digital analytics tracking, I wanted to share how sports organizations are capturing verified 1st-party fan data during live games and delivering exact ROI metrics to corporate brand sponsors.`,
    });
  } else if (signals.length > 0 && !hasModernFrontend && !hasEcommerce) {
    // If scanned but no tag manager / analytics
    pitchAngles.push({
      id: 'zero_party_data_capture',
      category: 'fan_engagement',
      headline: 'GDPR-Compliant Zero-Party Fan Data & Lead Capture',
      talkTrack: `No direct tracking pixels or tag managers were detected on ${entityName}'s homepage. Our interactive selfie/fan solution gives sponsors clean, consented fan contact opt-ins without cookie dependency.`,
      icebreakerSnippet: `With growing privacy regulations and cookie phase-outs, sports teams are turning to interactive matchday engagement to gather verified, consented fan contact data directly for commercial sponsors.`,
    });
  }

  // 4. CRM & Sales Process Integration
  if (hasCrm) {
    pitchAngles.push({
      id: 'crm_sponsor_sync',
      category: 'crm_integration',
      headline: 'Automated Inbound Sponsor Lead Sync',
      talkTrack: `Since ${entityName} leverages HubSpot, all partnership inquiries, hospitality requests, and inbound web capture leads can sync bi-directionally with your commercial team's pipeline.`,
      icebreakerSnippet: `Seeing that your commercial operations utilize HubSpot, we have built-in bi-directional lead export that automatically routes matchday commercial inquiries directly into your CRM.`,
    });
  }

  // Fallback if no specific signals detected
  if (pitchAngles.length === 0) {
    pitchAngles.push({
      id: 'core_fan_activation',
      category: 'fan_engagement',
      headline: 'Interactive In-Stadium & Digital Fan Sponsorship Activation',
      talkTrack: `Connect matchday crowds directly to ${entityName}'s commercial partners through real-time selfie sharing, halftime Jumbotron displays, and branded digital takeaways.`,
      icebreakerSnippet: `I came across ${entityName}'s digital channels and wanted to connect regarding how clubs are turning matchday attendance into measurable commercial engagement for key brand partners.`,
    });
  }

  const recommendedPitch = pitchAngles[0].icebreakerSnippet;

  return {
    scannedAt,
    detectedSignals: signals,
    hasAnalytics,
    hasEcommerce,
    hasModernFrontend,
    hasCrm,
    primaryCms,
    pitchAngles,
    recommendedPitch,
  };
}
