export type MessageDirection = 'inbound' | 'outbound' | 'auto_reply';
export type MessageStatus = 'received' | 'sent' | 'failed';

export interface WhatsAppMessageRecord {
  messageId: string;
  direction: MessageDirection;
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
    hasImage?: boolean;
  };
}

export interface RuntimeStatus {
  connected: boolean;
  state: 'open' | 'connecting' | 'close';
  phone: string | null;
  lastDisconnectReason: string | null;
}
