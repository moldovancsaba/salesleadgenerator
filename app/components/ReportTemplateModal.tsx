'use client';

import { Modal, Stack, Group, Title, Text, Button, Paper, Badge, Divider, SimpleGrid } from '@mantine/core';
import { IconSparkles, IconChartBar, IconTable, IconArrowRight, IconLayersLinked } from '@tabler/icons-react';
import { REPORT_TEMPLATES, type ReportTemplate } from '@/lib/report-templates';
import { METRIC_OPTIONS, GROUP_BY_OPTIONS } from '@/lib/report-pipeline';

type Props = {
  opened: boolean;
  onClose: () => void;
  onSelectTemplate: (template: ReportTemplate) => void;
  onSeedStarterPack: () => Promise<void>;
  seeding?: boolean;
};

export function ReportTemplateModal({ opened, onClose, onSelectTemplate, onSeedStarterPack, seeding }: Props) {
  const categories = Array.from(new Set(REPORT_TEMPLATES.map((t) => t.category)));

  function getMetricLabel(metric: string) {
    return METRIC_OPTIONS.find((m) => m.value === metric)?.label || metric;
  }

  function getGroupByLabel(field: string) {
    return GROUP_BY_OPTIONS.find((g) => g.value === field)?.label || field;
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs" align="center">
          <IconSparkles size={20} color="var(--mantine-color-indigo-6)" />
          <Title order={4}>Report Templates Gallery</Title>
        </Group>
      }
      size="xl"
      centered
    >
      <Stack gap="md">
        <Paper p="sm" withBorder radius="sm" bg="var(--mantine-color-indigo-0)">
          <Group justify="space-between" align="center" wrap="wrap" gap="sm">
            <div>
              <Text size="sm" fw={600} c="indigo.9">
                Explore & Learn: How Reports Are Built
              </Text>
              <Text size="xs" c="indigo.8">
                Select any template below to load its configuration into the editor. You can customize metrics, dimensions, and filters before saving.
              </Text>
            </div>
            <Button
              size="xs"
              variant="filled"
              color="indigo"
              leftSection={<IconLayersLinked size={14} />}
              onClick={onSeedStarterPack}
              loading={seeding}
            >
              Add All 6 Starter Reports
            </Button>
          </Group>
        </Paper>

        <Stack gap="lg">
          {categories.map((cat) => {
            const templates = REPORT_TEMPLATES.filter((t) => t.category === cat);
            return (
              <div key={cat}>
                <Title order={5} mb="xs" c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>
                  {cat}
                </Title>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  {templates.map((tmpl) => (
                    <Paper key={tmpl.id} p="sm" withBorder radius="sm" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <Stack gap="xs">
                        <Group justify="space-between" align="flex-start" wrap="nowrap">
                          <Text size="sm" fw={600}>
                            {tmpl.name}
                          </Text>
                          <Badge size="xs" variant="light" color={tmpl.chartType === 'table' ? 'gray' : 'blue'}>
                            {tmpl.chartType === 'table' ? 'Table' : tmpl.chartType === 'line' ? 'Line' : 'Bar'}
                          </Badge>
                        </Group>

                        <Text size="xs" c="dimmed" style={{ minHeight: 40 }}>
                          {tmpl.description}
                        </Text>

                        <Group gap={6} wrap="wrap">
                          <Badge size="xs" variant="outline" color="indigo">
                            Metric: {getMetricLabel(tmpl.metric)}
                          </Badge>
                          {tmpl.groupBy.length > 0 ? (
                            <Badge size="xs" variant="outline" color="teal">
                              By: {tmpl.groupBy.map(getGroupByLabel).join(' + ')}
                            </Badge>
                          ) : (
                            <Badge size="xs" variant="outline" color="gray">
                              Total aggregate
                            </Badge>
                          )}
                        </Group>
                      </Stack>

                      <Divider my="xs" />

                      <Group justify="flex-end">
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="indigo"
                          rightSection={<IconArrowRight size={12} />}
                          onClick={() => {
                            onSelectTemplate(tmpl);
                            onClose();
                          }}
                        >
                          Use Template
                        </Button>
                      </Group>
                    </Paper>
                  ))}
                </SimpleGrid>
              </div>
            );
          })}
        </Stack>

        <Group justify="flex-end" mt="xs">
          <Button variant="default" size="sm" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
