'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Container,
  Paper,
  Title,
  Text,
  TextInput,
  Select,
  Button,
  Group,
  Stack,
  SimpleGrid,
  Radio,
  Checkbox,
  Box,
  Badge,
  Divider,
  Modal,
} from '@mantine/core';
import {
  IconTrophy,
  IconCalendarEvent,
  IconMapPin,
  IconSparkles,
  IconCheck,
  IconAlertCircle,
  IconLock,
  IconArrowRight,
} from '@tabler/icons-react';
import { COUNTRY_OPTIONS } from '@/lib/country-list';

interface Props {
  brand: string;
  brandLabel: string;
  campaignSlug: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
  };
}

export function LandingCampaignClient({ brand, brandLabel, campaignSlug, utm }: Props) {
  const isVegas = brand === 'vegas' || campaignSlug.includes('darts') || campaignSlug.includes('grand-slam');

  // Form State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [country, setCountry] = useState<string | null>('GB');
  const [postCode, setPostCode] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [consentPdc, setConsentPdc] = useState(true);
  const [consentMrVegas, setConsentMrVegas] = useState<string>('yes');
  const [companyFaxHoneypot, setCompanyFaxHoneypot] = useState('');

  // Submission State
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  // Country select options
  const countrySelectData = COUNTRY_OPTIONS.map((c) => ({
    value: c.code,
    label: c.name,
  }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        firstName,
        lastName,
        contactName: `${firstName} ${lastName}`.trim(),
        contactEmail: email,
        contactPhone: phone,
        country: country || 'GB',
        postCode,
        dateOfBirth,
        consentPdc,
        consentMrVegas: consentMrVegas === 'yes',
        campaign: campaignSlug,
        sportOrSector: isVegas ? 'Darts & Sports Entertainment' : 'Inbound Campaign',
        message: isVegas
          ? `Grand Slam of Darts Ticket Giveaway Entry: DOB ${dateOfBirth}, Post Code ${postCode}, PDC Opt-in: ${consentPdc ? 'Yes' : 'No'}, Vegas Opt-in: ${consentMrVegas}`
          : `Campaign registration for ${campaignSlug}`,
        companyFaxHoneypot,
      };

      const res = await fetch(`/api/forms/${encodeURIComponent(brand)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Could not submit your entry. Please check your details.');
      }

      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box
      style={{
        minHeight: '100vh',
        backgroundColor: '#0a0b0e',
        color: '#f3f4f6',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(0, 168, 98, 0.15) 0%, rgba(10, 11, 14, 0.95) 70%)',
        paddingBottom: 64,
      }}
    >
      {/* Top Header Bar */}
      <Box
        style={{
          borderBottom: '1px solid rgba(255, 215, 0, 0.2)',
          backgroundColor: 'rgba(12, 13, 16, 0.85)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <Container size="md" py="sm">
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <Box
                style={{
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%)',
                  borderRadius: 8,
                  padding: '4px 10px',
                  boxShadow: '0 2px 10px rgba(245, 158, 11, 0.3)',
                }}
              >
                <Text fw={900} size="sm" c="#000" style={{ letterSpacing: '0.05em' }}>
                  MR VEGAS
                </Text>
              </Box>
              <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.08em' }}>
                Official Title Sponsor
              </Text>
            </Group>

            <Badge
              variant="outline"
              color="yellow"
              size="lg"
              leftSection={<IconTrophy size={14} color="#f59e0b" />}
              style={{ borderColor: 'rgba(245, 158, 11, 0.4)', color: '#fbbf24', textTransform: 'none' }}
            >
              Grand Slam of Darts
            </Badge>
          </Group>
        </Container>
      </Box>

      {/* Hero Section */}
      <Container size="md" pt="xl">
        <Box
          style={{
            borderRadius: 16,
            overflow: 'hidden',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 168, 98, 0.1)',
            marginBottom: 32,
            position: 'relative',
            backgroundColor: '#12141a',
          }}
        >
          {/* Hero Banner Media */}
          <Box style={{ position: 'relative', width: '100%', height: 260, backgroundColor: '#090a0d' }}>
            <Image
              src="https://i.emlfiles.com/cmpimg/2/1/3/3/3/2/files/imagecache/25939/w1248_1861178_ga-ticket-giveaway-mrv.jpg"
              alt="Mr Vegas Grand Slam of Darts Ticket Giveaway"
              fill
              style={{ objectFit: 'cover', opacity: 0.85 }}
              priority
              unoptimized
            />
            <Box
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(to top, #12141a 0%, rgba(18, 20, 26, 0.4) 60%, rgba(0, 0, 0, 0.2) 100%)',
              }}
            />
          </Box>

          {/* Tournament Overview Content */}
          <Box p={{ base: 'md', sm: 'xl' }}>
            <Group gap="xs" mb="xs">
              <Badge color="green" variant="filled" size="md">
                FREE ENTRY TICKET GIVEAWAY
              </Badge>
              <Badge color="dark" variant="outline" size="md" c="gray.4">
                PDC Major Event
              </Badge>
            </Group>

            <Title
              order={1}
              size="h2"
              fw={900}
              style={{
                color: '#ffffff',
                lineHeight: 1.2,
                letterSpacing: '-0.02em',
                marginBottom: 12,
              }}
            >
              Win Tickets to the Mr Vegas Grand Slam of Darts!
            </Title>

            <Text size="md" c="gray.3" style={{ lineHeight: 1.6, maxWidth: 680 }} mb="md">
              Title sponsors <strong>Mr Vegas</strong> are delighted to offer general admission tickets to this year’s prestigious tournament.
              Witness the world’s elite darts champions battle it out live on stage for the iconic <strong>Eric Bristow Trophy</strong>.
            </Text>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" mb="xs">
              <Group gap="xs" align="center">
                <Box
                  style={{
                    backgroundColor: 'rgba(0, 168, 98, 0.15)',
                    padding: 8,
                    borderRadius: 8,
                    border: '1px solid rgba(0, 168, 98, 0.3)',
                    color: '#10b981',
                  }}
                >
                  <IconMapPin size={18} />
                </Box>
                <div>
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                    Venue
                  </Text>
                  <Text size="sm" fw={700} c="white">
                    WV Active Aldersley, Wolverhampton
                  </Text>
                </div>
              </Group>

              <Group gap="xs" align="center">
                <Box
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                    padding: 8,
                    borderRadius: 8,
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    color: '#fbbf24',
                  }}
                >
                  <IconCalendarEvent size={18} />
                </Box>
                <div>
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                    Tournament Dates
                  </Text>
                  <Text size="sm" fw={700} c="white">
                    14th – 22nd November
                  </Text>
                </div>
              </Group>
            </SimpleGrid>
          </Box>
        </Box>

        {/* Form Container or Success State */}
        <Paper
          radius="lg"
          p={{ base: 'lg', sm: 'xl' }}
          style={{
            backgroundColor: '#12141a',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.6)',
          }}
        >
          {submitted ? (
            <Stack align="center" gap="md" py="xl" style={{ textAlign: 'center' }}>
              <Box
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(0, 168, 98, 0.2)',
                  border: '2px solid #10b981',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#10b981',
                }}
              >
                <IconCheck size={36} stroke={2.5} />
              </Box>

              <Title order={2} size="h2" fw={900} c="#10b981">
                Thank You for Entering!
              </Title>

              <Text size="md" c="gray.3" style={{ maxWidth: 540, lineHeight: 1.6 }}>
                Your entry has been received and registered into the official <strong>Mr Vegas Grand Slam of Darts</strong> draw.
                Winners will be contacted via email and SMS prior to tournament week.
              </Text>

              <Paper
                p="md"
                radius="md"
                style={{
                  backgroundColor: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.25)',
                  maxWidth: 540,
                }}
              >
                <Text size="sm" fw={700} c="#fbbf24" mb={4}>
                  Stay Connected & Good Luck!
                </Text>
                <Text size="xs" c="gray.4">
                  Follow Mr Vegas and the PDC across Instagram, X, TikTok, and YouTube for live player walk-ons, behind-the-scenes footage, and exclusive giveaways.
                </Text>
              </Paper>

              <Button
                variant="outline"
                color="yellow"
                size="md"
                mt="sm"
                onClick={() => {
                  setSubmitted(false);
                  setFirstName('');
                  setLastName('');
                  setEmail('');
                  setPhone('');
                }}
              >
                Submit Another Entry
              </Button>
            </Stack>
          ) : (
            <form onSubmit={handleSubmit}>
              <Stack gap="lg">
                <div>
                  <Group justify="space-between" align="baseline">
                    <Title order={2} size="h3" fw={800} c="white">
                      Enter the Ticket Giveaway
                    </Title>
                    <Text size="xs" c="dimmed">
                      All fields required unless noted
                    </Text>
                  </Group>
                  <Text size="sm" c="gray.4" mt={4}>
                    Fill in your details below for your chance to win tickets to this year&apos;s Grand Slam of Darts.
                  </Text>
                </div>

                {error && (
                  <Paper
                    p="sm"
                    radius="md"
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                    }}
                  >
                    <Group gap="xs" align="center">
                      <IconAlertCircle size={18} color="#ef4444" />
                      <Text size="sm" c="#f87171" fw={600}>
                        {error}
                      </Text>
                    </Group>
                  </Paper>
                )}

                {/* Honeypot field for bot suppression */}
                <input
                  type="text"
                  name="companyFaxHoneypot"
                  value={companyFaxHoneypot}
                  onChange={(e) => setCompanyFaxHoneypot(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  style={{ display: 'none' }}
                />

                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <TextInput
                    label={<Text size="sm" fw={600} c="gray.3">First Name</Text>}
                    placeholder="e.g. John"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    size="md"
                    styles={{
                      input: {
                        backgroundColor: '#1b1d24',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                      },
                    }}
                  />

                  <TextInput
                    label={<Text size="sm" fw={600} c="gray.3">Last Name</Text>}
                    placeholder="e.g. Smith"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    size="md"
                    styles={{
                      input: {
                        backgroundColor: '#1b1d24',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                      },
                    }}
                  />
                </SimpleGrid>

                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <TextInput
                    label={<Text size="sm" fw={600} c="gray.3">Contact Email</Text>}
                    placeholder="john.smith@example.com"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    size="md"
                    styles={{
                      input: {
                        backgroundColor: '#1b1d24',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                      },
                    }}
                  />

                  <TextInput
                    label={<Text size="sm" fw={600} c="gray.3">Phone Number</Text>}
                    placeholder="+44 7123 456789"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    size="md"
                    styles={{
                      input: {
                        backgroundColor: '#1b1d24',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                      },
                    }}
                  />
                </SimpleGrid>

                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                  <Select
                    label={<Text size="sm" fw={600} c="gray.3">Country</Text>}
                    data={countrySelectData}
                    value={country}
                    onChange={setCountry}
                    searchable
                    required
                    size="md"
                    styles={{
                      input: {
                        backgroundColor: '#1b1d24',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                      },
                      dropdown: {
                        backgroundColor: '#1b1d24',
                        borderColor: 'rgba(255, 255, 255, 0.2)',
                      },
                    }}
                  />

                  <TextInput
                    label={<Text size="sm" fw={600} c="gray.3">Post Code</Text>}
                    placeholder="e.g. WV6 9NW"
                    value={postCode}
                    onChange={(e) => setPostCode(e.target.value)}
                    required
                    size="md"
                    styles={{
                      input: {
                        backgroundColor: '#1b1d24',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                      },
                    }}
                  />

                  <TextInput
                    label={<Text size="sm" fw={600} c="gray.3">Date of Birth</Text>}
                    placeholder="YYYY-MM-DD"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    required
                    size="md"
                    styles={{
                      input: {
                        backgroundColor: '#1b1d24',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                      },
                    }}
                  />
                </SimpleGrid>

                <Divider my="xs" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }} />

                {/* Consent & Permissions */}
                <Stack gap="sm">
                  <Text size="sm" fw={700} c="#fbbf24">
                    Marketing & Communication Preferences
                  </Text>

                  <Checkbox
                    label={
                      <Text size="xs" c="gray.3">
                        Yes, I&apos;d like to receive emails from the PDC regarding news, priority ticket access, and future events.
                      </Text>
                    }
                    checked={consentPdc}
                    onChange={(e) => setConsentPdc(e.currentTarget.checked)}
                    color="green"
                  />

                  <Box>
                    <Text size="xs" c="gray.3" mb={6}>
                      Can Mr Vegas contact you with marketing and promotional offers?
                    </Text>
                    <Radio.Group value={consentMrVegas} onChange={setConsentMrVegas}>
                      <Group gap="xl">
                        <Radio value="yes" label={<Text size="xs" c="gray.3">Yes</Text>} color="green" />
                        <Radio value="no" label={<Text size="xs" c="gray.3">No</Text>} color="gray" />
                      </Group>
                    </Radio.Group>
                  </Box>

                  <Text size="xs" c="dimmed" style={{ lineHeight: 1.5 }} mt={4}>
                    By entering you agree to share your personal details with Mr Vegas and the PDC. Your data will be processed strictly in accordance with their privacy policies.
                    You must be 18+ to enter. Terms and conditions apply.
                  </Text>
                </Stack>

                <Button
                  type="submit"
                  size="xl"
                  loading={submitting}
                  style={{
                    background: 'linear-gradient(135deg, #00a862 0%, #00874e 100%)',
                    boxShadow: '0 4px 20px rgba(0, 168, 98, 0.4)',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: 18,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                  }}
                  rightSection={<IconArrowRight size={20} />}
                >
                  Submit Free Entry
                </Button>

                <Group justify="center" gap="lg" mt="xs">
                  <Group gap={6} align="center">
                    <IconLock size={14} color="#9ca3af" />
                    <Text size="xs" c="dimmed">
                      SSL Encrypted & GDPR Compliant
                    </Text>
                  </Group>

                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ textDecoration: 'underline', cursor: 'pointer' }}
                    onClick={() => setTermsOpen(true)}
                  >
                    Terms & Conditions
                  </Text>
                </Group>
              </Stack>
            </form>
          )}
        </Paper>

        {/* Footer info */}
        <Box mt="xl" style={{ textAlign: 'center' }}>
          <Text size="xs" c="dimmed">
            © 2026 Mr Vegas & Professional Darts Corporation. Official Title Sponsorship Activation.
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            Please gamble responsibly. 18+ only. BeGambleAware.org
          </Text>
        </Box>
      </Container>

      {/* Terms & Conditions Modal */}
      <Modal
        opened={termsOpen}
        onClose={() => setTermsOpen(false)}
        title={<Text fw={700} size="md">Grand Slam of Darts Giveaway Terms & Conditions</Text>}
        centered
        size="lg"
        styles={{
          content: { backgroundColor: '#181a20', color: '#f3f4f6' },
          header: { backgroundColor: '#181a20', color: '#f3f4f6' },
        }}
      >
        <Stack gap="sm">
          <Text size="xs" c="gray.3" style={{ lineHeight: 1.6 }}>
            1. The promoter of this ticket giveaway is Mr Vegas in partnership with the Professional Darts Corporation (PDC).
          </Text>
          <Text size="xs" c="gray.3" style={{ lineHeight: 1.6 }}>
            2. Entrants must be aged 18 years or over at the time of entry. Proof of age and identity may be required.
          </Text>
          <Text size="xs" c="gray.3" style={{ lineHeight: 1.6 }}>
            3. Each valid entry is entered into the prize draw for general admission tickets to the Mr Vegas Grand Slam of Darts at WV Active Aldersley.
          </Text>
          <Text size="xs" c="gray.3" style={{ lineHeight: 1.6 }}>
            4. Prizes are non-transferable, non-refundable, and no cash alternative is offered.
          </Text>
          <Text size="xs" c="gray.3" style={{ lineHeight: 1.6 }}>
            5. Winners will be notified via email or phone prior to the event date.
          </Text>
        </Stack>
      </Modal>
    </Box>
  );
}
