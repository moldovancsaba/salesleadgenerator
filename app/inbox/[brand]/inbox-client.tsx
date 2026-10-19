'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Box,
  Flex,
  Stack,
  Group,
  Text,
  Badge,
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
} from '@mantine/core';
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
} from '@tabler/icons-react';
import type { Brand } from '@/app/lib/brand';
import type {
  InboxStream,
  InboxThread,
  InboxMessage,
  InboxCounts,
} from '@/app/lib/inbox-store';

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

  // External options for composer
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; subject: string; body: string }>>([]);
  const [documents, setDocuments] = useState<Array<{ id: string; displayName: string }>>([]);

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

  // Load threads
  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    try {
      const params = new URLSearchParams();
      if (stream) params.set('stream', stream);
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
          setSelectedThread(data.thread);
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
          <Button
            variant={stream === 'inbox' ? 'light' : 'subtle'}
            color="indigo"
            justify="space-between"
            leftSection={<IconInbox size={18} />}
            rightSection={
              counts.unread > 0 ? (
                <Badge size="xs" color="indigo" variant="filled">
                  {counts.unread}
                </Badge>
              ) : counts.inbox > 0 ? (
                <Text size="xs" c="dimmed">
                  {counts.inbox}
                </Text>
              ) : null
            }
            onClick={() => {
              setStream('inbox');
              setArchivedOnly(false);
            }}
            styles={{ inner: { justifyContent: 'space-between' } }}
          >
            Inbox
          </Button>

          <Button
            variant={stream === 'needs_reply' ? 'light' : 'subtle'}
            color="orange"
            justify="space-between"
            leftSection={<IconFlame size={18} />}
            rightSection={
              counts.needs_reply > 0 ? (
                <Badge size="xs" color="orange" variant="filled">
                  {counts.needs_reply}
                </Badge>
              ) : null
            }
            onClick={() => {
              setStream('needs_reply');
              setArchivedOnly(false);
            }}
            styles={{ inner: { justifyContent: 'space-between' } }}
          >
            Needs Reply
          </Button>

          <Button
            variant={stream === 'sent' ? 'light' : 'subtle'}
            color="gray"
            justify="space-between"
            leftSection={<IconSend size={18} />}
            rightSection={
              counts.sent > 0 ? (
                <Text size="xs" c="dimmed">
                  {counts.sent}
                </Text>
              ) : null
            }
            onClick={() => {
              setStream('sent');
              setArchivedOnly(false);
            }}
            styles={{ inner: { justifyContent: 'space-between' } }}
          >
            Sent Outreach
          </Button>

          <Button
            variant={stream === 'internal' ? 'light' : 'subtle'}
            color="yellow"
            justify="space-between"
            leftSection={<IconNote size={18} />}
            rightSection={
              counts.internal > 0 ? (
                <Text size="xs" c="dimmed">
                  {counts.internal}
                </Text>
              ) : null
            }
            onClick={() => {
              setStream('internal');
              setArchivedOnly(false);
            }}
            styles={{ inner: { justifyContent: 'space-between' } }}
          >
            Internal Notes
          </Button>

          <Button
            variant={stream === 'calls' ? 'light' : 'subtle'}
            color="violet"
            justify="space-between"
            leftSection={<IconPhone size={18} />}
            rightSection={
              counts.calls > 0 ? (
                <Text size="xs" c="dimmed">
                  {counts.calls}
                </Text>
              ) : null
            }
            onClick={() => {
              setStream('calls');
              setArchivedOnly(false);
            }}
            styles={{ inner: { justifyContent: 'space-between' } }}
          >
            Call Logs
          </Button>

          <Button
            variant={stream === 'system' ? 'light' : 'subtle'}
            color="cyan"
            justify="space-between"
            leftSection={<IconBell size={18} />}
            rightSection={
              counts.system > 0 ? (
                <Text size="xs" c="dimmed">
                  {counts.system}
                </Text>
              ) : null
            }
            onClick={() => {
              setStream('system');
              setArchivedOnly(false);
            }}
            styles={{ inner: { justifyContent: 'space-between' } }}
          >
            System & Events
          </Button>

          <Button
            variant={stream === 'all' && !archivedOnly ? 'light' : 'subtle'}
            color="gray"
            justify="space-between"
            leftSection={<IconMail size={18} />}
            rightSection={
              counts.all > 0 ? (
                <Text size="xs" c="dimmed">
                  {counts.all}
                </Text>
              ) : null
            }
            onClick={() => {
              setStream('all');
              setArchivedOnly(false);
            }}
            styles={{ inner: { justifyContent: 'space-between' } }}
          >
            All Threads
          </Button>

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

          <Button
            variant={archivedOnly ? 'light' : 'subtle'}
            color="gray"
            justify="flex-start"
            leftSection={<IconArchive size={18} />}
            onClick={() => {
              setArchivedOnly(!archivedOnly);
            }}
          >
            {archivedOnly ? 'Active Inbox' : 'Archived'}
          </Button>
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
                      borderBottom: '1px solid var(--mantine-color-gray-2)',
                      backgroundColor: isSelected ? 'var(--mantine-color-indigo-0)' : t.isRead ? 'white' : 'var(--mantine-color-gray-0)',
                      transition: 'background-color 150ms ease',
                    }}
                  >
                    <Group justify="space-between" align="flex-start" wrap="nowrap" mb={2}>
                      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                        {!t.isRead && (
                          <Box
                            w={8}
                            h={8}
                            style={{
                              backgroundColor: 'var(--mantine-color-blue-6)',
                              borderRadius: '50%',
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <Text fw={t.isRead ? 600 : 700} size="sm" truncate>
                          {t.leadName}
                        </Text>
                      </Group>
                      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                        {formatRelativeTime(t.lastMessageAt)}
                      </Text>
                    </Group>

                    <Text fw={t.isRead ? 400 : 600} size="xs" c={t.isRead ? 'gray.7' : 'dark'} truncate mb={2}>
                      {t.subject}
                    </Text>

                    <Text size="xs" c="dimmed" lineClamp={2} mb={4}>
                      {t.snippet}
                    </Text>

                    <Group justify="space-between" align="center" mt={4}>
                      <Group gap={4}>
                        {t.leadStage && (
                          <Badge size="xs" variant="outline" color="gray">
                            {t.leadStage}
                          </Badge>
                        )}
                        {t.needsReply && (
                          <Badge size="xs" variant="filled" color="orange">
                            Reply Needed
                          </Badge>
                        )}
                        {t.messageCount > 1 && (
                          <Badge size="xs" variant="light" color="indigo">
                            {t.messageCount}
                          </Badge>
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
                <Box>
                  <Group gap="xs" align="center">
                    <Text fw={700} size="md">
                      {selectedThread.leadName}
                    </Text>
                    {selectedThread.leadStage && (
                      <Badge size="sm" variant="light" color="indigo">
                        {selectedThread.leadStage}
                      </Badge>
                    )}
                    {selectedThread.leadId && (
                      <Tooltip label="Open Lead in Pipeline">
                        <ActionIcon
                          component={Link}
                          href={`/sales/${brand}?leadId=${selectedThread.leadId}`}
                          variant="subtle"
                          size="sm"
                          color="indigo"
                        >
                          <IconExternalLink size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>

                  <Group gap="sm" mt={4}>
                    <Text size="xs" c="dimmed">
                      {selectedThread.contactName || 'No designated contact'}
                    </Text>
                    {selectedThread.contactEmail && (
                      <Text size="xs" c="indigo.7">
                        &lt;{selectedThread.contactEmail}&gt;
                      </Text>
                    )}
                  </Group>
                  <Text fw={600} size="sm" mt={6}>
                    {selectedThread.subject}
                  </Text>
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
                            <Box>
                              <Text size="xs" fw={700}>
                                {isNote
                                  ? `Internal Team Note (${m.loggedBy || 'Sales Rep'})`
                                  : isCall
                                  ? `Call Logged by ${m.loggedBy || 'Rep'}`
                                  : m.from || (isOutbound ? 'Outreach Dispatch' : 'Prospect')}
                              </Text>
                              {m.to && m.to.length > 0 && (
                                <Text size="xs" c="dimmed">
                                  To: {m.to.join(', ')}
                                </Text>
                              )}
                            </Box>
                          </Group>

                          <Group gap="xs">
                            {isNote && (
                              <Badge size="xs" color="yellow" variant="filled">
                                Private Note
                              </Badge>
                            )}
                            {isInbound && (
                              <Badge size="xs" color="teal" variant="light">
                                Inbound Email
                              </Badge>
                            )}
                            {isOutbound && (
                              <Badge size="xs" color="indigo" variant="light">
                                Outbound Email
                              </Badge>
                            )}
                            {isCall && m.callDisposition && (
                              <Badge size="xs" color="grape" variant="filled">
                                {m.callDisposition}
                              </Badge>
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
                <Alert color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setReplyError(null)} mb="xs">
                  {replyError}
                </Alert>
              )}
              {successNotice && (
                <Alert color="teal" icon={<IconCheck size={16} />} withCloseButton onClose={() => setSuccessNotice(null)} mb="xs">
                  {successNotice}
                </Alert>
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
    </Box>
  );
}
