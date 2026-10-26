'use client';

import Link from 'next/link';
import { Container, Paper, Stack, Title, Text, Group, Button, Divider, Box, List, ThemeIcon } from '@mantine/core';
import { StatusBadge, LabelTag, InlineAlert } from '@sovereignsquad/gds-core/client';
import { IconShieldCheck, IconMail, IconArrowLeft, IconLock, IconDatabase, IconCheck } from '@tabler/icons-react';
import { APP_VERSION } from '@/lib/release-notes-dates';

export default function PrivacyPolicyPage() {
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
              <StatusBadge status="success" size="xs">
                Active Policy
              </StatusBadge>
            </Group>
          </Group>

          <div>
            <Group gap="xs" align="center" mb={4}>
              <ThemeIcon size="lg" radius="md" color="indigo" variant="light">
                <IconShieldCheck size={20} />
              </ThemeIcon>
              <Title order={1} size="h2">Privacy Policy</Title>
            </Group>
            <Text size="xs" c="dimmed">
              Effective Date: October 23, 2026 • Last Updated: October 23, 2026
            </Text>
          </div>

          <InlineAlert
            severity="info"
            title="Privacy & Data Protection Notice"
            message="Sales Lead Generator is committed to protecting your personal information and ensuring full transparency regarding how external accounts (including Google/Gmail mailboxes) are connected, accessed, and processed."
          />

          <Divider />

          {/* Section 1: Introduction */}
          <Box>
            <Title order={3} size="h4" mb="xs">1. Introduction</Title>
            <Text size="sm" c="dimmed" lh={1.6}>
              Sales Lead Generator (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) is a B2B sales intelligence and pipeline CRM platform operated by Moldován Csaba Kft. This Privacy Policy details our practices regarding the collection, use, processing, and protection of your data when using our web application, APIs, and integrated mailbox services (the &quot;Service&quot;).
            </Text>
          </Box>

          {/* Section 2: Google API Limited Use Compliance */}
          <Box id="google-limited-use">
            <Title order={3} size="h4" mb="xs">2. Google API Services User Data Policy &amp; Limited Use Disclosure</Title>
            <Text size="sm" c="dimmed" lh={1.6} mb="sm">
              Sales Lead Generator integrates with Google APIs (including the Gmail API, Google Calendar API, and Google Contacts API) to empower commercial sales representatives to send outreach emails directly from their own mailbox, schedule meetings with automated Google Meet links, and synchronize prospect replies into the CRM timeline.
            </Text>

            <Paper p="md" withBorder radius="sm" bg="var(--mantine-color-indigo-0)" style={{ borderColor: 'var(--mantine-color-indigo-2)' }}>
              <Group gap="xs" mb="xs">
                <IconLock size={18} color="var(--mantine-color-indigo-7)" />
                <Text fw={700} size="sm" c="indigo">Google Limited Use Compliance Statement</Text>
              </Group>
              <Text size="xs" fw={500} c="dark" lh={1.5}>
                Sales Lead Generator&apos;s use and transfer to any other app of information received from Google APIs adheres to the{' '}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--mantine-color-indigo-7)', fontWeight: 600 }}
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
              </Text>
            </Paper>

            <Stack gap="xs" mt="md">
              <Text size="sm" fw={600}>Our binding commitments regarding Google User Data:</Text>
              <List size="sm" spacing="xs" icon={<ThemeIcon size={18} radius="xl" color="teal" variant="light"><IconCheck size={12} /></ThemeIcon>}>
                <List.Item>
                  <Text size="sm"><strong>No AI / Machine Learning Training:</strong> We do NOT use Google User Data (including message contents, headers, or attachments) to develop, train, fine-tune, or improve generalized artificial intelligence (AI) models, large language models (LLMs), or machine learning (ML) algorithms.</Text>
                </List.Item>
                <List.Item>
                  <Text size="sm"><strong>No Data Selling:</strong> We do NOT sell, rent, lease, or monetize Google User Data to any third party, broker, or advertiser under any circumstances.</Text>
                </List.Item>
                <List.Item>
                  <Text size="sm"><strong>No Advertising:</strong> We do NOT use or disclose Google User Data for serving advertisements, including personalized, retargeted, or interest-based advertising.</Text>
                </List.Item>
                <List.Item>
                  <Text size="sm"><strong>Strictly Limited Sharing:</strong> We only transfer Google User Data to our secure, SOC-2 compliant hosting and database sub-processors (MongoDB Atlas, Vercel) strictly as necessary to deliver core CRM user-facing functionality or comply with applicable law.</Text>
                </List.Item>
                <List.Item>
                  <Text size="sm"><strong>No Human Reading:</strong> No human beings read your Google User Data or email messages unless you have given explicit consent for specific technical support messages, it is strictly necessary for security/bug investigation, or it is required by law.</Text>
                </List.Item>
              </List>
            </Stack>
          </Box>

          {/* Section 3: Connecting Your Mailbox */}
          <Box id="mailbox-connection">
            <Title order={3} size="h4" mb="xs">3. How to Connect Your Mailbox (Google / Gmail)</Title>
            <Text size="sm" c="dimmed" lh={1.6} mb="sm">
              Sales representatives connect their individual Google Workspace or personal Gmail accounts directly to Sales Lead Generator using standard OAuth 2.0 with PKCE (Proof Key for Code Exchange):
            </Text>

            <List type="ordered" size="sm" spacing="xs" mb="md">
              <List.Item>Navigate to <strong>Email &amp; Integrations</strong> in the app navigation menu (or click your profile avatar).</List.Item>
              <List.Item>Under <strong>Personal Mailboxes (Google / Gmail)</strong>, click <strong>Connect with Google</strong>.</List.Item>
              <List.Item>You are redirected to Google&apos;s secure authorization page (<code>accounts.google.com</code>) to select your account and review permissions.</List.Item>
              <List.Item>Upon clicking <strong>Allow</strong>, Google returns an authorization code that our server exchanges for encrypted OAuth tokens.</List.Item>
              <List.Item>Your connected email address appears in your integration hub with instant Sync, Test, and Disconnect controls.</List.Item>
            </List>

            <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb={4}>Exact Google Scopes Requested &amp; Purpose:</Text>
            <Paper p="sm" withBorder radius="sm">
              <Stack gap="xs">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <div>
                    <Text size="xs" fw={700}>https://www.googleapis.com/auth/gmail.send</Text>
                    <Text size="xs" c="dimmed">Enables sending 1:1 business outreach emails and automated sequence follow-ups directly from your authenticated address.</Text>
                  </div>
                  <LabelTag tone="info" size="xs" label="Send" />
                </Group>
                <Divider />
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <div>
                    <Text size="xs" fw={700}>https://www.googleapis.com/auth/gmail.readonly</Text>
                    <Text size="xs" c="dimmed">Enables bi-directional synchronization of replies from your CRM leads and contacts into your timeline.</Text>
                  </div>
                  <LabelTag tone="info" size="xs" label="Sync" />
                </Group>
                <Divider />
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <div>
                    <Text size="xs" fw={700}>https://www.googleapis.com/auth/userinfo.email</Text>
                    <Text size="xs" c="dimmed">Enables associating your Google account address with your user profile and default sender settings.</Text>
                  </div>
                  <LabelTag tone="neutral" size="xs" label="Identity" />
                </Group>
              </Stack>
            </Paper>
          </Box>

          {/* Section 4: Receiving & Syncing Emails */}
          <Box id="receiving-emails">
            <Title order={3} size="h4" mb="xs">4. How We Receive &amp; Synchronize Emails</Title>
            <Text size="sm" c="dimmed" lh={1.6} mb="xs">
              When synchronizing incoming emails, Sales Lead Generator uses a strict <strong>Data Minimization Filter</strong>:
            </Text>
            <List size="sm" spacing="xs">
              <List.Item>
                <Text size="sm"><strong>CRM Contact Filtering:</strong> The sync engine examines message participant headers. If an email thread does NOT involve a recognized lead or contact registered in your CRM workspace, the message is <strong>immediately skipped</strong>. Personal and non-CRM emails are never fetched, parsed, or stored.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>Internal Domain Shielding:</strong> Purely internal colleague correspondence (staff syncs, payroll filings, administrative notices) is automatically excluded from lead records.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>User Mailbox Isolation:</strong> Representatives only have access to their own connected mailboxes and assigned leads. If an authenticated session cannot be verified, the inbox fails closed with zero threads displayed.</Text>
              </List.Item>
            </List>
          </Box>

          {/* Section 5: Sending Emails */}
          <Box id="sending-emails">
            <Title order={3} size="h4" mb="xs">5. How We Send Emails via Our Service</Title>
            <Text size="sm" c="dimmed" lh={1.6} mb="xs">
              When an authorized sales representative sends an outreach email or schedules an automated cadence:
            </Text>
            <List size="sm" spacing="xs">
              <List.Item>
                <Text size="sm"><strong>Direct REST API Dispatch:</strong> Messages are sent directly through Google&apos;s official Gmail REST API using your authenticated credentials. Messages originate from your genuine corporate address with full SPF, DKIM, and DMARC alignment.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>Thread Continuity:</strong> Outbound follow-up messages automatically include standard RFC 2822 <code>In-Reply-To</code> and <code>References</code> headers to preserve conversation threads in recipient clients.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>Signature Synchronization:</strong> Primary Gmail SendAs signatures are synchronized and formatted with RFC 3676 delimiters.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>Automatic Stop on Reply:</strong> When a recipient responds, the active cadence sequence is immediately stopped to prevent redundant follow-ups.</Text>
              </List.Item>
            </List>
          </Box>

          {/* Section 6: Security & Encryption */}
          <Box id="security">
            <Title order={3} size="h4" mb="xs">6. Data Security &amp; Token Encryption</Title>
            <Text size="sm" c="dimmed" lh={1.6} mb="xs">
              We employ robust administrative, physical, and technical safeguards to protect your data:
            </Text>
            <List size="sm" spacing="xs">
              <List.Item>
                <Text size="sm"><strong>AES-256-GCM Encryption at Rest:</strong> All stored Google OAuth access tokens and refresh tokens are encrypted at rest using AES-256-GCM authenticated encryption with random nonces before persisting to the database.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>TLS 1.3 in Transit:</strong> All web traffic and API calls operate exclusively over encrypted HTTPS/TLS 1.3 connections.</Text>
              </List.Item>
              <List.Item>
                <Text size="sm"><strong>Multi-Tenant Isolation:</strong> Data is strictly partitioned by brand and tenant boundaries at the database and query layer.</Text>
              </List.Item>
            </List>
          </Box>

          {/* Section 7: Disconnection & Deletion */}
          <Box id="disconnection">
            <Title order={3} size="h4" mb="xs">7. Account Disconnection &amp; Data Deletion</Title>
            <Text size="sm" c="dimmed" lh={1.6} mb="xs">
              You maintain complete control over your connected accounts:
            </Text>
            <Text size="sm" c="dimmed" lh={1.6} mb="xs">
              • <strong>1-Click Disconnect:</strong> In the app, open <strong>Email &amp; Integrations</strong> and click <strong>Disconnect</strong> next to any connected Google account. The server immediately revokes the OAuth token with Google and deletes all encrypted credentials from active storage.<br />
              • <strong>Revoke via Google:</strong> You can also revoke access anytime at{' '}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--mantine-color-indigo-7)' }}>
                myaccount.google.com/permissions
              </a>.<br />
              • <strong>Data Erasure Requests:</strong> To request deletion of all associated personal and activity data, email <code>moldovancsaba@gmail.com</code>.
            </Text>
          </Box>

          {/* Section 8: Rights & Contact */}
          <Box id="rights">
            <Title order={3} size="h4" mb="xs">8. Your Rights &amp; Contact Information</Title>
            <Text size="sm" c="dimmed" lh={1.6} mb="sm">
              Under GDPR, CCPA/CPRA, and relevant privacy laws, you have the right to access, rectify, port, or request erasure of your personal information.
            </Text>
            <Paper p="sm" withBorder radius="sm">
              <Text size="sm" fw={600}>Legal &amp; Compliance Team</Text>
              <Text size="xs" c="dimmed">Moldován Csaba Kft.</Text>
              <Text size="xs" c="dimmed">Email: moldovancsaba@gmail.com</Text>
              <Text size="xs" c="dimmed">Website: https://salesleadgenerator.vercel.app</Text>
              <Text size="xs" c="dimmed">Location: Budapest, Hungary</Text>
            </Paper>
          </Box>

          <Divider />

          {/* Footer Navigation */}
          <Group justify="space-between" align="center" wrap="wrap">
            <Text size="xs" c="dimmed">
              Read our <Link href="/terms" style={{ color: 'var(--mantine-color-indigo-6)' }}>Terms of Service</Link>
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
