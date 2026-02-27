export type MessageDirection = 'inbound' | 'outbound' | 'auto_reply';
export type MessageStatus = 'received' | 'sent' | 'failed';
export type WhatsAppSlotId = 'wa1';

export interface WhatsAppMessageRecord {
  clientId: WhatsAppSlotId;
  messageId: string;
  direction: MessageDirection;
  ownerUid?: string;
  from: string;
  to: string;
  text: string;
  timestamp: string;
  waTimestamp: number | null;
  status: MessageStatus;
  rawType: string | null;
  createdAt: string;
  metadata: {
    fromMe: boolean;
    isGroup: boolean;
    isSelfChat?: boolean;
    hasImage?: boolean;
    hasAudio?: boolean;
  };
}

export interface RuntimeStatus {
  slotId: WhatsAppSlotId;
  connected: boolean;
  state: 'open' | 'connecting' | 'close';
  phone: string | null;
  lastDisconnectReason: string | null;
}
