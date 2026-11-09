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
  Anchor,
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
        backgroundColor: '#07080a',
        color: '#f3f4f6',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(0, 135, 78, 0.18) 0%, rgba(7, 8, 10, 0.98) 75%)',
        padding: '32px 16px 64px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <Box style={{ width: '100%', maxWidth: 640 }}>
        {/* Main Card with Single Seamless Frame */}
        <Paper
          radius="xl"
          style={{
            backgroundColor: '#0f1117',
            border: '1px solid rgba(255, 215, 0, 0.2)',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 168, 98, 0.12)',
            overflow: 'hidden',
          }}
        >
          {/* Header Banner - Full Width Image Container without cropping */}
          <Box style={{ position: 'relative', width: '100%', aspectRatio: '1248/562', backgroundColor: '#000' }}>
            <Image
              src="https://i.emlfiles.com/cmpimg/2/1/3/3/3/2/files/imagecache/25939/w1248_1861178_ga-ticket-giveaway-mrv.jpg"
              alt="Mr Vegas Grand Slam of Darts Ticket Giveaway"
              fill
              sizes="(max-width: 640px) 100vw, 640px"
              style={{ objectFit: 'contain' }}
              priority
              unoptimized
            />
          </Box>

          {/* Card Body */}
          <Box p={{ base: 'lg', sm: 'xl' }}>
            {/* Event Intro Copy */}
            <Stack gap="xs" mb="xl">
              <Text size="md" fw={700} c="#fbbf24" style={{ lineHeight: 1.4 }}>
                Title sponsors of Grand Slam of Darts Mr Vegas are delighted to offer tickets to this year’s event.
              </Text>

              <Text size="sm" c="gray.3" style={{ lineHeight: 1.6 }}>
                Located at <strong>WV Active Aldersley</strong> between <strong>14th – 22nd November</strong>, the Mr Vegas Grand Slam of Darts promises to be another enthralling tournament where the top players in the world battle it out for the <strong>Eric Bristow Trophy</strong>.
              </Text>

              <Text size="sm" c="gray.3" style={{ lineHeight: 1.6 }}>
                Simply complete the free to enter entry form for your chance to win tickets to this year&apos;s event!
              </Text>

              <Text size="sm" fw={600} c="#10b981">
                We look forward to seeing the lucky winners at this year&apos;s Mr Vegas Grand Slam of Darts!
              </Text>
            </Stack>

            <Divider mb="xl" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }} />

            {/* Form or Confirmation */}
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

                <Text size="md" c="gray.3" style={{ maxWidth: 480, lineHeight: 1.6 }}>
                  Ensure you&apos;re following us across <strong>Facebook, Twitter, Instagram, TikTok and YouTube</strong> to stay up to date with all of the latest PDC news and competitions.
                </Text>

                <Text size="lg" fw={800} c="#fbbf24" mt="xs">
                  Good Luck.
                </Text>

                <Button
                  variant="outline"
                  color="yellow"
                  size="md"
                  mt="md"
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

                  <TextInput
                    label={<Text size="sm" fw={600} c="gray.3">First Name</Text>}
                    placeholder="e.g. John"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    size="md"
                    styles={{
                      input: {
                        backgroundColor: '#161922',
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
                    size="md"
                    styles={{
                      input: {
                        backgroundColor: '#161922',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                      },
                    }}
                  />

                  <Select
                    label={<Text size="sm" fw={600} c="gray.3">Country</Text>}
                    data={countrySelectData}
                    value={country}
                    onChange={setCountry}
                    searchable
                    required
                    size="md"
                    classNames={{
                      dropdown: 'landing-select-dropdown',
                      option: 'landing-select-option',
                    }}
                    comboboxProps={{
                      withinPortal: true,
                      classNames: {
                        dropdown: 'landing-select-dropdown',
                        option: 'landing-select-option',
                      },
                    }}
                    styles={{
                      input: {
                        backgroundColor: '#161922',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                      },
                      dropdown: {
                        backgroundColor: '#161922',
                        borderColor: 'rgba(255, 255, 255, 0.2)',
                        color: '#ffffff',
                      },
                      option: {
                        color: '#f3f4f6',
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
                        backgroundColor: '#161922',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                      },
                    }}
                  />

                  <TextInput
                    label={<Text size="sm" fw={600} c="gray.3">Date of Birth (please select from the calendar)</Text>}
                    description={<Text size="xs" c="dimmed">YYYY-MM-DD (18+ only)</Text>}
                    placeholder="YYYY-MM-DD"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    required
                    size="md"
                    styles={{
                      input: {
                        backgroundColor: '#161922',
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
                        backgroundColor: '#161922',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                      },
                    }}
                  />

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
                        backgroundColor: '#161922',
                        borderColor: 'rgba(255, 255, 255, 0.15)',
                        color: '#fff',
                      },
                    }}
                  />

                  <Divider my="xs" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }} />

                  {/* Consent & Permissions */}
                  <Stack gap="sm">
                    <Checkbox
                      label={
                        <Text size="xs" c="gray.3">
                          Yes, I&apos;d like to receive emails from the PDC
                        </Text>
                      }
                      checked={consentPdc}
                      onChange={(e) => setConsentPdc(e.currentTarget.checked)}
                      color="green"
                    />

                    <Box mt="xs">
                      <Text size="xs" fw={700} c="#fbbf24" mb={6}>
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
                      By entering you are agreeing to share your personal data with Mr Vegas. You are agreeing to receive marketing communications. Data will be processed in accordance with its{' '}
                      <Anchor
                        href="https://r1.marketing-pages.com/p/500W-DNU/mrvegastcs"
                        target="_blank"
                        rel="noopener noreferrer"
                        c="#34d399"
                        underline="always"
                        size="xs"
                      >
                        privacy policy (PP)
                      </Anchor>
                      .
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
                      marginTop: 8,
                    }}
                    rightSection={<IconArrowRight size={20} />}
                  >
                    Submit Entry
                  </Button>

                  <Group justify="center" gap="md" mt="xs">
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ textDecoration: 'underline', cursor: 'pointer' }}
                      onClick={() => setTermsOpen(true)}
                    >
                      Please click HERE to see terms &amp; conditions
                    </Text>
                    <Text size="xs" c="dimmed">|</Text>
                    <Anchor
                      href="https://r1.marketing-pages.com/p/500W-DNU/mrvegastcs"
                      target="_blank"
                      rel="noopener noreferrer"
                      size="xs"
                      c="gray.4"
                      underline="always"
                    >
                      Full GTC &amp; Privacy Policy (External)
                    </Anchor>
                  </Group>
                </Stack>
              </form>
            )}
          </Box>
        </Paper>
      </Box>

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
            1. The promoter of this ticket giveaway is The Professional Darts Corporation Ltd (PDC) in partnership with Mr Vegas.
          </Text>
          <Text size="xs" c="gray.3" style={{ lineHeight: 1.6 }}>
            2. Entrants must be UK residents aged 18 years or over at the time of entry. Proof of age and identity may be required.
          </Text>
          <Text size="xs" c="gray.3" style={{ lineHeight: 1.6 }}>
            3. Each valid entry is entered into the prize draw for 4x Pairs of General Admission Tickets to the 2026 Mr Vegas Grand Slam of Darts at WV Active Aldersley.
          </Text>
          <Text size="xs" c="gray.3" style={{ lineHeight: 1.6 }}>
            4. Prizes are non-transferable, non-refundable, and no cash alternative is offered.
          </Text>
          <Text size="xs" c="gray.3" style={{ lineHeight: 1.6 }}>
            5. Winners will be selected at random and notified via email within 48 hours following the draw.
          </Text>
          <Divider my="xs" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }} />
          <Text size="xs" c="dimmed">
            For full General Terms &amp; Conditions (GTC) and Privacy Policy (PP), visit:{' '}
            <Anchor
              href="https://r1.marketing-pages.com/p/500W-DNU/mrvegastcs"
              target="_blank"
              rel="noopener noreferrer"
              c="#34d399"
              underline="always"
            >
              https://r1.marketing-pages.com/p/500W-DNU/mrvegastcs
            </Anchor>
          </Text>
        </Stack>
      </Modal>
    </Box>
  );
}
