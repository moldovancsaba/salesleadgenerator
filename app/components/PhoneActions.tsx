'use client'

import { useState } from 'react'
import { Group, ActionIcon, Tooltip, Text } from '@mantine/core'
import {
  IconPhone,
  IconBrandWhatsapp,
  IconDeviceMobileMessage,
  IconMessagePlus,
} from '@tabler/icons-react'
import { buildWhatsAppUrl, buildIMessageUrl } from '@/lib/messaging-urls'
import { LogConversationModal } from './LogConversationModal'

type Props = {
  phone?: string | null
  contactName?: string
  entityName?: string
  leadId?: string
  brand: string
  size?: 'xs' | 'sm' | 'md'
  showNumberText?: boolean
  onConversationSaved?: () => void
}

export function PhoneActions({
  phone,
  contactName,
  entityName,
  leadId,
  brand,
  size = 'sm',
  showNumberText = true,
  onConversationSaved,
}: Props) {
  const [logModalOpen, setLogModalOpen] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<'whatsapp' | 'imessage' | 'sms'>('whatsapp')

  if (!phone || !phone.trim()) {
    return <Text size="sm" c="dimmed">—</Text>
  }

  const cleanPhone = phone.trim()
  const defaultText = brand === 'padel-africa'
    ? `Hi${contactName ? ` ${contactName}` : ''}, reaching out from Padel Africa regarding ${entityName || 'your padel club'}! We help clubs automate player bookings via WhatsApp and provide turnkey court supply.`
    : undefined
  const waUrl = buildWhatsAppUrl(cleanPhone, defaultText)
  const iMessageUrl = buildIMessageUrl(cleanPhone, defaultText)
  const telUrl = `tel:${cleanPhone}`

  function openLogger(channel: 'whatsapp' | 'imessage' | 'sms') {
    setSelectedChannel(channel)
    setLogModalOpen(true)
  }

  return (
    <>
      <Group gap={6} wrap="nowrap" align="center">
        {showNumberText && (
          <Text
            component="a"
            href={telUrl}
            size="sm"
            c="dimmed"
            style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
          >
            {cleanPhone}
          </Text>
        )}

        {/* Call (tel:) */}
        <Tooltip label={`Call ${cleanPhone}`} withArrow position="top">
          <ActionIcon
            component="a"
            href={telUrl}
            size={size}
            variant="subtle"
            color="gray"
            aria-label={`Call ${cleanPhone}`}
          >
            <IconPhone size={14} />
          </ActionIcon>
        </Tooltip>

        {/* WhatsApp */}
        {waUrl && (
          <Tooltip label="Chat on WhatsApp" withArrow position="top">
            <ActionIcon
              component="a"
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              size={size}
              variant="subtle"
              color="teal"
              aria-label={`Open WhatsApp chat with ${cleanPhone}`}
            >
              <IconBrandWhatsapp size={15} />
            </ActionIcon>
          </Tooltip>
        )}

        {/* iMessage / SMS */}
        {iMessageUrl && (
          <Tooltip label="Chat via iMessage / SMS" withArrow position="top">
            <ActionIcon
              component="a"
              href={iMessageUrl}
              size={size}
              variant="subtle"
              color="blue"
              aria-label={`Open iMessage with ${cleanPhone}`}
            >
              <IconDeviceMobileMessage size={15} />
            </ActionIcon>
          </Tooltip>
        )}

        {/* Log / Paste Conversation transcript */}
        {leadId && (
          <Tooltip label="Log WhatsApp / iMessage conversation transcript" withArrow position="top">
            <ActionIcon
              size={size}
              variant="subtle"
              color="indigo"
              onClick={() => openLogger('whatsapp')}
              aria-label="Log conversation transcript to SLG"
            >
              <IconMessagePlus size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>

      {leadId && (
        <LogConversationModal
          opened={logModalOpen}
          onClose={() => setLogModalOpen(false)}
          leadId={leadId}
          brand={brand}
          contactName={contactName}
          phone={cleanPhone}
          defaultChannel={selectedChannel}
          onSaved={onConversationSaved}
        />
      )}
    </>
  )
}
