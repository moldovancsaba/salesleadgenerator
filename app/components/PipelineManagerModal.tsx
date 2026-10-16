'use client';

import { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  Title,
  Button,
  TextInput,
  Select,
  Badge,
  Paper,
  Divider,
  Tooltip,
  ActionIcon,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import {
  IconPlus,
  IconTrash,
  IconArrowUp,
  IconArrowDown,
  IconCheck,
} from '@tabler/icons-react';
import type { Pipeline, PipelineStage } from '@/lib/pipelines';

const STAGE_COLOR_OPTIONS = [
  { value: 'blue', label: 'Blue' },
  { value: 'indigo', label: 'Indigo' },
  { value: 'violet', label: 'Violet' },
  { value: 'teal', label: 'Teal' },
  { value: 'green', label: 'Green' },
  { value: 'amber', label: 'Amber' },
  { value: 'orange', label: 'Orange' },
  { value: 'red', label: 'Red' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'grape', label: 'Grape' },
  { value: 'gray', label: 'Gray' },
];

const STAGE_TYPE_OPTIONS = [
  { value: 'open', label: 'Open stage' },
  { value: 'won', label: 'Won stage (100%)' },
  { value: 'lost', label: 'Lost stage (0%)' },
];

function buildStageKey(label: string, existingKeys: Set<string>): string {
  const base = label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'STAGE';
  if (!existingKeys.has(base)) return base;
  let suffix = 2;
  while (existingKeys.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}

function getStageType(stage: PipelineStage): 'open' | 'won' | 'lost' {
  if (stage.isWon) return 'won';
  if (stage.isLost) return 'lost';
  return 'open';
}

function applyStageType(stage: PipelineStage, type: string): PipelineStage {
  if (type === 'won') {
    return { ...stage, isWon: true, isLost: false, probability: 100 };
  }
  if (type === 'lost') {
    return { ...stage, isWon: false, isLost: true, probability: 0 };
  }
  return {
    ...stage,
    isWon: false,
    isLost: false,
    probability: stage.probability === 100 || stage.probability === 0 ? 25 : stage.probability,
  };
}

type Props = {
  opened: boolean;
  onClose: () => void;
  brand: string;
  pipelines: Pipeline[];
  selectedPipelineId: string | null;
  onPipelinesChanged: (pipelines: Pipeline[], nextSelectedId: string) => void;
};

export function PipelineManagerModal({
  opened,
  onClose,
  brand,
  pipelines,
  selectedPipelineId,
  onPipelinesChanged,
}: Props) {
  const [activeId, setActiveId] = useState<string>('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStages, setEditStages] = useState<PipelineStage[]>([]);
  const [newStageLabel, setNewStageLabel] = useState('');
  const [newStageColor, setNewStageColor] = useState<string>('blue');
  const [newStageType, setNewStageType] = useState<string>('open');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Create new pipeline state
  const [creatingMode, setCreatingMode] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createStages, setCreateStages] = useState<Array<{ label: string; color: string; type: 'open' | 'won' | 'lost' }>>([
    { label: 'Discovered', color: 'gray', type: 'open' },
    { label: 'Qualified', color: 'blue', type: 'open' },
    { label: 'Engaged', color: 'violet', type: 'open' },
    { label: 'Proposal', color: 'amber', type: 'open' },
    { label: 'Won', color: 'teal', type: 'won' },
    { label: 'Lost', color: 'red', type: 'lost' },
  ]);
  const [createStageDraftLabel, setCreateStageDraftLabel] = useState('');
  const [createStageDraftColor, setCreateStageDraftColor] = useState('indigo');

  const activePipeline = pipelines.find((p) => p.id === activeId) || pipelines[0] || null;

  useEffect(() => {
    if (!opened) return;
    const target = pipelines.find((p) => p.id === selectedPipelineId) || pipelines[0];
    if (target) {
      setActiveId(target.id);
      setEditName(target.name);
      setEditDescription(target.description || '');
      setEditStages(target.stages.map((s, idx) => ({ ...s, order: idx })));
    }
    setCreatingMode(false);
  }, [opened, selectedPipelineId, pipelines]);

  function selectPipelineForEdit(pipe: Pipeline) {
    setCreatingMode(false);
    setActiveId(pipe.id);
    setEditName(pipe.name);
    setEditDescription(pipe.description || '');
    setEditStages(pipe.stages.map((s, idx) => ({ ...s, order: idx })));
    setNewStageLabel('');
  }

  function handleStageLabelChange(index: number, label: string) {
    setEditStages((prev) => prev.map((s, i) => (i === index ? { ...s, label } : s)));
  }

  function handleStageColorChange(index: number, color: string) {
    setEditStages((prev) => prev.map((s, i) => (i === index ? { ...s, color } : s)));
  }

  function handleStageTypeChange(index: number, type: string) {
    setEditStages((prev) => prev.map((s, i) => (i === index ? applyStageType(s, type) : s)));
  }

  function handleMoveStage(index: number, direction: -1 | 1) {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= editStages.length) return;
    setEditStages((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy.map((s, idx) => ({ ...s, order: idx }));
    });
  }

  function handleRemoveStage(index: number) {
    if (editStages.length <= 1) {
      showNotification({ message: 'A pipeline must have at least one stage.', color: 'yellow' });
      return;
    }
    setEditStages((prev) => prev.filter((_, i) => i !== index).map((s, idx) => ({ ...s, order: idx })));
  }

  function handleAddStageToEdit() {
    const trimmed = newStageLabel.trim();
    if (!trimmed) return;
    const existingKeys = new Set(editStages.map((s) => s.key));
    const key = buildStageKey(trimmed, existingKeys);
    const baseStage: PipelineStage = {
      id: `stage_${key.toLowerCase()}_${Date.now().toString(36)}`,
      key,
      label: trimmed,
      color: newStageColor || 'blue',
      order: editStages.length,
    };
    const nextStage = applyStageType(baseStage, newStageType);
    setEditStages((prev) => [...prev, nextStage]);
    setNewStageLabel('');
    setNewStageType('open');
  }

  async function refreshPipelinesFromServer(preferredId?: string) {
    const res = await fetch(`/api/pipelines?brand=${encodeURIComponent(brand)}`);
    if (!res.ok) return;
    const data = await res.json();
    const list: Pipeline[] = Array.isArray(data.pipelines) ? data.pipelines : [];
    if (list.length > 0) {
      const nextId = preferredId && list.some((p) => p.id === preferredId)
        ? preferredId
        : (list.find((p) => p.isDefault) || list[0]).id;
      onPipelinesChanged(list, nextId);
    }
  }

  async function handleSavePipeline() {
    if (!activePipeline) return;
    const trimmedName = editName.trim();
    if (!trimmedName) {
      showNotification({ message: 'Pipeline name is required.', color: 'red' });
      return;
    }
    if (editStages.length === 0) {
      showNotification({ message: 'At least one stage is required.', color: 'red' });
      return;
    }
    setSaving(true);
    try {
      const normalizedStages = editStages.map((s, idx) => ({
        ...s,
        label: s.label.trim() || s.key,
        order: idx,
      }));
      const res = await fetch(
        `/api/pipelines/${encodeURIComponent(activePipeline.id)}?brand=${encodeURIComponent(brand)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            description: editDescription.trim() || undefined,
            stages: normalizedStages,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showNotification({ message: data.error || 'Failed to update pipeline', color: 'red' });
        return;
      }
      showNotification({ message: `Saved pipeline "${trimmedName}".`, color: 'teal' });
      await refreshPipelinesFromServer(activePipeline.id);
    } catch {
      showNotification({ message: 'Network error while saving pipeline', color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(pipe: Pipeline) {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/pipelines/${encodeURIComponent(pipe.id)}?brand=${encodeURIComponent(brand)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isDefault: true }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showNotification({ message: data.error || 'Failed to set default pipeline', color: 'red' });
        return;
      }
      showNotification({ message: `"${pipe.name}" is now the default pipeline.`, color: 'teal' });
      await refreshPipelinesFromServer(pipe.id);
    } catch {
      showNotification({ message: 'Network error while updating default pipeline', color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeletePipeline(pipe: Pipeline) {
    if (pipe.isDefault) return;
    if (!window.confirm(`Delete pipeline "${pipe.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/pipelines/${encodeURIComponent(pipe.id)}?brand=${encodeURIComponent(brand)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showNotification({ message: data.error || 'Cannot delete pipeline', color: 'red' });
        return;
      }
      showNotification({ message: `Deleted pipeline "${pipe.name}".`, color: 'teal' });
      await refreshPipelinesFromServer();
    } catch {
      showNotification({ message: 'Network error while deleting pipeline', color: 'red' });
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreatePipeline() {
    const trimmedName = createName.trim();
    if (!trimmedName) {
      showNotification({ message: 'Enter a name for the new pipeline.', color: 'red' });
      return;
    }
    const validDraftStages = createStages.filter((s) => s.label.trim().length > 0);
    if (validDraftStages.length === 0) {
      showNotification({ message: 'Add at least one stage to the new pipeline.', color: 'red' });
      return;
    }

    setSaving(true);
    try {
      // If the canonical default pipeline has not yet been persisted to MongoDB,
      // persist it first so both the default pipeline and the new pipeline coexist.
      const unpersistedDefault = pipelines.find(
        (p) => p.isDefault && p.createdAt === '1970-01-01T00:00:00.000Z'
      );
      if (unpersistedDefault) {
        await fetch(`/api/pipelines?brand=${encodeURIComponent(brand)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(unpersistedDefault),
        });
      }

      const usedKeys = new Set<string>();
      const stagesPayload: PipelineStage[] = validDraftStages.map((s, idx) => {
        const key = buildStageKey(s.label, usedKeys);
        usedKeys.add(key);
        const base: PipelineStage = {
          id: `stage_${key.toLowerCase()}_${idx}`,
          key,
          label: s.label.trim(),
          color: s.color || 'blue',
          order: idx,
        };
        return applyStageType(base, s.type);
      });

      const res = await fetch(`/api/pipelines?brand=${encodeURIComponent(brand)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: createDescription.trim() || undefined,
          isDefault: false,
          stages: stagesPayload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showNotification({ message: data.error || 'Failed to create pipeline', color: 'red' });
        return;
      }

      showNotification({ message: `Created pipeline "${trimmedName}".`, color: 'teal' });
      setCreateName('');
      setCreateDescription('');
      setCreatingMode(false);
      await refreshPipelinesFromServer(data.pipeline?.id);
    } catch {
      showNotification({ message: 'Network error while creating pipeline', color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Title order={4}>Manage Pipelines & Stages</Title>}
      size="lg"
      centered
    >
      <Stack gap="md">
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Group gap="xs" wrap="wrap">
            {pipelines.map((pipe) => (
              <Button
                key={pipe.id}
                size="xs"
                variant={!creatingMode && activePipeline?.id === pipe.id ? 'filled' : 'light'}
                color={pipe.isDefault ? 'indigo' : 'blue'}
                onClick={() => selectPipelineForEdit(pipe)}
              >
                {pipe.name}
                {pipe.isDefault ? ' (Default)' : ''}
              </Button>
            ))}
          </Group>
          <Button
            size="xs"
            variant={creatingMode ? 'filled' : 'outline'}
            color="teal"
            leftSection={<IconPlus size={14} />}
            onClick={() => setCreatingMode(true)}
          >
            New Pipeline
          </Button>
        </Group>

        <Divider />

        {creatingMode ? (
          <Stack gap="sm">
            <Title order={5}>Create New Pipeline</Title>
            <TextInput
              label="Pipeline name"
              placeholder="e.g. Sponsorships, Media Rights, Licensing"
              value={createName}
              onChange={(e) => setCreateName(e.currentTarget.value)}
              required
            />
            <TextInput
              label="Description (optional)"
              placeholder="Brief description of deals managed in this pipeline"
              value={createDescription}
              onChange={(e) => setCreateDescription(e.currentTarget.value)}
            />

            <Text size="xs" fw={600} c="dimmed" mt="xs">
              INITIAL STAGES ({createStages.length})
            </Text>
            <Stack gap="xs">
              {createStages.map((stage, idx) => (
                <Paper key={idx} withBorder p="xs" radius="sm">
                  <Group gap="xs" wrap="nowrap" align="center">
                    <Badge size="sm" variant="light" color={stage.color}>
                      {idx + 1}
                    </Badge>
                    <TextInput
                      size="xs"
                      style={{ flex: 1 }}
                      value={stage.label}
                      onChange={(e) => {
                        const val = e.currentTarget.value;
                        setCreateStages((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, label: val } : item))
                        );
                      }}
                      aria-label={`New pipeline stage ${idx + 1} name`}
                    />
                    <Select
                      size="xs"
                      data={STAGE_COLOR_OPTIONS}
                      value={stage.color}
                      onChange={(val) => {
                        if (!val) return;
                        setCreateStages((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, color: val } : item))
                        );
                      }}
                      style={{ width: 110 }}
                      aria-label={`New pipeline stage ${idx + 1} color`}
                    />
                    <Select
                      size="xs"
                      data={STAGE_TYPE_OPTIONS}
                      value={stage.type}
                      onChange={(val) => {
                        if (!val) return;
                        setCreateStages((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, type: val as 'open' | 'won' | 'lost' } : item
                          )
                        );
                      }}
                      style={{ width: 145 }}
                      aria-label={`New pipeline stage ${idx + 1} type`}
                    />
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      disabled={createStages.length <= 1}
                      onClick={() =>
                        setCreateStages((prev) => prev.filter((_, i) => i !== idx))
                      }
                      aria-label={`Remove stage ${stage.label}`}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </Paper>
              ))}
            </Stack>

            <Group gap="xs" align="flex-end">
              <TextInput
                size="xs"
                label="Add stage"
                placeholder="Stage name (e.g. Negotiation)"
                value={createStageDraftLabel}
                onChange={(e) => setCreateStageDraftLabel(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Select
                size="xs"
                label="Color"
                data={STAGE_COLOR_OPTIONS}
                value={createStageDraftColor}
                onChange={(val) => setCreateStageDraftColor(val || 'indigo')}
                style={{ width: 110 }}
              />
              <Button
                size="xs"
                variant="light"
                onClick={() => {
                  const trimmed = createStageDraftLabel.trim();
                  if (!trimmed) return;
                  setCreateStages((prev) => [
                    ...prev,
                    { label: trimmed, color: createStageDraftColor, type: 'open' },
                  ]);
                  setCreateStageDraftLabel('');
                }}
              >
                Add Stage
              </Button>
            </Group>

            <Group justify="flex-end" gap="xs" mt="sm">
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => setCreatingMode(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="xs"
                color="teal"
                loading={saving}
                onClick={handleCreatePipeline}
              >
                Create Pipeline
              </Button>
            </Group>
          </Stack>
        ) : activePipeline ? (
          <Stack gap="sm">
            <Group justify="space-between" align="flex-end" wrap="wrap" gap="xs">
              <TextInput
                label="Pipeline name"
                value={editName}
                onChange={(e) => setEditName(e.currentTarget.value)}
                style={{ flex: 1, minWidth: 200 }}
              />
              <Group gap="xs">
                {!activePipeline.isDefault && (
                  <Button
                    size="xs"
                    variant="light"
                    color="indigo"
                    leftSection={<IconCheck size={14} />}
                    onClick={() => handleSetDefault(activePipeline)}
                    loading={saving}
                  >
                    Set as Default
                  </Button>
                )}
                <Tooltip
                  label="The default pipeline cannot be deleted"
                  disabled={!activePipeline.isDefault}
                >
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    disabled={activePipeline.isDefault || deleting}
                    loading={deleting}
                    onClick={() => handleDeletePipeline(activePipeline)}
                  >
                    Delete Pipeline
                  </Button>
                </Tooltip>
              </Group>
            </Group>

            <TextInput
              label="Description"
              placeholder="Optional description"
              value={editDescription}
              onChange={(e) => setEditDescription(e.currentTarget.value)}
            />

            <Group justify="space-between" align="center" mt="xs">
              <Text size="xs" fw={600} c="dimmed">
                PIPELINE STAGES ({editStages.length})
              </Text>
              <Text size="xs" c="dimmed">
                Rename, recolor, reorder, or add stages below
              </Text>
            </Group>

            <Stack gap="xs">
              {editStages.map((stage, idx) => (
                <Paper key={stage.id || stage.key} withBorder p="xs" radius="sm">
                  <Group gap="xs" wrap="nowrap" align="center">
                    <Badge size="sm" variant="light" color={stage.color || 'gray'}>
                      {idx + 1}
                    </Badge>
                    <TextInput
                      size="xs"
                      value={stage.label}
                      onChange={(e) => handleStageLabelChange(idx, e.currentTarget.value)}
                      style={{ flex: 1 }}
                      aria-label={`Stage ${idx + 1} label`}
                    />
                    <Badge size="xs" variant="outline" color="gray">
                      {stage.key}
                    </Badge>
                    <Select
                      size="xs"
                      data={STAGE_COLOR_OPTIONS}
                      value={stage.color || 'gray'}
                      onChange={(val) => val && handleStageColorChange(idx, val)}
                      style={{ width: 105 }}
                      aria-label={`Stage ${stage.label} color`}
                    />
                    <Select
                      size="xs"
                      data={STAGE_TYPE_OPTIONS}
                      value={getStageType(stage)}
                      onChange={(val) => val && handleStageTypeChange(idx, val)}
                      style={{ width: 140 }}
                      aria-label={`Stage ${stage.label} outcome type`}
                    />
                    <Group gap={2} wrap="nowrap">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        disabled={idx === 0}
                        onClick={() => handleMoveStage(idx, -1)}
                        aria-label={`Move ${stage.label} earlier`}
                      >
                        <IconArrowUp size={14} />
                      </ActionIcon>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        disabled={idx === editStages.length - 1}
                        onClick={() => handleMoveStage(idx, 1)}
                        aria-label={`Move ${stage.label} later`}
                      >
                        <IconArrowDown size={14} />
                      </ActionIcon>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        disabled={editStages.length <= 1}
                        onClick={() => handleRemoveStage(idx)}
                        aria-label={`Delete stage ${stage.label}`}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </Group>
                </Paper>
              ))}
            </Stack>

            <Paper withBorder p="xs" radius="sm">
              <Group gap="xs" align="flex-end" wrap="wrap">
                <TextInput
                  size="xs"
                  label="Add new stage"
                  placeholder="e.g. Contract Review"
                  value={newStageLabel}
                  onChange={(e) => setNewStageLabel(e.currentTarget.value)}
                  style={{ flex: 1, minWidth: 160 }}
                />
                <Select
                  size="xs"
                  label="Color"
                  data={STAGE_COLOR_OPTIONS}
                  value={newStageColor}
                  onChange={(val) => setNewStageColor(val || 'blue')}
                  style={{ width: 105 }}
                />
                <Select
                  size="xs"
                  label="Stage type"
                  data={STAGE_TYPE_OPTIONS}
                  value={newStageType}
                  onChange={(val) => setNewStageType(val || 'open')}
                  style={{ width: 140 }}
                />
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconPlus size={14} />}
                  onClick={handleAddStageToEdit}
                  disabled={!newStageLabel.trim()}
                >
                  Add Stage
                </Button>
              </Group>
            </Paper>

            <Group justify="flex-end" gap="xs" mt="sm">
              <Button variant="default" size="xs" onClick={onClose} disabled={saving}>
                Close
              </Button>
              <Button
                color="indigo"
                size="xs"
                loading={saving}
                onClick={handleSavePipeline}
              >
                Save Pipeline & Stages
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Stack>
    </Modal>
  );
}
