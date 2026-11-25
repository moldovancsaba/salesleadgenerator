'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Box,
  Flex,
  Stack,
  Group,
  Text,
  Title,
  Button,
  ActionIcon,
  TextInput,
  Textarea,
  SegmentedControl,
  Select,
  MultiSelect,
  Switch,
  Loader,
  Tooltip,
  Divider,
  ScrollArea,
  Avatar,
  Paper,
  Alert,
  NavLink,
  Checkbox,
  Collapse,
} from '@mantine/core';
import {
  StatusBadge,
  LabelTag,
  CountBadge,
  InlineAlert,
} from '@sovereignsquad/gds-core/client';
import {
  IconInbox,
  IconMail,
  IconMailOpened,
  IconSend,
  IconNote,
  IconPhone,
  IconBell,
  IconFlame,
  IconStar,
  IconStarFilled,
  IconArchive,
  IconRefresh,
  IconSearch,
  IconX,
  IconExternalLink,
  IconCheck,
  IconAlertCircle,
  IconPaperclip,
  IconUser,
  IconCalendar,
  IconUserPlus,
  IconCurrencyDollar,
  IconUsers,
  IconBuilding,
  IconBold,
  IconItalic,
  IconList,
  IconLink,
  IconDownload,
  IconEye,
  IconFileText,
} from '@tabler/icons-react';
import type { Brand } from '@/app/lib/brand-constants';
import type {
  InboxStream,
  InboxThread,
  InboxMessage,
  InboxCounts,
} from '@/app/lib/inbox-store';
import type { GmailDraftItem } from '@/lib/gmail-drafts';
import { isInternalOrSystemEmail } from '@/lib/email-contact-extractor';
import { useAuth } from '@/app/components/AuthProvider';
import { ConvertModal } from './convert-modal';

type Props = {
  brand: Brand;
  label: string;
  initialStream?: string;
  initialSearch?: string;
  initialThreadId?: string;
  initialUnreadOnly?: boolean;
};

type SenderIdentityOption = {
  value: string;
  label: string;
  connectionId: string;
  signatureText: string;
};

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatFullTime(dateStr: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function InboxClient({
  brand,
  label,
  initialStream,
  initialSearch,
  initialThreadId,
  initialUnreadOnly = false,
}: Props) {
  const { hideNeedsReplyByBrand } = useAuth();
  const hideNeedsReply = Boolean(hideNeedsReplyByBrand?.[brand]);
  const [stream, setStream] = useState<InboxStream>(
    initialStream && ['inbox', 'drafts', 'sent', 'needs_reply', 'internal', 'calls', 'system', 'all'].includes(initialStream)
      ? (initialStream as InboxStream)
      : 'inbox'
  );
  useEffect(() => {
    if (hideNeedsReply && stream === 'needs_reply') {
      setStream('inbox');
    }
  }, [hideNeedsReply, stream]);
  const [search, setSearch] = useState(initialSearch || '');
  const [starredOnly, setStarredOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(initialUnreadOnly);
  const [archivedOnly, setArchivedOnly] = useState(false);

  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [counts, setCounts] = useState<InboxCounts>({
    all: 0,
    inbox: 0,
    sent: 0,
    needs_reply: 0,
    internal: 0,
    calls: 0,
    system: 0,
    unread: 0,
  });
  const [unreadInboxCount, setUnreadInboxCount] = useState(0);
  const [syncHealth, setSyncHealth] = useState<{
    state: 'up_to_date' | 'stale' | 'failed' | 'disconnected';
    connectedEmail?: string;
    lastSuccessAt?: string | null;
    lastError?: string | null;
    isStale: boolean;
  } | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [syncNotice, setSyncNotice] = useState<{ message: string; color: 'teal' | 'red' | 'blue' } | null>(null);

  // Selected thread state
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(initialThreadId || null);
  const [selectedThread, setSelectedThread] = useState<InboxThread | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [lead, setLead] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Composer state
  const [replyMode, setReplyMode] = useState<'email' | 'note'>('email');
  const [replyBody, setReplyBody] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyRecipient, setReplyRecipient] = useState('');
  const [replyDocumentIds, setReplyDocumentIds] = useState<string[]>([]);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const [templates, setTemplates] = useState<Array<{ id: string; name: string; subject: string; body: string }>>([]);
  const [documents, setDocuments] = useState<Array<{ id: string; displayName: string }>>([]);

  // Bulk thread selection & composer enhancement state (Issue 272)
  const [checkedThreadIds, setCheckedThreadIds] = useState<string[]>([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [senderIdentities, setSenderIdentities] = useState<SenderIdentityOption[]>([]);
  const [selectedSenderEmail, setSelectedSenderEmail] = useState<string | null>(null);
  const [userSignatureText, setUserSignatureText] = useState<string>('');
  const [syncingSignature, setSyncingSignature] = useState(false);
  const [showSignaturePreview, setShowSignaturePreview] = useState(false);
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Conversion / Deal modal state
  const [convertModalOpened, setConvertModalOpened] = useState(false);
  const [convertModalMode, setConvertModalMode] = useState<'convert' | 'add_deal' | 'add_contact'>('convert');
  const [targetContact, setTargetContact] = useState<
    { name?: string; email: string; title?: string; phone?: string } | undefined
  >(undefined);

  // Gmail Drafts state (#08 — assistant follow-ups & mailbox drafts)
  const [gmailDrafts, setGmailDrafts] = useState<GmailDraftItem[]>([]);
  const [draftsConnected, setDraftsConnected] = useState(false);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [draftTo, setDraftTo] = useState('');
  const [draftCc, setDraftCc] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftSenderEmail, setDraftSenderEmail] = useState<string | null>(null);
  const [draftEdited, setDraftEdited] = useState(false);
  const [sendingDraft, setSendingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftSuccess, setDraftSuccess] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    try {
      const res = await fetch(`/api/inbox/${brand}/drafts`);
      if (res.ok) {
        const data = await res.json();
        setDraftsConnected(Boolean(data.connected));
        const items: GmailDraftItem[] = Array.isArray(data.drafts) ? data.drafts : [];
        setGmailDrafts(items);
        setSelectedDraftId((prev) => {
          if (prev && items.some((d) => d.draftId === prev)) return prev;
          return items[0]?.draftId || null;
        });
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingDrafts(false);
    }
  }, [brand]);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  const activeDraft = gmailDrafts.find((d) => d.draftId === selectedDraftId) || null;

  useEffect(() => {
    if (!activeDraft) {
      setDraftTo('');
      setDraftCc('');
      setDraftSubject('');
      setDraftBody('');
      setDraftEdited(false);
      return;
    }
    setDraftTo(activeDraft.to.join(', '));
    setDraftCc(activeDraft.cc.join(', '));
    setDraftSubject(activeDraft.subject === '(No subject)' ? '' : activeDraft.subject);
    setDraftBody(activeDraft.bodyText);
    setDraftSenderEmail(activeDraft.senderEmail || selectedSenderEmail);
    setDraftEdited(false);
    setDraftError(null);
  }, [activeDraft, selectedSenderEmail]);

  const handleSendDraft = async (unchanged: boolean) => {
    if (!activeDraft) return;
    setSendingDraft(true);
    setDraftError(null);
    setDraftSuccess(null);
    try {
      const res = await fetch(`/api/inbox/${brand}/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId: activeDraft.draftId,
          connectionId: activeDraft.connectionId,
          to: unchanged ? activeDraft.to : draftTo,
          cc: unchanged ? activeDraft.cc : draftCc,
          subject: unchanged ? activeDraft.subject : draftSubject,
          body: unchanged ? activeDraft.bodyText : draftBody,
          unchanged,
          includeSignature,
          senderEmail: draftSenderEmail || activeDraft.senderEmail,
          threadId: activeDraft.threadId,
          inReplyTo: activeDraft.inReplyTo,
          references: activeDraft.references,
          matchedLeadId: activeDraft.matchedLeadId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to send Gmail draft');
      }
      setDraftSuccess(`Draft sent through Google (${draftSenderEmail || activeDraft.senderEmail}).`);
      setGmailDrafts((prev) => {
        const remaining = prev.filter((d) => d.draftId !== activeDraft.draftId);
        setSelectedDraftId(remaining[0]?.draftId || null);
        return remaining;
      });
      await loadThreads();
    } catch (err: any) {
      setDraftError(err?.message || 'Failed to send Gmail draft');
    } finally {
      setSendingDraft(false);
    }
  };

  // Fetch templates, documents, and user signature for composer
  useEffect(() => {
    async function loadComposerResources() {
      try {
        const [tplRes, docRes, intRes] = await Promise.all([
          fetch(`/api/outreach-templates?brand=${brand}`).then((r) => (r.ok ? r.json() : null)),
          fetch(`/api/documents?brand=${brand}`).then((r) => (r.ok ? r.json() : null)),
          fetch(`/api/user/integrations`).then((r) => (r.ok ? r.json() : null)),
        ]);
        if (tplRes?.templates && Array.isArray(tplRes.templates)) {
          setTemplates(tplRes.templates);
        }
        if (docRes?.documents && Array.isArray(docRes.documents)) {
          setDocuments(
            docRes.documents.map((d: any) => ({
              id: d.id,
              displayName: d.displayName || d.filename,
            }))
          );
        }
        if (intRes?.connections && Array.isArray(intRes.connections)) {
          const activeGmails = intRes.connections.filter(
            (c: any) => c.provider === 'gmail' && c.status === 'active'
          );
          const options: SenderIdentityOption[] = [];
          const seenEmails = new Set<string>();
          for (const conn of activeGmails) {
            const primaryEmail = (conn.userEmail || conn.providerAccountLabel || '').trim().toLowerCase();
            const sendAsMap = conn.sendAsSignatures && typeof conn.sendAsSignatures === 'object' ? conn.sendAsSignatures : {};
            const sendAsEntries = Object.values(sendAsMap) as Array<{
              email?: string;
              displayName?: string;
              signatureText?: string;
              isDefault?: boolean;
            }>;
            if (sendAsEntries.length > 0) {
              for (const entry of sendAsEntries) {
                const email = (entry.email || '').trim().toLowerCase();
                if (!email || seenEmails.has(email)) continue;
                seenEmails.add(email);
                options.push({
                  value: email,
                  label: entry.displayName ? `${entry.displayName} <${email}>` : email,
                  connectionId: conn.id,
                  signatureText: entry.signatureText ?? conn.signatureText ?? '',
                });
              }
            }
            if (primaryEmail && !seenEmails.has(primaryEmail)) {
              seenEmails.add(primaryEmail);
              options.push({
                value: primaryEmail,
                label: `${primaryEmail}${conn.isDefault ? ' (Default)' : ''}`,
                connectionId: conn.id,
                signatureText: conn.signatureText || '',
              });
            }
          }
          setSenderIdentities(options);
          const defaultConn = activeGmails.find((c: any) => c.isDefault) || activeGmails[0];
          const defaultEmail = (defaultConn?.userEmail || defaultConn?.providerAccountLabel || '').trim().toLowerCase();
          const chosen = options.find((o) => o.value === defaultEmail) || options[0];
          if (chosen) {
            setSelectedSenderEmail(chosen.value);
            setUserSignatureText(chosen.signatureText);
          }
        }
      } catch {
        // non-fatal
      }
    }
    loadComposerResources();
  }, [brand]);

  const handleToggleThreadCheck = (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCheckedThreadIds((prev) =>
      prev.includes(threadId) ? prev.filter((id) => id !== threadId) : [...prev, threadId]
    );
  };

  const handleToggleSelectAllThreads = () => {
    if (checkedThreadIds.length === threads.length && threads.length > 0) {
      setCheckedThreadIds([]);
    } else {
      setCheckedThreadIds(threads.map((t) => t.id));
    }
  };

  const handleBulkAction = async (updates: { isRead?: boolean; isStarred?: boolean; isArchived?: boolean }) => {
    if (checkedThreadIds.length === 0) return;
    setBulkUpdating(true);
    try {
      const res = await fetch(`/api/inbox/${brand}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadIds: checkedThreadIds, updates }),
      });
      if (res.ok) {
        const count = checkedThreadIds.length;
        setCheckedThreadIds([]);
        setSyncNotice({
          message: `Updated ${count} conversation${count === 1 ? '' : 's'}.`,
          color: 'teal',
        });
        await loadThreads();
      }
    } catch {
      setSyncNotice({ message: 'Failed to apply bulk action.', color: 'red' });
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleApplyFormat = (format: 'bold' | 'italic' | 'list' | 'link') => {
    const el = replyTextareaRef.current;
    const start = el ? el.selectionStart : replyBody.length;
    const end = el ? el.selectionEnd : replyBody.length;
    const selected = replyBody.slice(start, end);

    let replacement = '';
    if (format === 'bold') {
      replacement = `**${selected || 'bold text'}**`;
    } else if (format === 'italic') {
      replacement = `_${selected || 'italic text'}_`;
    } else if (format === 'list') {
      const lines = (selected || 'Item').split('\n');
      replacement = (start > 0 && replyBody[start - 1] !== '\n' ? '\n' : '') + lines.map((l) => `- ${l}`).join('\n');
    } else if (format === 'link') {
      replacement = `${selected || 'Link text'} (https://)`;
    }

    const nextBody = replyBody.slice(0, start) + replacement + replyBody.slice(end);
    setReplyBody(nextBody);
    setTimeout(() => {
      if (el) {
        el.focus();
        const cursorPos = start + replacement.length;
        el.setSelectionRange(cursorPos, cursorPos);
      }
    }, 0);
  };

  // Load threads (Team inbox is disabled; always scoped to current user)
  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    try {
      const params = new URLSearchParams();
      if (stream) params.set('stream', stream);
      params.set('scope', 'my');
      if (search.trim()) params.set('search', search.trim());
      if (starredOnly) params.set('starred', 'true');
      if (unreadOnly) params.set('unread', 'true');
      if (archivedOnly) params.set('archived', 'true');

      const res = await fetch(`/api/inbox/${brand}?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load threads');
      const data = await res.json();
      setThreads(data.threads || []);
      if (data.counts) {
        setCounts(data.counts);
      }
      if (typeof data.unreadInboxCount === 'number') {
        setUnreadInboxCount(data.unreadInboxCount);
      }
      if (data.syncHealth) {
        setSyncHealth(data.syncHealth);
      }
    } catch (err: any) {
      console.error('Error fetching inbox threads:', err);
    } finally {
      setLoadingThreads(false);
    }
  }, [brand, stream, search, starredOnly, unreadOnly, archivedOnly]);

  useEffect(() => {
    loadThreads();
    const interval = setInterval(() => {
      loadThreads();
    }, 60_000);
    return () => clearInterval(interval);
  }, [loadThreads]);

  const handleSyncGmail = async () => {
    setSyncingGmail(true);
    setSyncNotice(null);
    try {
      const res = await fetch(`/api/user/integrations/gmail/sync?brand=${encodeURIComponent(brand)}`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const msg = data.ingested > 0
          ? `Synced ${data.ingested} new message${data.ingested === 1 ? '' : 's'} from your Gmail inbox.`
          : 'Gmail inbox checked — no new correspondence found.';
        setSyncNotice({ message: msg, color: 'teal' });
        loadThreads();
        void loadDrafts();
      } else {
        const errorText = data.error === 'invalid_grant'
          ? 'Google authorization has expired or was revoked. Please reconnect your account in Email & Integrations.'
          : (data.error || 'Connect Gmail in Email & Integrations to sync correspondence.');
        setSyncNotice({ message: errorText, color: 'red' });
      }
    } catch {
      setSyncNotice({ message: 'Could not reach server to sync Gmail.', color: 'red' });
    } finally {
      setSyncingGmail(false);
    }
  };

  // Auto-select initialThreadId if provided and present, else first thread
  useEffect(() => {
    if (initialThreadId && threads.some((t) => t.id === initialThreadId)) {
      setSelectedThreadId(initialThreadId);
    } else if (threads.length > 0 && !selectedThreadId) {
      setSelectedThreadId(threads[0].id);
    }
  }, [threads, initialThreadId, selectedThreadId]);

  // Load selected thread detail
  useEffect(() => {
    if (!selectedThreadId) {
      setSelectedThread(null);
      setMessages([]);
      setLead(null);
      return;
    }

    let isMounted = true;
    async function fetchThreadDetail() {
      setLoadingDetail(true);
      setReplyError(null);
      try {
        const res = await fetch(
          `/api/inbox/${brand}/threads/${encodeURIComponent(selectedThreadId!)}?markRead=true`
        );
        if (!res.ok) throw new Error('Failed to fetch thread detail');
        const data = await res.json();
        if (isMounted) {
          setSelectedThread(
            data.thread
              ? {
                  ...data.thread,
                  participants: data.thread.participants || data.participants || [],
                }
              : null
          );
          setMessages(data.messages || []);
          setLead(data.lead);

          // Update local unread state in threads list only if the thread was actually unread
          setThreads((prev) => {
            const target = prev.find((t) => t.id === selectedThreadId);
            if (target && !target.isRead) {
              setCounts((c) => ({ ...c, unread: Math.max(0, c.unread - 1) }));
              if (target.streams.includes('inbox')) {
                setUnreadInboxCount((u) => Math.max(0, u - 1));
              }
            }
            return prev.map((t) => (t.id === selectedThreadId ? { ...t, isRead: true } : t));
          });

          // Pre-fill composer
          const th = data.thread;
          setReplySubject(th.subject.startsWith('Re: ') ? th.subject : `Re: ${th.subject}`);

          // Ensure reply recipient is strictly an external prospect, never an internal colleague
          let recipient = '';
          if (th.contactEmail && !isInternalOrSystemEmail(th.contactEmail, { brand })) {
            recipient = th.contactEmail;
          } else if (th.counterpartyEmail && !isInternalOrSystemEmail(th.counterpartyEmail, { brand })) {
            recipient = th.counterpartyEmail;
          } else if (Array.isArray(th.participants)) {
            const externalP = th.participants.find((p: any) => p.email && !isInternalOrSystemEmail(p.email, { brand }));
            if (externalP?.email) recipient = externalP.email;
          }
          setReplyRecipient(recipient || th.contactEmail || '');
          setReplyBody('');
          setReplyDocumentIds([]);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Failed to load thread detail:', err);
        }
      } finally {
        if (isMounted) {
          setLoadingDetail(false);
        }
      }
    }

    fetchThreadDetail();
    return () => {
      isMounted = false;
    };
  }, [brand, selectedThreadId]);

  // Scroll to bottom of message list on change
  useEffect(() => {
    if (messages.length > 0 && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Toggle thread star
  const handleToggleStar = async (threadId: string, currentStarred: boolean, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const nextStarred = !currentStarred;

    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, isStarred: nextStarred } : t))
    );
    if (selectedThread && selectedThread.id === threadId) {
      setSelectedThread({ ...selectedThread, isStarred: nextStarred });
    }

    try {
      await fetch(`/api/inbox/${brand}/threads/${encodeURIComponent(threadId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isStarred: nextStarred }),
      });
    } catch {
      // rollback on error
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, isStarred: currentStarred } : t))
      );
    }
  };

  // Toggle thread read status
  const handleToggleRead = async (threadId: string, currentRead: boolean, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const nextRead = !currentRead;

    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, isRead: nextRead } : t))
    );
    if (selectedThread && selectedThread.id === threadId) {
      setSelectedThread({ ...selectedThread, isRead: nextRead });
    }
    setCounts((prev) => ({
      ...prev,
      unread: nextRead ? Math.max(0, prev.unread - 1) : prev.unread + 1,
    }));
    setUnreadInboxCount((prev) =>
      nextRead ? Math.max(0, prev - 1) : prev + 1
    );

    try {
      await fetch(`/api/inbox/${brand}/threads/${encodeURIComponent(threadId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: nextRead }),
      });
    } catch {
      // rollback
      loadThreads();
    }
  };

  // Toggle archive status
  const handleToggleArchive = async (threadId: string, currentArchived: boolean, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const nextArchived = !currentArchived;

    try {
      await fetch(`/api/inbox/${brand}/threads/${encodeURIComponent(threadId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: nextArchived }),
      });
      // Remove from current view if not in archived stream
      if (!archivedOnly) {
        setThreads((prev) => prev.filter((t) => t.id !== threadId));
        if (selectedThreadId === threadId) {
          setSelectedThreadId(null);
        }
      } else {
        loadThreads();
      }
    } catch (err: any) {
      console.error('Archive failed:', err);
    }
  };

  const handleRefreshInboxSignature = async () => {
    setSyncingSignature(true);
    try {
      const currentOpt = senderIdentities.find((o) => o.value === selectedSenderEmail) || senderIdentities[0];
      const res = await fetch('/api/user/integrations/gmail/signature/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentOpt?.connectionId || selectedSenderEmail || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const sendAsMap = data.sendAsSignatures && typeof data.sendAsSignatures === 'object' ? data.sendAsSignatures : {};
        setSenderIdentities((prev) =>
          prev.map((opt) => {
            const updatedEntry = sendAsMap[opt.value];
            if (updatedEntry && typeof updatedEntry.signatureText === 'string') {
              return { ...opt, signatureText: updatedEntry.signatureText };
            }
            if (opt.connectionId === currentOpt?.connectionId && typeof data.signatureText === 'string') {
              return { ...opt, signatureText: data.signatureText };
            }
            return opt;
          })
        );
        const targetSig =
          (selectedSenderEmail && sendAsMap[selectedSenderEmail]?.signatureText) ??
          data.signatureText ??
          '';
        setUserSignatureText(targetSig);
      }
    } catch {
      // non-fatal
    } finally {
      setSyncingSignature(false);
    }
  };

  // Submit in-thread reply or note
  const handleSendReply = async () => {
    if (!selectedThreadId) return;
    setSendingReply(true);
    setReplyError(null);
    setSuccessNotice(null);

    try {
      const payload =
        replyMode === 'email'
          ? {
              kind: 'email',
              body: replyBody,
              subject: replySubject,
              recipientEmail: replyRecipient,
              documentIds: replyDocumentIds,
              includeSignature,
              ...(selectedSenderEmail ? { senderEmail: selectedSenderEmail } : {}),
            }
          : {
              kind: 'note',
              text: replyBody,
            };

      const res = await fetch(`/api/inbox/${brand}/threads/${encodeURIComponent(selectedThreadId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to dispatch reply');
      }

      setSuccessNotice(replyMode === 'email' ? 'Reply email successfully dispatched!' : 'Internal team note added!');
      setReplyBody('');

      // Refresh thread detail and thread list
      const detailRes = await fetch(
        `/api/inbox/${brand}/threads/${encodeURIComponent(selectedThreadId)}?markRead=true`
      );
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        setSelectedThread(detailData.thread);
        setMessages(detailData.messages || []);
      }
      loadThreads();
    } catch (err: any) {
      setReplyError(err?.message || 'Error sending reply');
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <Box h="calc(100vh - 56px)" bg="gray.0" style={{ display: 'flex', overflow: 'hidden' }}>
      {/* ---------------- PANE 1: Streams Sidebar ---------------- */}
      <Box
        w={240}
        bg="white"
        p="md"
        style={{
          borderRight: '1px solid var(--mantine-color-gray-3)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <Group justify="space-between" mb="xs">
          <Text fw={700} size="sm" c="gray.8">
            {label} Inbox
          </Text>
          <Group gap={4}>
            <Tooltip label="Sync with Gmail">
              <ActionIcon
                variant="light"
                color="teal"
                size="sm"
                onClick={handleSyncGmail}
                loading={syncingGmail}
                aria-label="Sync with Gmail"
              >
                <IconMail size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Refresh messages">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={() => {
                  loadThreads();
                  void loadDrafts();
                }}
                loading={loadingThreads}
                aria-label="Refresh messages"
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {syncNotice && (
          <Alert
            color={syncNotice.color}
            variant="light"
            withCloseButton
            onClose={() => setSyncNotice(null)}
            mb="xs"
            p="xs"
          >
            <Text size="xs">{syncNotice.message}</Text>
          </Alert>
        )}

        {syncHealth && (
          <Box mb="xs">
            <Group gap={6} justify="space-between" wrap="nowrap">
              <StatusBadge
                status={
                  syncHealth.state === 'up_to_date'
                    ? 'success'
                    : syncHealth.state === 'stale'
                      ? 'warning'
                      : syncHealth.state === 'failed'
                        ? 'danger'
                        : 'neutral'
                }
                size="xs"
              >
                {syncHealth.state === 'up_to_date'
                  ? 'Gmail Up to Date'
                  : syncHealth.state === 'stale'
                    ? 'Gmail Sync Stale'
                    : syncHealth.state === 'failed'
                      ? 'Gmail Sync Error'
                      : 'Gmail Disconnected'}
              </StatusBadge>
              {syncHealth.lastSuccessAt && (
                <Text size="10px" c="dimmed" truncate title={formatFullTime(syncHealth.lastSuccessAt)}>
                  {formatRelativeTime(syncHealth.lastSuccessAt)}
                </Text>
              )}
            </Group>
          </Box>
        )}

        <Divider mb="sm" />

        <Stack gap={4} style={{ flex: 1 }}>
          <NavLink
            label="Inbox"
            leftSection={<IconInbox size={18} />}
            rightSection={
              (unreadInboxCount > 0 || counts.unread > 0) ? (
                <CountBadge
                  size="xs"
                  value={unreadInboxCount || counts.unread}
                  cap={Number.MAX_SAFE_INTEGER}
                  srLabel="Unread conversations count"
                />
              ) : counts.inbox > 0 ? (
                <Text size="xs" c="dimmed">
                  {counts.inbox}
                </Text>
              ) : null
            }
            active={stream === 'inbox' && !archivedOnly}
            color="indigo"
            onClick={() => {
              setStream('inbox');
              setArchivedOnly(false);
            }}
            style={{ borderRadius: 6 }}
          />

          <NavLink
            label="Gmail Drafts"
            leftSection={<IconFileText size={18} />}
            rightSection={
              gmailDrafts.length > 0 ? (
                <CountBadge
                  size="xs"
                  value={gmailDrafts.length}
                  cap={Number.MAX_SAFE_INTEGER}
                  srLabel="Unsent Gmail drafts count"
                />
              ) : null
            }
            active={stream === 'drafts' && !archivedOnly}
            color="teal"
            onClick={() => {
              setStream('drafts');
              setArchivedOnly(false);
              void loadDrafts();
            }}
            style={{ borderRadius: 6 }}
          />

          {!hideNeedsReply && (
            <NavLink
              label="Needs Reply"
              leftSection={<IconFlame size={18} />}
              rightSection={
                counts.needs_reply > 0 ? (
                  <CountBadge size="xs" value={counts.needs_reply} srLabel="Needs reply count" />
                ) : null
              }
              active={stream === 'needs_reply' && !archivedOnly}
              color="orange"
              onClick={() => {
                setStream('needs_reply');
                setArchivedOnly(false);
              }}
              style={{ borderRadius: 6 }}
            />
          )}

          <NavLink
            label="Sent Outreach"
            leftSection={<IconSend size={18} />}
            rightSection={
              counts.sent > 0 ? (
                <Text size="xs" c="dimmed">
                  {counts.sent}
                </Text>
              ) : null
            }
            active={stream === 'sent' && !archivedOnly}
            color="gray"
            onClick={() => {
              setStream('sent');
              setArchivedOnly(false);
            }}
            style={{ borderRadius: 6 }}
          />

          <NavLink
            label="Internal Notes"
            leftSection={<IconNote size={18} />}
            rightSection={
              counts.internal > 0 ? (
                <Text size="xs" c="dimmed">
                  {counts.internal}
                </Text>
              ) : null
            }
            active={stream === 'internal' && !archivedOnly}
            color="yellow"
            onClick={() => {
              setStream('internal');
              setArchivedOnly(false);
            }}
            style={{ borderRadius: 6 }}
          />

          <NavLink
            label="Call Logs"
            leftSection={<IconPhone size={18} />}
            rightSection={
              counts.calls > 0 ? (
                <Text size="xs" c="dimmed">
                  {counts.calls}
                </Text>
              ) : null
            }
            active={stream === 'calls' && !archivedOnly}
            color="violet"
            onClick={() => {
              setStream('calls');
              setArchivedOnly(false);
            }}
            style={{ borderRadius: 6 }}
          />

          <NavLink
            label="System & Events"
            leftSection={<IconBell size={18} />}
            rightSection={
              counts.system > 0 ? (
                <Text size="xs" c="dimmed">
                  {counts.system}
                </Text>
              ) : null
            }
            active={stream === 'system' && !archivedOnly}
            color="cyan"
            onClick={() => {
              setStream('system');
              setArchivedOnly(false);
            }}
            style={{ borderRadius: 6 }}
          />

          <NavLink
            label="All Threads"
            leftSection={<IconMail size={18} />}
            rightSection={
              counts.all > 0 ? (
                <Text size="xs" c="dimmed">
                  {counts.all}
                </Text>
              ) : null
            }
            active={stream === 'all' && !archivedOnly}
            color="gray"
            onClick={() => {
              setStream('all');
              setArchivedOnly(false);
            }}
            style={{ borderRadius: 6 }}
          />

          <Divider my="xs" label="Filters" labelPosition="left" />

          <Group justify="space-between" px="xs">
            <Text size="xs" c="dimmed">
              Starred Only
            </Text>
            <Switch
              size="xs"
              checked={starredOnly}
              onChange={(e) => setStarredOnly(e.currentTarget.checked)}
            />
          </Group>

          <Group justify="space-between" px="xs">
            <Text size="xs" c="dimmed">
              Unread Only
            </Text>
            <Switch
              size="xs"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.currentTarget.checked)}
            />
          </Group>

          <Divider my="xs" />

          <NavLink
            label={archivedOnly ? 'Active Inbox' : 'Archived'}
            leftSection={<IconArchive size={18} />}
            active={archivedOnly}
            color="gray"
            onClick={() => {
              setArchivedOnly(!archivedOnly);
            }}
            style={{ borderRadius: 6 }}
          />
        </Stack>
      </Box>

      {/* ---------------- PANE 2: Conversation Thread List ---------------- */}
      <Box
        w={360}
        bg="white"
        style={{
          borderRight: '1px solid var(--mantine-color-gray-3)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <Box p="sm" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
          <TextInput
            placeholder="Search conversations..."
            leftSection={<IconSearch size={16} />}
            rightSection={
              search ? (
                <ActionIcon size="xs" variant="subtle" onClick={() => setSearch('')}>
                  <IconX size={14} />
                </ActionIcon>
              ) : null
            }
            size="xs"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          {threads.length > 0 && (
            <Group justify="space-between" align="center" mt="xs" wrap="nowrap">
              <Checkbox
                size="xs"
                label={
                  checkedThreadIds.length > 0
                    ? `${checkedThreadIds.length} selected`
                    : 'Select all'
                }
                checked={checkedThreadIds.length === threads.length && threads.length > 0}
                indeterminate={checkedThreadIds.length > 0 && checkedThreadIds.length < threads.length}
                onChange={handleToggleSelectAllThreads}
                aria-label="Select all threads"
              />
              {checkedThreadIds.length > 0 && (
                <Group gap={4} wrap="nowrap">
                  <Tooltip label="Mark selected as Read">
                    <ActionIcon
                      size="xs"
                      variant="light"
                      color="indigo"
                      loading={bulkUpdating}
                      onClick={() => handleBulkAction({ isRead: true })}
                      aria-label="Bulk mark read"
                    >
                      <IconMailOpened size={13} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Mark selected as Unread">
                    <ActionIcon
                      size="xs"
                      variant="light"
                      color="gray"
                      loading={bulkUpdating}
                      onClick={() => handleBulkAction({ isRead: false })}
                      aria-label="Bulk mark unread"
                    >
                      <IconMail size={13} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Star selected">
                    <ActionIcon
                      size="xs"
                      variant="light"
                      color="yellow"
                      loading={bulkUpdating}
                      onClick={() => handleBulkAction({ isStarred: true })}
                      aria-label="Bulk star"
                    >
                      <IconStar size={13} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={archivedOnly ? 'Unarchive selected' : 'Archive selected'}>
                    <ActionIcon
                      size="xs"
                      variant="light"
                      color="teal"
                      loading={bulkUpdating}
                      onClick={() => handleBulkAction({ isArchived: !archivedOnly })}
                      aria-label="Bulk archive"
                    >
                      <IconArchive size={13} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Clear selection">
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="gray"
                      onClick={() => setCheckedThreadIds([])}
                      aria-label="Clear bulk selection"
                    >
                      <IconX size={13} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              )}
            </Group>
          )}
        </Box>

        <ScrollArea style={{ flex: 1 }}>
          {stream === 'drafts' ? (
            loadingDrafts ? (
              <Flex justify="center" align="center" h={200}>
                <Loader size="sm" />
              </Flex>
            ) : !draftsConnected ? (
              <Flex direction="column" justify="center" align="center" p="xl" h={220}>
                <Text size="sm" fw={600} ta="center">
                  Gmail not connected
                </Text>
                <Text size="xs" c="dimmed" ta="center" mt={4}>
                  Connect your Google account in Email &amp; Integrations to review and send Gmail Drafts.
                </Text>
              </Flex>
            ) : (
              (() => {
                const q = search.trim().toLowerCase();
                const filteredDrafts = q
                  ? gmailDrafts.filter(
                      (d) =>
                        d.subject.toLowerCase().includes(q) ||
                        d.snippet.toLowerCase().includes(q) ||
                        d.to.some((e) => e.includes(q)) ||
                        (d.matchedLeadName && d.matchedLeadName.toLowerCase().includes(q)) ||
                        (d.matchedContactName && d.matchedContactName.toLowerCase().includes(q))
                    )
                  : gmailDrafts;
                if (filteredDrafts.length === 0) {
                  return (
                    <Flex direction="column" justify="center" align="center" p="xl" h={200}>
                      <Text size="sm" c="dimmed" ta="center">
                        No unsent Gmail drafts found.
                      </Text>
                    </Flex>
                  );
                }
                return (
                  <Box>
                    {filteredDrafts.map((d) => {
                      const isSelected = selectedDraftId === d.draftId;
                      return (
                        <Box
                          key={d.draftId}
                          p="sm"
                          onClick={() => setSelectedDraftId(d.draftId)}
                          style={{
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--gds-border-card, var(--mantine-color-gray-2))',
                            borderLeft: isSelected
                              ? '4px solid var(--mantine-color-teal-6)'
                              : '4px solid transparent',
                            backgroundColor: isSelected
                              ? 'var(--mantine-color-teal-0)'
                              : 'var(--gds-bg-card, var(--mantine-color-white))',
                          }}
                        >
                          <Group justify="space-between" align="flex-start" wrap="nowrap" mb={2}>
                            <Text fw={700} size="sm" truncate>
                              {d.matchedContactName || d.to[0] || '(No recipient yet)'}
                            </Text>
                            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                              {formatRelativeTime(d.updatedAt)}
                            </Text>
                          </Group>
                          <Text fw={600} size="xs" truncate mb={2}>
                            {d.subject}
                          </Text>
                          <Text size="xs" c="dimmed" lineClamp={2} mb={6}>
                            {d.snippet || 'Empty draft'}
                          </Text>
                          <Group gap={4} wrap="wrap">
                            <LabelTag size="xs" tone="warning" label="Draft" />
                            {d.isCrmLead && (
                              <StatusBadge status="success" size="xs">
                                CRM Lead{d.matchedLeadName ? `: ${d.matchedLeadName}` : ''}
                              </StatusBadge>
                            )}
                            {d.matchedThreadId && (
                              <LabelTag size="xs" tone="info" label="Thread Matched" />
                            )}
                            <LabelTag size="xs" tone="neutral" label={d.senderEmail.split('@')[0]} />
                          </Group>
                        </Box>
                      );
                    })}
                  </Box>
                );
              })()
            )
          ) : loadingThreads ? (
            <Flex justify="center" align="center" h={200}>
              <Loader size="sm" />
            </Flex>
          ) : threads.length === 0 ? (
            <Flex direction="column" justify="center" align="center" p="xl" h={200}>
              <Text size="sm" c="dimmed" ta="center">
                No conversations found in this stream.
              </Text>
            </Flex>
          ) : (
            <Box>
              {threads.map((t) => {
                const isSelected = selectedThreadId === t.id;
                const isChecked = checkedThreadIds.includes(t.id);
                return (
                  <Box
                    key={t.id}
                    p="sm"
                    onClick={() => setSelectedThreadId(t.id)}
                    className="group"
                    style={{
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--gds-border-card, var(--mantine-color-gray-2))',
                      borderLeft: !t.isRead
                        ? '4px solid var(--gds-vibe-primary, var(--mantine-color-indigo-6))'
                        : isSelected
                        ? '4px solid var(--mantine-color-indigo-3)'
                        : '4px solid transparent',
                      backgroundColor: isSelected
                        ? 'color-mix(in srgb, var(--gds-vibe-primary, var(--mantine-color-indigo-6)) 8%, var(--gds-bg-card, var(--mantine-color-white)))'
                        : t.isRead
                        ? 'var(--gds-bg-card, var(--mantine-color-white))'
                        : 'var(--gds-bg-surface, var(--mantine-color-gray-0))',
                      transition: 'background-color 150ms ease, border-color 150ms ease',
                    }}
                  >
                    {/* Header Row: Checkbox + Sender / Title + Timestamp + Hover Quick Actions */}
                    <Group justify="space-between" align="flex-start" wrap="nowrap" mb={2}>
                      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                        <Checkbox
                          size="xs"
                          checked={isChecked}
                          onChange={() => {}}
                          onClick={(e) => handleToggleThreadCheck(t.id, e)}
                          aria-label={`Select thread ${t.subject}`}
                        />
                        {!t.isRead && (
                          <Box
                            w={8}
                            h={8}
                            style={{
                              backgroundColor: 'var(--gds-vibe-primary, var(--mantine-color-indigo-6))',
                              borderRadius: '50%',
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <Text fw={t.isRead ? 600 : 700} size="sm" truncate>
                          {t.senderDisplayName || t.contactName || (t.hasLead ? t.leadName : (t.senderEmail || t.contactEmail || t.leadName))}
                        </Text>
                        {t.hasLead && t.leadName && t.senderDisplayName && t.leadName !== t.senderDisplayName && (
                          <LabelTag
                            tone="neutral"
                            size="xs"
                            label={t.leadName}
                            style={{ maxWidth: 120 }}
                          />
                        )}
                      </Group>
                      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                        {/* Hover Quick Action Strip */}
                        <Group gap={2} wrap="nowrap" className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <Tooltip label={t.isRead ? 'Mark as unread' : 'Mark as read'}>
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              color="gray"
                              onClick={(e) => handleToggleRead(t.id, t.isRead, e)}
                              aria-label={t.isRead ? 'Mark as unread' : 'Mark as read'}
                            >
                              {t.isRead ? <IconMail size={13} /> : <IconMailOpened size={13} />}
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={t.isArchived ? 'Unarchive' : 'Archive'}>
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              color="gray"
                              onClick={(e) => handleToggleArchive(t.id, t.isArchived, e)}
                              aria-label={t.isArchived ? 'Unarchive thread' : 'Archive thread'}
                            >
                              <IconArchive size={13} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                        <Text size="xs" c="dimmed">
                          {formatRelativeTime(t.lastMessageAt)}
                        </Text>
                      </Group>
                    </Group>

                    {/* Subject Line */}
                    <Text fw={t.isRead ? 500 : 700} size="xs" c={t.isRead ? 'dark.4' : 'dark'} truncate mb={2}>
                      {t.subject}
                    </Text>

                    {/* First 2 Lines Snippet */}
                    <Text size="xs" c="dimmed" lineClamp={2} mb={6} style={{ lineHeight: 1.4 }}>
                      {t.snippet || 'No preview text'}
                    </Text>

                    {/* Availability Indicators & Actions Row */}
                    <Group justify="space-between" align="center" mt={2} wrap="nowrap">
                      <Group gap={4} wrap="wrap">
                        {/* CRM Lead Match Indicator */}
                        <Tooltip
                          label={
                            t.hasLead || t.isCrmLead
                              ? `CRM Lead: ${t.leadName}`
                              : 'Connected mailbox email (not yet in CRM)'
                          }
                        >
                          <Box component="span">
                            {t.hasLead || t.isCrmLead ? (
                              <StatusBadge status="success" size="xs">
                                CRM Lead
                              </StatusBadge>
                            ) : (
                              <LabelTag
                                tone="neutral"
                                size="xs"
                                label="No Lead"
                                style={{ borderStyle: 'dashed', opacity: 0.65 }}
                              />
                            )}
                          </Box>
                        </Tooltip>

                        {/* Contact Availability Indicator */}
                        <Tooltip label={t.hasContact ? `Contact: ${t.contactName || t.contactEmail || 'Available'}` : 'No contact identified'}>
                          <Box component="span">
                            {t.hasContact ? (
                              <StatusBadge status="info" size="xs">
                                Contact
                              </StatusBadge>
                            ) : (
                              <LabelTag
                                tone="neutral"
                                size="xs"
                                label="No Contact"
                                style={{ borderStyle: 'dashed', opacity: 0.65 }}
                              />
                            )}
                          </Box>
                        </Tooltip>

                        {/* Deal Availability Indicator */}
                        <Tooltip label={t.hasDeal ? `Deal: ${t.dealValue ? `$${t.dealValue.toLocaleString()}` : 'In Pipeline'}` : 'No deal in pipeline'}>
                          <Box component="span">
                            {t.hasDeal ? (
                              <LabelTag
                                tone="success"
                                size="xs"
                                label={t.dealValue ? `$${t.dealValue.toLocaleString()}` : 'Deal'}
                              />
                            ) : (
                              <LabelTag
                                tone="neutral"
                                size="xs"
                                label="No Deal"
                                style={{ borderStyle: 'dashed', opacity: 0.65 }}
                              />
                            )}
                          </Box>
                        </Tooltip>

                        {!hideNeedsReply && t.needsReply && (
                          <StatusBadge status="warning" withIcon size="xs">
                            Reply Needed
                          </StatusBadge>
                        )}
                        {t.messageCount > 1 && (
                          <CountBadge value={t.messageCount} size="xs" srLabel="Message count" />
                        )}
                        {t.userMailbox && (
                          <Tooltip label={`Synced from ${t.userMailbox}`}>
                            <Box component="span">
                              <LabelTag
                                tone="neutral"
                                size="xs"
                                label={t.userMailbox.split('@')[0]}
                                style={{ opacity: 0.75 }}
                              />
                            </Box>
                          </Tooltip>
                        )}
                      </Group>

                      <Group gap={4}>
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color={t.isStarred ? 'yellow' : 'gray'}
                          onClick={(e) => handleToggleStar(t.id, t.isStarred, e)}
                          aria-label={t.isStarred ? 'Unstar thread' : 'Star thread'}
                        >
                          {t.isStarred ? <IconStarFilled size={14} /> : <IconStar size={14} />}
                        </ActionIcon>
                      </Group>
                    </Group>
                  </Box>
                );
              })}
            </Box>
          )}
        </ScrollArea>
      </Box>

      {/* ---------------- PANE 3: Conversation Reader & Composer ---------------- */}
      <Box style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {stream === 'drafts' ? (
          !activeDraft ? (
            <Flex direction="column" justify="center" align="center" h="100%" p="xl">
              <IconFileText size={48} color="var(--mantine-color-gray-5)" stroke={1.5} />
              <Text size="md" fw={600} c="dimmed" mt="sm">
                {draftSuccess ? 'Draft Sent!' : 'No draft selected'}
              </Text>
              <Text size="xs" c="dimmed" ta="center" mt={4}>
                {draftSuccess || 'Select a Gmail draft (including meeting-assistant follow-ups) to review, edit, or send via Google.'}
              </Text>
            </Flex>
          ) : (
            <ScrollArea style={{ flex: 1 }} p="md">
              <Stack gap="md">
                {draftSuccess && (
                  <InlineAlert
                    severity="success"
                    title="Sent via Google"
                    message={draftSuccess}
                    action={
                      <Button size="compact-xs" variant="subtle" color="teal" onClick={() => setDraftSuccess(null)}>
                        Dismiss
                      </Button>
                    }
                  />
                )}
                {draftError && (
                  <InlineAlert
                    severity="error"
                    title="Could not send draft"
                    message={draftError}
                    action={
                      <Button size="compact-xs" variant="subtle" color="red" onClick={() => setDraftError(null)}>
                        Dismiss
                      </Button>
                    }
                  />
                )}

                <Paper withBorder p="md" radius="md">
                  <Group justify="space-between" align="flex-start" wrap="wrap" mb="xs">
                    <div>
                      <Group gap="xs" align="center">
                        <Title order={4} style={{ margin: 0 }}>
                          Review Gmail Draft
                        </Title>
                        <LabelTag size="xs" tone="warning" label="Unsent Gmail Draft" />
                        {activeDraft.isCrmLead && (
                          <StatusBadge status="success" size="xs">
                            CRM Lead
                          </StatusBadge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed" mt={2}>
                        Send unchanged, edit before sending through Google, or leave unsent in Gmail Drafts.
                      </Text>
                    </div>
                    <Group gap="xs">
                      {activeDraft.matchedLeadId && (
                        <Button
                          component={Link}
                          href={`/sales/${brand}?leadId=${encodeURIComponent(activeDraft.matchedLeadId)}`}
                          size="compact-xs"
                          variant="light"
                          color="teal"
                          rightSection={<IconExternalLink size={12} />}
                        >
                          Lead: {activeDraft.matchedLeadName || 'Open'}
                        </Button>
                      )}
                      {activeDraft.matchedThreadId && (
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="indigo"
                          onClick={() => {
                            setStream('all');
                            setSelectedThreadId(activeDraft.matchedThreadId!);
                          }}
                        >
                          Open Matched Thread
                        </Button>
                      )}
                    </Group>
                  </Group>

                  <Stack gap="xs" mt="sm">
                    <Group grow>
                      {senderIdentities.length > 0 ? (
                        <Select
                          size="xs"
                          label="Sender (Google Account / Alias)"
                          data={senderIdentities.map((s) => ({ value: s.value, label: s.label }))}
                          value={draftSenderEmail || activeDraft.senderEmail}
                          onChange={(val) => {
                            if (!val) return;
                            setDraftSenderEmail(val);
                            setDraftEdited(val !== activeDraft.senderEmail || draftEdited);
                            const chosen = senderIdentities.find((o) => o.value === val);
                            if (chosen) setUserSignatureText(chosen.signatureText);
                          }}
                          allowDeselect={false}
                        />
                      ) : (
                        <TextInput size="xs" label="Sender" value={activeDraft.senderEmail} readOnly />
                      )}
                      <TextInput
                        size="xs"
                        label="To"
                        placeholder="recipient@company.com"
                        value={draftTo}
                        onChange={(e) => {
                          setDraftTo(e.currentTarget.value);
                          setDraftEdited(true);
                        }}
                      />
                    </Group>

                    <Group grow>
                      <TextInput
                        size="xs"
                        label="Cc (optional)"
                        placeholder="colleague@company.com"
                        value={draftCc}
                        onChange={(e) => {
                          setDraftCc(e.currentTarget.value);
                          setDraftEdited(true);
                        }}
                      />
                      <TextInput
                        size="xs"
                        label="Subject"
                        value={draftSubject}
                        onChange={(e) => {
                          setDraftSubject(e.currentTarget.value);
                          setDraftEdited(true);
                        }}
                      />
                    </Group>

                    <Textarea
                      label="Follow-up Message"
                      minRows={10}
                      maxRows={22}
                      autosize
                      value={draftBody}
                      onChange={(e) => {
                        setDraftBody(e.currentTarget.value);
                        setDraftEdited(true);
                      }}
                    />

                    {includeSignature && userSignatureText && (
                      <Paper p="xs" radius="sm" withBorder style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                        <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={2}>
                          Gmail Signature Appended on Send (if not already in draft)
                        </Text>
                        <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                          -- {'\n'}
                          {userSignatureText}
                        </Text>
                      </Paper>
                    )}

                    <Group justify="space-between" align="center" mt="xs" wrap="wrap">
                      <Group gap="sm">
                        <Switch
                          label="Include Gmail Signature"
                          size="xs"
                          checked={includeSignature}
                          onChange={(e) => setIncludeSignature(e.currentTarget.checked)}
                        />
                        {draftEdited && (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            color="gray"
                            onClick={() => {
                              setDraftTo(activeDraft.to.join(', '));
                              setDraftCc(activeDraft.cc.join(', '));
                              setDraftSubject(activeDraft.subject === '(No subject)' ? '' : activeDraft.subject);
                              setDraftBody(activeDraft.bodyText);
                              setDraftSenderEmail(activeDraft.senderEmail);
                              setDraftEdited(false);
                            }}
                          >
                            Reset Edits
                          </Button>
                        )}
                      </Group>

                      <Group gap="xs">
                        {!draftEdited && (
                          <Button
                            size="xs"
                            color="teal"
                            leftSection={<IconSend size={14} />}
                            loading={sendingDraft}
                            disabled={!draftTo.trim() || !draftBody.trim()}
                            onClick={() => handleSendDraft(true)}
                          >
                            Send Unchanged
                          </Button>
                        )}
                        <Button
                          size="xs"
                          color="indigo"
                          variant={draftEdited ? 'filled' : 'light'}
                          leftSection={<IconSend size={14} />}
                          loading={sendingDraft}
                          disabled={!draftTo.trim() || !draftSubject.trim() || !draftBody.trim()}
                          onClick={() => handleSendDraft(false)}
                        >
                          {draftEdited ? 'Send Edited Draft' : 'Send with Signature'}
                        </Button>
                      </Group>
                    </Group>
                  </Stack>
                </Paper>
              </Stack>
            </ScrollArea>
          )
        ) : !selectedThread ? (
          <Flex direction="column" justify="center" align="center" h="100%" p="xl">
            <IconInbox size={48} color="var(--mantine-color-gray-5)" stroke={1.5} />
            <Text size="md" fw={600} c="dimmed" mt="sm">
              No conversation selected
            </Text>
            <Text size="xs" c="dimmed">
              Choose a thread from the list to view its message history, internal notes, or reply.
            </Text>
          </Flex>
        ) : (
          <>
            {/* Thread Header */}
            <Paper p="md" radius={0} style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
              <Group justify="space-between" align="flex-start">
                <Box style={{ flex: 1, minWidth: 0 }}>
                  {/* Row 1: Subject / Title */}
                  <Text fw={700} size="md" truncate mb={4}>
                    {selectedThread.subject || 'No Subject'}
                  </Text>

                  {/* Row 2: 3 Availability Status Badges with 1-Click Conversion Affordances */}
                  <Group gap="xs" align="center" wrap="wrap" mb={6}>
                    {/* Lead Status & Action */}
                    {selectedThread.hasLead ? (
                      <Group gap={4} wrap="nowrap">
                        <StatusBadge status="success" size="sm">
                          Lead: {selectedThread.leadName}
                        </StatusBadge>
                        <Tooltip label="Open Lead in Pipeline">
                          <ActionIcon
                            component={Link}
                            href={`/sales/${brand}?leadId=${selectedThread.leadId}`}
                            variant="subtle"
                            size="sm"
                            color="teal"
                          >
                            <IconExternalLink size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    ) : (
                      <Button
                        size="compact-xs"
                        variant="filled"
                        color="indigo"
                        leftSection={<IconBuilding size={13} />}
                        onClick={() => {
                          setConvertModalMode('convert');
                          setTargetContact(undefined);
                          setConvertModalOpened(true);
                        }}
                      >
                        + Create Lead
                      </Button>
                    )}

                    {/* Contact Status & Action */}
                    {selectedThread.hasContact ? (
                      <StatusBadge status="info" size="sm">
                        Contact: {selectedThread.contactName || selectedThread.contactEmail || 'Identified'}
                      </StatusBadge>
                    ) : (
                      <Button
                        size="compact-xs"
                        variant="light"
                        color="blue"
                        leftSection={<IconUserPlus size={13} />}
                        onClick={() => {
                          setConvertModalMode(selectedThread.hasLead ? 'add_contact' : 'convert');
                          setTargetContact(undefined);
                          setConvertModalOpened(true);
                        }}
                      >
                        + Add Contact
                      </Button>
                    )}

                    {/* Deal Status & Action */}
                    {selectedThread.hasDeal ? (
                      <LabelTag
                        tone="success"
                        size="sm"
                        label={`Deal: ${selectedThread.dealValue ? `$${selectedThread.dealValue.toLocaleString()}` : 'In Pipeline'}`}
                      />
                    ) : (
                      <Button
                        size="compact-xs"
                        variant="light"
                        color="grape"
                        leftSection={<IconCurrencyDollar size={13} />}
                        onClick={() => {
                          setConvertModalMode(selectedThread.hasLead ? 'add_deal' : 'convert');
                          setTargetContact(undefined);
                          setConvertModalOpened(true);
                        }}
                      >
                        + Add Deal
                      </Button>
                    )}

                    {selectedThread.leadStage && (
                      <LabelTag
                        tone="neutral"
                        size="sm"
                        label={selectedThread.leadStage}
                      />
                    )}

                    {selectedThread.userMailbox && (
                      <Tooltip label={`Synced from connected mailbox: ${selectedThread.userMailbox}`}>
                        <Box component="span">
                          <LabelTag
                            tone="neutral"
                            size="sm"
                            label={`Mailbox: ${selectedThread.userMailbox}`}
                          />
                        </Box>
                      </Tooltip>
                    )}
                  </Group>

                  {/* Row 3: Counterparty Context */}
                  <Group gap="xs" mt={2} align="center">
                    <Text size="xs" fw={600} c="gray.8">
                      Counterparty:
                    </Text>
                    <Text size="xs" c="dark.3">
                      {selectedThread.senderDisplayName || selectedThread.contactName || 'External Prospect'}
                    </Text>
                    {(selectedThread.contactEmail || selectedThread.senderEmail) && (
                      <Text size="xs" c="indigo.7">
                        &lt;{selectedThread.contactEmail || selectedThread.senderEmail}&gt;
                      </Text>
                    )}
                  </Group>

                  {/* Thread Participants Strip (Contacts from emails) */}
                  {selectedThread.participants && selectedThread.participants.length > 0 && (
                    <Box mt="xs" pt="xs" style={{ borderTop: '1px dashed var(--mantine-color-gray-3)' }}>
                      <Group gap={6} align="center" mb={4}>
                        <IconUsers size={13} color="var(--mantine-color-indigo-6)" />
                        <Text size="11px" fw={700} c="dimmed">
                          Contacts from emails ({selectedThread.participants.length}):
                        </Text>
                      </Group>
                      <Group gap="xs" wrap="wrap">
                        {selectedThread.participants.map((p) => {
                          const isOnLead = Boolean(
                            lead?.contacts?.some(
                              (c: any) =>
                                (c?.email && c.email.toLowerCase() === p.email.toLowerCase()) ||
                                (c?.secondaryEmail && c.secondaryEmail.toLowerCase() === p.email.toLowerCase())
                            )
                          );
                          const isExisting = Boolean(p.isExistingContact || isOnLead || p.existingLeadId);
                          const targetLeadId = (p.existingLeadId || (isOnLead ? (lead?._id || lead?.id) : undefined))?.toString();
                          const targetLeadName = p.existingLeadName || (isOnLead ? (lead?.entity_name || lead?.name) : undefined);

                          return (
                            <Paper
                              key={p.email}
                              p="4px 8px"
                              radius="sm"
                              withBorder
                              style={{
                                backgroundColor: isExisting
                                  ? 'var(--mantine-color-teal-0)'
                                  : 'var(--mantine-color-gray-0)',
                                borderColor: isExisting
                                  ? 'var(--mantine-color-teal-3)'
                                  : 'var(--mantine-color-gray-3)',
                              }}
                            >
                              <Group gap={6} wrap="nowrap">
                                <Avatar size={18} radius="xl" color={isExisting ? 'teal' : 'indigo'}>
                                  {p.name ? p.name.charAt(0).toUpperCase() : p.email.charAt(0).toUpperCase()}
                                </Avatar>
                                <Box>
                                  <Group gap={4} align="center" wrap="nowrap">
                                    <Text size="11px" fw={600} style={{ lineHeight: 1.1 }}>
                                      {p.name || p.email}
                                    </Text>
                                    {isExisting && targetLeadName && (
                                      <StatusBadge status="success" size="xs">
                                        {targetLeadName}
                                      </StatusBadge>
                                    )}
                                  </Group>
                                  <Text size="10px" c="dimmed" style={{ lineHeight: 1.1 }}>
                                    {p.email} {p.title ? `• ${p.title}` : ''}
                                  </Text>
                                </Box>
                                {isExisting ? (
                                  <Group gap={4} wrap="nowrap">
                                    {targetLeadId && (
                                      <Button
                                        component="a"
                                        href={`/sales/${brand}?leadId=${encodeURIComponent(targetLeadId)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        size="compact-xs"
                                        variant="light"
                                        color="teal"
                                        leftSection={<IconExternalLink size={11} />}
                                        title={`Open ${targetLeadName || 'contact'} in sales pipeline`}
                                      >
                                        Open
                                      </Button>
                                    )}
                                    <Button
                                      size="compact-xs"
                                      variant="subtle"
                                      color="gray"
                                      onClick={() => {
                                        setTargetContact({
                                          name: p.name,
                                          email: p.email,
                                          title: p.title,
                                          phone: p.phone,
                                        });
                                        setConvertModalMode('add_contact');
                                        setConvertModalOpened(true);
                                      }}
                                      title="Create separate lead for this contact"
                                    >
                                      Separate Lead
                                    </Button>
                                  </Group>
                                ) : (
                                  <Button
                                    size="compact-xs"
                                    variant="light"
                                    color="indigo"
                                    onClick={() => {
                                      setTargetContact({
                                        name: p.name,
                                        email: p.email,
                                        title: p.title,
                                        phone: p.phone,
                                      });
                                      setConvertModalMode(selectedThread.hasLead ? 'add_contact' : 'convert');
                                      setConvertModalOpened(true);
                                    }}
                                  >
                                    {selectedThread.hasLead ? '+ Contact' : 'Convert'}
                                  </Button>
                                )}
                              </Group>
                            </Paper>
                          );
                        })}
                      </Group>
                    </Box>
                  )}
                </Box>

                <Group gap="xs">
                  <Tooltip label={selectedThread.isStarred ? 'Unstar' : 'Star'}>
                    <ActionIcon
                      variant="light"
                      color={selectedThread.isStarred ? 'yellow' : 'gray'}
                      onClick={() => handleToggleStar(selectedThread.id, selectedThread.isStarred)}
                    >
                      {selectedThread.isStarred ? <IconStarFilled size={16} /> : <IconStar size={16} />}
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip label={selectedThread.isRead ? 'Mark as Unread' : 'Mark as Read'}>
                    <ActionIcon
                      variant="light"
                      color="gray"
                      onClick={() => handleToggleRead(selectedThread.id, selectedThread.isRead)}
                    >
                      <IconMail size={16} />
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip label={selectedThread.isArchived ? 'Move to Active' : 'Archive Thread'}>
                    <ActionIcon
                      variant="light"
                      color="gray"
                      onClick={() => handleToggleArchive(selectedThread.id, selectedThread.isArchived)}
                    >
                      <IconArchive size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            </Paper>

            {/* Messages Timeline */}
            {(() => {
              const threadMatchingDraft = gmailDrafts.find(
                (d) =>
                  (d.threadId && d.threadId === selectedThread.id) ||
                  (selectedThread.contactEmail &&
                    d.to.some((addr) => addr.toLowerCase() === selectedThread.contactEmail?.toLowerCase()))
              );
              if (!threadMatchingDraft) return null;
              return (
                <Paper
                  px="md"
                  py="xs"
                  radius={0}
                  style={{
                    backgroundColor: 'var(--mantine-color-teal-0)',
                    borderBottom: '1px solid var(--mantine-color-teal-3)',
                  }}
                >
                  <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                    <Group gap="xs">
                      <IconFileText size={16} color="var(--mantine-color-teal-7)" />
                      <Text size="xs" fw={600}>
                        Gmail Follow-Up Draft Ready: &ldquo;{threadMatchingDraft.subject}&rdquo;
                      </Text>
                    </Group>
                    <Group gap="xs">
                      <Button
                        size="compact-xs"
                        variant="light"
                        color="teal"
                        onClick={() => {
                          setReplyMode('email');
                          setReplySubject(threadMatchingDraft.subject);
                          setReplyBody(threadMatchingDraft.bodyText);
                          if (threadMatchingDraft.to[0]) setReplyRecipient(threadMatchingDraft.to[0]);
                        }}
                      >
                        Load into Reply
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="filled"
                        color="teal"
                        onClick={() => {
                          setSelectedDraftId(threadMatchingDraft.draftId);
                          setStream('drafts');
                        }}
                      >
                        Review &amp; Send Draft
                      </Button>
                    </Group>
                  </Group>
                </Paper>
              );
            })()}
            <ScrollArea style={{ flex: 1 }} p="md">
              {loadingDetail ? (
                <Flex justify="center" align="center" h={200}>
                  <Loader size="sm" />
                </Flex>
              ) : (
                <Stack gap="md">
                  {messages.map((m) => {
                    const isInbound = m.type === 'email-inbound';
                    const isOutbound = m.type === 'email-outbound';
                    const isNote = m.type === 'note';
                    const isCall = m.type === 'call';
                    const isSystem = m.type === 'system' || m.type === 'meeting-scheduled';

                    return (
                      <Paper
                        key={m.id}
                        p="sm"
                        radius="md"
                        withBorder
                        style={{
                          backgroundColor: isNote
                            ? 'var(--mantine-color-yellow-0)'
                            : isInbound
                            ? 'var(--mantine-color-gray-0)'
                            : isCall
                            ? 'var(--mantine-color-grape-0)'
                            : 'white',
                          borderColor: isNote
                            ? 'var(--mantine-color-yellow-5)'
                            : isInbound
                            ? 'var(--mantine-color-gray-3)'
                            : isCall
                            ? 'var(--mantine-color-grape-3)'
                            : 'var(--mantine-color-gray-4)',
                        }}
                      >
                        <Group justify="space-between" align="center" mb="xs">
                          <Group gap="xs">
                            <Avatar
                              size="sm"
                              radius="xl"
                              color={isNote ? 'yellow' : isInbound ? 'teal' : isCall ? 'grape' : 'indigo'}
                            >
                              {isNote ? (
                                <IconNote size={14} />
                              ) : isCall ? (
                                <IconPhone size={14} />
                              ) : isSystem ? (
                                <IconCalendar size={14} />
                              ) : (
                                <IconUser size={14} />
                              )}
                            </Avatar>
                            <Box style={{ minWidth: 0, flex: 1 }}>
                              <Group gap="xs" wrap="wrap" align="center">
                                <Text size="xs" fw={700}>
                                  {isNote
                                    ? `Internal Team Note (${m.loggedBy || 'Sales Rep'})`
                                    : isCall
                                    ? `Call Logged by ${m.loggedBy || 'Rep'}`
                                    : m.from || (isOutbound ? 'Outreach Dispatch' : 'Prospect')}
                                </Text>
                                {!isNote && !isCall && m.from && (
                                  <Text size="11px" c="dimmed">
                                    &lt;{m.from}&gt;
                                  </Text>
                                )}
                              </Group>

                              {/* Prominently render TO recipient addresses */}
                              {m.to && m.to.length > 0 && (
                                <Group gap={4} wrap="wrap" align="baseline" mt={2}>
                                  <Text size="11px" fw={700} c="gray.7">
                                    To:
                                  </Text>
                                  <Text size="11px" c="dark.3" style={{ wordBreak: 'break-all' }}>
                                    {m.to.join(', ')}
                                  </Text>
                                </Group>
                              )}

                              {/* Prominently render CC recipient addresses */}
                              {m.cc && m.cc.length > 0 && (
                                <Group gap={4} wrap="wrap" align="baseline" mt={1}>
                                  <Text size="11px" fw={700} c="gray.7">
                                    Cc:
                                  </Text>
                                  <Text size="11px" c="dark.3" style={{ wordBreak: 'break-all' }}>
                                    {m.cc.join(', ')}
                                  </Text>
                                </Group>
                              )}
                            </Box>
                          </Group>

                          <Group gap="xs">
                            {isNote && (
                              <LabelTag size="xs" tone="warning" label="Private Note" />
                            )}
                            {isInbound && (
                              <StatusBadge status="success" size="xs">
                                Inbound Email
                              </StatusBadge>
                            )}
                            {isOutbound && (
                              <LabelTag size="xs" tone="info" label="Outbound Email" />
                            )}
                            {isCall && m.callDisposition && (
                              <LabelTag size="xs" tone="neutral" label={m.callDisposition} />
                            )}
                            <Text size="xs" c="dimmed">
                              {formatFullTime(m.createdAt)}
                            </Text>
                          </Group>
                        </Group>

                        {m.subject && (
                          <Text size="xs" fw={600} mb="xs">
                            {m.subject}
                          </Text>
                        )}

                        <Text
                          size="sm"
                          style={{
                            whiteSpace: 'pre-wrap',
                            lineHeight: 1.5,
                            wordBreak: 'break-word',
                          }}
                        >
                          {m.body}
                        </Text>

                        {/* Attachment Pills & Download Links (Issue 272) */}
                        {m.attachments && m.attachments.length > 0 && (
                          <Group gap="xs" mt="sm" wrap="wrap">
                            {m.attachments.map((att, idx) => {
                              const sizeLabel =
                                typeof att.size === 'number' && att.size > 0
                                  ? ` (${Math.max(1, Math.round(att.size / 1024))} KB)`
                                  : '';
                              const downloadHref = att.documentId
                                ? `/api/inbox/${brand}/attachments?documentId=${encodeURIComponent(att.documentId)}&filename=${encodeURIComponent(att.filename)}`
                                : att.attachmentId && (att.gmailMessageId || m.gmailMessageId)
                                ? `/api/inbox/${brand}/attachments?messageId=${encodeURIComponent(att.gmailMessageId || m.gmailMessageId || '')}&attachmentId=${encodeURIComponent(att.attachmentId)}&filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType)}`
                                : undefined;

                              return (
                                <Button
                                  key={`${att.filename}-${idx}`}
                                  component={downloadHref ? 'a' : 'button'}
                                  href={downloadHref}
                                  target={downloadHref ? '_blank' : undefined}
                                  rel={downloadHref ? 'noopener noreferrer' : undefined}
                                  size="compact-xs"
                                  variant="default"
                                  leftSection={<IconPaperclip size={12} />}
                                  rightSection={downloadHref ? <IconDownload size={12} /> : undefined}
                                >
                                  {att.filename}
                                  {sizeLabel}
                                </Button>
                              );
                            })}
                          </Group>
                        )}
                      </Paper>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </Stack>
              )}
            </ScrollArea>

            {/* Quick Composer */}
            <Paper p="sm" radius={0} style={{ borderTop: '1px solid var(--mantine-color-gray-3)', backgroundColor: 'white' }}>
              {replyError && (
                <Box mb="xs">
                  <InlineAlert
                    severity="error"
                    title="Dispatch Error"
                    message={replyError}
                    action={
                      <Button size="compact-xs" variant="subtle" color="red" onClick={() => setReplyError(null)}>
                        Dismiss
                      </Button>
                    }
                  />
                </Box>
              )}
              {successNotice && (
                <Box mb="xs">
                  <InlineAlert
                    severity="success"
                    title="Success"
                    message={successNotice}
                    action={
                      <Button size="compact-xs" variant="subtle" color="teal" onClick={() => setSuccessNotice(null)}>
                        Dismiss
                      </Button>
                    }
                  />
                </Box>
              )}

              <Group justify="space-between" mb="xs">
                <SegmentedControl
                  size="xs"
                  value={replyMode}
                  onChange={(val: any) => setReplyMode(val)}
                  data={[
                    { label: 'Reply via Email', value: 'email' },
                    { label: 'Internal Note', value: 'note' },
                  ]}
                />

                {replyMode === 'email' && templates.length > 0 && (
                  <Select
                    placeholder="Insert template..."
                    size="xs"
                    w={220}
                    data={templates.map((t) => ({ value: t.id, label: t.name }))}
                    onChange={(tplId) => {
                      if (!tplId) return;
                      const matched = templates.find((t) => t.id === tplId);
                      if (matched) {
                        setReplyBody(matched.body);
                        if (matched.subject && !replySubject) {
                          setReplySubject(matched.subject);
                        }
                      }
                    }}
                    clearable
                  />
                )}
              </Group>

              {replyMode === 'email' && (
                <Stack gap="xs" mb="xs">
                  <Group grow>
                    {senderIdentities.length > 0 && (
                      <Select
                        size="xs"
                        label="From (Gmail Identity)"
                        data={senderIdentities.map((s) => ({ value: s.value, label: s.label }))}
                        value={selectedSenderEmail}
                        onChange={(val) => {
                          if (!val) return;
                          setSelectedSenderEmail(val);
                          const chosen = senderIdentities.find((o) => o.value === val);
                          if (chosen) {
                            setUserSignatureText(chosen.signatureText);
                          }
                        }}
                        allowDeselect={false}
                      />
                    )}
                    <TextInput
                      size="xs"
                      label="To"
                      placeholder="recipient@example.com"
                      value={replyRecipient}
                      onChange={(e) => setReplyRecipient(e.currentTarget.value)}
                    />
                    <TextInput
                      size="xs"
                      label="Subject"
                      value={replySubject}
                      onChange={(e) => setReplySubject(e.currentTarget.value)}
                    />
                  </Group>

                  {documents.length > 0 && (
                    <MultiSelect
                      size="xs"
                      label="Attach Documents"
                      placeholder="Select documents from library..."
                      leftSection={<IconPaperclip size={14} />}
                      data={documents.map((d) => ({ value: d.id, label: d.displayName }))}
                      value={replyDocumentIds}
                      onChange={setReplyDocumentIds}
                      clearable
                      searchable
                    />
                  )}
                </Stack>
              )}

              {/* Formatting Toolbar (Issue 272) */}
              <Group gap={4} mb={6}>
                <Tooltip label="Bold (**text**)">
                  <ActionIcon
                    size="xs"
                    variant="default"
                    onClick={() => handleApplyFormat('bold')}
                    aria-label="Format bold"
                  >
                    <IconBold size={13} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Italic (_text_)">
                  <ActionIcon
                    size="xs"
                    variant="default"
                    onClick={() => handleApplyFormat('italic')}
                    aria-label="Format italic"
                  >
                    <IconItalic size={13} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Bulleted list (- item)">
                  <ActionIcon
                    size="xs"
                    variant="default"
                    onClick={() => handleApplyFormat('list')}
                    aria-label="Format bulleted list"
                  >
                    <IconList size={13} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Insert link">
                  <ActionIcon
                    size="xs"
                    variant="default"
                    onClick={() => handleApplyFormat('link')}
                    aria-label="Insert link"
                  >
                    <IconLink size={13} />
                  </ActionIcon>
                </Tooltip>
              </Group>

              <Textarea
                ref={replyTextareaRef}
                placeholder={
                  replyMode === 'email'
                    ? 'Write your email reply to the client...'
                    : 'Log an internal note visible only to your team...'
                }
                minRows={3}
                maxRows={8}
                autosize
                value={replyBody}
                onChange={(e) => setReplyBody(e.currentTarget.value)}
                mb="xs"
              />

              {replyMode === 'email' && includeSignature && userSignatureText && (
                <Collapse expanded={showSignaturePreview}>
                  <Paper
                    p="xs"
                    mb="xs"
                    radius="sm"
                    withBorder
                    style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}
                  >
                    <Text size="10px" fw={700} c="dimmed" tt="uppercase" mb={2}>
                      Synced Gmail Signature Preview
                    </Text>
                    <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                      -- {'\n'}
                      {userSignatureText}
                    </Text>
                  </Paper>
                </Collapse>
              )}

              <Group justify="space-between" align="center">
                {replyMode === 'email' ? (
                  <Group gap="sm">
                    <Switch
                      label="Include Email Signature"
                      size="xs"
                      checked={includeSignature}
                      onChange={(e) => setIncludeSignature(e.currentTarget.checked)}
                    />
                    {senderIdentities.length > 0 && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="gray"
                        loading={syncingSignature}
                        leftSection={<IconRefresh size={12} />}
                        onClick={handleRefreshInboxSignature}
                      >
                        Sync Signature
                      </Button>
                    )}
                    {includeSignature && userSignatureText && (
                      <Button
                        size="compact-xs"
                        variant="default"
                        leftSection={<IconEye size={12} />}
                        onClick={() => setShowSignaturePreview((v) => !v)}
                      >
                        {showSignaturePreview ? 'Hide Signature' : 'Preview Signature'}
                      </Button>
                    )}
                  </Group>
                ) : (
                  <Text size="xs" c="dimmed">
                    Notes are stamped with your user email and private to this organization.
                  </Text>
                )}

                <Button
                  size="xs"
                  color={replyMode === 'email' ? 'indigo' : 'yellow'}
                  leftSection={replyMode === 'email' ? <IconSend size={14} /> : <IconNote size={14} />}
                  onClick={handleSendReply}
                  loading={sendingReply}
                  disabled={!replyBody.trim()}
                >
                  {replyMode === 'email' ? 'Send Reply' : 'Add Note'}
                </Button>
              </Group>
            </Paper>
          </>
        )}
      </Box>

      {selectedThread && (
        <ConvertModal
          brand={brand}
          threadId={selectedThread.id}
          leadId={selectedThread.hasLead ? (selectedThread.leadId || undefined) : undefined}
          leadName={
            selectedThread.hasLead && selectedThread.leadName !== 'System Communications'
              ? selectedThread.leadName
              : undefined
          }
          defaultContact={
            targetContact || {
              name: selectedThread.contactName,
              email: selectedThread.contactEmail || '',
            }
          }
          threadParticipants={selectedThread.participants}
          mode={convertModalMode}
          opened={convertModalOpened}
          onClose={() => {
            setConvertModalOpened(false);
            setTargetContact(undefined);
          }}
          onSuccess={(data) => {
            if (data.leadId) {
              if (data.action !== 'create_lead' || !selectedThread.hasLead) {
                setSelectedThread((prev) =>
                  prev
                    ? {
                        ...prev,
                        leadId: data.leadId,
                        leadName: data.lead?.entity_name || prev.leadName,
                        leadStage: data.lead?.kanbanColumn || prev.leadStage,
                        dealValue: data.deal?.value || prev.dealValue,
                        hasLead: true,
                      }
                    : null
                );
                if (data.lead) {
                  setLead(data.lead);
                }
              }
              loadThreads();
              if (selectedThread?.id) {
                fetch(`/api/inbox/${brand}/threads/${encodeURIComponent(selectedThread.id)}`)
                  .then((r) => (r.ok ? r.json() : null))
                  .then((detail) => {
                    if (detail?.thread) {
                      setSelectedThread((prev) =>
                        prev
                          ? {
                              ...detail.thread,
                              participants: detail.thread.participants || detail.participants || [],
                            }
                          : null
                      );
                    }
                    if (detail?.lead) setLead(detail.lead);
                  })
                  .catch(() => {});
              }
            }
          }}
        />
      )}
    </Box>
  );
}

