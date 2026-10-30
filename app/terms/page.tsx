'use client';

import Link from 'next/link';
import { Container, Paper, Stack, Title, Text, Group, Button, Divider, Box, List, ThemeIcon } from '@mantine/core';
import { StatusBadge, LabelTag, InlineAlert } from '@sovereignsquad/gds-core/client';
import { IconFileText, IconArrowLeft, IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { APP_VERSION } from '@/lib/release-notes-dates';

export default function TermsOfServicePage() {
  return (
    <Container size="md" py={40}>
      <Paper p={{ base: 'md', sm: 'xl' }} radius="md" withBorder shadow="sm">
        <Stack gap="lg">
          {/* Header */}
          <Group justify="space-between" align="center" wrap="wrap">
            <Button
              component={Link}
              href="/"
              variant="subtle"
              size="xs"
              leftSection={<IconArrowLeft size={14} />}
            >
              Back to Sales Lead Generator
            </Button>
            <Group gap="xs">
              <LabelTag tone="info" size="xs" label={`v${APP_VERSION}`} />
              <StatusBadge status="neutral" size="xs">
                Terms of Use
              </StatusBadge>
            </Group>
          </Group>

          <div>
            <Group gap="xs" align="center" mb={4}>
              <ThemeIcon size="lg" radius="md" color="indigo" variant="light">
                <IconFileText size={20} />
              </ThemeIcon>
              <Title order={1} size="h2">Terms of Service</Title>
            </Group>
            <Text size="xs" c="dimmed">
              Effective Date: October 23, 2026 • Last Updated: October 23, 2026
            </Text>
          </div>

          <InlineAlert
            severity="info"
            title="Terms of Service Notice"
            message="Please read these Terms of Service carefully before accessing or using Sales Lead Generator. Connecting an email mailbox grants permission to send and synchronize correspondence in accordance with these terms."
          />

          <Divider />

          {/* Section 1: Acceptance */}
          <Box>
            <Title order={3} size="h4" mb="xs">1. Acceptance of Terms</Title>
            <Text size="sm" c="dimmed" lh={1.6}>
              These Terms of Service (&quot;Terms&quot;) govern access to and use of Sales Lead Generator, including its software, APIs, and associated web interfaces (the &quot;Service&quot;), operated by Moldován Csaba Kft. (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).
              By creating an account, accessing the application, or connecting an external account (including Google / Gmail), you agree to be bound by these Terms and our{' '}
              <Link href="/privacy" style={{ color: 'var(--mantine-color-indigo-6)', fontWeight: 500 }}>Privacy Policy</Link>.
            </Text>
          </Box>

          {/* Section 2: Service Description */}
          <Box>
            <Title order={3} size="h4" mb="xs">2. Service Description</Title>
            <Text size="sm" c="dimmed" lh={1.6}>
              Sales Lead Generator is a B2B sales intelligence and pipeline CRM platform. The Service enables sales organizations to manage lead stages, track deal values, score opportunities using ICE methodology, generate itemized CPQ quotes with e-signatures, schedule prospect discovery meetings, and coordinate multi-step outreach cadences.
            </Text>
          </Box>

          {/* Section 3: Mailbox Authorization */}
          <Box id="mailbox-authorization">
            <Title order={3} size="h4" mb="xs">3. Mailbox Authorization &amp; External Integrations</Title>
            <Text size="sm" c="dimmed" lh={1.6} mb="sm">
              When you connect an external email account (such as Google / Gmail) to Sales Lead Generator:
            </Text>
            <List size="sm" spacing="xs" icon={<ThemeIcon size={18} radius="xl" color="indigo" variant="light"><IconCheck size={12} /></ThemeIcon>}>
              <List.Item>
                <Text size="sm"><strong>Outbound Sending Authorization:</strong> You grant Sales Lead Generator express authorization to send 1:1 sales outreach emails and automated sequence follow-up messages on your behalf, originating from your authenticated email address via the official Gmail REST API.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>Inbound Reply Synchronization:</strong> You authorize the Service to inspect incoming messages matching registered CRM leads and contacts to maintain accurate conversation timelines.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>Account Ownership Representation:</strong> You represent and warrant that you are the rightful owner or authorized user of any email account you connect to the Service, and that doing so does not violate your employer&apos;s corporate policies or any third-party agreements.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>Revocation:</strong> You may disconnect your email account at any time via the <strong>Email &amp; Integrations</strong> menu. Upon disconnection, all background synchronization and sending authorization terminate immediately.</Text>
              </List.Item>
            </List>
          </Box>

          {/* Section 4: Acceptable Use & Anti-Spam */}
          <Box id="acceptable-use">
            <Title order={3} size="h4" mb="xs">4. Acceptable Use Policy &amp; Anti-Spam Obligations</Title>
            <Text size="sm" c="dimmed" lh={1.6} mb="sm">
              Sales Lead Generator requires all users to maintain the highest standards of professional sales communication. You agree to strictly abide by all anti-spam and electronic communications regulations:
            </Text>

            <Paper p="md" withBorder radius="sm" bg="var(--mantine-color-orange-0)" style={{ borderColor: 'var(--mantine-color-orange-2)' }} mb="md">
              <Group gap="xs" mb="xs">
                <IconAlertTriangle size={18} color="var(--mantine-color-orange-7)" />
                <Text fw={700} size="sm" c="orange">Mandatory Anti-Spam Rules</Text>
              </Group>
              <Text size="xs" c="dark" lh={1.5}>
                You must comply with the <strong>CAN-SPAM Act</strong> (US), the <strong>GDPR</strong> and <strong>ePrivacy Directive / PECR</strong> (EU/UK), and all applicable electronic privacy laws. Violation of anti-spam rules will result in immediate account suspension.
              </Text>
            </Paper>

            <List size="sm" spacing="xs">
              <List.Item>
                <Text size="sm"><strong>Accurate Identification:</strong> All outreach emails must contain truthful and accurate header information, identifying the real sender, corporate entity, and valid contact details.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>Non-Deceptive Subject Lines:</strong> Subject lines must truthfully reflect the commercial contents and intent of the communication.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>Honoring Unsubscribes &amp; Opt-Outs:</strong> If any recipient indicates they do not wish to be contacted, you must immediately cease communication. Our cadence engine automatically halts sequences upon reply; you must not re-engage opted-out prospects.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>No Purchased or Scraped Bulk Lists:</strong> The Service is designed for personalized B2B relationship building. You may not upload or spam purchased, scraped, or unauthorized contact lists.</Text>
              </List.Item>
            </List>
          </Box>

          {/* Section 5: Customer Data & IP */}
          <Box>
            <Title order={3} size="h4" mb="xs">5. Customer Data Ownership &amp; Intellectual Property</Title>
            <Text size="sm" c="dimmed" lh={1.6}>
              You retain all ownership, rights, and title to your business leads, notes, and communications data (&quot;Customer Data&quot;). We claim no ownership over your Customer Data. We grant you a limited, non-transferable license to access the CRM platform. You may not reverse engineer, copy, or redistribute the platform software or underlying algorithms.
            </Text>
          </Box>

          {/* Section 6: Disclaimers & Limitations */}
          <Box>
            <Title order={3} size="h4" mb="xs">6. Disclaimers &amp; Limitation of Liability</Title>
            <Text size="sm" c="dimmed" lh={1.6} mb="xs">
              THE SERVICE IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; BASIS. WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. WE DO NOT GUARANTEE THAT EMAILS SENT THROUGH INTEGRATED MAILBOXES WILL BE UNINTERRUPTED, DELIVERED TO THE INBOX, OR FREE FROM RECIPIENT SPAM FILTER INTERCEPTION.
            </Text>
            <Text size="sm" c="dimmed" lh={1.6}>
              IN NO EVENT SHALL MOLDOVÁN CSABA KFT. OR ITS AFFILIATES BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES (INCLUDING LOST PROFITS OR DATA LOSS) ARISING FROM USE OF THE SERVICE.
            </Text>
          </Box>

          {/* Section 7: Termination */}
          <Box>
            <Title order={3} size="h4" mb="xs">7. Termination &amp; Disconnection</Title>
            <Text size="sm" c="dimmed" lh={1.6}>
              You may terminate your use of the Service at any time by disconnecting your integrations and closing your account. We reserve the right to suspend or terminate accounts that violate our Acceptable Use Policy, anti-spam obligations, or legal terms.
            </Text>
          </Box>

          {/* Section 8: Governing Law */}
          <Box>
            <Title order={3} size="h4" mb="xs">8. Governing Law &amp; Jurisdiction</Title>
            <Text size="sm" c="dimmed" lh={1.6}>
              These Terms shall be governed by and construed in accordance with the laws of Hungary and the European Union. Any disputes arising under these Terms shall be resolved exclusively in the courts of Budapest, Hungary.
            </Text>
          </Box>

          {/* Section 9: Contact */}
          <Box>
            <Title order={3} size="h4" mb="xs">9. Contact Information</Title>
            <Paper p="sm" withBorder radius="sm">
              <Text size="sm" fw={600}>Legal &amp; Compliance Team</Text>
              <Text size="xs" c="dimmed">Moldován Csaba Kft.</Text>
              <Text size="xs" c="dimmed">Email: moldovancsaba@gmail.com</Text>
              <Text size="xs" c="dimmed">Website: https://sales.haho.ai</Text>
              <Text size="xs" c="dimmed">Location: Budapest, Hungary</Text>
            </Paper>
          </Box>

          <Divider />

          {/* Footer Navigation */}
          <Group justify="space-between" align="center" wrap="wrap">
            <Text size="xs" c="dimmed">
              Read our <Link href="/privacy" style={{ color: 'var(--mantine-color-indigo-6)' }}>Privacy Policy</Link>
            </Text>
            <Text size="xs" c="dimmed">
              Sales Lead Generator • v{APP_VERSION}
            </Text>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}
