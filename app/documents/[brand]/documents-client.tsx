'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Container,
  Stack,
  Group,
  Title,
  Text,
  Button,
  TextInput,
  Paper,
  Table,
  ActionIcon,
  Modal,
  Loader,
  Tooltip,
} from '@mantine/core';
import { LabelTag, InlineAlert } from '@sovereignsquad/gds-core/client';
import {
  IconSearch,
  IconPlus,
  IconTrash,
  IconEdit,
  IconCheck,
  IconX,
  IconFile,
  IconFileText,
  IconPhoto,
  IconAlertTriangle,
  IconUpload,
  IconFolderOpen,
} from '@tabler/icons-react';
import type { Brand } from '@/app/lib/brand';
import type { DocumentRecord } from '@/lib/documents';
import { formatFileSize, getFileIcon } from '@/app/components/DocumentLibraryPickerModal';

type Props = {
  brand: Brand;
  label: string;
};

export function DocumentsClient({ brand, label }: Props) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Upload modal state
  const [uploadOpened, setUploadOpened] = useState(false);
  const [uploadFilename, setUploadFilename] = useState('');
  const [uploadDisplayName, setUploadDisplayName] = useState('');
  const [uploadMimeType, setUploadMimeType] = useState('application/pdf');
  const [uploadSizeBytes, setUploadSizeBytes] = useState(1024 * 100); // 100KB default
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit/Rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Deletion in-use alert state
  const [inUseModal, setInUseModal] = useState<{
    opened: boolean;
    documentName: string;
    consumers: Array<{ kind: 'cadence' | 'template'; name: string }>;
  }>({ opened: false, documentName: '', consumers: [] });

  const loadDocuments = useCallback(async () => {
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
    loadDocuments();
  }, [loadDocuments]);

  const filteredDocs = documents.filter((d) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      d.displayName.toLowerCase().includes(q) ||
      d.filename.toLowerCase().includes(q) ||
      d.mimeType.toLowerCase().includes(q)
    );
  });

  const totalSize = documents.reduce((sum, d) => sum + (d.sizeBytes || 0), 0);

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFilename(file.name);
    setUploadDisplayName(file.name.replace(/\.[^/.]+$/, ''));
    setUploadMimeType(file.type || 'application/pdf');
    setUploadSizeBytes(file.size);
    setUploadOpened(true);
    e.target.value = '';
  }

  async function handleCreateDocument() {
    if (!uploadFilename.trim()) {
      setUploadError('Filename is required');
      return;
    }
    if (uploadSizeBytes > 25 * 1024 * 1024) {
      setUploadError('File size exceeds 25MB ceiling');
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const res = await fetch(`/api/documents?brand=${encodeURIComponent(brand)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          filename: uploadFilename.trim(),
          displayName: uploadDisplayName.trim() || uploadFilename.trim(),
          mimeType: uploadMimeType,
          sizeBytes: uploadSizeBytes,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to upload document');
      }

      setUploadOpened(false);
      setUploadFilename('');
      setUploadDisplayName('');
      loadDocuments();
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  }

  async function handleRename(id: string) {
    if (!editingName.trim()) return;
    setRenaming(true);
    try {
      const res = await fetch(`/api/documents/${id}?brand=${encodeURIComponent(brand)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: editingName.trim() }),
      });
      if (!res.ok) throw new Error('Failed to rename document');
      setEditingId(null);
      loadDocuments();
    } catch (err) {
      console.error(err);
    } finally {
      setRenaming(false);
    }
  }

  async function handleDelete(doc: DocumentRecord) {
    const confirmed = window.confirm(
      `Delete "${doc.displayName}" from the workspace document library?`
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/documents/${doc.id}?brand=${encodeURIComponent(brand)}`, {
        method: 'DELETE',
      });

      if (res.status === 409) {
        const data = await res.json();
        setInUseModal({
          opened: true,
          documentName: doc.displayName,
          consumers: data.usage || [],
        });
        return;
      }

      if (!res.ok) throw new Error('Failed to delete document');
      loadDocuments();
    } catch (err) {
      console.error(err);
      alert('Failed to delete document.');
    }
  }

  return (
    <Container size="xl" py="lg">
      <Stack gap="lg">
        {/* Header */}
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Title order={2}>{label} Document Library</Title>
            <Text size="sm" c="dimmed">
              Workspace collateral · attach once to sequences and 1:1 emails
            </Text>
          </div>
          <Group>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileSelected}
            />
            <Button
              leftSection={<IconUpload size={16} />}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload Document
            </Button>
          </Group>
        </Group>

        {/* Stats Strip */}
        <Group gap="md">
          <Paper p="md" withBorder style={{ flex: 1, minWidth: 160 }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Total Documents
            </Text>
            <Text size="xl" fw={700} mt={4}>
              {documents.length}
            </Text>
          </Paper>
          <Paper p="md" withBorder style={{ flex: 1, minWidth: 160 }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Total Storage Used
            </Text>
            <Text size="xl" fw={700} mt={4}>
              {formatFileSize(totalSize)}
            </Text>
          </Paper>
        </Group>

        {/* Search & Filter Toolbar */}
        <Group justify="space-between" align="center">
          <TextInput
            placeholder="Search documents by name or file type..."
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 320 }}
          />
          <Text size="xs" c="dimmed">
            Showing {filteredDocs.length} of {documents.length} document{documents.length === 1 ? '' : 's'}
          </Text>
        </Group>

        {/* Document Table */}
        {loading ? (
          <Group justify="center" py="xl">
            <Loader size="md" />
            <Text size="sm" c="dimmed">Loading document library...</Text>
          </Group>
        ) : error ? (
          <InlineAlert severity="error" title="Error loading library" message={error} />
        ) : filteredDocs.length === 0 ? (
          <Paper p="xl" withBorder style={{ textAlign: 'center' }}>
            <IconFolderOpen size={48} color="var(--mantine-color-gray-4)" style={{ margin: '0 auto 12px' }} />
            <Title order={4}>No documents found</Title>
            <Text size="sm" c="dimmed" mt={4} mb="md">
              {documents.length === 0
                ? 'Your workspace document library is empty. Upload collateral to attach to outreach emails.'
                : 'No documents match your search criteria.'}
            </Text>
            <Button
              variant="light"
              leftSection={<IconUpload size={16} />}
              onClick={() => fileInputRef.current?.click()}
            >
              Upload Document
            </Button>
          </Paper>
        ) : (
          <Paper withBorder>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Original Filename</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Size</Table.Th>
                  <Table.Th>Uploaded</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredDocs.map((doc) => {
                  const isEditing = editingId === doc.id;
                  return (
                    <Table.Tr key={doc.id}>
                      <Table.Td>
                        <Group gap="xs">
                          {getFileIcon(doc.mimeType)}
                          {isEditing ? (
                            <Group gap={4}>
                              <TextInput
                                size="xs"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                autoFocus
                              />
                              <ActionIcon
                                size="sm"
                                color="teal"
                                onClick={() => handleRename(doc.id)}
                                loading={renaming}
                                aria-label="Save name"
                              >
                                <IconCheck size={14} />
                              </ActionIcon>
                              <ActionIcon
                                size="sm"
                                color="gray"
                                onClick={() => setEditingId(null)}
                                aria-label="Cancel editing"
                              >
                                <IconX size={14} />
                              </ActionIcon>
                            </Group>
                          ) : (
                            <Text fw={500} size="sm">
                              {doc.displayName}
                            </Text>
                          )}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed" truncate style={{ maxWidth: 220 }}>
                          {doc.filename}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <LabelTag size="xs" tone="neutral" label={doc.mimeType.split('/')[1] || doc.mimeType} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{formatFileSize(doc.sizeBytes)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {new Date(doc.createdAt).toLocaleDateString()}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Group gap={6} justify="flex-end">
                          <Tooltip label="Rename">
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="gray"
                              onClick={() => {
                                setEditingId(doc.id);
                                setEditingName(doc.displayName);
                              }}
                              aria-label={`Rename ${doc.displayName}`}
                            >
                              <IconEdit size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Delete">
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              color="red"
                              onClick={() => handleDelete(doc)}
                              aria-label={`Delete ${doc.displayName}`}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Paper>
        )}

        {/* Upload Modal */}
        <Modal
          opened={uploadOpened}
          onClose={() => setUploadOpened(false)}
          title={<Text fw={600}>Add Document to Library</Text>}
          size="md"
        >
          <Stack gap="md">
            <TextInput
              label="Display Name"
              required
              value={uploadDisplayName}
              onChange={(e) => setUploadDisplayName(e.target.value)}
              placeholder="e.g. Q4 Executive Sponsorship Deck"
            />
            <TextInput
              label="Original Filename"
              required
              value={uploadFilename}
              onChange={(e) => setUploadFilename(e.target.value)}
            />
            <Group grow>
              <TextInput
                label="MIME Type"
                value={uploadMimeType}
                onChange={(e) => setUploadMimeType(e.target.value)}
              />
              <TextInput
                label="Size"
                value={formatFileSize(uploadSizeBytes)}
                disabled
              />
            </Group>

            {uploadError && (
              <InlineAlert severity="error" title="Upload failed" message={uploadError} />
            )}

            <Group justify="flex-end" mt="md">
              <Button variant="light" onClick={() => setUploadOpened(false)} disabled={uploading}>
                Cancel
              </Button>
              <Button onClick={handleCreateDocument} loading={uploading}>
                Save to Library
              </Button>
            </Group>
          </Stack>
        </Modal>

        {/* In-Use Deletion Blocked Modal */}
        <Modal
          opened={inUseModal.opened}
          onClose={() => setInUseModal({ opened: false, documentName: '', consumers: [] })}
          title={
            <Group gap="xs">
              <IconAlertTriangle color="var(--mantine-color-red-6)" size={20} />
              <Text fw={600} c="red.7">Document In Use</Text>
            </Group>
          }
          size="md"
        >
          <Stack gap="sm">
            <Text size="sm">
              <strong>&ldquo;{inUseModal.documentName}&rdquo;</strong> cannot be deleted because it is
              currently attached to active sequences or templates. Remove it from these items first:
            </Text>
            <Paper p="xs" withBorder bg="gray.0">
              <Stack gap={6}>
                {inUseModal.consumers.map((c, i) => (
                  <Group key={i} justify="space-between">
                    <Text size="xs" fw={500}>{c.name}</Text>
                    <LabelTag size="xs" tone={c.kind === 'cadence' ? 'info' : 'success'} label={c.kind} />
                  </Group>
                ))}
              </Stack>
            </Paper>
            <Group justify="flex-end" mt="md">
              <Button onClick={() => setInUseModal({ opened: false, documentName: '', consumers: [] })}>
                Understood
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </Container>
  );
}
