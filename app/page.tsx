'use client';

import { useState, useEffect } from 'react';

interface Lead {
  id: number;
  region: string;
  entity_name: string;
  url: string;
  address: string;
  general_contact: string;
  size: string;
  industry: string;
  sport_or_sector: string;
  level_league: string;
  decision_maker_name: string;
  decision_maker_title: string;
  decision_maker_contact: string;
  pro_for_cogmap: string[] | string;
  con_for_cogmap: string[] | string;
  value_proposition: string;
}

const FLAG: Record<string, string> = {
  US: '🇺🇸',
  CEE: '🇪🇺',
  MENA: '🌍',
};

export default function Home() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedLead, setExpandedLead] = useState<string | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string>('all');

  useEffect(() => {
    const loadLeads = async () => {
      try {
        const [usRes, ceeRes, menaRes] = await Promise.all([
          fetch('/us-leads.json'),
          fetch('/cee-leads.json'),
          fetch('/mena-leads.json'),
        ]);

        const usLeads: Lead[] = (await usRes.json()).map((l: Lead) => ({ ...l, region: l.region || 'US' }));
        const ceeLeads: Lead[] = (await ceeRes.json()).map((l: Lead) => ({ ...l, region: l.region || 'CEE' }));
        const menaLeads: Lead[] = (await menaRes.json()).map((l: Lead) => ({ ...l, region: l.region || 'MENA' }));

        setLeads([...usLeads, ...ceeLeads, ...menaLeads]);
      } catch (error) {
        console.error('Failed to load leads:', error);
      }
    };

    loadLeads();
  }, []);

  // Normalize pros/cons (could be array or string)
  const toArray = (val: string[] | string | undefined): string[] =>
    Array.isArray(val) ? val : typeof val === 'string' ? [val] : [];

  const sectors = Array.from(new Set(leads.map((l) => l.sport_or_sector || l.industry))).sort();

  const filteredLeads = leads.filter((lead) => {
    const matchesRegion = filter === 'all' || lead.region === filter;
    const matchesSector = sectorFilter === 'all' || lead.sport_or_sector?.includes(sectorFilter) || lead.industry?.includes(sectorFilter);
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      searchTerm === '' ||
      lead.entity_name?.toLowerCase().includes(q) ||
      lead.industry?.toLowerCase().includes(q) ||
      lead.sport_or_sector?.toLowerCase().includes(q) ||
      lead.decision_maker_name?.toLowerCase().includes(q) ||
      lead.level_league?.toLowerCase().includes(q) ||
      lead.value_proposition?.toLowerCase().includes(q);
    return matchesRegion && matchesSector && matchesSearch;
  });

  const regionCounts: Record<string, number> = {
    all: leads.length,
    US: leads.filter((l) => l.region === 'US').length,
    CEE: leads.filter((l) => l.region === 'CEE').length,
    MENA: leads.filter((l) => l.region === 'MENA').length,
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      {/* Header */}
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-lg">
              C
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold bg-gradient-to-r from-blue-800 to-indigo-600 bg-clip-text text-transparent">
              CogMap Lead Intelligence
            </h1>
          </div>
          <p className="text-lg text-slate-600 max-w-3xl">
            Enriched, qualified leads for CogMap&apos;s cognitive assessment platform across US, CEE, and MENA markets.
          </p>

          {/* Stat cards */}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(regionCounts).map(([region, count]) => (
              <button
                key={region}
                onClick={() => setFilter(region)}
                className={`text-left p-4 rounded-xl border-2 transition-all duration-200 shadow-sm hover:shadow-md ${
                  filter === region
                    ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                    : 'border-slate-200 bg-white hover:border-blue-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">{region === 'all' ? '🌐' : FLAG[region]}</span>
                  <span className="text-sm font-medium text-slate-500">{region.toUpperCase()}</span>
                </div>
                <div className="text-3xl font-bold text-slate-900 mt-1">{count}</div>
              </button>
            ))}
          </div>
        </header>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="flex-1 relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search entities, decision makers, industries, leagues..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
            />
          </div>
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          >
            <option value="all">All Sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Results count */}
        <p className="text-sm text-slate-500 mb-4">
          Showing {filteredLeads.length} of {leads.length} leads
        </p>

        {/* Lead Cards */}
        <div className="space-y-4">
          {filteredLeads.map((lead) => {
            const key = `${lead.region}-${(lead as any).id ?? lead.entity_name}`;
            const isExpanded = expandedLead === key;
            const pros = toArray(lead.pro_for_cogmap);
            const cons = toArray(lead.con_for_cogmap);

            return (
              <div
                key={key}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Card Header */}
                <div className="p-6">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 flex-wrap mb-2">
                        <span className="text-2xl">{FLAG[lead.region] || '🏢'}</span>
                        <h2 className="text-2xl font-bold text-slate-900">{lead.entity_name}</h2>
                        <span className="inline-flex px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                          {lead.region}
                        </span>
                      </div>
                      <p className="text-slate-600 mb-1">
                        {lead.sport_or_sector || lead.industry}
                      </p>
                      <p className="text-sm text-slate-500">{lead.level_league}</p>
                    </div>
                    {lead.url && (
                      <a
                        href={lead.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
                      >
                        Visit Website
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>

                  {/* Details Grid */}
                  <div className="grid md:grid-cols-2 gap-6 mt-5">
                    <div className="space-y-2.5">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Entity Details</h3>
                      <dl className="space-y-2 text-sm">
                        {lead.address && (
                          <div className="flex gap-2">
                            <dt className="font-medium text-slate-600 w-20 shrink-0">Address</dt>
                            <dd className="text-slate-700">{lead.address}</dd>
                          </div>
                        )}
                        {lead.general_contact && (
                          <div className="flex gap-2">
                            <dt className="font-medium text-slate-600 w-20 shrink-0">Contact</dt>
                            <dd className="text-slate-700">{lead.general_contact}</dd>
                          </div>
                        )}
                        {lead.size && (
                          <div className="flex gap-2">
                            <dt className="font-medium text-slate-600 w-20 shrink-0">Size</dt>
                            <dd className="text-slate-700">{lead.size}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    <div className="space-y-2.5">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Decision Maker</h3>
                      <dl className="space-y-2 text-sm">
                        {lead.decision_maker_name && (
                          <div className="flex gap-2">
                            <dt className="font-medium text-slate-600 w-20 shrink-0">Name</dt>
                            <dd className="text-slate-900 font-semibold">{lead.decision_maker_name}</dd>
                          </div>
                        )}
                        {lead.decision_maker_title && (
                          <div className="flex gap-2">
                            <dt className="font-medium text-slate-600 w-20 shrink-0">Title</dt>
                            <dd className="text-slate-700">{lead.decision_maker_title}</dd>
                          </div>
                        )}
                        {lead.decision_maker_contact && (
                          <div className="flex gap-2">
                            <dt className="font-medium text-slate-600 w-20 shrink-0">Reach</dt>
                            <dd className="text-slate-700">{lead.decision_maker_contact}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  </div>
                </div>

                {/* Pro/Con Value Prop Toggle */}
                <div className="border-t border-slate-100">
                  <button
                    onClick={() => setExpandedLead(isExpanded ? null : key)}
                    className="w-full px-6 py-3 text-left text-sm font-semibold text-blue-700 hover:bg-blue-50 transition-colors flex items-center gap-2"
                  >
                    <svg
                      className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    {isExpanded ? 'Hide Analysis' : 'Show Pro/Con & Value Proposition'}
                  </button>

                  {isExpanded && (
                    <div className="px-6 pb-6 space-y-5">
                      <div className="bg-blue-50 rounded-xl p-5">
                        <h4 className="text-sm font-bold text-blue-900 mb-2 flex items-center gap-2">
                          💡 Value Proposition
                        </h4>
                        <p className="text-sm text-blue-900 leading-relaxed">{lead.value_proposition}</p>
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="bg-emerald-50 rounded-xl p-5">
                          <h4 className="text-sm font-bold text-emerald-900 mb-3 flex items-center gap-2">
                            ✅ Pro for CogMap
                          </h4>
                          <ul className="space-y-1.5 text-sm text-emerald-900">
                            {pros.map((p, i) => (
                              <li key={i} className="flex gap-2">
                                <span className="text-emerald-500 mt-0.5">•</span>
                                <span>{p}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="bg-amber-50 rounded-xl p-5">
                          <h4 className="text-sm font-bold text-amber-900 mb-3 flex items-center gap-2">
                            ⚠️ Con for CogMap
                          </h4>
                          <ul className="space-y-1.5 text-sm text-amber-900">
                            {cons.map((c, i) => (
                              <li key={i} className="flex gap-2">
                                <span className="text-amber-500 mt-0.5">•</span>
                                <span>{c}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filteredLeads.length === 0 && (
          <div className="text-center py-20">
            <p className="text-slate-500 text-lg">No leads match your search criteria</p>
            <button
              onClick={() => { setSearchTerm(''); setFilter('all'); setSectorFilter('all'); }}
              className="mt-4 text-blue-600 hover:text-blue-800 font-medium"
            >
              Clear all filters
            </button>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-slate-200 text-center text-sm text-slate-500">
          <p>CogMap Lead Intelligence • Updated July 2026</p>
          <p className="mt-1">50 qualified leads across US, CEE, and MENA regions</p>
        </footer>
      </div>
    </main>
  );
}
