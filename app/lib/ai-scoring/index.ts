export type LeadFeatures = {
  contactRichness: number;
  orgSizeScore: number;
  regionScore: number;
  valuePropLength: number;
  prosConsCompleteness: number;
  recencyDays: number;
};

export function extractFeatures(lead: any): LeadFeatures {
  const contacts = Array.isArray(lead.contacts) ? lead.contacts : [];
  const contactFields = ['name', 'title', 'email', 'phone', 'linkedin'];
  const filledContacts = contacts.filter((c: any) => contactFields.some((f) => !!c?.[f]));
  const contactRichness = contacts.length > 0 ? Math.min(1, filledContacts.length / Math.max(1, contacts.length)) : 0;

  const sizeMap: Record<string, number> = { Enterprise: 1, Large: 0.8, Medium: 0.5, Small: 0.2 };
  const orgSizeScore = sizeMap[lead.size] || 0.3;

  const regionScore = lead.region === 'US' ? 0.8 : lead.region ? 0.5 : 0.2;

  const valuePropLength = Math.min(1, (lead.value_proposition?.length || 0) / 300);

  const pros = Array.isArray(lead.pro_for_slg) ? lead.pro_for_slg.length : 0;
  const cons = Array.isArray(lead.con_for_slg) ? lead.con_for_slg.length : 0;
  const prosConsCompleteness = Math.min(1, (pros + cons) / 5);

  const createdAt = lead.createdAt ? new Date(lead.createdAt).getTime() : Date.now();
  const recencyDays = Math.max(0, (Date.now() - createdAt) / (1000 * 60 * 60 * 24));
  const recencyScore = Math.max(0, 1 - recencyDays / 30);

  return {
    contactRichness,
    orgSizeScore,
    regionScore,
    valuePropLength,
    prosConsCompleteness,
    recencyDays,
  };
}

export function computeAiScore(features: LeadFeatures): { aiScore: number; confidence: number } {
  const weights = {
    contactRichness: 220,
    orgSizeScore: 180,
    regionScore: 140,
    valuePropLength: 160,
    prosConsCompleteness: 180,
    recencyScore: 120,
  };

  const recencyScore = Math.max(0, 1 - features.recencyDays / 30);
  const score =
    features.contactRichness * weights.contactRichness +
    features.orgSizeScore * weights.orgSizeScore +
    features.regionScore * weights.regionScore +
    features.valuePropLength * weights.valuePropLength +
    features.prosConsCompleteness * weights.prosConsCompleteness +
    recencyScore * weights.recencyScore;

  const aiScore = Math.min(1000, Math.max(0, Math.round(score)));
  const confidence = Math.round(
    Math.min(1, 0.4 + features.contactRichness * 0.3 + features.prosConsCompleteness * 0.3) * 100
  );

  return { aiScore, confidence };
}
