"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compressPdfBufferToFit = compressPdfBufferToFit;
const pdf_lib_1 = require("pdf-lib");
function clearPdfMetadata(document) {
    document.setTitle('');
    document.setAuthor('');
    document.setSubject('');
    document.setProducer('');
    document.setCreator('');
    document.setKeywords([]);
}
async function saveOptimizedPdf(document) {
    clearPdfMetadata(document);
    const bytes = await document.save({
        useObjectStreams: true,
        addDefaultPage: false,
        updateFieldAppearances: false,
        objectsPerTick: 100
    });
    return Buffer.from(bytes);
}
async function compressPdfBufferToFit(buffer, targetBytes) {
    if (!buffer || buffer.length === 0) {
        return null;
    }
    if (buffer.length <= targetBytes) {
        return buffer;
    }
    let best = buffer;
    try {
        const loaded = await pdf_lib_1.PDFDocument.load(buffer, {
            ignoreEncryption: true,
            updateMetadata: false
        });
        const optimized = await saveOptimizedPdf(loaded);
        if (optimized.length < best.length) {
            best = optimized;
        }
        if (best.length <= targetBytes) {
            return best;
        }
    }
    catch {
        return null;
    }
    try {
        const source = await pdf_lib_1.PDFDocument.load(best, {
            ignoreEncryption: true,
            updateMetadata: false
        });
        const rebuilt = await pdf_lib_1.PDFDocument.create();
        const copiedPages = await rebuilt.copyPages(source, source.getPageIndices());
        for (const page of copiedPages) {
            rebuilt.addPage(page);
        }
        const rebuiltBytes = await saveOptimizedPdf(rebuilt);
        if (rebuiltBytes.length < best.length) {
            best = rebuiltBytes;
        }
    }
    catch {
        // Keep the best attempt so far.
    }
    return best.length <= targetBytes ? best : null;
}
