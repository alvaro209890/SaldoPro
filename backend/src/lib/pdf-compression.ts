import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';

const execFile = promisify(execFileCallback);

interface GhostscriptStrategy {
  pdfSettings: '/ebook' | '/screen';
  imageResolution: number;
}

const GHOSTSCRIPT_STRATEGIES: GhostscriptStrategy[] = [
  { pdfSettings: '/ebook', imageResolution: 110 },
  { pdfSettings: '/screen', imageResolution: 96 },
  { pdfSettings: '/screen', imageResolution: 72 }
];

function ghostscriptCandidates(): string[] {
  if (process.platform === 'win32') {
    return ['gswin64c.exe', 'gswin64c', 'gs'];
  }

  return ['gs'];
}

function clearPdfMetadata(document: PDFDocument): void {
  document.setTitle('');
  document.setAuthor('');
  document.setSubject('');
  document.setProducer('');
  document.setCreator('');
  document.setKeywords([]);
}

async function saveOptimizedPdf(document: PDFDocument): Promise<Buffer> {
  clearPdfMetadata(document);

  const bytes = await document.save({
    useObjectStreams: true,
    addDefaultPage: false,
    updateFieldAppearances: false,
    objectsPerTick: 100
  });

  return Buffer.from(bytes);
}

async function compressWithPdfLib(buffer: Buffer): Promise<Buffer | null> {
  let best = buffer;

  try {
    const loaded = await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      updateMetadata: false
    });

    const optimized = await saveOptimizedPdf(loaded);
    if (optimized.length < best.length) {
      best = optimized;
    }
  } catch {
    // Keep trying stronger fallbacks below.
  }

  try {
    const source = await PDFDocument.load(best, {
      ignoreEncryption: true,
      updateMetadata: false
    });
    const rebuilt = await PDFDocument.create();
    const copiedPages = await rebuilt.copyPages(source, source.getPageIndices());

    for (const page of copiedPages) {
      rebuilt.addPage(page);
    }

    const rebuiltBytes = await saveOptimizedPdf(rebuilt);
    if (rebuiltBytes.length < best.length) {
      best = rebuiltBytes;
    }
  } catch {
    // Keep the best attempt so far.
  }

  return best.length < buffer.length ? best : null;
}

function buildGhostscriptArgs(
  inputPath: string,
  outputPath: string,
  strategy: GhostscriptStrategy
): string[] {
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

async function compressWithGhostscript(
  buffer: Buffer,
  targetBytes: number
): Promise<Buffer | null> {
  const workdir = await mkdtemp(join(tmpdir(), 'saldopro-pdf-'));
  const inputPath = join(workdir, 'input.pdf');

  try {
    await writeFile(inputPath, buffer);

    let best: Buffer | null = null;

    for (const binary of ghostscriptCandidates()) {
      let binaryMissing = false;

      for (let index = 0; index < GHOSTSCRIPT_STRATEGIES.length; index += 1) {
        const strategy = GHOSTSCRIPT_STRATEGIES[index];
        const outputPath = join(workdir, `output-${index}.pdf`);

        try {
          await execFile(binary, buildGhostscriptArgs(inputPath, outputPath, strategy), {
            timeout: 60_000,
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024
          });

          const candidate = await readFile(outputPath);
          if (!candidate || candidate.length === 0) {
            continue;
          }

          if (!best || candidate.length < best.length) {
            best = candidate;
          }

          if (candidate.length <= targetBytes) {
            return candidate;
          }
        } catch (error) {
          const code = (error as { code?: string } | undefined)?.code;
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
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function compressPdfBufferToFit(buffer: Buffer, targetBytes: number): Promise<Buffer | null> {
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
