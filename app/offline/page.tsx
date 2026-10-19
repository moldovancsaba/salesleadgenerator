'use client';

import Link from 'next/link';
import { Container, Paper, Stack, Group, Title, Text, Button, ThemeIcon } from '@mantine/core';
import { StatusBadge } from '@sovereignsquad/gds-core/client';
import { IconAlertCircle, IconRefresh, IconArrowLeft } from '@tabler/icons-react';

export default function OfflinePage() {
  const handleRetry = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return (
    <Container size="sm" py={80}>
      <Paper p="xl" radius="md" withBorder shadow="sm">
        <Stack align="center" gap="lg" style={{ textAlign: 'center' }}>
          <ThemeIcon size={64} radius="xl" color="orange" variant="light">
            <IconAlertCircle size={36} />
          </ThemeIcon>

          <Stack gap="xs" align="center">
            <StatusBadge status="warning" size="lg" withIcon>
              Offline Shell
            </StatusBadge>
            <Title order={2}>You are currently offline</Title>
            <Text c="dimmed" size="sm" maw={420}>
              Sales Lead Generator requires an active internet connection to load live CRM pipelines,
              leads, and outreach cadences. Your installed application shell is ready to resume as soon as
              connection is re-established.
            </Text>
          </Stack>

          <Group justify="center" mt="md">
            <Button
              component={Link}
              href="/"
              variant="default"
              leftSection={<IconArrowLeft size={16} />}
            >
              Return to start
            </Button>
            <Button
              color="indigo"
              leftSection={<IconRefresh size={16} />}
              onClick={handleRetry}
            >
              Check connection &amp; retry
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}
