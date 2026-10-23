'use client';

import { useState } from 'react';
import {
  Paper,
  Group,
  Stack,
  Text,
  Button,
  Collapse,
  TextInput,
  Modal,
  Tabs,
  Box,
} from '@mantine/core';
import { StatusBadge, LabelTag } from '@sovereignsquad/gds-core/client';
import {
  IconCheck,
  IconChevronRight,
  IconClipboardList,
  IconBulb,
} from '@tabler/icons-react';
import {
  getStageGuidance,
  DISCOVERY_PLAYBOOKS,
  compilePlaybookSubmission,
  type DiscoveryPlaybook,
} from '@/lib/sales-playbooks';

type StageOption = { value: string; label: string };

type Props = {
  currentStage: string;
  stageOptions: StageOption[];
  disabled?: boolean;
  existingQualification?: {
    budgetConfirmed?: boolean;
    budgetNotes?: string;
    authorityConfirmed?: boolean;
    needNotes?: string;
    timelineEstimate?: string;
  };
  existingChecklist?: Array<{ id?: string; text: string; done: boolean }>;
  existingNotes?: string;
  onSelectStage: (stage: string) => void;
  onApplyPlaybook: (payload: {
    notes: string;
    qualification: {
      budgetConfirmed: boolean;
      budgetNotes: string;
      authorityConfirmed: boolean;
      needNotes: string;
      timelineEstimate: string;
    };
    checklist: Array<{ id?: string; text: string; done: boolean }>;
  }) => Promise<void>;
};

export function SalesPathPlaybookBar({
  currentStage,
  stageOptions,
  disabled,
  existingQualification,
  existingChecklist,
  existingNotes,
  onSelectStage,
  onApplyPlaybook,
}: Props) {
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [playbookModalOpen, setPlaybookModalOpen] = useState(false);
  const [activePlaybookId, setActivePlaybookId] = useState<string>('bant');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savingPlaybook, setSavingPlaybook] = useState(false);

  const guidance = getStageGuidance(currentStage);
  const currentIdx = stageOptions.findIndex((s) => s.value === currentStage);

  const activePlaybook: DiscoveryPlaybook =
    DISCOVERY_PLAYBOOKS.find((p) => p.id === activePlaybookId) || DISCOVERY_PLAYBOOKS[0];

  const hasAnyAnswer = activePlaybook.questions.some(
    (q) => (answers[q.id] || '').trim().length > 0
  );

  async function handleSavePlaybook() {
    if (!hasAnyAnswer) return;
    setSavingPlaybook(true);
    try {
      const compiled = compilePlaybookSubmission(
        activePlaybook,
        answers,
        existingQualification,
        existingChecklist
      );
      const mergedNotes = existingNotes?.trim()
        ? `${existingNotes.trim()}\n\n${compiled.formattedNote}`
        : compiled.formattedNote;
      const mergedChecklist = [
        ...(existingChecklist || []),
        ...compiled.newChecklistItems,
      ];
      await onApplyPlaybook({
        notes: mergedNotes,
        qualification: compiled.qualificationPatch,
        checklist: mergedChecklist,
      });
      setAnswers({});
      setPlaybookModalOpen(false);
    } finally {
      setSavingPlaybook(false);
    }
  }

  return (
    <>
      <Paper
        withBorder
        p="xs"
        radius="md"
        style={{
          borderColor: 'var(--gds-border-card)',
          backgroundColor: 'var(--gds-bg-card)',
        }}
      >
        <Stack gap="xs">
          {/* Interactive Horizontal Sales Path Stepper */}
          <Group gap={4} wrap="wrap" justify="space-between">
            <Group gap={4} wrap="wrap" style={{ flex: 1 }}>
              {stageOptions.map((st, idx) => {
                const isCurrent = st.value === currentStage;
                const isPast =
                  currentIdx >= 0 &&
                  idx < currentIdx &&
                  currentStage !== 'LOST' &&
                  st.value !== 'LOST';
                const color =
                  st.value === 'WON'
                    ? 'teal'
                    : st.value === 'LOST'
                      ? 'red'
                      : isCurrent
                        ? 'indigo'
                        : isPast
                          ? 'teal'
                          : 'gray';
                return (
                  <Button
                    key={st.value}
                    size="compact-xs"
                    variant={isCurrent ? 'filled' : isPast ? 'light' : 'subtle'}
                    color={color}
                    disabled={disabled}
                    leftSection={isPast ? <IconCheck size={11} /> : undefined}
                    rightSection={
                      idx < stageOptions.length - 1 ? (
                        <IconChevronRight size={11} />
                      ) : undefined
                    }
                    onClick={() => {
                      if (!isCurrent) onSelectStage(st.value);
                    }}
                    aria-label={`Move stage to ${st.label}`}
                  >
                    {st.label}
                  </Button>
                );
              })}
            </Group>

            <Group gap={6} wrap="nowrap">
              <Button
                size="compact-xs"
                variant="light"
                color="indigo"
                leftSection={<IconBulb size={12} />}
                onClick={() => setGuidanceOpen((o) => !o)}
              >
                {guidanceOpen ? 'Hide Guidance' : 'Stage Guidance'}
              </Button>
              <Button
                size="compact-xs"
                variant="default"
                leftSection={<IconClipboardList size={12} />}
                disabled={disabled}
                onClick={() => setPlaybookModalOpen(true)}
              >
                Discovery Playbook
              </Button>
            </Group>
          </Group>

          <Collapse expanded={guidanceOpen}>
            <Box
              p="xs"
              style={{
                borderTop: '1px solid var(--gds-border-card)',
              }}
            >
              <Stack gap={6}>
                <Group justify="space-between" align="center">
                  <Group gap="xs">
                    <StatusBadge status="info" size="xs">
                      {guidance.label} Stage Playbook
                    </StatusBadge>
                    <Text size="xs" fw={600}>
                      Objective:
                    </Text>
                  </Group>
                </Group>
                <Text size="xs">{guidance.objective}</Text>

                <Text size="xs" fw={600} mt={4}>
                  Exit Criteria:
                </Text>
                <Stack gap={2}>
                  {guidance.exitCriteria.map((item, i) => (
                    <Text key={i} size="xs" c="dimmed">
                      ✓ {item}
                    </Text>
                  ))}
                </Stack>

                <Text size="xs" c="dimmed" fs="italic" mt={4}>
                  Coach Tip: &ldquo;{guidance.talkTrack}&rdquo;
                </Text>
              </Stack>
            </Box>
          </Collapse>
        </Stack>
      </Paper>

      <Modal
        opened={playbookModalOpen}
        onClose={() => setPlaybookModalOpen(false)}
        title="Interactive Discovery Playbooks"
        size="lg"
        centered
      >
        <Stack gap="md">
          <Text size="xs" c="dimmed">
            Run a structured discovery framework during your call. Submitting automatically updates the lead&apos;s Qualification fields, appends structured discovery notes, and creates recommended follow-up checklist items.
          </Text>

          <Tabs
            value={activePlaybookId}
            onChange={(val) => {
              if (val) setActivePlaybookId(val);
            }}
          >
            <Tabs.List>
              {DISCOVERY_PLAYBOOKS.map((pb) => (
                <Tabs.Tab key={pb.id} value={pb.id}>
                  <Group gap={6} wrap="nowrap">
                    <Text size="xs" fw={600}>
                      {pb.name.replace(' Playbook', '')}
                    </Text>
                    <LabelTag tone="info" size="xs" label={pb.badge} />
                  </Group>
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>

          <Text size="xs" c="dimmed">
            {activePlaybook.description}
          </Text>

          <Stack gap="sm">
            {activePlaybook.questions.map((q) => (
              <TextInput
                key={q.id}
                size="xs"
                label={q.label}
                placeholder={q.placeholder}
                value={answers[q.id] || ''}
                onChange={(e) => {
                  const val = e.currentTarget.value;
                  setAnswers((prev) => ({ ...prev, [q.id]: val }));
                }}
              />
            ))}
          </Stack>

          <Group justify="flex-end" gap="xs" mt="sm">
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              onClick={() => setPlaybookModalOpen(false)}
              disabled={savingPlaybook}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              color="teal"
              loading={savingPlaybook}
              disabled={!hasAnyAnswer}
              onClick={handleSavePlaybook}
            >
              Save Discovery &amp; Update Lead
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
