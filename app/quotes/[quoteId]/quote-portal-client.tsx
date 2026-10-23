'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Container,
  Title,
  Text,
  Stack,
  Group,
  Button,
  TextInput,
  Loader,
  Paper,
  Divider,
  Table,
  Checkbox,
} from '@mantine/core';
import { StatusBadge, LabelTag, InlineAlert } from '@sovereignsquad/gds-core/client';
import { IconDownload, IconCheck, IconFileText, IconLock } from '@tabler/icons-react';
import type { PublicQuotePortalDto } from '@/app/lib/quotes-store';

type Props = {
  quoteId: string;
  token: string;
};

function formatCurrency(value: number, currency: string): string {
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return `${sym}${Math.round(value).toLocaleString()}`;
}

export function QuotePortalClient({ quoteId, token }: Props) {
  const [loading, setLoading] = useState(true);
  const [portal, setPortal] = useState<PublicQuotePortalDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState('');
  const [signatureText, setSignatureText] = useState('');
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadPortal = useCallback(async () => {
    if (!token) {
      setError('Invalid or missing proposal security token.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/quotes/${encodeURIComponent(quoteId)}/accept?token=${encodeURIComponent(token)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.portal) {
        throw new Error(data?.error || 'This proposal could not be found or the link has expired.');
      }
      setPortal(data.portal);
    } catch (err: any) {
      setError(err?.message || 'Unable to load proposal.');
    } finally {
      setLoading(false);
    }
  }, [quoteId, token]);

  useEffect(() => {
    loadPortal();
  }, [loadPortal]);

  async function handleAcceptAndSign() {
    if (!portal) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(quoteId)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          signerName: signerName.trim(),
          signerTitle: signerTitle.trim(),
          signerEmail: signerEmail.trim(),
          purchaseOrderNumber: purchaseOrderNumber.trim(),
          signatureText: signatureText.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Could not complete signature');
      }
      await loadPortal();
    } catch (err: any) {
      setSubmitError(err?.message || 'Could not complete signature');
    } finally {
      setSubmitting(false);
    }
  }

  const pdfDownloadUrl = `/api/quotes/${encodeURIComponent(quoteId)}/view?token=${encodeURIComponent(token)}`;

  if (loading) {
    return (
      <Container size="sm" py="xl">
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      </Container>
    );
  }

  if (error || !portal) {
    return (
      <Container size="sm" py="xl">
        <InlineAlert
          severity="error"
          title="Proposal Unavailable"
          message={error || 'This proposal link is invalid or unavailable.'}
        />
      </Container>
    );
  }

  const isSigned = portal.status === 'signed';

  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <Paper
          withBorder
          p="lg"
          radius="md"
          style={{ borderColor: 'var(--gds-border-card)', backgroundColor: 'var(--gds-bg-card)' }}
        >
          <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
            <div>
              <Group gap="xs" align="center">
                <LabelTag tone="info" size="sm" label={portal.brandLabel} />
                <StatusBadge
                  status={isSigned ? 'success' : 'info'}
                  withIcon={isSigned}
                >
                  {isSigned ? 'Signed & Accepted' : 'Awaiting Acceptance'}
                </StatusBadge>
              </Group>
              <Title order={2} mt="xs">
                Commercial Proposal for {portal.entityName}
              </Title>
              <Text size="xs" c="dimmed" mt={4}>
                Reference #{portal.quoteId.slice(-8).toUpperCase()} · Issued{' '}
                {new Date(portal.createdAt).toLocaleDateString()}
              </Text>
            </div>
            <Button
              component="a"
              href={pdfDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              variant="default"
              size="xs"
              leftSection={<IconDownload size={14} />}
            >
              Download PDF
            </Button>
          </Group>

          <Divider my="md" />

          <Table withTableBorder withColumnBorders highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Description</Table.Th>
                <Table.Th style={{ textAlign: 'right', width: 90 }}>Qty</Table.Th>
                <Table.Th style={{ textAlign: 'right', width: 130 }}>Unit Price</Table.Th>
                <Table.Th style={{ textAlign: 'right', width: 140 }}>Amount</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {portal.lineItems.map((item, idx) => {
                const qty = item.quantity ?? 1;
                const unit = item.unitPrice ?? item.value;
                return (
                  <Table.Tr key={idx}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {item.label}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{qty}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {formatCurrency(unit, item.currency || portal.currency)}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text size="sm" fw={600}>
                        {formatCurrency(item.value, item.currency || portal.currency)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>

          <Group justify="flex-end" mt="md">
            <Stack gap={2} align="flex-end">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Total Proposal Value ({portal.currency})
              </Text>
              <Title order={3}>{formatCurrency(portal.totalValue, portal.currency)}</Title>
            </Stack>
          </Group>
        </Paper>

        {isSigned ? (
          <Paper
            withBorder
            p="lg"
            radius="md"
            style={{ borderColor: 'var(--gds-border-card)', backgroundColor: 'var(--gds-bg-card)' }}
          >
            <Stack gap="sm">
              <Group gap="xs">
                <StatusBadge status="success" withIcon>
                  Executed Agreement
                </StatusBadge>
                {portal.signedAt && (
                  <Text size="xs" c="dimmed">
                    Signed on {new Date(portal.signedAt).toLocaleString()}
                  </Text>
                )}
              </Group>
              <Text size="sm">
                This proposal has been formally accepted and e-signed by{' '}
                <Text span fw={600}>
                  {portal.signerName || portal.signerEmail || 'Authorized Signatory'}
                </Text>
                {portal.signerTitle ? ` (${portal.signerTitle})` : ''}
                {portal.signerEmail ? ` <${portal.signerEmail}>` : ''}.
              </Text>
              {portal.purchaseOrderNumber && (
                <Text size="xs" c="dimmed">
                  Purchase Order Reference: <Text span fw={600}>{portal.purchaseOrderNumber}</Text>
                </Text>
              )}
              <Group gap="xs" mt="xs">
                <Button
                  component="a"
                  href={pdfDownloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="xs"
                  variant="light"
                  leftSection={<IconFileText size={14} />}
                >
                  View Official PDF Copy
                </Button>
              </Group>
            </Stack>
          </Paper>
        ) : (
          <Paper
            withBorder
            p="lg"
            radius="md"
            style={{ borderColor: 'var(--gds-border-card)', backgroundColor: 'var(--gds-bg-card)' }}
          >
            <Stack gap="sm">
              <Group gap="xs">
                <IconLock size={16} />
                <Title order={4}>Accept &amp; E-Sign Proposal</Title>
              </Group>
              <Text size="xs" c="dimmed">
                Complete the fields below to electronically sign and accept this commercial proposal on behalf of{' '}
                {portal.entityName}.
              </Text>

              {submitError && (
                <InlineAlert severity="error" title="Could not sign proposal" message={submitError} />
              )}

              <Group grow align="flex-start">
                <TextInput
                  label="Full Name"
                  placeholder="Jane Doe"
                  required
                  value={signerName}
                  onChange={(e) => setSignerName(e.currentTarget.value)}
                />
                <TextInput
                  label="Job Title"
                  placeholder="Commercial Director"
                  value={signerTitle}
                  onChange={(e) => setSignerTitle(e.currentTarget.value)}
                />
              </Group>

              <Group grow align="flex-start">
                <TextInput
                  label="Work Email"
                  type="email"
                  placeholder="jane@organization.com"
                  required
                  value={signerEmail}
                  onChange={(e) => setSignerEmail(e.currentTarget.value)}
                />
                <TextInput
                  label="Purchase Order # (Optional)"
                  placeholder="PO-2026-001"
                  value={purchaseOrderNumber}
                  onChange={(e) => setPurchaseOrderNumber(e.currentTarget.value)}
                />
              </Group>

              <TextInput
                label="Typed Electronic Signature (type your full legal name)"
                placeholder={signerName || 'Type your full name to sign'}
                required
                value={signatureText}
                onChange={(e) => setSignatureText(e.currentTarget.value)}
                styles={{
                  input: {
                    fontStyle: 'italic',
                    fontWeight: 600,
                  },
                }}
              />

              <Checkbox
                size="xs"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.currentTarget.checked)}
                label={`I confirm that I am authorized to accept this proposal on behalf of ${portal.entityName} and agree that my typed electronic signature is legally binding.`}
              />

              <Group justify="flex-end" mt="xs">
                <Button
                  color="teal"
                  leftSection={<IconCheck size={16} />}
                  loading={submitting}
                  disabled={
                    !agreedTerms ||
                    signerName.trim().length < 2 ||
                    !signerEmail.trim().includes('@') ||
                    signatureText.trim().length < 2
                  }
                  onClick={handleAcceptAndSign}
                >
                  Accept &amp; Sign Proposal
                </Button>
              </Group>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
