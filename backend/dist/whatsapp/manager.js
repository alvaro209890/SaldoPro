"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppClientsManager = exports.WHATSAPP_SLOT_IDS = void 0;
exports.isWhatsAppSlotId = isWhatsAppSlotId;
const env_1 = require("../config/env");
const logger_1 = require("../lib/logger");
const client_1 = require("./client");
const events_1 = require("./events");
/** Only wa1 is active — single WhatsApp connection. */
exports.WHATSAPP_SLOT_IDS = ['wa1'];
function isWhatsAppSlotId(value) {
    return value === 'wa1' || value === 'wa2';
}
class WhatsAppClientsManager {
    client;
    constructor() {
        this.client = new client_1.WhatsAppClient({
            slotId: 'wa1',
            authDir: env_1.env.whatsappAuthDirWa1,
            displayName: 'WhatsApp 1'
        });
    }
    async startAll() {
        try {
            await this.client.start();
        }
        catch (error) {
            logger_1.logger.error('Failed to start WhatsApp', { error });
        }
    }
    async shutdownAll() {
        try {
            await this.client.shutdown();
        }
        catch (error) {
            logger_1.logger.error('Failed to shutdown WhatsApp', { error });
        }
    }
    getClient(_slotId) {
        return this.client;
    }
    getStatuses() {
        return [this.client.getStatus()];
    }
    getStatusBySlot(_slotId) {
        return this.client.getStatus();
    }
    async getQrPayloadBySlot(_slotId) {
        return this.client.getQrPayload();
    }
    async getQrPayloads() {
        try {
            return { wa1: await this.client.getQrPayload() };
        }
        catch {
            return { wa1: { available: false, reason: 'no_qr' } };
        }
    }
    async resetSession(_slotId) {
        await this.client.resetSession();
    }
    async sendTextWithRouting(input) {
        const normalizedPhone = (0, events_1.normalizePhoneNumber)(input.to);
        if (normalizedPhone.length < 10) {
            throw new Error('Invalid destination phone');
        }
        if (!this.client.getStatus().connected) {
            throw new Error('WhatsApp is not connected');
        }
        const result = await this.client.sendText(input.to, input.text, input.ownerUid);
        return { ...result, clientId: 'wa1' };
    }
}
exports.WhatsAppClientsManager = WhatsAppClientsManager;
