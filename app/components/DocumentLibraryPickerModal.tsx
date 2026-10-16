'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  TextInput,
  Button,
  Badge,
  Paper,
  Loader,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import {
  IconSearch,
  IconFile,
  IconFileText,
  IconPhoto,
  IconCheck,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import type { DocumentRecord } from '@/lib/documents';

type Props = {
  opened: boolean;
  onClose: () => void;
  brand: string;
  selectedDocumentIds: string[];
  onToggleDocument: (doc: DocumentRecord) => void;
};

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function getFileIcon(mimeType: string) {
  if (mimeType.includes('pdf')) return <IconFileText size={18} color="var(--mantine-color-red-6)" />;
  if (mimeType.includes('image')) return <IconPhoto size={18} color="var(--mantine-color-teal-6)" />;
  return <IconFile size={18} color="var(--mantine-color-blue-6)" />;
}

export function DocumentLibraryPickerModal({
  opened,
  onClose,
  brand,
  selectedDocumentIds,
  onToggleDocument,
}: Props) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents?brand=${encodeURIComponent(brand)}`);
      if (!res.ok) throw new Error('Failed to load documents');
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [brand]);

  useEffect(() => {
    if (opened) {
      fetchDocuments();
    }
  }, [opened, fetchDocuments]);

  const filtered = documents.filter((d) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      d.displayName.toLowerCase().includes(q) ||
      d.filename.toLowerCase().includes(q) ||
      d.mimeType.toLowerCase().includes(q)
    );
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={600}>Attach from Document Library</Text>}
      size="lg"
      padding="md"
    >
      <Stack gap="md">
        <TextInput
          placeholder="Search documents by name or file type..."
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {loading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Loading documents...</Text>
          </Group>
        ) : error ? (
          <Paper p="md" withBorder bg="red.0">
            <Text size="sm" c="red.7">{error}</Text>
          </Paper>
        ) : filtered.length === 0 ? (
          <Paper p="xl" withBorder style={{ textAlign: 'center' }}>
            <IconFile size={36} color="var(--mantine-color-gray-4)" style={{ margin: '0 auto 8px' }} />
            <Text fw={500} size="sm">No documents found</Text>
            <Text size="xs" c="dimmed" mt={4}>
              {documents.length === 0
                ? 'No documents have been uploaded to this workspace library yet.'
                : 'No documents match your search query.'}
            </Text>
          </Paper>
        ) : (
          <Stack gap="xs" style={{ maxHeight: 380, overflowY: 'auto' }}>
            {filtered.map((doc) => {
              const isSelected = selectedDocumentIds.includes(doc.id);
              return (
                <Paper
                  key={doc.id}
                  p="xs"
                  withBorder
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderColor: isSelected ? 'var(--mantine-color-indigo-4)' : undefined,
                    backgroundColor: isSelected ? 'var(--mantine-color-indigo-0)' : undefined,
                  }}
                >
                  <Group gap="sm" style={{ flex: 1, minWidth: 0 }}>
                    {getFileIcon(doc.mimeType)}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={500} truncate>
                        {doc.displayName}
                      </Text>
                      <Group gap={6} mt={2}>
                        <Text size="xs" c="dimmed">{formatFileSize(doc.sizeBytes)}</Text>
                        <Text size="xs" c="dimmed">·</Text>
                        <Badge size="xs" variant="light" color="gray">
                          {doc.mimeType.split('/')[1] || doc.mimeType}
                        </Badge>
                      </Group>
                    </div>
                  </Group>

                  <Button
                    size="xs"
                    variant={isSelected ? 'filled' : 'light'}
                    color={isSelected ? 'indigo' : 'gray'}
                    leftSection={isSelected ? <IconCheck size={14} /> : <IconPlus size={14} />}
                    onClick={() => onToggleDocument(doc)}
                  >
                    {isSelected ? 'Attached' : 'Attach'}
                  </Button>
                </Paper>
              );
            })}
          </Stack>
        )}

        <Group justify="space-between" mt="sm">
          <Text size="xs" c="dimmed">
            {selectedDocumentIds.length} document{selectedDocumentIds.length === 1 ? '' : 's'} selected
          </Text>
          <Button onClick={onClose}>Done</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
