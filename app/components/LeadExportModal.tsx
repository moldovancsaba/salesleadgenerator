'use client';

import { useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  Title,
  Text,
  Button,
  Radio,
  Paper,
  Divider,
} from '@mantine/core';
import { LabelTag } from '@sovereignsquad/gds-core/client';
import {
  IconDownload,
  IconCopy,
  IconBrandGoogle,
  IconCheck,
} from '@tabler/icons-react';
import { showNotification } from '@mantine/notifications';
import {
  CRM_PRESETS,
  type CrmPreset,
  exportLeadsToCsv,
  exportLeadsToGoogleSheetsTsv,
} from '@/lib/crm-lead-exchange';
import type { Lead } from '@/app/types';

type Props = {
  opened: boolean;
  onClose: () => void;
  brand: string;
  allLeadsCount?: number;
  filteredLeads: Lead[];
  selectedLeadIds?: string[];
  totalPipelineLeads?: number;
};

export function LeadExportModal({
  opened,
  onClose,
  brand,
  filteredLeads,
  selectedLeadIds = [],
  totalPipelineLeads,
}: Props) {
  const [preset, setPreset] = useState<CrmPreset>('google_sheets');
  const [scope, setScope] = useState<'all' | 'filtered' | 'selected'>(
    selectedLeadIds.length > 0 ? 'selected' : 'all'
  );
  const [downloading, setDownloading] = useState(false);
  const [copying, setCopying] = useState(false);

  async function resolveLeadsForExport(): Promise<Lead[]> {
    if (scope === 'selected' && selectedLeadIds.length > 0) {
      const selectedSet = new Set(selectedLeadIds);
      return filteredLeads.filter((l) => selectedSet.has(l._id));
    }

    if (scope === 'filtered') {
      return filteredLeads;
    }

    // scope === 'all': fetch full brand leads from server
    const url = new URL('/api/leads', window.location.origin);
    url.searchParams.set('brand', brand);
    url.searchParams.set('limit', '5000');
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Failed to load leads (${res.status})`);
    const data = await res.json();
    return (data.leads || []) as Lead[];
  }

  async function handleDownloadCsv() {
    setDownloading(true);
    try {
      const leads = await resolveLeadsForExport();
      if (leads.length === 0) {
        showNotification({
          title: 'No leads to export',
          message: 'There are no leads matching the selected export scope.',
          color: 'yellow',
        });
        return;
      }

      const csvContent = exportLeadsToCsv(leads, preset, brand);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${brand}-leads-${preset}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showNotification({
        title: 'Export successful',
        message: `Exported ${leads.length.toLocaleString()} leads in ${CRM_PRESETS[preset].label} format.`,
        color: 'teal',
        icon: <IconCheck size={16} />,
      });
      onClose();
    } catch (err: any) {
      console.error('Export error:', err);
      showNotification({
        title: 'Export failed',
        message: err?.message || 'Failed to generate export file.',
        color: 'red',
      });
    } finally {
      setDownloading(false);
    }
  }

  async function handleCopyGoogleSheets() {
    setCopying(true);
    try {
      const leads = await resolveLeadsForExport();
      if (leads.length === 0) {
        showNotification({
          title: 'No leads to copy',
          message: 'There are no leads matching the selected export scope.',
          color: 'yellow',
        });
        return;
      }

      const tsvContent = exportLeadsToGoogleSheetsTsv(leads);
      await navigator.clipboard.writeText(tsvContent);

      showNotification({
        title: 'Copied for Google Sheets!',
        message: `Copied ${leads.length.toLocaleString()} leads to clipboard. Open Google Sheets and paste with Cmd+V.`,
        color: 'teal',
        icon: <IconCheck size={16} />,
        autoClose: 6000,
      });
      onClose();
    } catch (err: any) {
      console.error('Copy error:', err);
      showNotification({
        title: 'Copy failed',
        message: err?.message || 'Failed to copy to clipboard.',
        color: 'red',
      });
    } finally {
      setCopying(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs" align="center">
          <IconDownload size={20} color="var(--mantine-color-indigo-6)" />
          <Title order={4}>Export Leads to Major CRM Systems</Title>
        </Group>
      }
      size="lg"
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Export prospect records formatted specifically for your CRM sales system, ready for seamless import without column remapping.
        </Text>

        <div>
          <Text size="sm" fw={600} mb="xs">
            1. Select Destination CRM Format
          </Text>
          <Radio.Group value={preset} onChange={(val) => setPreset(val as CrmPreset)}>
            <Stack gap="xs">
              <Paper
                p="xs"
                withBorder
                radius="sm"
                style={{
                  cursor: 'pointer',
                  borderColor: preset === 'google_sheets' ? 'var(--mantine-color-indigo-5)' : undefined,
                }}
                onClick={() => setPreset('google_sheets')}
              >
                <Group justify="space-between" align="center">
                  <Radio value="google_sheets" label="Google Sheets / Universal CSV" />
                  <LabelTag tone="success" size="xs" label="Recommended for Spreadsheets" />
                </Group>
                <Text size="xs" c="dimmed" mt={4} pl={28}>
                  {CRM_PRESETS.google_sheets.description}
                </Text>
              </Paper>

              <Paper
                p="xs"
                withBorder
                radius="sm"
                style={{
                  cursor: 'pointer',
                  borderColor: preset === 'hubspot' ? 'var(--mantine-color-indigo-5)' : undefined,
                }}
                onClick={() => setPreset('hubspot')}
              >
                <Group justify="space-between" align="center">
                  <Radio value="hubspot" label="HubSpot CRM" />
                  <LabelTag tone="warning" size="xs" label="HubSpot Schema" />
                </Group>
                <Text size="xs" c="dimmed" mt={4} pl={28}>
                  {CRM_PRESETS.hubspot.description}
                </Text>
              </Paper>

              <Paper
                p="xs"
                withBorder
                radius="sm"
                style={{
                  cursor: 'pointer',
                  borderColor: preset === 'salesforce' ? 'var(--mantine-color-indigo-5)' : undefined,
                }}
                onClick={() => setPreset('salesforce')}
              >
                <Group justify="space-between" align="center">
                  <Radio value="salesforce" label="Salesforce Sales Cloud" />
                  <LabelTag tone="info" size="xs" label="Salesforce Lead Schema" />
                </Group>
                <Text size="xs" c="dimmed" mt={4} pl={28}>
                  {CRM_PRESETS.salesforce.description}
                </Text>
              </Paper>

              <Paper
                p="xs"
                withBorder
                radius="sm"
                style={{
                  cursor: 'pointer',
                  borderColor: preset === 'pipedrive' ? 'var(--mantine-color-indigo-5)' : undefined,
                }}
                onClick={() => setPreset('pipedrive')}
              >
                <Group justify="space-between" align="center">
                  <Radio value="pipedrive" label="Pipedrive CRM" />
                  <LabelTag tone="info" size="xs" label="Pipedrive Deals Schema" />
                </Group>
                <Text size="xs" c="dimmed" mt={4} pl={28}>
                  {CRM_PRESETS.pipedrive.description}
                </Text>
              </Paper>
            </Stack>
          </Radio.Group>
        </div>

        <Divider />

        <div>
          <Text size="sm" fw={600} mb="xs">
            2. Choose Export Scope
          </Text>
          <Radio.Group value={scope} onChange={(val) => setScope(val as any)}>
            <Stack gap="xs">
              <Radio
                value="all"
                label={
                  <Text size="sm">
                    All pipeline leads for <Text span fw={600}>{brand.toUpperCase()}</Text> ({totalPipelineLeads ? totalPipelineLeads.toLocaleString() : 'All'} leads)
                  </Text>
                }
              />
              <Radio
                value="filtered"
                label={
                  <Text size="sm">
                    Currently visible / filtered leads ({filteredLeads.length.toLocaleString()} leads)
                  </Text>
                }
              />
              {selectedLeadIds.length > 0 && (
                <Radio
                  value="selected"
                  label={
                    <Text size="sm">
                      Selected leads only ({selectedLeadIds.length.toLocaleString()} selected)
                    </Text>
                  }
                />
              )}
            </Stack>
          </Radio.Group>
        </div>

        <Divider />

        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Button
            variant="light"
            color="teal"
            leftSection={<IconBrandGoogle size={16} />}
            onClick={handleCopyGoogleSheets}
            loading={copying}
            disabled={downloading}
          >
            Copy for Google Sheets (Cmd+V)
          </Button>

          <Group gap="xs">
            <Button variant="subtle" color="gray" onClick={onClose} disabled={downloading || copying}>
              Cancel
            </Button>
            <Button
              variant="filled"
              color="indigo"
              leftSection={<IconDownload size={16} />}
              onClick={handleDownloadCsv}
              loading={downloading}
              disabled={copying}
            >
              Download {CRM_PRESETS[preset].label} CSV
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
