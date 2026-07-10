/**
 * Metrics Dashboard
 * Shows overall pipeline health, ICE score distribution, regional breakdowns
 */

"use client";

import { useMemo } from "react";
import type { Lead } from "./types";

type Props = {
  leads: Lead[];
};

export function MetricsPanel({ leads }: Props) {
  const metrics = useMemo(() => {
    const columns = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST'];
    const regions = ['us', 'cee', 'mena'];
    const declineReasons: Record<string, number> = {};

    // Column distribution
    const columnCounts = Object.fromEntries(columns.map(c => [c, 0]));
    leads.forEach(lead => {
      if (columnCounts[lead.kanbanColumn] !== undefined) {
        columnCounts[lead.kanbanColumn]++;
      }
    });

    // Regional distribution
    const regionCounts = Object.fromEntries(regions.map(r => [r, 0]));
    leads.forEach(lead => {
      const region = lead.region?.toLowerCase();
      if (region && regionCounts[region] !== undefined) {
        regionCounts[region]++;
      }
    });

    // ICE score distribution
    const iceScores = leads
      .map(lead => {
        if (!lead.ice) return null;
        const { impact = 0, confidence = 0, ease = 0 } = lead.ice;
        return impact * confidence * ease;
      })
      .filter((score): score is number => score !== null)
      .sort((a, b) => a - b);

    const avgIce = iceScores.length > 0
      ? iceScores.reduce((sum, s) => sum + s, 0) / iceScores.length
      : 0;

    const medianIce = iceScores.length > 0
      ? iceScores[Math.floor(iceScores.length / 2)]
      : 0;

    // ICE score buckets
    const buckets = [
      { label: '0-200', min: 0, max: 200, count: 0 },
      { label: '200-400', min: 200, max: 400, count: 0 },
      { label: '400-600', min: 400, max: 600, count: 0 },
      { label: '600-800', min: 600, max: 800, count: 0 },
      { label: '800+', min: 800, max: Infinity, count: 0 },
    ];

    iceScores.forEach(score => {
      const bucket = buckets.find(b => score >= b.min && score < b.max);
      if (bucket) bucket.count++;
    });

    // Decline reasons
    leads.forEach(lead => {
      if (lead.declineReason) {
        declineReasons[lead.declineReason] = (declineReasons[lead.declineReason] || 0) + 1;
      }
    });

    const sortedDeclineReasons = Object.entries(declineReasons)
      .sort(([, a], [, b]) => b - a);

    // Quality distribution
    const qualityCounts = { verified: 0, checked: 0, draft: 0 };
    leads.forEach(lead => {
      const quality = lead.scoreProfile?.qualityStatus || 'draft';
      if (quality === 'verified') qualityCounts.verified++;
      else if (quality === 'checked') qualityCounts.checked++;
      else qualityCounts.draft++;
    });

    // Status distribution (legacy status field)
    const statusCounts: Record<string, number> = {};
    leads.forEach(lead => {
      const status = lead.status || 'unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    return {
      total: leads.length,
      columnCounts,
      regionCounts,
      avgIce,
      medianIce,
      buckets,
      sortedDeclineReasons,
      qualityCounts,
      statusCounts,
    };
  }, [leads]);

  return (
    <div className="space-y-8">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="text-sm text-gray-600 mb-1">Total Leads</div>
          <div className="text-3xl font-bold text-gray-900">{metrics.total}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="text-sm text-gray-600 mb-1">Avg ICE Score</div>
          <div className="text-3xl font-bold text-blue-600">{metrics.avgIce.toFixed(0)}</div>
          <div className="text-xs text-gray-500 mt-1">Median: {metrics.medianIce}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="text-sm text-gray-600 mb-1">Regional Split</div>
          <div className="text-sm text-gray-900 mt-2">
            <div className="flex justify-between mb-1">
              <span>US:</span>
              <span className="font-semibold">{metrics.regionCounts.us}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span>CEE:</span>
              <span className="font-semibold">{metrics.regionCounts.cee}</span>
            </div>
            <div className="flex justify-between">
              <span>MENA:</span>
              <span className="font-semibold">{metrics.regionCounts.mena}</span>
            </div>
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="text-sm text-gray-600 mb-1">Quality Status</div>
          <div className="text-sm text-gray-900 mt-2">
            <div className="flex justify-between mb-1">
              <span className="text-green-600">Verified:</span>
              <span className="font-semibold">{metrics.qualityCounts.verified}</span>
            </div>
            <div className="flex justify-between mb-1">
              <span className="text-yellow-600">Checked:</span>
              <span className="font-semibold">{metrics.qualityCounts.checked}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Draft:</span>
              <span className="font-semibold">{metrics.qualityCounts.draft}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ICE Score Distribution */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">ICE Score Distribution</h3>
        <div className="space-y-3">
          {metrics.buckets.map((bucket) => (
            <div key={bucket.label} className="flex items-center gap-4">
              <div className="w-20 text-sm text-gray-600">{bucket.label}</div>
              <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 flex items-center justify-end pr-2 text-xs text-white font-medium transition-all"
                  style={{
                    width: `${metrics.total > 0 ? (bucket.count / metrics.total) * 100 : 0}%`,
                    minWidth: bucket.count > 0 ? '2rem' : '0',
                  }}
                >
                  {bucket.count > 0 && bucket.count}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pipeline Distribution */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Pipeline Distribution</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(metrics.columnCounts).map(([column, count]) => (
            <div key={column} className="border border-gray-200 rounded p-4">
              <div className="text-sm text-gray-600 mb-1">{column}</div>
              <div className="text-2xl font-bold text-gray-900">{count}</div>
              <div className="text-xs text-gray-500 mt-1">
                {metrics.total > 0 ? ((count / metrics.total) * 100).toFixed(1) : 0}%
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Decline Reasons */}
      {metrics.sortedDeclineReasons.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Decline Reasons</h3>
          <div className="space-y-2">
            {metrics.sortedDeclineReasons.map(([reason, count]) => (
              <div key={reason} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <span className="text-sm text-gray-700">{reason}</span>
                <span className="text-sm font-semibold text-gray-900">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Regional Breakdown */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Regional Breakdown</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(metrics.regionCounts).map(([region, count]) => (
            <div key={region} className="border border-gray-200 rounded p-4">
              <div className="text-sm text-gray-600 mb-1">{region.toUpperCase()}</div>
              <div className="text-2xl font-bold text-gray-900">{count}</div>
              <div className="text-xs text-gray-500 mt-1">
                {metrics.total > 0 ? ((count / metrics.total) * 100).toFixed(1) : 0}% of total
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Status Distribution */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Legacy Status Distribution</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(metrics.statusCounts).map(([status, count]) => (
            <div key={status} className="text-center">
              <div className="text-2xl font-bold text-gray-900">{count}</div>
              <div className="text-sm text-gray-600 capitalize">{status}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
