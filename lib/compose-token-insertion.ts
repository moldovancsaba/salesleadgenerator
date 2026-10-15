/**
 * Utility functions and token definitions for keyboard-accessible template token insertion
 * in email/outreach composition surfaces (Issue #242).
 */

import { resolveCanonicalToken } from './template-personalization';

export type ComposeToken = {
  token: string;
  key: string;
  label: string;
};

export const COMPOSE_TOKENS: ComposeToken[] = [
  { token: '{first_name}', key: 'first_name', label: 'First Name' },
  { token: '{last_name}', key: 'last_name', label: 'Last Name' },
  { token: '{contact_name}', key: 'contact_name', label: 'Contact Name' },
  { token: '{company}', key: 'company', label: 'Company' },
  { token: '{title}', key: 'job_title', label: 'Title' },
  { token: '{industry}', key: 'industry', label: 'Industry' },
  { token: '{value_proposition}', key: 'value_proposition', label: 'Value Proposition' },
  { token: '{country}', key: 'country', label: 'Country' },
];

export type InsertTokenResult = {
  text: string;
  caretIndex: number;
};

/**
 * Inserts a token string into text at the specified selection range [start, end].
 * If start or end are omitted, null, or out of bounds, defaults to appending at end of text.
 * When start < end, replaces the selected range.
 * If start > end (e.g. inverted selection), normalizes so the range [min, max] is replaced.
 * Automatically wraps token in `{...}` if not already formatted with braces.
 * Returns the modified string and the new caret index positioned immediately after the inserted token.
 */
export function insertTokenAtCaret(
  text: string,
  token: string,
  selectionStart?: number | null,
  selectionEnd?: number | null
): InsertTokenResult {
  const currentText = text || '';
  const rawStart = typeof selectionStart === 'number' && !isNaN(selectionStart) ? selectionStart : currentText.length;
  const rawEnd = typeof selectionEnd === 'number' && !isNaN(selectionEnd) ? selectionEnd : rawStart;

  const min = Math.max(0, Math.min(rawStart, rawEnd, currentText.length));
  const max = Math.max(0, Math.min(Math.max(rawStart, rawEnd), currentText.length));

  const formattedToken = token.startsWith('{') && token.endsWith('}') ? token : `{${token}}`;

  const before = currentText.slice(0, min);
  const after = currentText.slice(max);

  const newText = before + formattedToken + after;
  const caretIndex = before.length + formattedToken.length;

  return {
    text: newText,
    caretIndex,
  };
}

/**
 * Resolves the display preview value of a token for a given lead/personalization context.
 * Checks canonical and alias keys case-insensitively.
 */
export function resolveTokenPreview(key: string, context: Record<string, any> | null | undefined): string {
  if (!context) return '';
  const cleanKey = (key || '').trim().toLowerCase();
  if (!cleanKey) return '';
  const canonical = resolveCanonicalToken(cleanKey);

  const val = context[canonical] ?? context[cleanKey];
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}
