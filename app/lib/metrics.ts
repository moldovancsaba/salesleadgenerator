/**
 * Metrics calculation utilities for GDS-compliant dashboard
 */

export type LeadMetrics = {
  _id: string;
  kanbanColumn: string;
  region: string;
  qualityStatus: string;
  ice?: { total: number };
};

/**
 * Calculate leads count by pipeline stage
 */
export function metricsByStage(leads: LeadMetrics[]): Record<string, number> {
  const stages = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST'];
  return stages.reduce((acc, stage) => {
    acc[stage] = leads.filter(l => l.kanbanColumn === stage).length;
    return acc;
  }, {} as Record<string, number>);
}

/**
 * Calculate leads count by region
 */
export function metricsByRegion(leads: LeadMetrics[]): Record<string, number> {
  return leads.reduce((acc, lead) => {
    acc[lead.region] = (acc[lead.region] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

/**
 * Calculate leads count by quality status
 */
export function metricsByQuality(leads: LeadMetrics[]): Record<string, number> {
  const statuses = ['DRAFT', 'CHECKED', 'VERIFIED'];
  return statuses.reduce((acc, status) => {
    acc[status] = leads.filter(l => l.qualityStatus === status).length;
    return acc;
  }, {} as Record<string, number>);
}

/**
 * Calculate leads count by ICE score level
 */
export function metricsByIceLevel(leads: LeadMetrics[]): Record<string, number> {
  const levels = {
    'High (800+)': 0,
    'Medium (500-799)': 0,
    'Low (200-499)': 0,
    'Critical (<200)': 0,
  };

  leads.forEach(lead => {
    const score = lead.ice?.total || 0;
    if (score >= 800) levels['High (800+)']++;
    else if (score >= 500) levels['Medium (500-799)']++;
    else if (score >= 200) levels['Low (200-499)']++;
    else levels['Critical (<200)']++;
  });

  return levels;
}
