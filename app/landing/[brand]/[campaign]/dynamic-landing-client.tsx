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
  IconDownload,
  IconQrcode,
  IconWallet,
  IconUserPlus,
  IconCalendarEvent,
} from '@tabler/icons-react';
import { COUNTRY_OPTIONS } from '@/lib/country-list';
import {
  generateAttendeeBadgePng,
  buildVCardDataUri,
  buildCalendarIcsDataUri,
} from '@/lib/attendee-card';
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
    return init;
  });

  const [companyFaxHoneypot, setCompanyFaxHoneypot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [passImageUrl, setPassImageUrl] = useState<string | null>(null);
  const [generatingPass, setGeneratingPass] = useState(false);

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

      // Automatically generate attendee QR contact badge PNG
      try {
        setGeneratingPass(true);
        // Find attendee name from formValues
        const firstName = formValues[page.fields.find((f) => f.leadProperty === 'contact_first_name')?.id || ''] || '';
        const lastName = formValues[page.fields.find((f) => f.leadProperty === 'contact_last_name')?.id || ''] || '';
        const entityName = formValues[page.fields.find((f) => f.leadProperty === 'entity_name')?.id || ''] || '';
        const contactName = `${firstName} ${lastName}`.trim() || entityName;
        const email = formValues[page.fields.find((f) => f.leadProperty === 'contact_email')?.id || ''] || '';
        const phone = formValues[page.fields.find((f) => f.leadProperty === 'contact_phone')?.id || ''] || '';
        const countryCode = formValues[page.fields.find((f) => f.leadProperty === 'country')?.id || ''] || '';
        const countryName = COUNTRY_OPTIONS.find((c) => c.code === countryCode)?.name || countryCode;
        const postCode = formValues[page.fields.find((f) => f.leadProperty === 'post_code')?.id || ''] || '';

        const badgePng = await generateAttendeeBadgePng({
          name: contactName || 'Event Attendee',
          eventName: page.title || `${brandLabel} Event`,
          venue: 'WV Active Aldersley, Wolverhampton',
          email,
          phone,
          country: countryName,
          postCode,
          brandLabel,
          ticketType: 'Official Event Entry Pass',
        });
        setPassImageUrl(badgePng);
      } catch (err) {
        console.warn('Failed to generate attendee badge PNG:', err);
      } finally {
        setGeneratingPass(false);
      }
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
      case 'date': {
        const autoCompleteValue =
          field.leadProperty === 'contact_first_name' ? 'given-name'
          : field.leadProperty === 'contact_last_name' ? 'family-name'
          : field.leadProperty === 'contact_email' || field.type === 'email' ? 'email'
          : field.leadProperty === 'contact_phone' || field.type === 'tel' ? 'tel'
          : field.leadProperty === 'post_code' ? 'postal-code'
          : field.leadProperty === 'date_of_birth' || field.type === 'date' ? 'bday'
          : field.leadProperty === 'city' ? 'address-level2'
          : field.leadProperty === 'address' ? 'street-address'
          : field.leadProperty === 'entity_name' ? 'organization'
          : undefined;

        const fieldName =
          field.leadProperty === 'contact_first_name' ? 'firstName'
          : field.leadProperty === 'contact_last_name' ? 'lastName'
          : field.leadProperty === 'contact_email' ? 'email'
          : field.leadProperty === 'contact_phone' ? 'tel'
          : field.leadProperty === 'post_code' ? 'postalCode'
          : field.leadProperty === 'date_of_birth' ? 'bday'
          : field.id;

        return (
          <TextInput
            key={field.id}
            id={fieldName}
            name={fieldName}
            autoComplete={autoCompleteValue}
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
      }

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
              placeholder="Select or type country..."
              data={countrySelectData}
              value={val || null}
              onChange={(value) => handleFieldChange(field.id, value)}
              searchable
              clearable
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
          {/* Header Banner Block */}
          {page.blocks?.showHeroBanner !== false && page.heroBannerUrl && (
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
            {/* Event Intro Copy Block */}
            {((page.blocks?.showHeroCopy !== false && (page.heroHeadline || page.heroSubheadline)) ||
              (page.blocks?.showBullets !== false && page.bodyBullets && page.bodyBullets.length > 0)) && (
              <Stack gap="xs" mb="xl">
                {page.blocks?.showHeroCopy !== false && page.heroHeadline && (
                  <Text size="md" fw={700} c={design.accentColor} style={{ lineHeight: 1.4 }}>
                    {page.heroHeadline}
                  </Text>
                )}

                {page.blocks?.showHeroCopy !== false && page.heroSubheadline && (
                  <Text size="sm" c="gray.3" style={{ lineHeight: 1.6 }}>
                    {page.heroSubheadline}
                  </Text>
                )}

                {page.blocks?.showBullets !== false &&
                  page.bodyBullets?.map((bullet, idx) => (
                    <Text
                      key={idx}
                      size="sm"
                      c={idx === page.bodyBullets!.length - 1 ? '#10b981' : 'gray.3'}
                      fw={idx === page.bodyBullets!.length - 1 ? 600 : 400}
                      style={{ lineHeight: 1.6 }}
                    >
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

                {/* Attendee QR Contact Card Pass Block */}
                {page.blocks?.showDigitalPasses !== false && passImageUrl && (
                  <Box
                    mt="lg"
                    p="md"
                    style={{
                      width: '100%',
                      maxWidth: 420,
                      backgroundColor: '#0d1117',
                      borderRadius: 16,
                      border: `1px solid ${design.primaryColor}66`,
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                    }}
                  >
                    <Group gap="xs" align="center" mb="xs">
                      <IconQrcode size={20} color={design.primaryColor} />
                      <Text size="sm" fw={700} c={design.primaryColor}>
                        Your Event Contact Pass
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed" mb="md" style={{ maxWidth: 360 }}>
                      A hostess at the event can scan this QR code directly into their phone contacts (vCard).
                    </Text>

                    <Box
                      style={{
                        position: 'relative',
                        width: '100%',
                        borderRadius: 12,
                        overflow: 'hidden',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={passImageUrl}
                        alt="Event Attendee Pass"
                        style={{
                          width: '100%',
                          height: 'auto',
                          display: 'block',
                          objectFit: 'contain',
                        }}
                      />
                    </Box>

                    <Stack gap="xs" mt="md" style={{ width: '100%' }}>
                      <Button
                        component="a"
                        href={passImageUrl}
                        download={`event-pass-${campaignSlug || 'attendee'}.png`}
                        size="md"
                        fullWidth
                        leftSection={<IconDownload size={18} />}
                        style={{
                          background: `linear-gradient(135deg, ${design.primaryColor} 0%, ${design.primaryColor}cc 100%)`,
                          color: '#ffffff',
                          fontWeight: 700,
                        }}
                      >
                        Save Pass to Photos / Images
                      </Button>

                      <Button
                        component="a"
                        href={buildVCardDataUri({
                          name:
                            `${formValues[page.fields.find((f) => f.leadProperty === 'contact_first_name')?.id || ''] || ''} ${formValues[page.fields.find((f) => f.leadProperty === 'contact_last_name')?.id || ''] || ''}`.trim() ||
                            formValues[page.fields.find((f) => f.leadProperty === 'entity_name')?.id || ''] ||
                            'Event Attendee',
                          eventName: page.title || `${brandLabel} Event`,
                          email: formValues[page.fields.find((f) => f.leadProperty === 'contact_email')?.id || ''] || '',
                          phone: formValues[page.fields.find((f) => f.leadProperty === 'contact_phone')?.id || ''] || '',
                          country:
                            COUNTRY_OPTIONS.find(
                              (c) => c.code === formValues[page.fields.find((f) => f.leadProperty === 'country')?.id || '']
                            )?.name || '',
                          postCode: formValues[page.fields.find((f) => f.leadProperty === 'post_code')?.id || ''] || '',
                          brandLabel,
                          ticketType: 'Official Event Entry Pass',
                        })}
                        download={`event-pass-${campaignSlug || 'attendee'}.vcf`}
                        variant="default"
                        size="md"
                        fullWidth
                        leftSection={<IconUserPlus size={18} color="#34d399" />}
                        style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.06)',
                          borderColor: 'rgba(255, 255, 255, 0.15)',
                          color: '#ffffff',
                          fontWeight: 600,
                        }}
                      >
                        Save Contact Card to Phone
                      </Button>

                      {page.blocks?.showCalendarInvite !== false && (
                        <Button
                          component="a"
                          href={buildCalendarIcsDataUri({
                            name:
                              `${formValues[page.fields.find((f) => f.leadProperty === 'contact_first_name')?.id || ''] || ''} ${formValues[page.fields.find((f) => f.leadProperty === 'contact_last_name')?.id || ''] || ''}`.trim() ||
                              'Event Attendee',
                            eventName: page.title || `${brandLabel} Event`,
                            venue: 'WV Active Aldersley, Wolverhampton',
                            brandLabel,
                          })}
                          download="event-schedule.ics"
                          variant="default"
                          size="md"
                          fullWidth
                          leftSection={<IconCalendarEvent size={18} color="#fbbf24" />}
                          style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.06)',
                            borderColor: 'rgba(255, 255, 255, 0.15)',
                            color: '#ffffff',
                            fontWeight: 600,
                          }}
                        >
                          Add Event to Calendar
                        </Button>
                      )}

                      <Button
                        onClick={async () => {
                          try {
                            const firstName = formValues[page.fields.find((f) => f.leadProperty === 'contact_first_name')?.id || ''] || '';
                            const lastName = formValues[page.fields.find((f) => f.leadProperty === 'contact_last_name')?.id || ''] || '';
                            const entityName = formValues[page.fields.find((f) => f.leadProperty === 'entity_name')?.id || ''] || '';
                            const res = await fetch('/api/wallet/pass', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name: `${firstName} ${lastName}`.trim() || entityName || 'Event Attendee',
                                eventName: page.title || `${brandLabel} Event`,
                                venue: 'WV Active Aldersley, Wolverhampton',
                                email: formValues[page.fields.find((f) => f.leadProperty === 'contact_email')?.id || ''] || '',
                                phone: formValues[page.fields.find((f) => f.leadProperty === 'contact_phone')?.id || ''] || '',
                                country:
                                  COUNTRY_OPTIONS.find(
                                    (c) => c.code === formValues[page.fields.find((f) => f.leadProperty === 'country')?.id || '']
                                  )?.name || '',
                                postCode: formValues[page.fields.find((f) => f.leadProperty === 'post_code')?.id || ''] || '',
                                brand,
                                campaign: campaignSlug,
                                brandLabel,
                              }),
                            });

                            if (!res.ok) {
                              const data = await res.json().catch(() => ({}));
                              if (res.status === 501) {
                                alert(
                                  'Apple Wallet pass endpoint is installed. To generate live signed .pkpass files on your domain, upload your Apple Developer Pass Type ID certificate and private key.'
                                );
                                return;
                              }
                              throw new Error(data.error || 'Failed to download Apple Wallet pass');
                            }

                            const blob = await res.blob();
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `event-pass-${campaignSlug || 'attendee'}.pkpass`;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            window.URL.revokeObjectURL(url);
                          } catch (err: any) {
                            alert(err?.message || 'Could not download pass.');
                          }
                        }}
                        size="md"
                        fullWidth
                        leftSection={<IconWallet size={18} color="#ffffff" />}
                        style={{
                          backgroundColor: '#000000',
                          border: '1px solid rgba(255, 255, 255, 0.25)',
                          color: '#ffffff',
                          fontWeight: 700,
                        }}
                      >
                        Add to Apple Wallet (.pkpass)
                      </Button>

                      <Button
                        component="a"
                        href={`/api/badge?name=${encodeURIComponent(`${formValues[page.fields.find((f) => f.leadProperty === 'contact_first_name')?.id || ''] || ''} ${formValues[page.fields.find((f) => f.leadProperty === 'contact_last_name')?.id || ''] || ''}`.trim() || 'Attendee')}&email=${encodeURIComponent(formValues[page.fields.find((f) => f.leadProperty === 'contact_email')?.id || ''] || '')}&phone=${encodeURIComponent(formValues[page.fields.find((f) => f.leadProperty === 'contact_phone')?.id || ''] || '')}&brand=${encodeURIComponent(brand)}&campaign=${encodeURIComponent(campaignSlug)}`}
                        target="_blank"
                        size="md"
                        fullWidth
                        leftSection={<IconWallet size={18} color="#93c5fd" />}
                        style={{
                          backgroundColor: '#1e293b',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#ffffff',
                          fontWeight: 700,
                        }}
                      >
                        Add to Google Wallet / View Pass
                      </Button>
                    </Stack>
                  </Box>
                )}

                <Button
                  variant="outline"
                  color="yellow"
                  size="md"
                  mt="md"
                  onClick={() => {
                    setSubmitted(false);
                    setPassImageUrl(null);
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

                  {page.blocks?.showFooterDisclaimer !== false && page.footerDisclaimer && (
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

                  {page.blocks?.showTermsModal !== false && page.termsHtml && (
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
