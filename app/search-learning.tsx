"use client";

import { useState, useEffect } from "react";

interface TopQuery {
  query: string;
  accepted: number;
  declined: number;
  createdLeads: number;
}

interface TopTerm {
  key: string;
  score: number;
}

interface TopDomain {
  key: string;
  score: number;
}

interface SearchLearningData {
  totalRuns: number;
  lastQueries: string[];
  updatedAt: string | null;
  topQueries: TopQuery[];
  topTerms: TopTerm[];
  topDomains: TopDomain[];
  avgSuccessRate: number;
}

export function SearchLearningPanel() {
  const [data, setData] = useState<SearchLearningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSearchLearning();
  }, []);

  const fetchSearchLearning = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/search-learning");
      if (!response.ok) throw new Error("Failed to fetch search learning data");
      
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const getSuccessRate = (query: TopQuery) => {
    const total = query.accepted + query.declined;
    if (total === 0) return 0;
    return Math.round((query.accepted / total) * 100);
  };

  const getPerformanceColor = (rate: number) => {
    if (rate >= 70) return "text-green-600 bg-green-50";
    if (rate >= 40) return "text-yellow-600 bg-yellow-50";
    return "text-red-600 bg-red-50";
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-semibold mb-2">Error Loading Search Learning Data</h3>
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || (data.topQueries.length === 0 && data.topTerms.length === 0 && data.topDomains.length === 0)) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Search Learning</h2>
        <p className="text-gray-600 mb-6">
          Track which search queries are producing the best results.
        </p>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-500 mb-2">No search learning data available yet</p>
          <p className="text-gray-400 text-sm">
            Search queries will be tracked as you accept or decline leads in the pipeline
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Search Learning</h2>
        <p className="text-gray-600">
          Track which search queries are producing the best results. High success rates indicate valuable queries for finding leads.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-600 mb-1">Total Search Runs</div>
          <div className="text-3xl font-bold text-gray-900">{data.totalRuns}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-600 mb-1">Average Success Rate</div>
          <div className="text-3xl font-bold text-gray-900">
            {Math.round(data.avgSuccessRate * 100)}%
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-600 mb-1">Last Updated</div>
          <div className="text-sm font-semibold text-gray-900">
            {data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : 'Never'}
          </div>
        </div>
      </div>

      {/* Top Queries */}
      {data.topQueries.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Top Queries</h3>
          <div className="space-y-4">
            {data.topQueries.map((query, index) => {
              const successRate = getSuccessRate(query);
              const performanceColor = getPerformanceColor(successRate);

              return (
                <div
                  key={index}
                  className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900 text-lg mb-1">
                        {query.query}
                      </h4>
                      <p className="text-xs text-gray-500">
                        {query.createdLeads} lead(s) created
                      </p>
                    </div>
                    <div className={`px-3 py-1.5 rounded-full text-sm font-bold ${performanceColor}`}>
                      {successRate}% success
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-green-50 rounded p-3">
                      <div className="text-2xl font-bold text-green-600">
                        {query.accepted}
                      </div>
                      <div className="text-sm text-green-700">Accepted</div>
                    </div>
                    <div className="bg-red-50 rounded p-3">
                      <div className="text-2xl font-bold text-red-600">
                        {query.declined}
                      </div>
                      <div className="text-sm text-red-700">Declined</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Terms */}
      {data.topTerms.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Top Terms</h3>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex flex-wrap gap-2">
              {data.topTerms.slice(0, 20).map((term, index) => (
                <span
                  key={index}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                    term.score >= 0.7
                      ? "bg-green-100 text-green-700"
                      : term.score >= 0.4
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {term.key}
                  <span className="ml-2 text-xs opacity-75">
                    ({Math.round(term.score * 100)})
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top Domains */}
      {data.topDomains.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Top Domains</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.topDomains.slice(0, 10).map((domain, index) => (
              <div
                key={index}
                className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-between"
              >
                <div className="font-mono text-sm text-gray-900">{domain.key}</div>
                <div className="text-sm font-semibold text-gray-700">
                  Score: {Math.round(domain.score * 100)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Queries */}
      {data.lastQueries.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4">Recent Queries</h3>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="space-y-2">
              {data.lastQueries.slice(0, 10).map((query, index) => (
                <div key={index} className="text-sm text-gray-700 py-1 border-b border-gray-100 last:border-0">
                  {query}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-blue-900 font-semibold mb-2">💡 Tips</h3>
        <ul className="text-blue-800 text-sm space-y-1 list-disc list-inside">
          <li>Focus on queries with high success rates (70%+)</li>
          <li>Review queries with low success rates to refine your search strategy</li>
          <li>Use successful query patterns to discover similar opportunities</li>
          <li>Search learning data updates automatically as you accept or decline leads</li>
        </ul>
      </div>
    </div>
  );
}
