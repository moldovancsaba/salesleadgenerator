'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Box,
  Title,
  Text,
  Badge,
  Group,
  Stack,
  Paper,
  ActionIcon,
  TextInput,
  SegmentedControl,
  Button,
  Divider,
  Collapse,
  Tooltip,
  Container,
  Grid,
} from '@mantine/core';
import {
  IconSparkles,
  IconCalendar,
  IconSearch,
  IconX,
  IconLink,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconRocket,
  IconBug,
  IconShieldLock,
  IconFileText,
  IconArrowLeft,
  IconArrowUp,
} from '@tabler/icons-react';
import type { ReleaseNote, ReleaseCategory, ReleaseItem } from '@/lib/release-notes-parser';
import { filterReleaseNotes } from '@/lib/release-notes-parser';

interface WhatsNewClientProps {
  initialNotes: ReleaseNote[];
  brand: string;
  label: string;
}

export function WhatsNewClient({ initialNotes, brand, label }: WhatsNewClientProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ReleaseCategory>('all');
  const [visibleCount, setVisibleCount] = useState(15);
  const [expandedVersions, setExpandedVersions] = useState<Record<string, boolean>>({});
  const [copiedVersion, setCopiedVersion] = useState<string | null>(null);

  // Filter notes in memory
  const filteredNotes = useMemo(() => {
    return filterReleaseNotes(initialNotes, { query, category });
  }, [initialNotes, query, category]);

  const displayedNotes = useMemo(() => {
    return filteredNotes.slice(0, visibleCount);
  }, [filteredNotes, visibleCount]);

  const hasMore = visibleCount < filteredNotes.length;

  const toggleExpand = (version: string) => {
    setExpandedVersions((prev) => ({ ...prev, [version]: !prev[version] }));
  };

  const copyReleaseLink = (version: string) => {
    const slug = `v${version.replace(/\./g, '-')}`;
    const url = `${window.location.origin}/whats-new/${brand}#${slug}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopiedVersion(version);
      setTimeout(() => setCopiedVersion(null), 2000);
    });
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <Box
      style={{
        background: 'var(--mantine-color-gray-0)',
        minHeight: 'calc(100vh - 48px)',
        paddingBottom: '60px',
      }}
    >
      {/* Hero Header */}
      <Box
        style={{
          background: 'var(--mantine-color-body)',
          borderBottom: '1px solid var(--mantine-color-gray-3)',
          padding: '24px 16px',
        }}
      >
        <Container size="lg">
          <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
            <Stack gap={6}>
              <Group gap="xs">
                <Button
                  component={Link}
                  href={`/sales/${brand}`}
                  variant="subtle"
                  size="compact-xs"
                  color="gray"
                  leftSection={<IconArrowLeft size={14} />}
                >
                  Back to {label}
                </Button>
                <Badge variant="light" color="indigo" size="sm" leftSection={<IconSparkles size={12} />}>
                  Changelog & Updates
                </Badge>
              </Group>
              <Title order={2} style={{ fontSize: '24px', fontWeight: 800 }}>
                What&apos;s New in Sales Lead Generator
              </Title>
              <Text size="sm" c="dimmed">
                Detailed release notes, newly shipped capabilities, and continuous improvements ordered from newest to oldest.
              </Text>
            </Stack>

            <Group gap="xs" align="center">
              {initialNotes[0] && (
                <Paper
                  withBorder
                  p="xs"
                  radius="md"
                  style={{
                    background: 'var(--mantine-color-indigo-0)',
                    borderColor: 'var(--mantine-color-indigo-2)',
                  }}
                >
                  <Group gap="xs">
                    <IconSparkles size={16} color="var(--mantine-color-indigo-7)" />
                    <Stack gap={0}>
                      <Text size="xs" fw={700} c="indigo.8">
                        Latest: v{initialNotes[0].version}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {initialNotes[0].formattedDate}
                      </Text>
                    </Stack>
                  </Group>
                </Paper>
              )}
            </Group>
          </Group>

          {/* Filter Bar */}
          <Divider my="md" />
          <Grid gap="md" align="center">
            <Grid.Col span={{ base: 12, sm: 6, md: 5 }}>
              <TextInput
                placeholder="Search releases (e.g. inbox, sso, encoding, contacts)..."
                value={query}
                onChange={(e) => {
                  setQuery(e.currentTarget.value);
                  setVisibleCount(15);
                }}
                leftSection={<IconSearch size={16} />}
                rightSection={
                  query ? (
                    <ActionIcon size="xs" variant="subtle" onClick={() => setQuery('')} aria-label="Clear search">
                      <IconX size={14} />
                    </ActionIcon>
                  ) : null
                }
                radius="md"
                size="sm"
              />
            </Grid.Col>

            <Grid.Col span={{ base: 12, sm: 6, md: 7 }}>
              <Group gap="xs" justify="flex-end" wrap="wrap">
                <SegmentedControl
                  size="xs"
                  value={category}
                  onChange={(val) => {
                    setCategory(val as ReleaseCategory);
                    setVisibleCount(15);
                  }}
                  data={[
                    { label: 'All Updates', value: 'all' },
                    { label: '🚀 What\'s New', value: 'new' },
                    { label: '🛠️ What\'s Fixed', value: 'fix' },
                    { label: '🔒 Security', value: 'security' },
                  ]}
                />
              </Group>
            </Grid.Col>
          </Grid>
        </Container>
      </Box>

      {/* Main Content Area */}
      <Container size="lg" mt="lg">
        <Grid gap="xl">
          {/* Main Feed: Blog Cards */}
          <Grid.Col span={{ base: 12, md: 8, lg: 9 }}>
            {displayedNotes.length === 0 ? (
              <Paper withBorder p="xl" radius="md" style={{ textAlign: 'center', background: 'var(--mantine-color-body)' }}>
                <IconSearch size={36} color="var(--mantine-color-gray-5)" style={{ margin: '0 auto 12px' }} />
                <Title order={4} mb="xs">No releases match your search</Title>
                <Text size="sm" c="dimmed" mb="md">
                  No release notes found for &quot;{query}&quot; in the &quot;{category}&quot; category.
                </Text>
                <Button
                  variant="light"
                  size="xs"
                  onClick={() => {
                    setQuery('');
                    setCategory('all');
                  }}
                >
                  Reset filters
                </Button>
              </Paper>
            ) : (
              <Stack gap="lg">
                {displayedNotes.map((note, index) => {
                  const isLatest = index === 0 && !query && category === 'all';
                  const slug = `v${note.version.replace(/\./g, '-')}`;
                  const isExpanded = !!expandedVersions[note.version];

                  return (
                    <Paper
                      key={note.version}
                      id={slug}
                      withBorder
                      radius="md"
                      p="lg"
                      style={{
                        background: 'var(--mantine-color-body)',
                        borderColor: isLatest ? 'var(--mantine-color-indigo-4)' : undefined,
                        borderWidth: isLatest ? '2px' : '1px',
                        transition: 'box-shadow 0.2s ease',
                      }}
                    >
                      {/* Release Card Header */}
                      <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs" mb="sm">
                        <Group gap="xs" wrap="wrap" align="center">
                          <Badge
                            size="md"
                            variant="filled"
                            color={isLatest ? 'indigo' : 'dark'}
                            radius="sm"
                            style={{ fontWeight: 700 }}
                          >
                            v{note.version}
                          </Badge>

                          {isLatest && (
                            <Badge size="xs" variant="light" color="teal">
                              Latest Release
                            </Badge>
                          )}

                          <Group gap={4} c="dimmed" wrap="nowrap">
                            <IconCalendar size={14} />
                            <Text size="xs" fw={500}>
                              {note.formattedDate}
                            </Text>
                          </Group>

                          <Badge size="xs" variant="subtle" color="gray">
                            {note.relativeAge}
                          </Badge>
                        </Group>

                        <Group gap={6}>
                          {note.newCount > 0 && (
                            <Badge size="xs" variant="light" color="teal" leftSection={<IconRocket size={10} />}>
                              {note.newCount} New
                            </Badge>
                          )}
                          {note.fixCount > 0 && (
                            <Badge size="xs" variant="light" color="blue" leftSection={<IconBug size={10} />}>
                              {note.fixCount} Fixed
                            </Badge>
                          )}
                          {note.securityCount > 0 && (
                            <Badge size="xs" variant="light" color="violet" leftSection={<IconShieldLock size={10} />}>
                              {note.securityCount} Security
                            </Badge>
                          )}
                          <Tooltip label={copiedVersion === note.version ? 'Link copied!' : 'Copy direct link to release'}>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color={copiedVersion === note.version ? 'teal' : 'gray'}
                              onClick={() => copyReleaseLink(note.version)}
                              aria-label="Copy link to release"
                            >
                              {copiedVersion === note.version ? <IconCheck size={14} /> : <IconLink size={14} />}
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Group>

                      {/* Release Title */}
                      <Title
                        order={3}
                        style={{
                          fontSize: '18px',
                          fontWeight: 700,
                          lineHeight: 1.3,
                          marginBottom: '12px',
                        }}
                      >
                        {note.title}
                      </Title>

                      {/* Itemized Highlights */}
                      <Stack gap="sm" mt="sm">
                        {note.items.map((item: ReleaseItem, itemIdx: number) => {
                          const isNew = item.type === 'new';
                          const isFix = item.type === 'fix';
                          const isSec = item.type === 'security';
                          const isDoc = item.type === 'doc';

                          const badgeColor = isNew
                            ? 'teal'
                            : isFix
                              ? 'blue'
                              : isSec
                                ? 'violet'
                                : isDoc
                                  ? 'gray'
                                  : 'indigo';

                          const badgeLabel = isNew
                            ? 'NEW'
                            : isFix
                              ? 'FIX'
                              : isSec
                                ? 'SECURITY'
                                : isDoc
                                  ? 'DOCS'
                                  : 'UPDATE';

                          const IconComponent = isNew
                            ? IconRocket
                            : isFix
                              ? IconBug
                              : isSec
                                ? IconShieldLock
                                : IconFileText;

                          return (
                            <Box
                              key={itemIdx}
                              p="xs"
                              style={{
                                background: 'var(--mantine-color-gray-0)',
                                borderLeft: `3px solid var(--mantine-color-${badgeColor}-6)`,
                                borderRadius: '4px',
                              }}
                            >
                              <Group gap="xs" align="flex-start" wrap="nowrap">
                                <Badge
                                  size="xs"
                                  variant="filled"
                                  color={badgeColor}
                                  radius="xs"
                                  leftSection={<IconComponent size={10} />}
                                  style={{ flexShrink: 0, marginTop: '2px' }}
                                >
                                  {badgeLabel}
                                </Badge>

                                <Box style={{ flex: 1, minWidth: 0 }}>
                                  <Text size="sm" fw={600} style={{ wordBreak: 'break-word' }}>
                                    {item.title}
                                  </Text>

                                  {item.details.length > 0 && (
                                    <Stack gap={4} mt={6}>
                                      {item.details.map((detail, dIdx) => (
                                        <Group key={dIdx} gap="xs" align="flex-start" wrap="nowrap">
                                          <Text size="xs" c="dimmed" style={{ flexShrink: 0, marginTop: '2px' }}>
                                            •
                                          </Text>
                                          <Text size="xs" c="dimmed" style={{ lineHeight: 1.45, wordBreak: 'break-word' }}>
                                            {detail}
                                          </Text>
                                        </Group>
                                      ))}
                                    </Stack>
                                  )}
                                </Box>
                              </Group>
                            </Box>
                          );
                        })}
                      </Stack>

                      {/* Expandable Technical Notes */}
                      <Divider my="sm" />
                      <Group justify="space-between" align="center">
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          color="gray"
                          onClick={() => toggleExpand(note.version)}
                          rightSection={isExpanded ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
                        >
                          {isExpanded ? 'Hide raw changelog markdown' : 'Show raw changelog markdown'}
                        </Button>
                        <Text size="xs" c="dimmed">
                          {note.items.length} update{note.items.length === 1 ? '' : 's'}
                        </Text>
                      </Group>

                      <Collapse expanded={isExpanded}>
                        <Paper
                          p="sm"
                          mt="xs"
                          radius="sm"
                          style={{
                            background: 'var(--mantine-color-dark-8)',
                            color: 'var(--mantine-color-gray-1)',
                            fontFamily: 'monospace',
                            fontSize: '11px',
                            whiteSpace: 'pre-wrap',
                            overflowX: 'auto',
                          }}
                        >
                          {note.rawMarkdown}
                        </Paper>
                      </Collapse>
                    </Paper>
                  );
                })}

                {/* Load More Button */}
                {hasMore && (
                  <Button
                    variant="light"
                    color="indigo"
                    size="md"
                    fullWidth
                    onClick={() => setVisibleCount((prev) => prev + 15)}
                    mt="md"
                  >
                    Load older releases ({filteredNotes.length - visibleCount} more available)
                  </Button>
                )}
              </Stack>
            )}
          </Grid.Col>

          {/* Right Sidebar: Quick Navigation Jump */}
          <Grid.Col span={{ base: 12, md: 4, lg: 3 }} visibleFrom="md">
            <Box
              style={{
                position: 'sticky',
                top: '64px',
                maxHeight: 'calc(100vh - 80px)',
                overflowY: 'auto',
              }}
            >
              <Paper withBorder p="md" radius="md" style={{ background: 'var(--mantine-color-body)' }}>
                <Group justify="space-between" mb="xs">
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                    Recent Releases
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    {initialNotes.length} total
                  </Badge>
                </Group>
                <Divider mb="sm" />

                <Stack gap={4}>
                  {initialNotes.slice(0, 20).map((n) => {
                    const slug = `v${n.version.replace(/\./g, '-')}`;
                    return (
                      <Box
                        key={n.version}
                        component="a"
                        href={`#${slug}`}
                        p="xs"
                        style={{
                          borderRadius: '6px',
                          textDecoration: 'none',
                          color: 'inherit',
                          display: 'block',
                          transition: 'background 0.15s ease',
                          '&:hover': {
                            background: 'var(--mantine-color-gray-1)',
                          },
                        }}
                      >
                        <Group justify="space-between" wrap="nowrap">
                          <Text size="xs" fw={600} truncate>
                            v{n.version}
                          </Text>
                          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                            {n.relativeAge}
                          </Text>
                        </Group>
                        <Text size="xs" c="dimmed" lineClamp={1} mt={2}>
                          {n.title}
                        </Text>
                      </Box>
                    );
                  })}
                </Stack>

                <Divider my="sm" />
                <Button
                  variant="subtle"
                  size="compact-xs"
                  color="indigo"
                  fullWidth
                  leftSection={<IconArrowUp size={14} />}
                  onClick={scrollToTop}
                >
                  Back to top
                </Button>
              </Paper>
            </Box>
          </Grid.Col>
        </Grid>
      </Container>
    </Box>
  );
}
