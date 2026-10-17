'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Modal, Stack, Group, Title, Text, Button, Paper, Badge, Divider, Loader, Alert, Switch, NumberInput } from '@mantine/core';
import { IconMail, IconBrandGoogle, IconCheck, IconAlertTriangle, IconRefresh, IconUnlink, IconCalendar, IconInfoCircle, IconPlus } from '@tabler/icons-react';
import { useAuth } from './AuthProvider';

type SafeConnection = {
  id: string;
  provider: string;
  authMethod: string;
  providerAccountLabel?: string;
  userEmail?: string;
  isDefault?: boolean;
  status: 'active' | 'expired' | 'revoked' | 'error';
  lastVerifiedAt?: string;
  lastSyncError?: string;
  signatureText?: string;
  signatureSyncedAt?: string;
};

type CalendarSyncSettings = {
  syncEnabled: boolean;
  defaultDurationMinutes: number;
  autoSyncCadenceTasks: boolean;
};

const DEFAULT_CALENDAR_SETTINGS: CalendarSyncSettings = {
  syncEnabled: true,
  defaultDurationMinutes: 30,
  autoSyncCadenceTasks: true,
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
  const [configured, setConfigured] = useState<{ google: boolean; encryption: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncingSignatureId, setSyncingSignatureId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [calendarSettings, setCalendarSettings] = useState<CalendarSyncSettings>(DEFAULT_CALENDAR_SETTINGS);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/user/integrations');
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections || []);
        if (data.configured) {
          setConfigured(data.configured);
        }
      }
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCalendarSettings = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const res = await fetch(`/api/calendar/sync-settings?brand=${encodeURIComponent(brand)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setCalendarSettings({
            syncEnabled: typeof data.settings.syncEnabled === 'boolean' ? data.settings.syncEnabled : true,
            defaultDurationMinutes: typeof data.settings.defaultDurationMinutes === 'number' ? data.settings.defaultDurationMinutes : 30,
            autoSyncCadenceTasks: typeof data.settings.autoSyncCadenceTasks === 'boolean' ? data.settings.autoSyncCadenceTasks : true,
          });
        }
      }
    } catch {
      // Non-fatal
    } finally {
      setCalendarLoading(false);
    }
  }, [brand]);

  useEffect(() => {
    if (opened) {
      loadConnections();
      loadCalendarSettings();

      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const err = params.get('error') || params.get('connect_error');
        const conn = params.get('connected');
        if (conn === 'gmail') {
          setFeedback({ type: 'success', message: 'Google account successfully connected!' });
        } else if (err === 'google_not_configured') {
          setFeedback({
            type: 'error',
            message: 'Google OAuth integration is not configured on the server. GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required.',
          });
        } else if (err === 'encryption_not_configured') {
          setFeedback({
            type: 'error',
            message: 'Credential encryption is not configured on the server. INTEGRATION_CREDENTIALS_ENCRYPTION_KEY is required.',
          });
        } else if (err === 'duplicate_connection') {
          setFeedback({
            type: 'error',
            message: 'This Google account is already connected to your profile.',
          });
        } else if (err && err.startsWith('token_exchange_')) {
          setFeedback({
            type: 'error',
            message: `Google rejected token exchange: ${err.replace('token_exchange_', '').replace(/_/g, ' ')}. Verify Google OAuth Client Secret and Redirect URI.`,
          });
        } else if (err && err.startsWith('error_')) {
          setFeedback({
            type: 'error',
            message: `Connection failed: ${decodeURIComponent(err.replace(/^error_/, '')).replace(/_/g, ' ')}.`,
          });
        } else if (err) {
          setFeedback({
            type: 'error',
            message: `Connection could not be completed (${decodeURIComponent(err).replace(/_/g, ' ')}).`,
          });
        }
      }
    }
  }, [opened, loadConnections, loadCalendarSettings]);

  const gmailConnections = connections.filter((c) => c.provider === 'gmail' && c.status !== 'revoked');

  function handleConnectGmail() {
    if (configured && !configured.google) {
      setFeedback({
        type: 'error',
        message: 'Google OAuth is not configured on the server yet. An administrator must configure GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.',
      });
      return;
    }
    if (configured && !configured.encryption) {
      setFeedback({
        type: 'error',
        message: 'Credential encryption is not configured on the server. INTEGRATION_CREDENTIALS_ENCRYPTION_KEY is required.',
      });
      return;
    }
    const returnUrl = typeof window !== 'undefined' ? window.location.pathname + window.location.search : pathname;
    const relativeUrl = `/api/integrations/gmail/connect?brand=${encodeURIComponent(brand)}&scopeType=user&returnUrl=${encodeURIComponent(returnUrl)}`;
    const fullUrl = new URL(relativeUrl, window.location.origin).toString();
    window.location.assign(fullUrl);
  }

  async function handleSetDefaultGmail(id: string) {
    setSettingDefaultId(id);
    setFeedback(null);
    try {
      const res = await fetch('/api/user/integrations/gmail/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setFeedback({ type: 'success', message: 'Default Gmail sender account updated.' });
        await loadConnections();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Failed to set default account.' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Could not reach server to set default account.' });
    } finally {
      setSettingDefaultId(null);
    }
  }

  async function handleSyncGmail(id?: string) {
    setSyncingId(id || 'all');
    setFeedback(null);
    try {
      const url = `/api/user/integrations/gmail/sync?brand=${encodeURIComponent(brand)}${id ? `&id=${encodeURIComponent(id)}` : ''}`;
      const res = await fetch(url, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        const msg = data.ingested > 0
          ? `Synced ${data.ingested} new message${data.ingested === 1 ? '' : 's'} from your inbox!`
          : `Inbox checked — no new replies from CRM contacts (${data.skipped} messages skipped).`;
        setFeedback({ type: 'success', message: msg });
        await loadConnections();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Sync could not be completed.' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Could not reach server to sync messages.' });
    } finally {
      setSyncingId(null);
    }
  }

  async function handleTestGmail(id: string) {
    setTestingId(id);
    setFeedback(null);
    try {
      const res = await fetch('/api/user/integrations/gmail/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
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
      setTestingId(null);
    }
  }

  async function handleRefreshSignature(id: string) {
    setSyncingSignatureId(id);
    setFeedback(null);
    try {
      const res = await fetch('/api/user/integrations/gmail/signature/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setFeedback({
          type: 'success',
          message: data.signatureText ? 'Gmail signature synchronized successfully.' : 'Signature refreshed (no signature configured in Gmail).',
        });
        await loadConnections();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Failed to sync signature.' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Could not reach server to sync signature.' });
    } finally {
      setSyncingSignatureId(null);
    }
  }

  async function handleDisconnectGmail(id: string, label?: string) {
    const accountDesc = label ? ` (${label})` : '';
    if (!window.confirm(`Disconnect your Google account${accountDesc}? You will no longer be able to send or receive emails from this address.`)) {
      return;
    }
    setDisconnectingId(id);
    setFeedback(null);
    try {
      const res = await fetch('/api/user/integrations/gmail/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setFeedback({ type: 'success', message: 'Google account disconnected.' });
        await loadConnections();
      } else {
        setFeedback({ type: 'error', message: 'Failed to disconnect account.' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Network error while disconnecting.' });
    } finally {
      setDisconnectingId(null);
    }
  }

  async function handleUpdateCalendarSettings(patch: Partial<CalendarSyncSettings>) {
    setCalendarSaving(true);
    setFeedback(null);
    const updated = { ...calendarSettings, ...patch };
    setCalendarSettings(updated);
    try {
      const res = await fetch('/api/calendar/sync-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          ...updated,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setFeedback({ type: 'success', message: 'Google Calendar sync settings saved.' });
      } else {
        setFeedback({ type: 'error', message: data.error || 'Failed to save calendar settings.' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Could not reach server to update calendar settings.' });
    } finally {
      setCalendarSaving(false);
    }
  }

  const isGoogleConnected = gmailConnections.some((c) => c.status === 'active');
  const isAnyBusy = Boolean(testingId || syncingId || syncingSignatureId || disconnectingId || settingDefaultId);

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
          <Title order={5} mb={4}>Personal Mailboxes (Google / Gmail)</Title>
          <Text size="xs" c="dimmed">
            Connect one or more Google accounts to send outreach emails directly from your personal or brand mailboxes and automatically sync lead replies.
          </Text>
        </div>

        {loading ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : gmailConnections.length > 0 ? (
          <Stack gap="sm">
            {gmailConnections.map((conn) => {
              const isConnActive = conn.status === 'active';
              const isTestingThis = testingId === conn.id;
              const isSyncingThis = syncingId === conn.id;
              const isSyncingSigThis = syncingSignatureId === conn.id;
              const isDisconnectingThis = disconnectingId === conn.id;
              const isSettingDefaultThis = settingDefaultId === conn.id;

              return (
                <Paper
                  key={conn.id}
                  p="sm"
                  withBorder
                  radius="sm"
                  style={{
                    borderColor: isConnActive
                      ? (conn.isDefault ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-green-6)')
                      : 'var(--mantine-color-red-6)',
                  }}
                >
                  <Stack gap="xs">
                    <Group justify="space-between" align="center">
                      <Group gap="xs">
                        <IconBrandGoogle size={20} color={isConnActive ? 'red' : 'gray'} />
                        <div>
                          <Group gap={6} align="center">
                            <Text size="sm" fw={600}>
                              {conn.userEmail || conn.providerAccountLabel || user?.email || 'Connected Account'}
                            </Text>
                            {conn.isDefault && (
                              <Badge color="blue" variant="filled" size="xs">
                                Default Sender
                              </Badge>
                            )}
                          </Group>
                          <Text size="xs" c="dimmed">
                            Verified: {formatRelativeTime(conn.lastVerifiedAt)}
                          </Text>
                        </div>
                      </Group>
                      <Group gap="xs">
                        {!conn.isDefault && isConnActive && (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            color="blue"
                            onClick={() => handleSetDefaultGmail(conn.id)}
                            loading={isSettingDefaultThis}
                            disabled={isAnyBusy}
                          >
                            Set as Default
                          </Button>
                        )}
                        <Badge color={isConnActive ? 'green' : 'red'} variant="light">
                          {isConnActive ? 'Connected' : conn.status}
                        </Badge>
                      </Group>
                    </Group>

                    {conn.lastSyncError && (
                      <Text size="xs" c="red">
                        Error: {conn.lastSyncError}
                      </Text>
                    )}

                    <Divider my={4} />

                    <Stack gap={6}>
                      <Group justify="space-between" align="center">
                        <Text size="xs" fw={600} c="dimmed">Gmail Signature</Text>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="indigo"
                          leftSection={<IconRefresh size={12} />}
                          onClick={() => handleRefreshSignature(conn.id)}
                          loading={isSyncingSigThis}
                          disabled={isAnyBusy}
                        >
                          Refresh Signature
                        </Button>
                      </Group>
                      {conn.signatureText ? (
                        <Paper p="xs" withBorder bg="var(--mantine-color-gray-0)" radius="xs">
                          <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap', maxHeight: 80, overflowY: 'auto' }}>
                            {conn.signatureText}
                          </Text>
                          {conn.signatureSyncedAt && (
                            <Text size="10px" c="dimmed" mt={4}>
                              Synced: {formatRelativeTime(conn.signatureSyncedAt)}
                            </Text>
                          )}
                        </Paper>
                      ) : (
                        <Text size="xs" c="dimmed">
                          No signature found in Gmail. Click Refresh Signature to sync.
                        </Text>
                      )}
                    </Stack>

                    <Divider my={4} />

                    <Group justify="flex-end" gap="xs">
                      <Button
                        size="xs"
                        variant="light"
                        color="blue"
                        leftSection={<IconRefresh size={14} />}
                        onClick={() => handleSyncGmail(conn.id)}
                        loading={isSyncingThis}
                        disabled={isAnyBusy}
                      >
                        Sync Emails Now
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="gray"
                        leftSection={<IconCheck size={14} />}
                        onClick={() => handleTestGmail(conn.id)}
                        loading={isTestingThis}
                        disabled={isAnyBusy}
                      >
                        Test
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        leftSection={<IconUnlink size={14} />}
                        onClick={() => handleDisconnectGmail(conn.id, conn.userEmail || conn.providerAccountLabel)}
                        loading={isDisconnectingThis}
                        disabled={isAnyBusy}
                      >
                        Disconnect
                      </Button>
                    </Group>
                  </Stack>
                </Paper>
              );
            })}

            <Button
              size="xs"
              variant="light"
              color="indigo"
              leftSection={<IconPlus size={14} />}
              onClick={handleConnectGmail}
              disabled={configured?.google === false || configured?.encryption === false || isAnyBusy}
            >
              + Connect another Google Account
            </Button>
          </Stack>
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

              {configured?.google === false && (
                <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light" title="Google OAuth Setup Required">
                  <Stack gap={4}>
                    <Text size="xs">
                      Google OAuth credentials are not configured in this deployment environment.
                    </Text>
                    {isSuperAdmin && (
                      <Text size="xs" c="dimmed">
                        Admins: Configure <Text span ff="monospace" size="xs">GOOGLE_OAUTH_CLIENT_ID</Text>,{' '}
                        <Text span ff="monospace" size="xs">GOOGLE_OAUTH_CLIENT_SECRET</Text>, and{' '}
                        <Text span ff="monospace" size="xs">GOOGLE_OAUTH_REDIRECT_URI</Text> in your Vercel project environment variables.
                      </Text>
                    )}
                  </Stack>
                </Alert>
              )}

              {configured?.google && configured?.encryption === false && (
                <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light" title="Encryption Key Required">
                  <Stack gap={4}>
                    <Text size="xs">
                      Credential encryption key is missing in this deployment environment.
                    </Text>
                    {isSuperAdmin && (
                      <Text size="xs" c="dimmed">
                        Admins: Configure <Text span ff="monospace" size="xs">INTEGRATION_CREDENTIALS_ENCRYPTION_KEY</Text> (a 32-byte base64 key) in Vercel.
                      </Text>
                    )}
                  </Stack>
                </Alert>
              )}

              <Button
                size="sm"
                color="indigo"
                leftSection={<IconBrandGoogle size={16} />}
                onClick={handleConnectGmail}
                mt="xs"
                disabled={configured?.google === false || configured?.encryption === false}
              >
                {configured?.google === false
                  ? 'Google OAuth Setup Required'
                  : configured?.encryption === false
                  ? 'Encryption Key Setup Required'
                  : 'Connect with Google'}
              </Button>
            </Stack>
          </Paper>
        )}

        <Divider my="xs" />

        <div>
          <Group gap="xs" align="center" mb={4}>
            <IconCalendar size={18} color="var(--mantine-color-indigo-6)" />
            <Title order={5}>Google Calendar Task Reminders</Title>
          </Group>
          <Text size="xs" c="dimmed">
            Sync scheduled CRM cadence tasks (phone calls, LinkedIn steps, follow-ups) directly to your Google Calendar.
          </Text>
        </div>

        <Paper p="sm" withBorder radius="sm">
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <div>
                <Text size="sm" fw={500}>Calendar Sync Active</Text>
                <Text size="xs" c="dimmed">Create and update reminder events for your assigned tasks</Text>
              </div>
              <Switch
                checked={calendarSettings.syncEnabled}
                onChange={(e) => handleUpdateCalendarSettings({ syncEnabled: e.currentTarget.checked })}
                disabled={!isGoogleConnected || calendarSaving || calendarLoading}
                color="indigo"
              />
            </Group>

            <Divider />

            <Group justify="space-between" align="center">
              <div>
                <Text size="sm" fw={500}>Auto-sync Cadence Tasks</Text>
                <Text size="xs" c="dimmed">Automatically generate timed calendar reminders when sequence steps mature</Text>
              </div>
              <Switch
                checked={calendarSettings.autoSyncCadenceTasks}
                onChange={(e) => handleUpdateCalendarSettings({ autoSyncCadenceTasks: e.currentTarget.checked })}
                disabled={!isGoogleConnected || !calendarSettings.syncEnabled || calendarSaving || calendarLoading}
                color="indigo"
              />
            </Group>

            <Divider />

            <Group justify="space-between" align="center">
              <div>
                <Text size="sm" fw={500}>Default Reminder Duration</Text>
                <Text size="xs" c="dimmed">Timed events start at the task scheduled due time</Text>
              </div>
              <NumberInput
                value={calendarSettings.defaultDurationMinutes}
                onChange={(val) => {
                  const num = typeof val === 'number' ? val : parseInt(val as string, 10);
                  if (!isNaN(num)) {
                    handleUpdateCalendarSettings({ defaultDurationMinutes: Math.max(5, Math.min(480, num)) });
                  }
                }}
                min={5}
                max={480}
                step={5}
                disabled={!isGoogleConnected || !calendarSettings.syncEnabled || calendarSaving || calendarLoading}
                size="xs"
                w={90}
                rightSection={<Text size="10px" c="dimmed" pr={4}>min</Text>}
              />
            </Group>

            {!isGoogleConnected ? (
              <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light" p="xs">
                <Text size="xs">
                  Connect your Google account above to enable Google Calendar reminder synchronization.
                </Text>
              </Alert>
            ) : (
              <Paper p="xs" radius="xs" bg="var(--mantine-color-blue-0)">
                <Group gap="xs" align="flex-start" wrap="nowrap">
                  <IconInfoCircle size={15} color="var(--mantine-color-blue-7)" style={{ marginTop: 2, flexShrink: 0 }} />
                  <Text size="xs" c="blue.9">
                    Google Calendar events serve as personal reminders. Sequence progression and deal movement always depend on completing tasks in the CRM.
                  </Text>
                </Group>
              </Paper>
            )}
          </Stack>
        </Paper>

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
