'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Modal, Stack, Group, Title, Text, Button, Paper, Badge, Divider, Loader } from '@mantine/core';
import { IconMail, IconBrandGoogle, IconCheck, IconAlertTriangle, IconRefresh, IconUnlink } from '@tabler/icons-react';
import { useAuth } from './AuthProvider';

type SafeConnection = {
  id: string;
  provider: string;
  authMethod: string;
  providerAccountLabel?: string;
  userEmail?: string;
  status: 'active' | 'expired' | 'revoked' | 'error';
  lastVerifiedAt?: string;
  lastSyncError?: string;
};

type Props = {
  opened: boolean;
  onClose: () => void;
  brand?: string;
};

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return 'Never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function UserSettingsModal({ opened, onClose, brand = 'cogmap' }: Props) {
  const { user, isSuperAdmin } = useAuth();
  const pathname = usePathname();
  const [connections, setConnections] = useState<SafeConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/user/integrations');
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections || []);
      }
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opened) {
      loadConnections();
    }
  }, [opened, loadConnections]);

  const gmailConnection = connections.find((c) => c.provider === 'gmail' && c.status !== 'revoked');

  function handleConnectGmail() {
    const returnUrl = typeof window !== 'undefined' ? window.location.pathname + window.location.search : pathname;
    const relativeUrl = `/api/integrations/gmail/connect?brand=${encodeURIComponent(brand)}&scopeType=user&returnUrl=${encodeURIComponent(returnUrl)}`;
    const fullUrl = new URL(relativeUrl, window.location.origin).toString();
    window.location.assign(fullUrl);
  }

  async function handleTestGmail() {
    setTesting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/user/integrations/gmail/test', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setFeedback({ type: 'success', message: 'Gmail connection verified and active.' });
        await loadConnections();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Verification failed. Reconnection may be required.' });
        await loadConnections();
      }
    } catch {
      setFeedback({ type: 'error', message: 'Could not reach server to test connection.' });
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnectGmail() {
    if (!window.confirm('Disconnect your Gmail account? You will no longer be able to send or receive emails from your personal address.')) {
      return;
    }
    setDisconnecting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/user/integrations/gmail/disconnect', { method: 'POST' });
      if (res.ok) {
        setFeedback({ type: 'success', message: 'Gmail account disconnected.' });
        await loadConnections();
      } else {
        setFeedback({ type: 'error', message: 'Failed to disconnect account.' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Network error while disconnecting.' });
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={<Title order={4}>My Account & Integrations</Title>} size="md" centered>
      <Stack gap="md">
        <Paper p="sm" withBorder radius="sm">
          <Group justify="space-between" align="center">
            <div>
              <Text size="sm" fw={600}>{user?.name || user?.email || 'User'}</Text>
              <Text size="xs" c="dimmed">{user?.email || 'No email associated'}</Text>
            </div>
            <Badge color="indigo" variant="light" size="sm">
              {isSuperAdmin ? 'Super Admin' : 'Sales Rep'}
            </Badge>
          </Group>
        </Paper>

        <div>
          <Title order={5} mb={4}>Personal Mailbox (Gmail)</Title>
          <Text size="xs" c="dimmed">
            Connect your Google account to send 1:1 outreach emails from your own address and automatically sync lead replies.
          </Text>
        </div>

        {loading ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : gmailConnection && gmailConnection.status === 'active' ? (
          <Paper p="sm" withBorder radius="sm" style={{ borderColor: 'var(--mantine-color-green-6)' }}>
            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <Group gap="xs">
                  <IconBrandGoogle size={20} color="#EA4335" />
                  <div>
                    <Text size="sm" fw={600}>
                      {gmailConnection.providerAccountLabel || gmailConnection.userEmail || user?.email || 'Connected'}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Verified: {formatRelativeTime(gmailConnection.lastVerifiedAt)}
                    </Text>
                  </div>
                </Group>
                <Badge color="green" variant="light">Connected</Badge>
              </Group>

              <Divider my={4} />

              <Group justify="flex-end" gap="xs">
                <Button
                  size="xs"
                  variant="light"
                  color="gray"
                  leftSection={<IconRefresh size={14} />}
                  onClick={handleTestGmail}
                  loading={testing}
                  disabled={disconnecting}
                >
                  Test
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  leftSection={<IconUnlink size={14} />}
                  onClick={handleDisconnectGmail}
                  loading={disconnecting}
                  disabled={testing}
                >
                  Disconnect
                </Button>
              </Group>
            </Stack>
          </Paper>
        ) : (
          <Paper p="sm" withBorder radius="sm">
            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <Group gap="xs">
                  <IconBrandGoogle size={20} color="gray" />
                  <div>
                    <Text size="sm" fw={500}>Google / Gmail</Text>
                    <Text size="xs" c="dimmed">Not connected</Text>
                  </div>
                </Group>
                <Badge color="gray" variant="light">Not Connected</Badge>
              </Group>

              {gmailConnection?.lastSyncError && (
                <Text size="xs" c="red">
                  Error: {gmailConnection.lastSyncError}
                </Text>
              )}

              <Button
                size="sm"
                color="indigo"
                leftSection={<IconBrandGoogle size={16} />}
                onClick={handleConnectGmail}
                mt="xs"
              >
                Connect with Google
              </Button>
            </Stack>
          </Paper>
        )}

        {feedback && (
          <Paper p="xs" radius="sm" bg={feedback.type === 'success' ? 'green.0' : 'red.0'}>
            <Group gap="xs">
              {feedback.type === 'success' ? (
                <IconCheck size={16} color="green" />
              ) : (
                <IconAlertTriangle size={16} color="red" />
              )}
              <Text size="xs" c={feedback.type === 'success' ? 'green.9' : 'red.9'}>
                {feedback.message}
              </Text>
            </Group>
          </Paper>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose} size="sm">
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
