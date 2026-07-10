"use client";

import type { Lead } from "./page";

type Props = {
  lead: Lead;
  onClick: () => void;
};

export function LeadCard({ lead, onClick }: Props) {
  const ice = lead.ice || { impact: 5, confidence: 5, ease: 5 };
  const iceScore = ice.impact * ice.confidence * ice.ease;
  const maxIce = 1000; // 10*10*10
  const icePercent = Math.min(100, (iceScore / maxIce) * 100);

  function iceColor(): string {
    if (iceScore >= 720) return "bg-emerald-500";
    if (iceScore >= 480) return "bg-indigo-500";
    if (iceScore >= 200) return "bg-blue-500";
    return "bg-slate-400";
  }

  function regionColor(): string {
    const colors: Record<string, string> = {
      US: "bg-red-100 text-red-800",
      CEE: "bg-blue-100 text-blue-800",
      MENA: "bg-green-100 text-green-800",
    };
    return colors[lead.region] || "bg-slate-100 text-slate-800";
  }

  function qualityBadge(): { label: string; color: string } {
    switch (lead.qualityStatus) {
      case "VERIFIED": return { label: "✓ Verified", color: "text-emerald-600" };
      case "CHECKED": return { label: "✓ Checked", color: "text-indigo-600" };
      case "DRAFT":
      default:
        return { label: "Draft", color: "text-slate-400" };
    }
  }

  const q = qualityBadge();

  return (
    <div
      onClick={onClick}
      className="bg-white border border-slate-200 rounded-lg p-3 hover:border-indigo-400 hover:shadow-md transition-all cursor-pointer"
    >
      {/* Header: name + ICE score */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">
            {lead.entity_name}
          </div>
          <div className="text-xs text-slate-500 truncate mt-0.5">
            {lead.industry || lead.sport_or_sector || "—"}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-xs font-bold text-slate-700">{Math.round(iceScore)}</div>
          <div className="text-[10px] text-slate-500 uppercase">ICE</div>
        </div>
      </div>

      {/* ICE bar */}
      <div className="mb-2">
        <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full ${iceColor()} transition-all`} style={{ width: `${icePercent}%` }} />
        </div>
      </div>

      {/* Footer: region + quality + score */}
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className={`px-1.5 py-0.5 rounded font-medium ${regionColor()}`}>
          {lead.region}
        </span>
        <span className={`${q.color} font-medium`}>{q.label}</span>
      </div>

      {/* Decision maker (if present) */}
      {lead.decision_maker_name && (
        <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 truncate">
          👤 {lead.decision_maker_name}
          {lead.decision_maker_title && ` · ${lead.decision_maker_title}`}
        </div>
      )}

      {/* Feedback indicators */}
      {(lead.feedbackScore > 0 || lead.declineCount > 0) && (
        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
          {lead.feedbackScore > 0 && <span>↑ {lead.feedbackScore}</span>}
          {lead.declineCount > 0 && <span>↓ {lead.declineCount}</span>}
        </div>
      )}
    </div>
  );
}
