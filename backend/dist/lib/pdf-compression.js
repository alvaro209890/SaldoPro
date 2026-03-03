"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compressPdfBufferToFit = compressPdfBufferToFit;
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const node_util_1 = require("node:util");
const pdf_lib_1 = require("pdf-lib");
const execFile = (0, node_util_1.promisify)(node_child_process_1.execFile);
const GHOSTSCRIPT_STRATEGIES = [
    { pdfSettings: '/ebook', imageResolution: 110 },
    { pdfSettings: '/screen', imageResolution: 96 },
    { pdfSettings: '/screen', imageResolution: 72 }
];
function ghostscriptCandidates() {
    if (process.platform === 'win32') {
        return ['gswin64c.exe', 'gswin64c', 'gs'];
    }
    return ['gs'];
}
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
async function compressWithPdfLib(buffer) {
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
    }
    catch {
        // Keep trying stronger fallbacks below.
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
    return best.length < buffer.length ? best : null;
}
function buildGhostscriptArgs(inputPath, outputPath, strategy) {
    const monoResolution = Math.max(72, Math.floor(strategy.imageResolution * 0.75));
    return [
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        '-dSAFER',
        '-dDetectDuplicateImages=true',
        '-dCompressFonts=true',
        '-dSubsetFonts=true',
        '-dAutoRotatePages=/None',
        '-dColorImageDownsampleType=/Bicubic',
        '-dGrayImageDownsampleType=/Bicubic',
        '-dMonoImageDownsampleType=/Subsample',
        '-dDownsampleColorImages=true',
        '-dDownsampleGrayImages=true',
        '-dDownsampleMonoImages=true',
        `-dColorImageResolution=${strategy.imageResolution}`,
        `-dGrayImageResolution=${strategy.imageResolution}`,
        `-dMonoImageResolution=${monoResolution}`,
        `-dPDFSETTINGS=${strategy.pdfSettings}`,
        `-sOutputFile=${outputPath}`,
        inputPath
    ];
}
async function compressWithGhostscript(buffer, targetBytes) {
    const workdir = await (0, promises_1.mkdtemp)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'saldopro-pdf-'));
    const inputPath = (0, node_path_1.join)(workdir, 'input.pdf');
    try {
        await (0, promises_1.writeFile)(inputPath, buffer);
        let best = null;
        for (const binary of ghostscriptCandidates()) {
            let binaryMissing = false;
            for (let index = 0; index < GHOSTSCRIPT_STRATEGIES.length; index += 1) {
                const strategy = GHOSTSCRIPT_STRATEGIES[index];
                const outputPath = (0, node_path_1.join)(workdir, `output-${index}.pdf`);
                try {
                    await execFile(binary, buildGhostscriptArgs(inputPath, outputPath, strategy), {
                        timeout: 60_000,
                        windowsHide: true,
                        maxBuffer: 4 * 1024 * 1024
                    });
                    const candidate = await (0, promises_1.readFile)(outputPath);
                    if (!candidate || candidate.length === 0) {
                        continue;
                    }
                    if (!best || candidate.length < best.length) {
                        best = candidate;
                    }
                    if (candidate.length <= targetBytes) {
                        return candidate;
                    }
                }
                catch (error) {
                    const code = error?.code;
                    if (code === 'ENOENT') {
                        binaryMissing = true;
                        break;
                    }
                }
            }
            if (!binaryMissing && best) {
                break;
            }
        }
        return best && best.length < buffer.length ? best : null;
    }
    finally {
        await (0, promises_1.rm)(workdir, { recursive: true, force: true });
    }
}
async function compressPdfBufferToFit(buffer, targetBytes) {
    if (!buffer || buffer.length === 0) {
        return null;
    }
    if (buffer.length <= targetBytes) {
        return buffer;
    }
    let best = buffer;
    const pdfLibCompressed = await compressWithPdfLib(best);
    if (pdfLibCompressed && pdfLibCompressed.length < best.length) {
        best = pdfLibCompressed;
        if (best.length <= targetBytes) {
            return best;
        }
    }
    const ghostscriptCompressed = await compressWithGhostscript(best, targetBytes);
    if (ghostscriptCompressed && ghostscriptCompressed.length < best.length) {
        best = ghostscriptCompressed;
    }
    return best.length <= targetBytes ? best : null;
}
