"use client"

import { useState, useEffect } from 'react'

export default function Home() {
  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expandedLead, setExpandedLead] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchLeads()
  }, [filter])

  const fetchLeads = async () => {
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.append('region', filter)
      if (searchTerm) params.append('search', searchTerm)

      const res = await fetch(`/api/leads?${params.toString()}`)
      const data = await res.json()
      setLeads(data.leads || [])
    } catch (error) {
      console.error('Failed to fetch leads:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedLead(expandedLead === id ? null : id)
  }

  const regionCounts = {
    all: leads.length,
    US: leads.filter(l => l.region === 'US').length,
    CEE: leads.filter(l => l.region === 'CEE').length,
    MENA: leads.filter(l => l.region === 'MENA').length,
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading leads from MongoDB...</p>
        </div>
      </div>
    )
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-12">
          <h1 className="text-6xl font-bold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent mb-4">
            CogMap Lead Intelligence
          </h1>
          <p className="text-xl text-slate-600">
            Interactive database • {leads.length} qualified leads • Powered by MongoDB Atlas
          </p>
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            {['all', 'US', 'CEE', 'MENA'].map(region => {
              const count = regionCounts[region as keyof typeof regionCounts]
              const active = filter === region
              return (
                <button
                  key={region}
                  onClick={() => setFilter(region)}
                  className={`p-6 rounded-xl border-2 transition-all ${
                    active
                      ? 'border-blue-500 bg-blue-50 shadow-lg'
                      : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-slate-500 font-medium">{region}</span>
                    {active && <span className="text-blue-500">✓</span>}
                  </div>
                  <div className="text-4xl font-bold text-slate-900">{count}</div>
                  <div className="text-xs text-slate-400 mt-1">leads</div>
                </button>
              )
            })}
          </div>
        </header>

        <div className="mb-8">
          <input
            type="text"
            placeholder="Search entities, industries, sectors..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyUp={fetchLeads}
            className="w-full px-6 py-4 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
          />
        </div>

        <div className="space-y-6">
          {leads.map(lead => (
            <div key={lead._id} className="bg-white rounded-2xl shadow-md hover:shadow-xl transition-shadow border border-slate-200 overflow-hidden">
              <div className="p-8">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <h2 className="text-3xl font-bold text-slate-900">{lead.entity_name}</h2>
                      <span className={`px-4 py-1.5 text-sm font-semibold rounded-full ${
                        lead.region === 'US' ? 'bg-red-100 text-red-800' :
                        lead.region === 'CEE' ? 'bg-blue-100 text-blue-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {lead.region}
                      </span>
                      <span className="px-4 py-1.5 text-sm font-semibold rounded-full bg-indigo-100 text-indigo-800">
                        {lead.priority}
                      </span>
                    </div>
                    <p className="text-lg text-slate-600 mb-2">{lead.sport_or_sector}</p>
                    <p className="text-sm text-slate-500">{lead.level_league}</p>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6 mb-6">
                  <div className="bg-slate-50 rounded-xl p-6">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">
                      Entity Details
                    </h3>
                    <dl className="space-y-2 text-sm">
                      <div className="flex gap-2">
                        <dt className="font-medium text-slate-500 min-w-[80px]">URL</dt>
                        <dd>
                          <a href={lead.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                            {lead.url}
                          </a>
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="font-medium text-slate-500 min-w-[80px]">Address</dt>
                        <dd className="text-slate-700">{lead.address}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="font-medium text-slate-500 min-w-[80px]">Contact</dt>
                        <dd className="text-slate-700">{lead.general_contact}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="font-medium text-slate-500 min-w-[80px]">Size</dt>
                        <dd className="text-slate-700">{lead.size}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-6">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">
                      Decision Maker
                    </h3>
                    <dl className="space-y-2 text-sm">
                      <div className="flex gap-2">
                        <dt className="font-medium text-slate-500 min-w-[80px]">Name</dt>
                        <dd className="text-slate-700 font-semibold">{lead.decision_maker_name}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="font-medium text-slate-500 min-w-[80px]">Title</dt>
                        <dd className="text-slate-700">{lead.decision_maker_title}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="font-medium text-slate-500 min-w-[80px]">Contact</dt>
                        <dd className="text-slate-700">{lead.decision_maker_contact}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <button
                  onClick={() => toggleExpand(lead._id)}
                  className="w-full text-left py-3 px-4 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors flex items-center justify-between"
                >
                  <span className="text-sm font-semibold text-slate-700">
                    {expandedLead === lead._id ? '▼ Hide' : '▶ Show'} Pro/Con Analysis & Value Proposition
                  </span>
                  <span className="text-xs text-slate-500">
                    {lead.pro_for_cogmap?.length || 0} pros • {lead.con_for_cogmap?.length || 0} cons
                  </span>
                </button>

                {expandedLead === lead._id && (
                  <div className="mt-6 grid md:grid-cols-2 gap-6">
                    <div className="border-l-4 border-green-500 bg-green-50 rounded-r-xl p-6">
                      <h4 className="text-lg font-bold text-green-900 mb-3">✅ Pro for CogMap</h4>
                      <ul className="space-y-2 text-sm text-green-800">
                        {lead.pro_for_cogmap?.map((pro, i) => (
                          <li key={i}>• {pro}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="border-l-4 border-red-500 bg-red-50 rounded-r-xl p-6">
                      <h4 className="text-lg font-bold text-red-900 mb-3">⚠️ Con for CogMap</h4>
                      <ul className="space-y-2 text-sm text-red-800">
                        {lead.con_for_cogmap?.map((con, i) => (
                          <li key={i}>• {con}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="md:col-span-2 bg-blue-50 border-l-4 border-blue-500 rounded-r-xl p-6">
                      <h4 className="text-lg font-bold text-blue-900 mb-3">💡 Value Proposition</h4>
                      <p className="text-sm text-blue-800 leading-relaxed">{lead.value_proposition}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <footer className="mt-16 text-center text-sm text-slate-400">
          <p>CogMap Lead Intelligence • Powered by MongoDB Atlas • {new Date().getFullYear()}</p>
        </footer>
      </div>
    </main>
  )
}
