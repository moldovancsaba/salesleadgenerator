"use client";

import { useEffect, useState } from "react";

export function SearchLearningPanel() {
  const [learning, setLearning] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      try {
        const res = await fetch("/api/search-learning");
        const data = await res.json();
        setLearning(data);
      } catch (err) {
        console.error("search learning fetch failed", err);
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, []);

  if (loading) {
    return (
      <div className="text-center text-slate-500 py-12">
        Loading search learning data…
      </div>
    );
  }

  if (!learning) {
    return (
      <div className="text-center text-slate-500 py-12">
        No search learning data available
      </div>
    );
  }

  const avgRate = Math.round((learning.avgSuccessRate || 0) * 100);
  const lastUpdated = learning.updatedAt ? new Date(learning.updatedAt).toLocaleString() : "Never";

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">Search Learning Overview</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-slate-500 mb-1">Total Runs</div>
            <div className="text-2xl font-bold text-slate-900">{learning.totalRuns}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Avg Success Rate</div>
            <div className="text-2xl font-bold text-indigo-600">{avgRate}%</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Tracked Queries</div>
            <div className="text-2xl font-bold text-slate-900">{learning.topQueries?.length || 0}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Last Updated</div>
            <div className="text-sm text-slate-700 mt-1">{lastUpdated}</div>
          </div>
        </div>
      </div>

      {/* Last Queries */}
      {learning.lastQueries && learning.lastQueries.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-3">Recent Queries</h3>
          <div className="flex flex-wrap gap-2">
            {learning.lastQueries.map((q: string, i: number) => (
              <span key={i} className="px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-sm">
                {q}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Top Queries */}
      {learning.topQueries && learning.topQueries.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-3">Highest-Performing Queries</h3>
          <div className="space-y-3">
            {learning.topQueries
              .slice(0, 10)
              .map((entry: any, i: number) => {
                const total = (entry.accepted || 0) + (entry.declined || 0);
                const rate = total > 0 ? Math.round(((entry.accepted || 0) / total) * 100) : 0;
                return (
                  <div key={i} className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="font-medium text-slate-900">{entry.query}</div>
                      <div className="text-xs text-slate-500">
                        Leads created: {entry.createdLeads || 0}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-slate-700">
                        {entry.accepted || 0} accepted / {entry.declined || 0} declined
                      </div>
                      <div className="text-xs text-slate-500">{rate}% acceptance</div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Top Terms */}
      {learning.topTerms && learning.topTerms.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-3">Top Terms</h3>
          <div className="flex flex-wrap gap-2">
            {learning.topTerms.slice(0, 20).map((entry: any, i: number) => (
              <span
                key={i}
                className={`px-3 py-1 rounded-full text-sm ${
                  entry.score >= 0.5 ? "bg-emerald-100 text-emerald-800" :
                  entry.score >= 0 ? "bg-indigo-100 text-indigo-800" :
                  "bg-rose-100 text-rose-800"
                }`}
              >
                <span className="font-medium">{entry.key}</span>
                <span className="text-xs ml-1">({Math.round(entry.score * 100)})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Top Domains */}
      {learning.topDomains && learning.topDomains.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-3">Top Domains</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {learning.topDomains.slice(0, 12).map((entry: any, i: number) => (
              <div key={i} className="border border-slate-200 rounded-lg p-3">
                <div className="font-medium text-slate-900 text-sm">{entry.key}</div>
                <div className="text-xs text-slate-500 mt-1">Score: {Math.round(entry.score)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Help text */}
      <div className="bg-indigo-50 border-l-4 border-indigo-500 rounded-r-lg p-4">
        <h4 className="text-sm font-semibold text-indigo-900 mb-2">How does this work?</h4>
        <p className="text-sm text-indigo-800">
          Search learning tracks which queries, terms, and domains produce high-quality leads.
          When you ACCEPT a lead, we record the search context and boost future queries of that type.
          When you DECLINE, we reduce weight on those signals. This creates a feedback loop where
          the system self-learns your ideal customer profile.
        </p>
      </div>
    </div>
  );
}
