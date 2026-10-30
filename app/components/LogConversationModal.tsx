'use client'

import { useState } from 'react'
import { Modal, Stack, Group, Text, Select, Textarea, Button, TextInput, SegmentedControl } from '@mantine/core'
import { StatusBadge } from '@sovereignsquad/gds-core/client'
import { showNotification } from '@mantine/notifications'
import { IconBrandWhatsapp, IconDeviceMobileMessage, IconCheck, IconMessagePlus } from '@tabler/icons-react'

type Props = {
  opened: boolean
  onClose: () => void
  leadId?: string
  brand: string
  contactName?: string
  phone?: string
  defaultChannel?: 'whatsapp' | 'imessage' | 'sms'
  onSaved?: () => void
}

export function LogConversationModal({
  opened,
  onClose,
  leadId,
  brand,
  contactName,
  phone,
  defaultChannel = 'whatsapp',
  onSaved,
}: Props) {
  const [channel, setChannel] = useState<'whatsapp' | 'imessage' | 'sms'>(defaultChannel)
  const [direction, setDirection] = useState<'outbound' | 'inbound' | 'two-way'>('two-way')
  const [subject, setSubject] = useState('')
  const [transcript, setTranscript] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  if (!opened) return null

  async function handleSave() {
    if (!leadId) {
      showNotification({
        title: 'Lead ID missing',
        message: 'Cannot save conversation without an associated lead.',
        color: 'red',
      })
      return
    }

    const text = transcript.trim()
    if (!text) {
      showNotification({
        title: 'Content required',
        message: 'Please paste the conversation text or transcript.',
        color: 'red',
      })
      return
    }

    setSaving(true)
    try {
      const fullText = notes.trim()
        ? `[Conversation Notes]\n${notes.trim()}\n\n[Transcript]\n${text}`
        : text

      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/activity?brand=${encodeURIComponent(brand)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: channel,
          direction: direction === 'two-way' ? null : direction,
          subject: subject.trim() || `${channel === 'whatsapp' ? 'WhatsApp' : channel === 'imessage' ? 'iMessage' : 'SMS'} chat with ${contactName || phone || 'contact'}`,
          transcript: fullText,
          notes: fullText,
          contactKey: contactName && phone ? `${contactName.toLowerCase().trim()}|${phone}` : undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Failed to save conversation (${res.status})`)
      }

      showNotification({
        title: 'Conversation Logged',
        message: `Saved ${channel === 'whatsapp' ? 'WhatsApp' : channel === 'imessage' ? 'iMessage' : 'SMS'} conversation to lead activity timeline.`,
        color: 'teal',
        icon: <IconCheck size={16} />,
      })

      setTranscript('')
      setNotes('')
      setSubject('')
      onClose()
      if (onSaved) onSaved()
    } catch (err: any) {
      showNotification({
        title: 'Save Failed',
        message: err?.message || 'Failed to save conversation.',
        color: 'red',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs" align="center">
          <IconMessagePlus size={18} color="var(--mantine-color-indigo-6)" />
          <Text fw={600} size="sm">
            Log {channel === 'whatsapp' ? 'WhatsApp' : channel === 'imessage' ? 'iMessage' : 'SMS'} Conversation
          </Text>
          {contactName && <StatusBadge status="neutral" size="xs">{contactName}</StatusBadge>}
        </Group>
      }
      size="lg"
      radius="md"
    >
      <Stack gap="sm">
        <Group grow align="flex-start">
          <Select
            label="Messaging Channel"
            value={channel}
            onChange={(val) => setChannel((val as any) || 'whatsapp')}
            data={[
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'imessage', label: 'iMessage' },
              { value: 'sms', label: 'SMS' },
            ]}
            required
          />
          <div>
            <Text size="xs" fw={500} mb={4}>
              Direction
            </Text>
            <SegmentedControl
              fullWidth
              size="xs"
              value={direction}
              onChange={(val) => setDirection(val as any)}
              data={[
                { label: 'Outbound', value: 'outbound' },
                { label: 'Inbound', value: 'inbound' },
                { label: 'Full Chat (Two-way)', value: 'two-way' },
              ]}
            />
          </div>
        </Group>

        {phone && (
          <Text size="xs" c="dimmed">
            Phone / Handle: <Text span fw={500}>{phone}</Text>
          </Text>
        )}

        <TextInput
          label="Conversation Subject / Topic (Optional)"
          placeholder="e.g. Discussed court booking SaaS & pro shop wholesale"
          value={subject}
          onChange={(e) => setSubject(e.currentTarget.value)}
        />

        <Textarea
          label="Conversation Transcript (Paste from WhatsApp or iMessage)"
          placeholder="Paste copied chat messages here...
[29/10/2026, 10:15] Rep: Hi, sharing the requested quote and details.
[29/10/2026, 10:18] Contact: Thanks, looks great. Can we book a call tomorrow?"
          value={transcript}
          onChange={(e) => setTranscript(e.currentTarget.value)}
          minRows={5}
          maxRows={12}
          autosize
          required
        />

        <Textarea
          label="Summary & Key Takeaways / Next Steps (Optional)"
          placeholder="Agreed to send formal proposal and schedule follow-up call on Friday."
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          minRows={2}
          maxRows={4}
          autosize
        />

        <Group justify="flex-end" mt="md" gap="xs">
          <Button variant="default" size="xs" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="xs"
            color="indigo"
            onClick={handleSave}
            loading={saving}
            leftSection={<IconCheck size={14} />}
          >
            Save to Activity Timeline
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
