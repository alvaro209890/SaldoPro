"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppClientsManager = exports.WHATSAPP_SLOT_IDS = void 0;
exports.isWhatsAppSlotId = isWhatsAppSlotId;
const env_1 = require("../config/env");
const firestore_1 = require("../lib/firestore");
const logger_1 = require("../lib/logger");
const client_1 = require("./client");
const events_1 = require("./events");
exports.WHATSAPP_SLOT_IDS = ['wa1', 'wa2'];
function isWhatsAppSlotId(value) {
    return value === 'wa1' || value === 'wa2';
}
class WhatsAppClientsManager {
    clients;
    constructor() {
        this.clients = {
            wa1: new client_1.WhatsAppClient({
                slotId: 'wa1',
                authDir: env_1.env.whatsappAuthDirWa1,
                displayName: 'WhatsApp 1'
            }),
            wa2: new client_1.WhatsAppClient({
                slotId: 'wa2',
                authDir: env_1.env.whatsappAuthDirWa2,
                displayName: 'WhatsApp 2'
            })
        };
    }
    async startAll() {
        await Promise.all(exports.WHATSAPP_SLOT_IDS.map(async (slotId) => {
            try {
                await this.clients[slotId].start();
            }
            catch (error) {
                logger_1.logger.error('Failed to start WhatsApp slot', { slotId, error });
            }
        }));
    }
    async shutdownAll() {
        await Promise.all(exports.WHATSAPP_SLOT_IDS.map(async (slotId) => {
            try {
                await this.clients[slotId].shutdown();
            }
            catch (error) {
                logger_1.logger.error('Failed to shutdown WhatsApp slot', { slotId, error });
            }
        }));
    }
    getClient(slotId) {
        return this.clients[slotId];
    }
    getStatuses() {
        return exports.WHATSAPP_SLOT_IDS.map((slotId) => this.clients[slotId].getStatus());
    }
    getStatusBySlot(slotId) {
        return this.clients[slotId].getStatus();
    }
    async getQrPayloadBySlot(slotId) {
        return this.clients[slotId].getQrPayload();
    }
    async getQrPayloads() {
        const payloads = await Promise.all(exports.WHATSAPP_SLOT_IDS.map(async (slotId) => {
            try {
                return [slotId, await this.clients[slotId].getQrPayload()];
            }
            catch {
                return [slotId, { available: false, reason: 'no_qr' }];
            }
        }));
        return Object.fromEntries(payloads);
    }
    async resetSession(slotId) {
        if (slotId) {
            await this.clients[slotId].resetSession();
            return;
        }
        await Promise.all(exports.WHATSAPP_SLOT_IDS.map((id) => this.clients[id].resetSession()));
    }
    firstConnectedClient() {
        for (const slotId of exports.WHATSAPP_SLOT_IDS) {
            const client = this.clients[slotId];
            if (client.getStatus().connected) {
                return { slotId, client };
            }
        }
        return null;
    }
    async sendTextWithRouting(input) {
        const normalizedPhone = (0, events_1.normalizePhoneNumber)(input.to);
        if (normalizedPhone.length < 10) {
            throw new Error('Invalid destination phone');
        }
        if (input.clientId) {
            const forcedClient = this.clients[input.clientId];
            if (!forcedClient.getStatus().connected) {
                throw new Error(`WhatsApp ${input.clientId} is not connected`);
            }
            const result = await forcedClient.sendText(input.to, input.text, input.ownerUid);
            return { ...result, clientId: input.clientId };
        }
        const lastClientId = await (0, firestore_1.getLastConversationClientIdByPhone)(input.ownerUid, normalizedPhone);
        if (lastClientId) {
            const routedClient = this.clients[lastClientId];
            if (routedClient.getStatus().connected) {
                const result = await routedClient.sendText(input.to, input.text, input.ownerUid);
                return { ...result, clientId: lastClientId };
            }
        }
        const fallback = this.firstConnectedClient();
        if (!fallback) {
            throw new Error('No connected WhatsApp client is available');
        }
        const result = await fallback.client.sendText(input.to, input.text, input.ownerUid);
        return { ...result, clientId: fallback.slotId };
    }
}
exports.WhatsAppClientsManager = WhatsAppClientsManager;
