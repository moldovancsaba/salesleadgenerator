// Call & Meeting Transcript Analyzer (issue #281) — pure, deterministic
// extraction of competitor mentions (matched against Battlecards), action items,
// budget/pricing signals, timeline cues, objections, and overall sentiment.

export type BattlecardForAnalysis = {
  id: string;
  competitorName: string;
  positioningSummary: string;
  objections?: Array<{ objection: string; response: string }>;
};

export type MatchedBattlecardHit = {
  battlecardId: string;
  competitorName: string;
  positioningSummary: string;
  topObjectionRebuttal?: { objection: string; response: string };
};

export type TranscriptSignal = {
  category: 'budget' | 'timeline' | 'objection' | 'buying_intent';
  snippet: string;
};

export type TranscriptAnalysisResult = {
  sentiment: 'positive' | 'neutral' | 'cautious';
  matchedBattlecards: MatchedBattlecardHit[];
  actionItems: string[];
  signals: TranscriptSignal[];
};

const ACTION_VERBS_RE =
  /\b(?:will send|send over|follow up|schedule|book a|share the|prepare a|introduce|connect you with|next step is|action item|todo|to-do|we need to|i'll send|i will send)\b/i;

const BUDGET_RE =
  /(?:(?:\$|€|£)\s*\d[\d,.]*\s*(?:k|m|thousand|million)?|\b(?:budget|pricing|cost|quote|proposal|annual fee|upfront|discount|po|purchase order)\b)/i;

const TIMELINE_RE =
  /\b(?:q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december|next week|next month|this quarter|season opener|before the match|deadline|kickoff|launch date)\b/i;

const OBJECTION_RE =
  /\b(?:too expensive|no budget|already using|locked into|contract with|not a priority|concern about|worried about|pushback|hesitant|legal review|security review|it integration)\b/i;

const POSITIVE_RE =
  /\b(?:excited|love this|looks great|impressed|move forward|send the contract|send the quote|approved|strong fit|ready to start|let's do it)\b/i;

function splitSentences(text: string): string[] {
  return text
    .split(/(?:[\r\n]+|(?<=[.!?])\s+)/)
    .map((s) => s.replace(/^[•\-*]\s*/, '').trim())
    .filter((s) => s.length >= 6);
}

export function analyzeTranscript(
  text: string,
  battlecards: BattlecardForAnalysis[] = []
): TranscriptAnalysisResult {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return {
      sentiment: 'neutral',
      matchedBattlecards: [],
      actionItems: [],
      signals: [],
    };
  }

  const lower = trimmed.toLowerCase();
  const matchedBattlecards: MatchedBattlecardHit[] = [];

  for (const card of battlecards) {
    const compName = (card.competitorName || '').trim();
    if (!compName) continue;
    if (lower.includes(compName.toLowerCase())) {
      matchedBattlecards.push({
        battlecardId: card.id,
        competitorName: compName,
        positioningSummary: card.positioningSummary,
        topObjectionRebuttal:
          Array.isArray(card.objections) && card.objections.length > 0
            ? card.objections[0]
            : undefined,
      });
    }
  }

  const sentences = splitSentences(trimmed);
  const actionItems: string[] = [];
  const signals: TranscriptSignal[] = [];

  let positiveHits = 0;
  let objectionHits = 0;

  for (const sentence of sentences) {
    if (ACTION_VERBS_RE.test(sentence) && actionItems.length < 6) {
      const cleaned = sentence.slice(0, 160);
      if (!actionItems.includes(cleaned)) {
        actionItems.push(cleaned);
      }
    }

    if (BUDGET_RE.test(sentence) && signals.filter((s) => s.category === 'budget').length < 3) {
      signals.push({ category: 'budget', snippet: sentence.slice(0, 160) });
    }

    if (TIMELINE_RE.test(sentence) && signals.filter((s) => s.category === 'timeline').length < 3) {
      signals.push({ category: 'timeline', snippet: sentence.slice(0, 160) });
    }

    if (OBJECTION_RE.test(sentence)) {
      objectionHits += 1;
      if (signals.filter((s) => s.category === 'objection').length < 3) {
        signals.push({ category: 'objection', snippet: sentence.slice(0, 160) });
      }
    }

    if (POSITIVE_RE.test(sentence)) {
      positiveHits += 1;
      if (signals.filter((s) => s.category === 'buying_intent').length < 2) {
        signals.push({ category: 'buying_intent', snippet: sentence.slice(0, 160) });
      }
    }
  }

  const sentiment: TranscriptAnalysisResult['sentiment'] =
    objectionHits > positiveHits
      ? 'cautious'
      : positiveHits > 0
        ? 'positive'
        : 'neutral';

  return {
    sentiment,
    matchedBattlecards,
    actionItems,
    signals,
  };
}
