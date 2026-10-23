'use client';

import { useState } from 'react';
import {
  Container,
  Paper,
  Title,
  Text,
  TextInput,
  Textarea,
  Select,
  Button,
  Group,
  Stack,
  SimpleGrid,
  ThemeIcon,
  Box,
} from '@mantine/core';
import { IconCheck, IconSend, IconCalendarEvent } from '@tabler/icons-react';
import { StatusBadge, LabelTag, InlineAlert } from '@sovereignsquad/gds-core/client';
import type { Brand } from '@/app/lib/brand';

type Props = {
  brand: Brand;
  label: string;
  subtitle?: string;
  embed?: boolean;
};

const SIZE_OPTIONS = [
  { value: 'Small', label: 'Small (1–50 members / staff)' },
  { value: 'Medium', label: 'Medium (51–250 members / staff)' },
  { value: 'Large', label: 'Large (251–1,000 members / staff)' },
  { value: 'Enterprise', label: 'Enterprise / National Federation (1,000+)' },
];

export function InboundFormClient({ brand, label, subtitle, embed }: Props) {
  const [entityName, setEntityName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [country, setCountry] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactTitle, setContactTitle] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [sportOrSector, setSportOrSector] = useState('');
  const [organizationSize, setOrganizationSize] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [companyFaxHoneypot, setCompanyFaxHoneypot] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(brand)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityName,
          websiteUrl,
          country,
          contactName,
          contactTitle,
          contactEmail,
          contactPhone,
          sportOrSector,
          organizationSize: organizationSize || '',
          message,
          companyFaxHoneypot,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Could not submit your inquiry');
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'Could not submit your inquiry');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size={embed ? 'sm' : 'md'} py={embed ? 'sm' : 'xl'}>
      <Paper withBorder p={embed ? 'md' : 'xl'} radius="md" shadow={embed ? undefined : 'xs'}>
        {submitted ? (
          <Stack gap="md" align="center" py="lg">
            <ThemeIcon size={48} radius="xl" color="teal" variant="light">
              <IconCheck size={28} />
            </ThemeIcon>
            <Title order={3} ta="center">
              Thank you, {contactName}!
            </Title>
            <Text size="sm" c="dimmed" ta="center" maw={460}>
              We have received your inquiry for <strong>{entityName}</strong>. Our {label} team will review your details and reach out to <strong>{contactEmail}</strong> shortly.
            </Text>
            <Group gap="xs" mt="xs">
              <Button
                component="a"
                href={`/schedule/${brand}`}
                variant="light"
                color="indigo"
                size="xs"
                leftSection={<IconCalendarEvent size={15} />}
              >
                Book a meeting slot now
              </Button>
            </Group>
          </Stack>
        ) : (
          <form onSubmit={handleSubmit}>
            <Stack gap="md">
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <div>
                  <Group gap="xs" align="center">
                    <Title order={embed ? 4 : 2}>{label} — Get in Touch</Title>
                    <StatusBadge status="info" size="xs">
                      Direct Inquiry
                    </StatusBadge>
                  </Group>
                  <Text size="xs" c="dimmed" mt={4}>
                    {subtitle || `Share your organization details and our ${label} team will prepare a tailored walkthrough.`}
                  </Text>
                </div>
                <LabelTag tone="neutral" size="xs" label="Fast Response" />
              </Group>

              {error && <InlineAlert severity="error" title="Submission Error" message={error} />}

              {/* Hidden honeypot field for bot filtering */}
              <Box style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none' }} aria-hidden="true">
                <TextInput
                  label="Company Fax"
                  tabIndex={-1}
                  autoComplete="off"
                  value={companyFaxHoneypot}
                  onChange={(e) => setCompanyFaxHoneypot(e.currentTarget.value)}
                />
              </Box>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput
                  label="Organization / Club Name"
                  placeholder="e.g. FC Barcelona, Hungarian Swimming Federation"
                  value={entityName}
                  onChange={(e) => setEntityName(e.currentTarget.value)}
                  required
                />
                <TextInput
                  label="Website URL"
                  placeholder="https://yourclub.com"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.currentTarget.value)}
                />
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput
                  label="Your Full Name"
                  placeholder="Alex Rivera"
                  value={contactName}
                  onChange={(e) => setContactName(e.currentTarget.value)}
                  required
                />
                <TextInput
                  label="Job Title / Role"
                  placeholder="Commercial Director / Head of Academy"
                  value={contactTitle}
                  onChange={(e) => setContactTitle(e.currentTarget.value)}
                />
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <TextInput
                  label="Work Email"
                  placeholder="alex@yourclub.com"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.currentTarget.value)}
                  required
                />
                <TextInput
                  label="Phone / WhatsApp (Optional)"
                  placeholder="+44 20 7946 0921"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.currentTarget.value)}
                />
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                <TextInput
                  label="Sport / Industry Sector"
                  placeholder="Football, Basketball, Sports Tech"
                  value={sportOrSector}
                  onChange={(e) => setSportOrSector(e.currentTarget.value)}
                />
                <Select
                  label="Organization Size"
                  placeholder="Select tier"
                  data={SIZE_OPTIONS}
                  value={organizationSize}
                  onChange={setOrganizationSize}
                  clearable
                />
                <TextInput
                  label="Country Code (ISO-2)"
                  placeholder="e.g. GB, DE, US, HU"
                  maxLength={2}
                  value={country}
                  onChange={(e) => setCountry(e.currentTarget.value.toUpperCase())}
                />
              </SimpleGrid>

              <Textarea
                label="How can we help you?"
                placeholder="Tell us about your upcoming season, fan engagement goals, or performance objectives..."
                minRows={3}
                value={message}
                onChange={(e) => setMessage(e.currentTarget.value)}
              />

              <Group justify="flex-end" mt="xs">
                <Button
                  type="submit"
                  loading={submitting}
                  leftSection={<IconSend size={15} />}
                  color="indigo"
                >
                  Submit Inquiry
                </Button>
              </Group>
            </Stack>
          </form>
        )}
      </Paper>
    </Container>
  );
}
