// Rule-based (regex/keyword lookup, ordered precedence) job-title
// normalization — explicitly NOT ML, no hosted model, no training data, no
// external API. Pure and synchronous, mirroring lib/kanban-column-visibility.ts's
// shape. Computed inside lib/contacts.ts's normalizeContact() and persisted
// on every contacts[] entry, the same pattern isDecisionMaker already uses.

export type SeniorityTier = 'C-level' | 'VP' | 'Director' | 'Manager' | 'IC' | 'Unknown';
export type Department = 'Sales' | 'Marketing' | 'Operations' | 'Executive' | 'Unknown';

export type TitleClassification = {
  seniorityTier: SeniorityTier;
  department: Department;
};

// First-match-wins, most senior first. `c[a-z]o` intentionally matches any
// three-letter "C_O" abbreviation (CEO/CFO/COO/CRO/CTO/CIO/...), not an
// exhaustive enumerated list — broad by design for a rule-based heuristic.
function classifySeniority(lower: string, department: Department): SeniorityTier {
  if (/\b(chief|c[a-z]o)\b/.test(lower)) return 'C-level';
  if (/\b(svp|evp|vp|vice president)\b/.test(lower)) return 'VP';
  if (/\bdirector\b/.test(lower)) return 'Director';
  if (/\b(manager|head of|team lead)\b/.test(lower)) return 'Manager';
  // No explicit rank keyword matched. A bare owner/founder/co-founder/
  // president signal (Executive department) doesn't tell us anything about
  // org-chart rank — a solo founder isn't meaningfully an "individual
  // contributor" either — so that's Unknown, not a default IC guess,
  // matching the issue's own worked example ("Owner" -> Unknown tier,
  // Executive department). A department that resolved to nothing at all
  // (Unknown) means nothing about the title was recognized in the first
  // place — e.g. a non-Latin-script title — so that's Unknown too, never a
  // guessed IC. Only a genuinely-recognized functional department
  // (Sales/Marketing/Operations) with no rank keyword defaults to IC.
  if (department === 'Executive' || department === 'Unknown') return 'Unknown';
  return 'IC';
}

// First-match-wins, checked in this fixed order regardless of where each
// keyword appears in the string. Two reconciliations against the issue's
// own literal pseudocode/examples, both intentional:
// - "revenue" is added to the Sales keywords — absent from the pseudocode,
//   but required to make its own worked example true ("Chief Revenue
//   Officer" -> Sales department); the pseudocode text and worked example
//   disagreed, so this reconciles them rather than silently picking one.
// - the bare "president" keyword excludes "vice president" via a negative
//   lookbehind — without it, "VP of Sales" titles spelled out as "Vice
//   President, Sales" would incorrectly resolve to Executive department
//   instead of Sales, since "president" is a substring of "vice president".
function classifyDepartment(lower: string): Department {
  if (/\b(ceo|founder|co-founder|owner|(?<!vice )president)\b/.test(lower)) return 'Executive';
  if (/\b(sales|business development|bd|revenue)\b/.test(lower)) return 'Sales';
  if (/\b(marketing|brand|comms)\b/.test(lower)) return 'Marketing';
  if (/\b(operations|ops|logistics)\b/.test(lower)) return 'Operations';
  return 'Unknown';
}

export function normalizeTitle(rawTitle: string | undefined | null): TitleClassification {
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (!title) return { seniorityTier: 'Unknown', department: 'Unknown' };

  const lower = title.toLowerCase();
  const department = classifyDepartment(lower);
  const seniorityTier = classifySeniority(lower, department);

  return { seniorityTier, department };
}
