'use client';

import { useState, useTransition } from 'react';
import {
  Modal,
  Stack,
  Group,
  Title,
  Text,
  Button,
  Select,
  Textarea,
  FileInput,
  Paper,
  Badge,
  Table,
  Divider,
  Alert,
  Loader,
} from '@mantine/core';
import {
  IconUpload,
  IconCheck,
  IconFileSpreadsheet,
  IconAlertCircle,
  IconClipboard,
} from '@tabler/icons-react';
import { showNotification } from '@mantine/notifications';
import {
  CRM_PRESETS,
  type CrmPreset,
  parseCrmImport,
  type CrmImportResult,
} from '@/lib/crm-lead-exchange';
import type { Lead, KanbanColumn } from '@/app/types';

type Props = {
  opened: boolean;
  onClose: () => void;
  brand: string;
  tenantId?: string;
  onImportCompleted?: () => void;
};

export function LeadImportModal({
  opened,
  onClose,
  brand,
  tenantId = 'default',
  onImportCompleted,
}: Props) {
  const [selectedPreset, setSelectedPreset] = useState<string>('auto');
  const [rawText, setRawText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<CrmImportResult | null>(null);
  const [dedupPolicy, setDedupPolicy] = useState<'skip' | 'update' | 'create_all'>('skip');
  const [targetStage, setTargetStage] = useState<KanbanColumn>('DISCOVERED');
  const [importing, setImporting] = useState(false);
  const [, startTransition] = useTransition();

  function handleFileChange(f: File | null) {
    setFile(f);
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      setRawText(text);
      processInput(text, selectedPreset);
    };
    reader.readAsText(f);
  }

  function handleTextChange(text: string) {
    setRawText(text);
    processInput(text, selectedPreset);
  }

  function handlePresetChange(presetVal: string | null) {
    const val = presetVal || 'auto';
    setSelectedPreset(val);
    if (rawText) {
      processInput(rawText, val);
    }
  }

  function processInput(text: string, presetVal: string) {
    if (!text.trim()) {
      setImportResult(null);
      return;
    }
    startTransition(() => {
      const forced = presetVal === 'auto' ? undefined : (presetVal as CrmPreset);
      const result = parseCrmImport(text, { forcedPreset: forced, defaultStage: targetStage });
      setImportResult(result);
    });
  }

  async function handleExecuteImport() {
    if (!importResult || importResult.validLeads.length === 0) return;

    setImporting(true);
    try {
      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          tenantId,
          leads: importResult.validLeads,
          preset: importResult.preset,
          deduplicationPolicy: dedupPolicy,
          defaultStage: targetStage,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Import failed with status ${res.status}`);
      }

      const summary = await res.json();

      showNotification({
        title: 'Import Completed',
        message: `Successfully processed ${summary.total} leads: ${summary.created} added, ${summary.updated} updated, ${summary.skipped} skipped.`,
        color: 'teal',
        icon: <IconCheck size={16} />,
        autoClose: 7000,
      });

      if (onImportCompleted) {
        onImportCompleted();
      }
      onClose();
    } catch (err: any) {
      console.error('Import execution error:', err);
      showNotification({
        title: 'Import Error',
        message: err?.message || 'Failed to complete lead import.',
        color: 'red',
      });
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs" align="center">
          <IconUpload size={20} color="var(--mantine-color-indigo-6)" />
          <Title order={4}>Import Leads from Major CRM Sales Systems</Title>
        </Group>
      }
      size="xl"
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Import prospective accounts and leads exported from <Text span fw={600}>HubSpot, Salesforce, Pipedrive, or Google Sheets</Text>. You can upload a CSV/TSV file or paste tabular data directly from your clipboard.
        </Text>

        <Group grow align="flex-start">
          <Select
            label="CRM System Source Format"
            value={selectedPreset}
            onChange={handlePresetChange}
            data={[
              { value: 'auto', label: '✨ Auto-Detect CRM Format' },
              { value: 'google_sheets', label: 'Google Sheets / Universal CSV' },
              { value: 'hubspot', label: 'HubSpot CRM' },
              { value: 'salesforce', label: 'Salesforce Sales Cloud' },
              { value: 'pipedrive', label: 'Pipedrive CRM' },
            ]}
          />

          <Select
            label="Default Pipeline Stage"
            value={targetStage}
            onChange={(val) => {
              const stage = (val as KanbanColumn) || 'DISCOVERED';
              setTargetStage(stage);
              if (rawText) processInput(rawText, selectedPreset);
            }}
            data={[
              { value: 'DISCOVERED', label: 'Discovered (Top of Funnel)' },
              { value: 'QUALIFIED', label: 'Qualified' },
              { value: 'ENGAGED', label: 'Engaged (Active Outreach)' },
              { value: 'PROPOSAL', label: 'Proposal Sent' },
              { value: 'WON', label: 'Won' },
              { value: 'BACKLOG', label: 'Backlog / Deferred' },
            ]}
          />
        </Group>

        <Paper p="sm" withBorder radius="sm">
          <Stack gap="xs">
            <Group justify="space-between" align="center">
              <Text size="sm" fw={600}>
                Upload File or Paste Data
              </Text>
              <FileInput
                size="xs"
                placeholder="Choose CSV / TSV file"
                accept=".csv,.tsv,.txt"
                value={file}
                onChange={handleFileChange}
                leftSection={<IconFileSpreadsheet size={14} />}
                clearable
              />
            </Group>

            <Textarea
              placeholder="Or paste rows copied directly from Google Sheets, Excel, HubSpot, or Salesforce here…"
              minRows={4}
              maxRows={8}
              value={rawText}
              onChange={(e) => handleTextChange(e.currentTarget.value)}
            />
          </Stack>
        </Paper>

        {importResult && (
          <Stack gap="xs">
            <Group justify="space-between" align="center">
              <Group gap="xs">
                <Text size="sm" fw={600}>
                  Parsed Data Preview
                </Text>
                <Badge color="indigo" variant="light">
                  Source: {CRM_PRESETS[importResult.preset]?.label || importResult.preset}
                </Badge>
                <Badge color="teal" variant="light">
                  {importResult.validLeads.length} valid lead{importResult.validLeads.length === 1 ? '' : 's'}
                </Badge>
              </Group>

              <Select
                size="xs"
                w={220}
                label="Deduplication"
                value={dedupPolicy}
                onChange={(val) => setDedupPolicy((val as any) || 'skip')}
                data={[
                  { value: 'skip', label: 'Skip existing duplicates' },
                  { value: 'update', label: 'Update existing leads' },
                  { value: 'create_all', label: 'Import all as new' },
                ]}
              />
            </Group>

            {importResult.warnings.length > 0 && (
              <Alert icon={<IconAlertCircle size={16} />} color="yellow" variant="light" p="xs">
                {importResult.warnings.join(' ')}
              </Alert>
            )}

            <Paper withBorder radius="sm" style={{ maxHeight: 240, overflowY: 'auto' }}>
              <Table striped highlightOnHover withColumnBorders style={{ fontSize: '0.75rem' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Company Name</Table.Th>
                    <Table.Th>Website</Table.Th>
                    <Table.Th>Country</Table.Th>
                    <Table.Th>Primary Contact</Table.Th>
                    <Table.Th>Stage</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {importResult.preview.map((row, idx) => (
                    <Table.Tr key={idx}>
                      <Table.Td fw={600}>{row.mapped.entity_name || '—'}</Table.Td>
                      <Table.Td>{row.mapped.url || '—'}</Table.Td>
                      <Table.Td>{row.mapped.country || '—'}</Table.Td>
                      <Table.Td>
                        {row.mapped.contacts?.[0]?.name ? (
                          <div>
                            <div>{row.mapped.contacts[0].name}</div>
                            {row.mapped.contacts[0].email && (
                              <Text size="xs" c="dimmed">{row.mapped.contacts[0].email}</Text>
                            )}
                          </div>
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" color="gray" variant="light">
                          {row.mapped.kanbanColumn}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          </Stack>
        )}

        <Divider />

        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" color="gray" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button
            variant="filled"
            color="indigo"
            leftSection={importing ? <Loader size={14} color="white" /> : <IconUpload size={14} />}
            onClick={handleExecuteImport}
            disabled={!importResult || importResult.validLeads.length === 0 || importing}
            loading={importing}
          >
            Import {importResult ? importResult.validLeads.length.toLocaleString() : 0} Leads
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
