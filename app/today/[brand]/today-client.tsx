'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Box,
  Title,
  Text,
  Button,
  Group,
  Stack,
  Paper,
  ActionIcon,
  Modal,
  Loader,
  Menu,
  SegmentedControl,
  Select,
  NumberInput,
  Textarea,
  SimpleGrid,
  Card,
} from '@mantine/core';
import {
  StatusBadge,
  LabelTag,
  CountBadge,
  InlineAlert,
} from '@sovereignsquad/gds-core/client';
import {
  IconCheck,
  IconClock,
  IconCalendar,
  IconPhone,
  IconBrandLinkedin,
  IconListCheck,
  IconAlertTriangle,
  IconRefresh,
  IconArrowRight,
  IconCalendarPlus,
  IconBuilding,
  IconCoins,
  IconUser,
} from '@tabler/icons-react';
import type { Brand } from '@/app/lib/brand';
import type {
  TodayCadenceTask,
  TodayFollowUp,
  TodayDealAttention,
  TodayViewData,
} from '@/lib/today';

type Props = {
  brand: Brand;
  label: string;
};

const CALL_DISPOSITIONS = [
  { value: 'connected', label: 'Connected / Spoke with prospect' },
  { value: 'voicemail', label: 'Left Voicemail' },
  { value: 'no-answer', label: 'No Answer' },
  { value: 'busy', label: 'Busy Line' },
  { value: 'wrong-number', label: 'Wrong Number' },
  { value: 'not-interested', label: 'Not Interested' },
];

export function TodayClient({ brand, label }: Props) {
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [tab, setTab] = useState<string>('all');
  const [data, setData] = useState<TodayViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Call modal state
  const [callModalLead, setCallModalLead] = useState<{
    id: string;
    entityName: string;
    contactName?: string;
    contactKey?: string;
  } | null>(null);
  const [callDisposition, setCallDisposition] = useState<string>('connected');
  const [callDuration, setCallDuration] = useState<number>(5);
  const [callNotes, setCallNotes] = useState<string>('');
  const [callSubmitting, setCallSubmitting] = useState(false);

  const fetchTodayData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const res = await fetch(`/api/today/${brand}?scope=${scope}&timezone=${encodeURIComponent(tz)}`);
      if (!res.ok) {
        throw new Error(`Failed to load Today queue (${res.status})`);
      }
      const json: TodayViewData = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Error loading Today data');
    } finally {
      setLoading(false);
    }
  }, [brand, scope]);

  useEffect(() => {
    fetchTodayData();
  }, [fetchTodayData]);

  const handleCompleteCadenceStep = async (leadId: string) => {
    try {
      setActionInProgress(leadId);
      const res = await fetch(`/api/leads/${leadId}/cadence/complete-step?brand=${brand}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Completed via Today execution queue' }),
      });
      if (!res.ok) throw new Error('Failed to complete cadence task');
      await fetchTodayData();
    } catch (err: any) {
      alert(err?.message || 'Action failed');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleMarkActionDone = async (leadId: string) => {
    try {
      setActionInProgress(leadId);
      const res = await fetch(`/api/leads/${leadId}/action-done?brand=${brand}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: 'Marked done via Today execution queue' }),
      });
      if (!res.ok) throw new Error('Failed to mark follow-up completed');
      await fetchTodayData();
    } catch (err: any) {
      alert(err?.message || 'Action failed');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleSnooze = async (leadId: string, duration: string) => {
    try {
      setActionInProgress(leadId);
      const res = await fetch(`/api/leads/${leadId}/snooze?brand=${brand}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration }),
      });
      if (!res.ok) throw new Error('Failed to snooze reminder');
      await fetchTodayData();
    } catch (err: any) {
      alert(err?.message || 'Action failed');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleLogCallSubmit = async () => {
    if (!callModalLead) return;
    try {
      setCallSubmitting(true);
      const contactKey = callModalLead.contactKey || callModalLead.contactName || 'Primary Contact';
      const res = await fetch(`/api/leads/${callModalLead.id}/activity?brand=${brand}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactKey,
          disposition: callDisposition,
          durationMinutes: callDuration,
          note: callNotes,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to log call');
      }
      setCallModalLead(null);
      setCallNotes('');
      await fetchTodayData();
    } catch (err: any) {
      alert(err?.message || 'Failed to log call');
    } finally {
      setCallSubmitting(false);
    }
  };

  const counts = data?.counts ?? {
    total: 0,
    cadenceTasks: 0,
    overdueFollowUps: 0,
    dueTodayFollowUps: 0,
    dealsNeedingAttention: 0,
  };

  return (
    <Box px={{ base: 'sm', sm: 'md', md: 'lg' }} py="md" w="100%" style={{ flex: 1, minWidth: 0 }}>
      <Stack gap="lg">
        {/* Compact Application Header matching Contacts reference */}
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <div>
            <Group gap="xs" align="center">
              <Title order={2} style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
                {label} Today&apos;s Work
              </Title>
              <CountBadge value={counts.total} size="md" srLabel="Actions pending" />
            </Group>
            <Text size="xs" c="dimmed" mt={2}>
              {data?.date
                ? new Date(data.date + 'T12:00:00Z').toLocaleDateString(undefined, {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                : 'Your daily action stream'}
              {data?.timezone ? ` · ${data.timezone}` : ''}
            </Text>
          </div>
          <Group gap="xs">
            <SegmentedControl
              value={scope}
              onChange={(val) => setScope(val as 'mine' | 'all')}
              data={[
                { label: 'My queue', value: 'mine' },
                { label: 'All reps', value: 'all' },
              ]}
              size="xs"
            />
            <ActionIcon
              variant="default"
              size="md"
              aria-label="Refresh today queue"
              onClick={fetchTodayData}
              loading={loading}
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Group>
        </Group>

        {/* Metric summary strip */}
        <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="md">
          <Card withBorder padding="sm" radius="md">
            <Text size="xs" c="dimmed" fw={600} tt="uppercase">
              Total Queue
            </Text>
            <Title order={3} mt={4}>
              {counts.total}
            </Title>
            <Text size="xs" c="dimmed">
              actions pending
            </Text>
          </Card>
          <Card withBorder padding="sm" radius="md">
            <Group justify="space-between" align="center">
              <Text size="xs" c={counts.overdueFollowUps > 0 ? 'red' : 'dimmed'} fw={600} tt="uppercase">
                Overdue
              </Text>
              {counts.overdueFollowUps > 0 && (
                <StatusBadge status="danger" withIcon size="xs">
                  Urgent
                </StatusBadge>
              )}
            </Group>
            <Title order={3} mt={4} c={counts.overdueFollowUps > 0 ? 'red' : undefined}>
              {counts.overdueFollowUps}
            </Title>
            <Text size="xs" c="dimmed">
              past due date
            </Text>
          </Card>
          <Card withBorder padding="sm" radius="md">
            <Group justify="space-between" align="center">
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                Due Today
              </Text>
              {counts.dueTodayFollowUps > 0 && (
                <StatusBadge status="warning" size="xs">
                  Today
                </StatusBadge>
              )}
            </Group>
            <Title order={3} mt={4}>
              {counts.dueTodayFollowUps}
            </Title>
            <Text size="xs" c="dimmed">
              scheduled touches
            </Text>
          </Card>
          <Card withBorder padding="sm" radius="md">
            <Group justify="space-between" align="center">
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                Cadence Steps
              </Text>
              {counts.cadenceTasks > 0 && (
                <StatusBadge status="info" size="xs">
                  Sequences
                </StatusBadge>
              )}
            </Group>
            <Title order={3} mt={4}>
              {counts.cadenceTasks}
            </Title>
            <Text size="xs" c="dimmed">
              manual tasks
            </Text>
          </Card>
          <Card withBorder padding="sm" radius="md">
            <Group justify="space-between" align="center">
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                Stale Deals
              </Text>
              {counts.dealsNeedingAttention > 0 && (
                <StatusBadge status="warning" withIcon size="xs">
                  Attention
                </StatusBadge>
              )}
            </Group>
            <Title order={3} mt={4}>
              {counts.dealsNeedingAttention}
            </Title>
            <Text size="xs" c="dimmed">
              past close / inactive
            </Text>
          </Card>
        </SimpleGrid>

        {/* Filter tabs */}
        <SegmentedControl
          value={tab}
          onChange={setTab}
          data={[
            { label: `All (${counts.total})`, value: 'all' },
            { label: `Overdue (${counts.overdueFollowUps})`, value: 'overdue' },
            { label: `Due Today (${counts.dueTodayFollowUps})`, value: 'due_today' },
            { label: `Cadence Tasks (${counts.cadenceTasks})`, value: 'cadence' },
            { label: `Deals Attention (${counts.dealsNeedingAttention})`, value: 'deals' },
          ]}
          fullWidth
        />

        {/* Content body */}
        {loading && !data ? (
          <Group justify="center" py="xl">
            <Loader size="md" />
            <Text size="sm" c="dimmed">
              Loading today&apos;s queue...
            </Text>
          </Group>
        ) : error ? (
          <InlineAlert severity="error" title="Queue Error" message={error} />
        ) : counts.total === 0 ? (
          <Paper p="xl" withBorder style={{ textAlign: 'center' }}>
            <ActionIcon color="green" variant="light" size={48} radius="xl" style={{ margin: '0 auto 12px' }}>
              <IconCheck size={28} />
            </ActionIcon>
            <Title order={4} fw={600}>
              You&apos;re all caught up for today!
            </Title>
            <Text size="sm" c="dimmed" mt={4} maw={420} mx="auto">
              No overdue follow-ups, pending cadence tasks, or stale deals requiring immediate attention.
            </Text>
          </Paper>
        ) : (
          <Stack gap="md">
            {/* 1. Cadence Tasks */}
            {(tab === 'all' || tab === 'cadence') && data && data.cadenceTasks.length > 0 && (
              <Stack gap="xs">
                <Text size="sm" fw={700} c="dimmed" tt="uppercase">
                  Cadence Manual Tasks ({data.cadenceTasks.length})
                </Text>
                {data.cadenceTasks.map((task: TodayCadenceTask) => (
                  <Paper key={task.leadId} withBorder p="md" radius="md">
                    <Group justify="space-between" align="center" wrap="wrap">
                      <Group gap="sm" align="flex-start">
                        <ActionIcon
                          variant="light"
                          color={task.channel === 'call' ? 'green' : task.channel === 'linkedin' ? 'blue' : 'gray'}
                          size="lg"
                          radius="md"
                        >
                          {task.channel === 'call' ? (
                            <IconPhone size={20} />
                          ) : task.channel === 'linkedin' ? (
                            <IconBrandLinkedin size={20} />
                          ) : (
                            <IconListCheck size={20} />
                          )}
                        </ActionIcon>
                        <div>
                          <Group gap="xs">
                            <Link
                              href={`/sales/${brand}?lead=${task.leadId}`}
                              style={{ textDecoration: 'none', color: 'inherit' }}
                            >
                              <Text fw={600} size="sm" className="hover:underline">
                                {task.entityName}
                              </Text>
                            </Link>
                            <LabelTag tone="info" size="xs" label={task.channel.toUpperCase()} />
                            {task.cadenceName && (
                              <LabelTag
                                tone="neutral"
                                size="xs"
                                label={`${task.cadenceName} · Step ${task.stepIndex}${task.totalSteps ? ` of ${task.totalSteps}` : ''}`}
                              />
                            )}
                          </Group>
                          <Group gap="xs" mt={2}>
                            {task.contactName && (
                              <Text size="xs" c="dimmed">
                                <IconUser size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
                                {task.contactName}
                              </Text>
                            )}
                            {task.contactEmail && (
                              <Text size="xs" c="dimmed">
                                ({task.contactEmail})
                              </Text>
                            )}
                            {task.assignedTo && (
                              <Text size="xs" c="dimmed">
                                · Rep: {task.assignedTo}
                              </Text>
                            )}
                          </Group>
                          {task.reminderNote && (
                            <Text size="xs" c="slate" mt={4} style={{ fontStyle: 'italic' }}>
                              &ldquo;{task.reminderNote}&rdquo;
                            </Text>
                          )}
                        </div>
                      </Group>
                      <Group gap="xs">
                        {task.channel === 'call' && (
                          <Button
                            size="xs"
                            variant="light"
                            color="teal"
                            leftSection={<IconPhone size={14} />}
                            onClick={() =>
                              setCallModalLead({
                                id: task.leadId,
                                entityName: task.entityName,
                                contactName: task.contactName,
                                contactKey: task.contactKey,
                              })
                            }
                          >
                            Log Call
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="filled"
                          color="indigo"
                          leftSection={<IconCheck size={14} />}
                          loading={actionInProgress === task.leadId}
                          onClick={() => handleCompleteCadenceStep(task.leadId)}
                        >
                          Complete Step
                        </Button>
                      </Group>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            )}

            {/* 2. Overdue Follow-ups */}
            {(tab === 'all' || tab === 'overdue') && data && data.overdueFollowUps.length > 0 && (
              <Stack gap="xs">
                <Text size="sm" fw={700} c="red" tt="uppercase">
                  Overdue Follow-ups ({data.overdueFollowUps.length})
                </Text>
                {data.overdueFollowUps.map((item: TodayFollowUp) => (
                  <Paper key={item.leadId} withBorder p="md" radius="md">
                    <Group justify="space-between" align="center" wrap="wrap">
                      <Group gap="sm" align="flex-start">
                        <ActionIcon variant="light" color="red" size="lg" radius="md">
                          <IconClock size={20} />
                        </ActionIcon>
                        <div>
                          <Group gap="xs">
                            <Link
                              href={`/sales/${brand}?lead=${item.leadId}`}
                              style={{ textDecoration: 'none', color: 'inherit' }}
                            >
                              <Text fw={600} size="sm" className="hover:underline">
                                {item.entityName}
                              </Text>
                            </Link>
                            <StatusBadge status="danger" withIcon size="xs">
                              {`${item.overdueDays}d overdue`}
                            </StatusBadge>
                          </Group>
                          <Group gap="xs" mt={2}>
                            {item.contactName && (
                              <Text size="xs" c="dimmed">
                                <IconUser size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
                                {item.contactName}
                              </Text>
                            )}
                            {item.contactEmail && (
                              <Text size="xs" c="dimmed">
                                ({item.contactEmail})
                              </Text>
                            )}
                            {item.assignedTo && (
                              <Text size="xs" c="dimmed">
                                · Rep: {item.assignedTo}
                              </Text>
                            )}
                          </Group>
                          {item.nextActionNote && (
                            <Text size="xs" c="slate" mt={4} style={{ fontStyle: 'italic' }}>
                              &ldquo;{item.nextActionNote}&rdquo;
                            </Text>
                          )}
                        </div>
                      </Group>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="light"
                          color="teal"
                          leftSection={<IconPhone size={14} />}
                          onClick={() =>
                            setCallModalLead({
                              id: item.leadId,
                              entityName: item.entityName,
                              contactName: item.contactName,
                              contactKey: item.contactKey,
                            })
                          }
                        >
                          Log Call
                        </Button>
                        <Menu shadow="md" width={160}>
                          <Menu.Target>
                            <Button size="xs" variant="default" leftSection={<IconCalendarPlus size={14} />}>
                              Snooze
                            </Button>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item onClick={() => handleSnooze(item.leadId, '1d')}>
                              Tomorrow (+1d)
                            </Menu.Item>
                            <Menu.Item onClick={() => handleSnooze(item.leadId, '3d')}>
                              In 3 days (+3d)
                            </Menu.Item>
                            <Menu.Item onClick={() => handleSnooze(item.leadId, '1w')}>
                              Next week (+1w)
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                        <Button
                          size="xs"
                          variant="filled"
                          color="green"
                          leftSection={<IconCheck size={14} />}
                          loading={actionInProgress === item.leadId}
                          onClick={() => handleMarkActionDone(item.leadId)}
                        >
                          Mark Done
                        </Button>
                      </Group>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            )}

            {/* 3. Due Today Follow-ups */}
            {(tab === 'all' || tab === 'due_today') && data && data.dueTodayFollowUps.length > 0 && (
              <Stack gap="xs">
                <Text size="sm" fw={700} c="dimmed" tt="uppercase">
                  Due Today Follow-ups ({data.dueTodayFollowUps.length})
                </Text>
                {data.dueTodayFollowUps.map((item: TodayFollowUp) => (
                  <Paper key={item.leadId} withBorder p="md" radius="md">
                    <Group justify="space-between" align="center" wrap="wrap">
                      <Group gap="sm" align="flex-start">
                        <ActionIcon variant="light" color="orange" size="lg" radius="md">
                          <IconCalendar size={20} />
                        </ActionIcon>
                        <div>
                          <Group gap="xs">
                            <Link
                              href={`/sales/${brand}?lead=${item.leadId}`}
                              style={{ textDecoration: 'none', color: 'inherit' }}
                            >
                              <Text fw={600} size="sm" className="hover:underline">
                                {item.entityName}
                              </Text>
                            </Link>
                            <StatusBadge status="warning" size="xs">
                              Due Today
                            </StatusBadge>
                          </Group>
                          <Group gap="xs" mt={2}>
                            {item.contactName && (
                              <Text size="xs" c="dimmed">
                                <IconUser size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
                                {item.contactName}
                              </Text>
                            )}
                            {item.contactEmail && (
                              <Text size="xs" c="dimmed">
                                ({item.contactEmail})
                              </Text>
                            )}
                            {item.assignedTo && (
                              <Text size="xs" c="dimmed">
                                · Rep: {item.assignedTo}
                              </Text>
                            )}
                          </Group>
                          {item.nextActionNote && (
                            <Text size="xs" c="slate" mt={4} style={{ fontStyle: 'italic' }}>
                              &ldquo;{item.nextActionNote}&rdquo;
                            </Text>
                          )}
                        </div>
                      </Group>
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="light"
                          color="teal"
                          leftSection={<IconPhone size={14} />}
                          onClick={() =>
                            setCallModalLead({
                              id: item.leadId,
                              entityName: item.entityName,
                              contactName: item.contactName,
                              contactKey: item.contactKey,
                            })
                          }
                        >
                          Log Call
                        </Button>
                        <Menu shadow="md" width={160}>
                          <Menu.Target>
                            <Button size="xs" variant="default" leftSection={<IconCalendarPlus size={14} />}>
                              Snooze
                            </Button>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item onClick={() => handleSnooze(item.leadId, '1d')}>
                              Tomorrow (+1d)
                            </Menu.Item>
                            <Menu.Item onClick={() => handleSnooze(item.leadId, '3d')}>
                              In 3 days (+3d)
                            </Menu.Item>
                            <Menu.Item onClick={() => handleSnooze(item.leadId, '1w')}>
                              Next week (+1w)
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                        <Button
                          size="xs"
                          variant="filled"
                          color="green"
                          leftSection={<IconCheck size={14} />}
                          loading={actionInProgress === item.leadId}
                          onClick={() => handleMarkActionDone(item.leadId)}
                        >
                          Mark Done
                        </Button>
                      </Group>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            )}

            {/* 4. Deals Needing Attention */}
            {(tab === 'all' || tab === 'deals') && data && data.dealsNeedingAttention.length > 0 && (
              <Stack gap="xs">
                <Text size="sm" fw={700} c="dimmed" tt="uppercase">
                  Deals Needing Attention ({data.dealsNeedingAttention.length})
                </Text>
                {data.dealsNeedingAttention.map((deal: TodayDealAttention) => (
                  <Paper key={deal.dealId || deal.leadId} withBorder p="md" radius="md">
                    <Group justify="space-between" align="center" wrap="wrap">
                      <Group gap="sm" align="flex-start">
                        <ActionIcon variant="light" color="grape" size="lg" radius="md">
                          <IconCoins size={20} />
                        </ActionIcon>
                        <div>
                          <Group gap="xs">
                            <Link
                              href={`/sales/${brand}?lead=${deal.leadId}`}
                              style={{ textDecoration: 'none', color: 'inherit' }}
                            >
                              <Text fw={600} size="sm" className="hover:underline">
                                {deal.dealTitle || deal.entityName}
                              </Text>
                            </Link>
                            {deal.reason === 'past_close_date' ? (
                              <StatusBadge status="danger" withIcon size="xs">
                                {`Past close date (${deal.daysOverdueOrInactive}d ago)`}
                              </StatusBadge>
                            ) : (
                              <StatusBadge status="warning" withIcon size="xs">
                                {`Stale (${deal.daysOverdueOrInactive}d inactive)`}
                              </StatusBadge>
                            )}
                          </Group>
                          <Group gap="xs" mt={2}>
                            <Text size="xs" c="dimmed">
                              <IconBuilding size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
                              {deal.entityName}
                            </Text>
                            {deal.pipelineStage && (
                              <Text size="xs" c="dimmed">
                                · Stage: {deal.pipelineStage}
                              </Text>
                            )}
                            {deal.dealValue !== undefined && (
                              <Text size="xs" fw={600} c="indigo">
                                · ${deal.dealValue.toLocaleString()}
                              </Text>
                            )}
                            {deal.expectedCloseDate && (
                              <Text size="xs" c="dimmed">
                                · Expected close: {deal.expectedCloseDate}
                              </Text>
                            )}
                          </Group>
                        </div>
                      </Group>
                      <Button
                        component={Link}
                        href={`/sales/${brand}?lead=${deal.leadId}`}
                        size="xs"
                        variant="default"
                        rightSection={<IconArrowRight size={14} />}
                      >
                        View Deal
                      </Button>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            )}
          </Stack>
        )}
      </Stack>

      {/* Quick Call Log Modal */}
      <Modal
        opened={Boolean(callModalLead)}
        onClose={() => setCallModalLead(null)}
        title={
          <Group gap="xs">
            <ActionIcon color="teal" variant="light" size="sm">
              <IconPhone size={16} />
            </ActionIcon>
            <Text fw={600}>Log Call — {callModalLead?.entityName}</Text>
          </Group>
        }
        size="md"
      >
        <Stack gap="sm">
          {callModalLead?.contactName && (
            <Text size="sm" c="dimmed">
              Contact: <strong>{callModalLead.contactName}</strong>
            </Text>
          )}
          <Select
            label="Call Outcome / Disposition"
            data={CALL_DISPOSITIONS}
            value={callDisposition}
            onChange={(val) => setCallDisposition(val || 'connected')}
            allowDeselect={false}
            required
          />
          <NumberInput
            label="Duration (minutes)"
            min={1}
            max={300}
            value={callDuration}
            onChange={(val) => setCallDuration(typeof val === 'number' ? val : 5)}
          />
          <Textarea
            label="Call Notes"
            placeholder="Summary of discussion, objections, next steps agreed upon..."
            minRows={3}
            value={callNotes}
            onChange={(e) => setCallNotes(e?.target?.value ?? e?.currentTarget?.value ?? '')}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setCallModalLead(null)}>
              Cancel
            </Button>
            <Button
              color="teal"
              leftSection={<IconCheck size={16} />}
              loading={callSubmitting}
              onClick={handleLogCallSubmit}
            >
              Save Call Entry
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
