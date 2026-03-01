"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWhatsAppReminderNotifier = startWhatsAppReminderNotifier;
const firestore_1 = require("../lib/firestore");
const logger_1 = require("../lib/logger");
const REMINDER_POLL_MS = 60_000;
const REMINDER_BATCH_LIMIT = 50;
function formatAmountBr(value) {
    return `R$ ${value.toFixed(2).replace('.', ',')}`;
}
function formatDateBr(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd))
        return ymd;
    const [year, month, day] = ymd.split('-');
    return `${day}/${month}/${year}`;
}
function reminderTypeLabel(value) {
    return value === 'payable' ? 'A pagar' : 'A receber';
}
function buildReminderMessage(reminder) {
    const isFinancial = (reminder.reminderKind === 'payable' || reminder.reminderKind === 'receivable') &&
        reminder.amount != null &&
        (reminder.type === 'payable' || reminder.type === 'receivable');
    let detailLine = 'Lembrete comum';
    if (isFinancial && reminder.type && reminder.amount != null) {
        detailLine = `${reminderTypeLabel(reminder.type)}: ${formatAmountBr(reminder.amount)}`;
    }
    return [
        '*Lembrete SaldoPro*',
        '',
        `*${reminder.title}*`,
        detailLine,
        `Vencimento: ${formatDateBr(reminder.dueDate)} ${reminder.dueTime}`,
        ...(isFinancial
            ? ['', 'Gostaria que eu ja registrasse essa transacao agora?']
            : ['', 'Se quiser, te ajudo a organizar isso no app.'])
    ].join('\n');
}
function startWhatsAppReminderNotifier(manager) {
    let stopped = false;
    let inFlight = false;
    const tick = async () => {
        if (stopped || inFlight)
            return;
        inFlight = true;
        try {
            const status = manager.getStatuses()[0];
            if (!status?.connected)
                return;
            const nowIso = new Date().toISOString();
            const dueReminders = await (0, firestore_1.getDueWhatsAppReminders)(nowIso, REMINDER_BATCH_LIMIT);
            if (dueReminders.length === 0)
                return;
            let sentCount = 0;
            for (const reminder of dueReminders) {
                try {
                    await manager.sendTextWithRouting({
                        to: reminder.notifyPhone,
                        text: buildReminderMessage(reminder),
                        ownerUid: reminder.uid,
                        mediaUrl: reminder.receiptUrl ?? undefined
                    });
                    const marked = await (0, firestore_1.markReminderAsNotified)(reminder.uid, reminder.id, new Date().toISOString());
                    if (marked) {
                        sentCount += 1;
                    }
                }
                catch (error) {
                    logger_1.logger.warn('Failed to deliver WhatsApp reminder', {
                        reminderId: reminder.id,
                        uid: reminder.uid,
                        phone: reminder.notifyPhone,
                        error: error instanceof Error ? error.message : 'unknown'
                    });
                }
            }
            if (sentCount > 0) {
                logger_1.logger.info('WhatsApp reminders delivered', {
                    sentCount,
                    dueCount: dueReminders.length
                });
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to process due WhatsApp reminders', {
                name: error instanceof Error ? error.name : 'Error',
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
        }
        finally {
            inFlight = false;
        }
    };
    const timer = setInterval(() => {
        void tick();
    }, REMINDER_POLL_MS);
    logger_1.logger.info('WhatsApp reminder notifier started', {
        intervalMs: REMINDER_POLL_MS,
        batchLimit: REMINDER_BATCH_LIMIT
    });
    void tick();
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}
