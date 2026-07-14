'use client';

import { useState } from 'react';
import type { Lead } from './types';
import { 
  Modal, 
  Stack, 
  Group, 
  Text, 
  Badge, 
  Progress, 
  Textarea, 
  Select, 
  Button, 
  Box,
  Title,
  Divider,
  Paper,
  SimpleGrid
} from '@mantine/core';
import { regionTone } from './theme/semantic';
import { iceTone, qualityTone } from './theme/semantic';
import { semanticToneToMantineColor } from './utils/semantic-colors';
import { IconX, IconThumbUp, IconThumbDown, IconPin, IconRefresh } from '@tabler/icons-react';

type KanbanColumn = Lead['kanbanColumn'];
type DeclineReason = Lead extends { declineReason?: infer R } ? R : never;

type Props = {
  lead: Lead;
  onClose: () => void;
  onAction: (leadId: string, action: string, payload?: any) => void;
  onUpdated: () => void;
};

const DECLINE_REASONS: { value: DeclineReason; label: string }[] = [
  { value: "WRONG_INDUSTRY", label: "Wrong industry" },
  { value: "NO_DECISION_MAKER", label: "No decision maker" },
  { value: "TOO_SMALL", label: "Too small" },
  { value: "ALREADY_COMPETITOR", label: "Already competitor" },
  { value: "BAD_TIMING", label: "Bad timing" },
  { value: "BUDGET_CONSTRAINTS", label: "Budget constraints" },
  { value: "NOT_RESPONSIVE", label: "Not responsive" },
  { value: "MISSING_CONTEXT", label: "Missing context" },
  { value: "LOW_PRIORITY", label: "Low priority" },
  { value: "OTHER", label: "Other" },
];

export function LeadDetailModal({ lead, onClose, onAction }: Props) {
  const [annotation, setAnnotation] = useState("");
  const [declineReason, setDeclineReason] = useState<DeclineReason>("OTHER");
  const [actionMode, setActionMode] = useState<"decline" | "pin" | "refresh" | null>(null);
  const [busy, setBusy] = useState(false);

  const ice = lead.ice || { impact: 0, confidence: 0, ease: 0 };
  const iceScore = Math.round(ice.impact * ice.confidence * ice.ease);
  const maxIce = 1000;
  const icePercent = Math.min(100, (iceScore / maxIce) * 100);
  
  // Get Mantine color values from semantic tones
  const iceToneValue = semanticToneToMantineColor(iceTone(iceScore));
  const regionToneValue = semanticToneToMantineColor(regionTone[lead.region]);
  const qualityToneValue = semanticToneToMantineColor(qualityTone[lead.qualityStatus]);

  async function handleAccept() {
    setBusy(true);
    onAction(lead._id, "ACCEPT", { annotation: annotation || "Accepted" });
    setBusy(false);
  }

  async function handleDecline() {
    setBusy(true);
    onAction(lead._id, "DECLINE", { declineReason, annotation });
    setBusy(false);
  }

  async function handlePin() {
    setBusy(true);
    onAction(lead._id, "PIN", { annotation });
    setBusy(false);
  }

  async function handleRefresh() {
    setBusy(true);
    onAction(lead._id, "REQUEST_REFRESH", { annotation });
    setBusy(false);
  }

  async function handleModify() {
    setBusy(true);
    onAction(lead._id, "MODIFY", { annotation });
    setBusy(false);
  }

  return (
    <Modal
      opened={true}
      onClose={onClose}
      size="xl"
      padding={0}
      withCloseButton={false}
      fullScreen={true}
    >
      <Paper radius="md" withBorder={false}>
        {/* Header */}
        <Box p="md" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
          <Group justify="space-between" align="flex-start">
            <Stack gap="xs" style={{ flex: 1 }}>
              <Title order={2}>{lead.entity_name}</Title>
              <Group gap="xs">
                <Badge variant="light" color={regionToneValue}>
                  {lead.region}
                </Badge>
                <Text size="sm" c="dimmed">{lead.industry || lead.sport_or_sector}</Text>
                <Badge variant="light" color={qualityToneValue}>
                  {lead.qualityStatus || 'DRAFT'}
                </Badge>
              </Group>
            </Stack>
            <Button variant="subtle" color="gray" onClick={onClose} p={4}>
              <IconX size={20} />
            </Button>
          </Group>
        </Box>

        {/* Content */}
        <Box p="md">
          <Stack gap="md">
            {/* ICE Score */}
            <Paper p="md" withBorder>
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text fw={600}>ICE Score</Text>
                  <Text fw={700} size="lg">{iceScore} / {maxIce}</Text>
                </Group>
                <Progress value={icePercent} size="lg" color={iceToneValue} />
                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
                  <Box>
                    <Text size="xs" c="dimmed">Impact</Text>
                    <Text fw={600}>{ice.impact} / 10</Text>
                  </Box>
                  <Box>
                    <Text size="xs" c="dimmed">Confidence</Text>
                    <Text fw={600}>{ice.confidence} / 10</Text>
                  </Box>
                  <Box>
                    <Text size="xs" c="dimmed">Ease</Text>
                    <Text fw={600}>{ice.ease} / 10</Text>
                  </Box>
                </SimpleGrid>
              </Stack>
            </Paper>

            {/* Details */}
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Box>
                <Text size="xs" c="dimmed">URL</Text>
                {lead.url ? (
                  <Text size="sm" component="a" href={lead.url} target="_blank" c="blue">
                    {lead.url}
                  </Text>
                ) : '—'}
              </Box>
              <Box>
                <Text size="xs" c="dimmed">Size</Text>
                <Text size="sm">{lead.size || '—'}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">Level / League</Text>
                <Text size="sm">{lead.level_league || '—'}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">Kanban Column</Text>
                <Text size="sm">{lead.kanbanColumn}</Text>
              </Box>
            </SimpleGrid>

            {/* Decision Maker */}
            {lead.decision_maker_name && (
              <Paper p="md" withBorder>
                <Stack gap="xs">
                  <Text size="xs" c="dimmed" fw={600}>DECISION MAKER</Text>
                  <Text fw={600}>{lead.decision_maker_name}</Text>
                  {lead.decision_maker_title && (
                    <Text size="sm" c="dimmed">{lead.decision_maker_title}</Text>
                  )}
                  {lead.decision_maker_contact && (
                    <Text size="sm" c="dimmed">{lead.decision_maker_contact}</Text>
                  )}
                </Stack>
              </Paper>
            )}

            {/* Pros / Cons */}
            {((lead.pro_for_cogmap && lead.pro_for_cogmap.length > 0) || 
              (lead.con_for_cogmap && lead.con_for_cogmap.length > 0)) && (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                {lead.pro_for_cogmap && lead.pro_for_cogmap.length > 0 && (
                  <Paper p="md" withBorder>
                    <Stack gap="xs">
                      <Text size="xs" c="green" fw={600} tt="uppercase">Pros for CogMap</Text>
                      <Stack gap={4}>
                        {lead.pro_for_cogmap.map((pro, i) => (
                          <Text size="sm" key={i}>• {pro}</Text>
                        ))}
                      </Stack>
                    </Stack>
                  </Paper>
                )}
                {lead.con_for_cogmap && lead.con_for_cogmap.length > 0 && (
                  <Paper p="md" withBorder>
                    <Stack gap="xs">
                      <Text size="xs" c="red" fw={600} tt="uppercase">Cons for CogMap</Text>
                      <Stack gap={4}>
                        {lead.con_for_cogmap.map((con, i) => (
                          <Text size="sm" key={i}>• {con}</Text>
                        ))}
                      </Stack>
                    </Stack>
                  </Paper>
                )}
              </SimpleGrid>
            )}

            {/* Value Proposition */}
            {lead.value_proposition && (
              <Paper p="md" withBorder>
                <Stack gap="xs">
                  <Text size="xs" c="blue" fw={600} tt="uppercase">Value Proposition</Text>
                  <Text size="sm">{lead.value_proposition}</Text>
                </Stack>
              </Paper>
            )}

            {/* Feedback Summary */}
            {(lead.feedbackScore > 0 || lead.declineCount > 0 || lead.acceptanceCount > 0) && (
              <Paper p="md" withBorder>
                <Stack gap="xs">
                  <Text size="xs" fw={600} tt="uppercase">Feedback History</Text>
                  <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
                    <Box>
                      <Text size="xs" c="dimmed">Feedback Score</Text>
                      <Text fw={700}>{lead.feedbackScore}</Text>
                    </Box>
                    <Box>
                      <Text size="xs" c="dimmed">Acceptances</Text>
                      <Text fw={700} c="green">{lead.acceptanceCount}</Text>
                    </Box>
                    <Box>
                      <Text size="xs" c="dimmed">Declines</Text>
                      <Text fw={700} c="red">{lead.declineCount}</Text>
                    </Box>
                  </SimpleGrid>
                  {lead.declinedAt && lead.declineReason && (
                    <Text size="xs" c="dimmed">
                      Declined: {new Date(lead.declinedAt).toLocaleDateString()} ({lead.declineReason})
                    </Text>
                  )}
                </Stack>
              </Paper>
            )}

            <Divider />

            {/* Annotation */}
            <Stack gap="xs">
              <Text fw={600}>Annotation</Text>
              <Textarea
                value={annotation}
                onChange={(e) => setAnnotation(e.target.value)}
                rows={3}
                placeholder="Add notes, reasoning, or context for your action…"
              />
            </Stack>
          </Stack>
        </Box>

        {/* Actions */}
        <Box p="md" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
          {!actionMode ? (
            <Group gap="sm" wrap="wrap">
              <Button 
                color="green" 
                leftSection={<IconThumbUp size={16} />}
                onClick={handleAccept}
                disabled={busy}
              >
                Accept → QUALIFIED
              </Button>
              <Button 
                color="red" 
                leftSection={<IconThumbDown size={16} />}
                onClick={() => setActionMode("decline")}
                disabled={busy}
                variant="light"
              >
                Decline → LOST
              </Button>
              <Button 
                color="blue" 
                leftSection={<IconPin size={16} />}
                onClick={handlePin}
                disabled={busy}
                variant="light"
              >
                Pin to ENGAGED
              </Button>
              <Button 
                color="gray" 
                leftSection={<IconRefresh size={16} />}
                onClick={handleRefresh}
                disabled={busy}
                variant="light"
              >
                Request Refresh
              </Button>
            </Group>
          ) : actionMode === "decline" ? (
            <Stack gap="sm">
              <Stack gap="xs">
                <Text fw={600}>Decline Reason</Text>
                <Select
                  data={DECLINE_REASONS.map(r => ({ value: r.value, label: r.label }))}
                  value={declineReason}
                  onChange={(value) => setDeclineReason((value as DeclineReason) || "OTHER")}
                />
              </Stack>
              <Group gap="sm">
                <Button 
                  color="red" 
                  onClick={handleDecline}
                  disabled={busy}
                  style={{ flex: 1 }}
                >
                  Confirm Decline
                </Button>
                <Button 
                  color="gray" 
                  variant="light"
                  onClick={() => setActionMode(null)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </Group>
            </Stack>
          ) : null}
        </Box>
      </Paper>
    </Modal>
  );
}
