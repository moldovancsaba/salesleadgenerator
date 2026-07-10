"use client";

import { useState } from "react";
import type { Lead, KanbanColumn, DeclineReason } from "./page";

type Props = {
  lead: Lead;
  onClose: () => void;
  onAction: (leadId: string, action: string, payload?: any) => void;
  onUpdated: () => void;
};

const DECLINE_REASONS: { value: DeclineReason; label: string }[] = [
  { value: "WRONG_INDUSTRY", label: "Wrong industry" },
  { value: "NO_DECISION_MAKER", label: "No decision maker" },
  { value: "TOO_SMALL", label: "Too small" },
  { value: "ALREADY_COMPETITOR", label: "Already competitor" },
  { value: "BAD_TIMING", label: "Bad timing" },
  { value: "BUDGET_CONSTRAINTS", label: "Budget constraints" },
  { value: "NOT_RESPONSIVE", label: "Not responsive" },
  { value: "MISSING_CONTEXT", label: "Missing context" },
  { value: "LOW_PRIORITY", label: "Low priority" },
  { value: "OTHER", label: "Other" },
];

export function LeadDetailModal({ lead, onClose, onAction }: Props) {
  const [annotation, setAnnotation] = useState("");
  const [declineReason, setDeclineReason] = useState<DeclineReason>("OTHER");
  const [actionMode, setActionMode] = useState<"decline" | "pin" | "refresh" | null>(null);
  const [busy, setBusy] = useState(false);

  const ice = lead.ice || { impact: 5, confidence: 5, ease: 5 };
  const iceScore = Math.round(ice.impact * ice.confidence * ice.ease);
  const maxIce = 1000;
  const icePercent = Math.min(100, (iceScore / maxIce) * 100);

  function regionColor(): string {
    const colors: Record<string, string> = {
      US: "bg-red-100 text-red-800 border-red-200",
      CEE: "bg-blue-100 text-blue-800 border-blue-200",
      MENA: "bg-green-100 text-green-800 border-green-200",
    };
    return colors[lead.region] || "bg-slate-100 text-slate-800 border-slate-200";
  }

  async function handleAccept() {
    setBusy(true);
    onAction(lead._id, "ACCEPT", { annotation: annotation || "Accepted" });
    setBusy(false);
  }

  async function handleDecline() {
    setBusy(true);
    onAction(lead._id, "DECLINE", { declineReason, annotation });
    setBusy(false);
  }

  async function handlePin() {
    setBusy(true);
    onAction(lead._id, "PIN", { annotation });
    setBusy(false);
  }

  async function handleRefresh() {
    setBusy(true);
    onAction(lead._id, "REQUEST_REFRESH", { annotation });
    setBusy(false);
  }

  async function handleModify() {
    setBusy(true);
    onAction(lead._id, "MODIFY", { annotation });
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-slate-900">{lead.entity_name}</h2>
              <div className="flex items-center gap-2 mt-2">
                <span className={`px-2 py-0.5 text-xs font-medium rounded border ${regionColor()}`}>
                  {lead.region}
                </span>
                <span className="text-sm text-slate-600">{lead.industry || lead.sport_or_sector}</span>
                <span className="text-xs text-slate-400">•</span>
                <span className="text-xs text-slate-500">{lead.kanbanColumn}</span>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* ICE Score */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-700">ICE Score</span>
              <span className="text-lg font-bold text-slate-900">{iceScore} / {maxIce}</span>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${iceScore >= 720 ? "bg-emerald-500" : iceScore >= 480 ? "bg-indigo-500" : iceScore >= 200 ? "bg-blue-500" : "bg-slate-400"}`}
                style={{ width: `${icePercent}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-4 mt-3 text-xs">
              <div>
                <div className="text-slate-500 mb-1">Impact</div>
                <div className="font-semibold text-slate-900">{ice.impact} / 10</div>
              </div>
              <div>
                <div className="text-slate-500 mb-1">Confidence</div>
                <div className="font-semibold text-slate-900">{ice.confidence} / 10</div>
              </div>
              <div>
                <div className="text-slate-500 mb-1">Ease</div>
                <div className="font-semibold text-slate-900">{ice.ease} / 10</div>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-slate-500 mb-1">URL</div>
              {lead.url && (
                <a href={lead.url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline">
                  {lead.url}
                </a>
              )}
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Size</div>
              <div className="text-sm text-slate-900">{lead.size || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Level / League</div>
              <div className="text-sm text-slate-900">{lead.level_league || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Quality Status</div>
              <div className="text-sm text-slate-900 font-medium">{lead.qualityStatus || "DRAFT"}</div>
            </div>
          </div>

          {/* Decision Maker */}
          {lead.decision_maker_name && (
            <div className="border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500 mb-2">Decision Maker</div>
              <div className="font-semibold text-slate-900">{lead.decision_maker_name}</div>
              {lead.decision_maker_title && <div className="text-sm text-slate-600 mt-1">{lead.decision_maker_title}</div>}
              {lead.decision_maker_contact && (
                <div className="text-sm text-slate-500 mt-1">{lead.decision_maker_contact}</div>
              )}
            </div>
          )}

          {/* Pros / Cons */}
          {((lead.pro_for_cogmap && lead.pro_for_cogmap.length > 0) || (lead.con_for_cogmap && lead.con_for_cogmap.length > 0)) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {lead.pro_for_cogmap && lead.pro_for_cogmap.length > 0 && (
                <div className="border-l-4 border-emerald-500 bg-emerald-50 rounded-r-lg p-4">
                  <div className="text-xs font-semibold text-emerald-700 mb-2">PROS FOR COGMAP</div>
                  <ul className="space-y-1 text-sm text-emerald-900">
                    {lead.pro_for_cogmap.map((pro, i) => (
                      <li key={i}>• {pro}</li>
                    ))}
                  </ul>
                </div>
              )}
              {lead.con_for_cogmap && lead.con_for_cogmap.length > 0 && (
                <div className="border-l-4 border-rose-500 bg-rose-50 rounded-r-lg p-4">
                  <div className="text-xs font-semibold text-rose-700 mb-2">CONS FOR COGMAP</div>
                  <ul className="space-y-1 text-sm text-rose-900">
                    {lead.con_for_cogmap.map((con, i) => (
                      <li key={i}>• {con}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Value Proposition */}
          {lead.value_proposition && (
            <div className="border-l-4 border-indigo-500 bg-indigo-50 rounded-r-lg p-4">
              <div className="text-xs font-semibold text-indigo-700 mb-2">VALUE PROPOSITION</div>
              <p className="text-sm text-indigo-900">{lead.value_proposition}</p>
            </div>
          )}

          {/* Feedback Summary */}
          {(lead.feedbackScore > 0 || lead.declineCount > 0 || lead.acceptanceCount > 0) && (
            <div className="bg-slate-50 rounded-lg p-4">
              <div className="text-xs font-semibold text-slate-700 mb-2">FEEDBACK HISTORY</div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-slate-500">Feedback Score</div>
                  <div className="font-bold text-slate-900">{lead.feedbackScore}</div>
                </div>
                <div>
                  <div className="text-slate-500">Acceptances</div>
                  <div className="font-bold text-emerald-600">{lead.acceptanceCount}</div>
                </div>
                <div>
                  <div className="text-slate-500">Declines</div>
                  <div className="font-bold text-rose-600">{lead.declineCount}</div>
                </div>
              </div>
              {lead.declinedAt && lead.declineReason && (
                <div className="mt-3 text-xs text-slate-500">
                  Declined: {new Date(lead.declinedAt).toLocaleDateString()} ({lead.declineReason})
                </div>
              )}
            </div>
          )}

          {/* Annotation */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Annotation</label>
            <textarea
              value={annotation}
              onChange={(e) => setAnnotation(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              rows={3}
              placeholder="Add notes, reasoning, or context for your action…"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4">
          {!actionMode ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleAccept}
                disabled={busy}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                Accept → QUALIFIED
              </button>
              <button
                onClick={() => setActionMode("decline")}
                disabled={busy}
                className="px-4 py-2 bg-rose-600 text-white rounded-lg font-medium hover:bg-rose-700 disabled:opacity-50"
              >
                Decline → LOST
              </button>
              <button
                onClick={handlePin}
                disabled={busy}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                Pin to ENGAGED
              </button>
              <button
                onClick={handleRefresh}
                disabled={busy}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-300 disabled:opacity-50"
              >
                Request Refresh
              </button>
            </div>
          ) : actionMode === "decline" ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Decline Reason</label>
                <select
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value as DeclineReason)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  {DECLINE_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleDecline}
                  disabled={busy}
                  className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-lg font-medium hover:bg-rose-700 disabled:opacity-50"
                >
                  Confirm Decline
                </button>
                <button
                  onClick={() => setActionMode(null)}
                  disabled={busy}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-300 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
