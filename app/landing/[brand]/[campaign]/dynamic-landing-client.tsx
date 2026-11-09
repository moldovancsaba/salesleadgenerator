'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  Anchor,
  Paper,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconArrowRight,
} from '@tabler/icons-react';
import { COUNTRY_OPTIONS } from '@/lib/country-list';
import {
  LandingPageRecord,
  LandingFormFieldConfig,
  THEME_PRESETS,
} from '@/lib/landing-page-schema';

export function DynamicLandingClient({
  page,
  brand,
  brandLabel,
  campaignSlug,
  utm,
}: {
  page: LandingPageRecord;
  brand: string;
  brandLabel: string;
  campaignSlug: string;
  utm?: { source?: string; medium?: string; campaign?: string };
}) {
  const [formValues, setFormValues] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    page.fields.forEach((f) => {
      if (f.defaultValue !== undefined) {
        init[f.id] = f.defaultValue;
      } else if (f.type === 'checkbox') {
        init[f.id] = false;
      } else {
        init[f.id] = '';
      }
    });
    // Default country to United Kingdom / GB if present
    const countryField = page.fields.find((f) => f.leadProperty === 'country');
    if (countryField && !init[countryField.id]) {
      init[countryField.id] = 'GB';
    }
    return init;
  });

  const [companyFaxHoneypot, setCompanyFaxHoneypot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);

  const design = page.design || THEME_PRESETS.dark_emerald;

  const countrySelectData = COUNTRY_OPTIONS.map((c) => ({
    value: c.code,
    label: c.name,
  }));

  const handleFieldChange = (id: string, value: any) => {
    setFormValues((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      // Map dynamic fields to SLG Lead payload
      const payload: Record<string, any> = {
        campaign: campaignSlug,
        companyFaxHoneypot,
        dynamicFields: {},
      };

      for (const f of page.fields) {
        const val = formValues[f.id];
        if (f.leadProperty === 'contact_first_name') payload.firstName = val;
        else if (f.leadProperty === 'contact_last_name') payload.lastName = val;
        else if (f.leadProperty === 'contact_email') payload.contactEmail = val;
        else if (f.leadProperty === 'contact_phone') payload.contactPhone = val;
        else if (f.leadProperty === 'contact_title') payload.contactTitle = val;
        else if (f.leadProperty === 'entity_name') payload.entityName = val;
        else if (f.leadProperty === 'url') payload.websiteUrl = val;
        else if (f.leadProperty === 'country') payload.country = val;
        else if (f.leadProperty === 'post_code') payload.postCode = val;
        else if (f.leadProperty === 'city') payload.city = val;
        else if (f.leadProperty === 'address') payload.address = val;
        else if (f.leadProperty === 'size') payload.organizationSize = val;
        else if (f.leadProperty === 'sport_or_sector') payload.sportOrSector = val;
        else if (f.leadProperty === 'industry') payload.industry = val;
        else if (f.leadProperty === 'date_of_birth') payload.dateOfBirth = val;
        else if (f.leadProperty === 'message') payload.message = val;
        else if (f.leadProperty === 'custom_consent_checkbox') {
          payload.consentPdc = val === true;
          payload.dynamicFields[f.label] = val ? 'Yes' : 'No';
        } else if (f.leadProperty === 'custom_radio_choice') {
          payload.consentMrVegas = val === 'yes' || val === 'Yes';
          payload.dynamicFields[f.label] = val;
        } else {
          payload.dynamicFields[f.label || f.id] = val;
        }
      }

      // Add UTM metadata
      if (utm?.source) payload.dynamicFields['UTM Source'] = utm.source;
      if (utm?.medium) payload.dynamicFields['UTM Medium'] = utm.medium;
      if (utm?.campaign) payload.dynamicFields['UTM Campaign'] = utm.campaign;

      const res = await fetch(`/api/forms/${brand}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit entry');
      }

      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please check your information and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderField = (field: LandingFormFieldConfig) => {
    const val = formValues[field.id];

    switch (field.type) {
      case 'text':
      case 'email':
      case 'tel':
      case 'url':
      case 'date':
        return (
          <TextInput
            key={field.id}
            label={<Text size="sm" fw={600} c="gray.3">{field.label}</Text>}
            placeholder={field.placeholder}
            type={field.type}
            value={val ?? ''}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
            description={field.description ? <Text size="xs" c="dimmed">{field.description}</Text> : null}
            size="md"
            styles={{
              input: {
                backgroundColor: '#161922',
                borderColor: 'rgba(255, 255, 255, 0.15)',
                color: '#fff',
              },
            }}
          />
        );

      case 'textarea':
        return (
          <Textarea
            key={field.id}
            label={<Text size="sm" fw={600} c="gray.3">{field.label}</Text>}
            placeholder={field.placeholder}
            value={val ?? ''}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            required={field.required}
            minRows={3}
            size="md"
            styles={{
              input: {
                backgroundColor: '#161922',
                borderColor: 'rgba(255, 255, 255, 0.15)',
                color: '#fff',
              },
            }}
          />
        );

      case 'select':
        if (field.leadProperty === 'country') {
          return (
            <Select
              key={field.id}
              label={<Text size="sm" fw={600} c="gray.3">{field.label}</Text>}
              data={countrySelectData}
              value={val ?? 'GB'}
              onChange={(value) => handleFieldChange(field.id, value)}
              searchable
              required={field.required}
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
          );
        }

        if (field.leadProperty === 'size') {
          const sizes = ['Small', 'Medium', 'Large', 'Enterprise'];
          return (
            <Select
              key={field.id}
              label={<Text size="sm" fw={600} c="gray.3">{field.label}</Text>}
              data={sizes.map((s) => ({ value: s, label: s }))}
              value={val ?? ''}
              onChange={(value) => handleFieldChange(field.id, value)}
              required={field.required}
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
          );
        }

        return (
          <Select
            key={field.id}
            label={<Text size="sm" fw={600} c="gray.3">{field.label}</Text>}
            data={(field.options || []).map((o) => ({ value: o, label: o }))}
            value={val ?? ''}
            onChange={(value) => handleFieldChange(field.id, value)}
            required={field.required}
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
        );

      case 'checkbox':
        return (
          <Stack key={field.id} gap={4}>
            {field.description && (
              <Text size="xs" fw={700} c={design.accentColor}>
                {field.description}
              </Text>
            )}
            <Checkbox
              label={<Text size="xs" c="gray.3">{field.label}</Text>}
              checked={Boolean(val)}
              onChange={(e) => handleFieldChange(field.id, e.currentTarget.checked)}
              color="green"
            />
          </Stack>
        );

      case 'radio':
        const radioOpts = field.options && field.options.length > 0 ? field.options : ['Yes', 'No'];
        return (
          <Box key={field.id} mt="xs">
            <Text size="xs" fw={700} c={design.accentColor} mb={6}>
              {field.label}
            </Text>
            <Radio.Group value={val ?? ''} onChange={(value) => handleFieldChange(field.id, value)}>
              <Group gap="xl">
                {radioOpts.map((opt) => (
                  <Radio key={opt} value={opt.toLowerCase()} label={<Text size="xs" c="gray.3">{opt}</Text>} color="green" />
                ))}
              </Group>
            </Radio.Group>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Box
      style={{
        minHeight: '100vh',
        backgroundColor: design.backgroundColor,
        color: design.textColor,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        backgroundImage: `radial-gradient(circle at 50% 0%, ${design.primaryColor}2e 0%, ${design.backgroundColor}fb 75%)`,
        padding: '32px 16px 64px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <Box style={{ width: '100%', maxWidth: 640 }}>
        {/* Main Card */}
        <Paper
          radius="xl"
          style={{
            backgroundColor: design.cardBackgroundColor,
            border: `1px solid ${design.accentColor}33`,
            boxShadow: `0 24px 60px rgba(0, 0, 0, 0.8), 0 0 40px ${design.primaryColor}1a`,
            overflow: 'hidden',
          }}
        >
          {/* Header Banner */}
          {page.heroBannerUrl && (
            <Box style={{ position: 'relative', width: '100%', aspectRatio: '1248/562', backgroundColor: '#000' }}>
              <Image
                src={page.heroBannerUrl}
                alt={page.title}
                fill
                sizes="(max-width: 640px) 100vw, 640px"
                style={{ objectFit: 'contain' }}
                priority
                unoptimized
              />
            </Box>
          )}

          {/* Card Body */}
          <Box p={{ base: 'lg', sm: 'xl' }}>
            {/* Event Intro Copy */}
            {(page.heroHeadline || page.heroSubheadline || (page.bodyBullets && page.bodyBullets.length > 0)) && (
              <Stack gap="xs" mb="xl">
                {page.heroHeadline && (
                  <Text size="md" fw={700} c={design.accentColor} style={{ lineHeight: 1.4 }}>
                    {page.heroHeadline}
                  </Text>
                )}

                {page.heroSubheadline && (
                  <Text size="sm" c="gray.3" style={{ lineHeight: 1.6 }}>
                    {page.heroSubheadline}
                  </Text>
                )}

                {page.bodyBullets?.map((bullet, idx) => (
                  <Text key={idx} size="sm" c={idx === page.bodyBullets!.length - 1 ? '#10b981' : 'gray.3'} fw={idx === page.bodyBullets!.length - 1 ? 600 : 400} style={{ lineHeight: 1.6 }}>
                    {bullet}
                  </Text>
                ))}
              </Stack>
            )}

            <Divider mb="xl" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }} />

            {/* Form or Confirmation */}
            {submitted ? (
              <Stack align="center" gap="md" py="xl" style={{ textAlign: 'center' }}>
                <Box
                  style={{
                    width: 68,
                    height: 68,
                    borderRadius: '50%',
                    backgroundColor: `${design.primaryColor}33`,
                    border: `2px solid ${design.primaryColor}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: design.primaryColor,
                  }}
                >
                  <IconCheck size={36} stroke={2.5} />
                </Box>

                <Title order={2} size="h2" fw={900} c={design.primaryColor}>
                  {page.successTitle || 'Thank You for Entering!'}
                </Title>

                <Text size="md" c="gray.3" style={{ maxWidth: 480, lineHeight: 1.6 }}>
                  {page.successMessage || 'We have received your information.'}
                </Text>

                <Text size="lg" fw={800} c={design.accentColor} mt="xs">
                  Good Luck.
                </Text>

                <Button
                  variant="outline"
                  color="yellow"
                  size="md"
                  mt="md"
                  onClick={() => {
                    setSubmitted(false);
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

                  {/* Render Fields */}
                  {page.fields.map(renderField)}

                  {page.footerDisclaimer && (
                    <Text size="xs" c="dimmed" style={{ lineHeight: 1.5 }} mt={4}>
                      {page.footerDisclaimer.includes('privacy policy') ? (
                        <>
                          {page.footerDisclaimer.replace(/privacy policy\.?/i, '').trim()}{' '}
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
                        </>
                      ) : (
                        page.footerDisclaimer
                      )}
                    </Text>
                  )}

                  <Button
                    type="submit"
                    size="xl"
                    loading={submitting}
                    style={{
                      background: `linear-gradient(135deg, ${design.primaryColor} 0%, ${design.primaryColor}cc 100%)`,
                      boxShadow: `0 4px 20px ${design.primaryColor}66`,
                      color: '#ffffff',
                      fontWeight: 800,
                      fontSize: 18,
                      letterSpacing: '0.03em',
                      textTransform: 'uppercase',
                      marginTop: 8,
                    }}
                    rightSection={<IconArrowRight size={20} />}
                  >
                    {page.ctaButtonText || 'Submit Entry'}
                  </Button>

                  {page.termsHtml && (
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
                  )}
                </Stack>
              </form>
            )}
          </Box>
        </Paper>
      </Box>

      {/* Terms & Conditions Modal */}
      {page.termsHtml && (
        <Modal
          opened={termsOpen}
          onClose={() => setTermsOpen(false)}
          title={<Text fw={700} size="md">{page.title} — Terms &amp; Conditions</Text>}
          centered
          size="lg"
          styles={{
            content: { backgroundColor: '#181a20', color: '#f3f4f6' },
            header: { backgroundColor: '#181a20', color: '#f3f4f6' },
          }}
        >
          <Stack gap="sm">
            {page.termsHtml.split('\n').map((line, idx) => (
              <Text key={idx} size="xs" c="gray.3" style={{ lineHeight: 1.6 }}>
                {line}
              </Text>
            ))}
            <Divider my="xs" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }} />
            <Text size="xs" c="dimmed">
              For complete official General Terms &amp; Conditions (GTC) and Privacy Policy (PP), visit:{' '}
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
      )}
    </Box>
  );
}
