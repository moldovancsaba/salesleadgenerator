'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Box,
  Flex,
  Stack,
  Group,
  Text,
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
} from '@tabler/icons-react';
import type { Brand } from '@/app/lib/brand-constants';
import type {
  InboxStream,
  InboxThread,
  InboxMessage,
  InboxCounts,
} from '@/app/lib/inbox-store';
import { ConvertModal } from './convert-modal';

type Props = {
  brand: Brand;
  label: string;
  initialStream?: string;
  initialSearch?: string;
  initialThreadId?: string;
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

export function InboxClient({ brand, label, initialStream, initialSearch, initialThreadId }: Props) {
  const [stream, setStream] = useState<InboxStream>(
    initialStream && ['inbox', 'sent', 'needs_reply', 'internal', 'calls', 'system', 'all'].includes(initialStream)
      ? (initialStream as InboxStream)
      : 'inbox'
  );
  const [search, setSearch] = useState(initialSearch || '');
  const [starredOnly, setStarredOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
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
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

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

  // Conversion / Deal modal state
  const [convertModalOpened, setConvertModalOpened] = useState(false);
  const [convertModalMode, setConvertModalMode] = useState<'convert' | 'add_deal' | 'add_contact'>('convert');
  const [targetContact, setTargetContact] = useState<
    { name?: string; email: string; title?: string; phone?: string } | undefined
  >(undefined);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch templates and documents for composer
  useEffect(() => {
    async function loadComposerResources() {
      try {
        const [tplRes, docRes] = await Promise.all([
          fetch(`/api/outreach-templates?brand=${brand}`).then((r) => (r.ok ? r.json() : null)),
          fetch(`/api/documents?brand=${brand}`).then((r) => (r.ok ? r.json() : null)),
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
      } catch {
        // non-fatal
      }
    }
    loadComposerResources();
  }, [brand]);

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
        setSyncNotice(msg);
        loadThreads();
      } else {
        setSyncNotice(data.error || 'Connect Gmail in Email & Integrations to sync correspondence.');
      }
    } catch {
      setSyncNotice('Could not reach server to sync Gmail.');
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

          // Update local unread state in threads list
          setThreads((prev) =>
            prev.map((t) => (t.id === selectedThreadId ? { ...t, isRead: true } : t))
          );
          setCounts((prev) => ({
            ...prev,
            unread: Math.max(0, prev.unread - 1),
          }));

          // Pre-fill composer
          const th = data.thread;
          setReplySubject(th.subject.startsWith('Re: ') ? th.subject : `Re: ${th.subject}`);
          setReplyRecipient(th.contactEmail || '');
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
                onClick={() => loadThreads()}
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
            color="teal"
            variant="light"
            withCloseButton
            onClose={() => setSyncNotice(null)}
            mb="xs"
            p="xs"
          >
            <Text size="xs">{syncNotice}</Text>
          </Alert>
        )}

        <Divider mb="sm" />

        <Stack gap={4} style={{ flex: 1 }}>
          <NavLink
            label="Inbox"
            leftSection={<IconInbox size={18} />}
            rightSection={
              counts.unread > 0 ? (
                <CountBadge size="xs" value={counts.unread} srLabel="Unread messages count" />
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
        </Box>

        <ScrollArea style={{ flex: 1 }}>
          {loadingThreads ? (
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
                return (
                  <Box
                    key={t.id}
                    p="sm"
                    onClick={() => setSelectedThreadId(t.id)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--gds-border-card, var(--mantine-color-gray-2))',
                      backgroundColor: isSelected
                        ? 'color-mix(in srgb, var(--gds-vibe-primary, var(--mantine-color-indigo-6)) 8%, var(--gds-bg-card, var(--mantine-color-white)))'
                        : t.isRead
                        ? 'var(--gds-bg-card, var(--mantine-color-white))'
                        : 'var(--gds-bg-surface, var(--mantine-color-gray-0))',
                      transition: 'background-color 150ms ease',
                    }}
                  >
                    {/* Header Row: Sender / Title + Timestamp */}
                    <Group justify="space-between" align="flex-start" wrap="nowrap" mb={2}>
                      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
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
                      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                        {formatRelativeTime(t.lastMessageAt)}
                      </Text>
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
                        {/* Lead Availability Indicator */}
                        <Tooltip label={t.hasLead ? `Lead: ${t.leadName}` : 'No lead linked'}>
                          <Box component="span">
                            {t.hasLead ? (
                              <StatusBadge status="success" size="xs">
                                Lead
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

                        {t.needsReply && (
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
        {!selectedThread ? (
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

              <Textarea
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

              <Group justify="space-between" align="center">
                {replyMode === 'email' ? (
                  <Switch
                    label="Include Email Signature"
                    size="xs"
                    checked={includeSignature}
                    onChange={(e) => setIncludeSignature(e.currentTarget.checked)}
                  />
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

