import { useEffect, useRef, useState } from 'react';
import {
    CalendarClock,
    Download,
    FileArchive,
    FileImage,
    FileText,
    Files,
    HardDrive,
    RefreshCw,
    Tag,
    Trash2,
    Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { Modal } from '@/components/ui/Modal';
import { useUserDocuments } from '@/hooks/useUserDocuments';
import type { UserDocumentAsset } from '@/types';

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_FILE_TYPES = 'image/*,.pdf,.zip,application/pdf,application/zip,application/x-zip-compressed';

function formatFileSize(sizeBytes: number): string {
    if (sizeBytes < 1024) return `${sizeBytes} B`;
    if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string | null): string {
    if (!value) return 'Sem registro';

    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return value;

    return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(new Date(parsed));
}

function tagsToInput(tags: string[]): string {
    return tags.join(', ');
}

function inputToTags(value: string): string[] {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function stripExtension(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, '');
}

function isImageMimeType(mimeType: string): boolean {
    return mimeType.toLowerCase().startsWith('image/');
}

function isPdfMimeType(mimeType: string): boolean {
    return mimeType.toLowerCase() === 'application/pdf';
}

function isZipMimeType(mimeType: string): boolean {
    const normalized = mimeType.toLowerCase();
    return (
        normalized === 'application/zip' ||
        normalized === 'application/x-zip-compressed' ||
        normalized === 'multipart/x-zip'
    );
}

function normalizeSupportedMimeType(value: string): string {
    const normalized = value.trim().toLowerCase();

    if (!normalized) return '';
    if (isImageMimeType(normalized)) return normalized;
    if (isPdfMimeType(normalized)) return normalized;
    if (isZipMimeType(normalized)) return 'application/zip';

    return '';
}

function inferMimeTypeFromFile(file: File): string {
    const directMimeType = normalizeSupportedMimeType(file.type);
    if (directMimeType) {
        return directMimeType;
    }

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.pdf')) return 'application/pdf';
    if (lowerName.endsWith('.zip')) return 'application/zip';
    if (lowerName.endsWith('.png')) return 'image/png';
    if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
    if (lowerName.endsWith('.webp')) return 'image/webp';
    if (lowerName.endsWith('.gif')) return 'image/gif';
    if (lowerName.endsWith('.bmp')) return 'image/bmp';
    if (lowerName.endsWith('.heic')) return 'image/heic';
    if (lowerName.endsWith('.heif')) return 'image/heif';

    return '';
}

function applyMimeTypeToDataUrl(dataUrl: string, mimeType: string): string {
    return dataUrl.replace(/^data:[^;,]+(?=;base64,)/i, `data:${mimeType}`);
}

function readFileAsDataUrl(file: File, mimeType: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result !== 'string') {
                reject(new Error('Falha ao ler o arquivo.'));
                return;
            }

            resolve(mimeType ? applyMimeTypeToDataUrl(reader.result, mimeType) : reader.result);
        };
        reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo.'));
        reader.readAsDataURL(file);
    });
}

function getDocumentTypeLabel(mimeType: string): string {
    if (isImageMimeType(mimeType)) return 'Imagem';
    if (isPdfMimeType(mimeType)) return 'PDF';
    if (isZipMimeType(mimeType)) return 'ZIP';
    return 'Arquivo';
}

function getDocumentTypeMeta(mimeType: string): {
    icon: typeof FileImage;
    accentClassName: string;
    label: string;
    helper: string;
} {
    if (isImageMimeType(mimeType)) {
        return {
            icon: FileImage,
            accentClassName: 'bg-indigo-500/10 text-indigo-300',
            label: 'Imagem',
            helper: 'Preview em imagem',
        };
    }

    if (isPdfMimeType(mimeType)) {
        return {
            icon: FileText,
            accentClassName: 'bg-rose-500/10 text-rose-300',
            label: 'PDF',
            helper: 'Preview em PDF',
        };
    }

    if (isZipMimeType(mimeType)) {
        return {
            icon: FileArchive,
            accentClassName: 'bg-amber-500/10 text-amber-300',
            label: 'ZIP',
            helper: 'Arquivo compactado',
        };
    }

    return {
        icon: Files,
        accentClassName: 'bg-surface-800 text-gray-300',
        label: 'Arquivo',
        helper: 'Sem preview',
    };
}

function renderDocumentVisual(
    source: string,
    mimeType: string,
    title: string,
    heightClassName: string
) {
    if (isImageMimeType(mimeType)) {
        return (
            <img
                src={source}
                alt={title}
                className={`${heightClassName} w-full bg-surface-950 object-cover`}
            />
        );
    }

    if (isPdfMimeType(mimeType)) {
        return (
            <iframe
                src={source}
                title={title}
                className={`${heightClassName} w-full bg-white`}
            />
        );
    }

    const meta = getDocumentTypeMeta(mimeType);
    const Icon = meta.icon;

    return (
        <div className={`flex ${heightClassName} w-full flex-col items-center justify-center gap-3 bg-surface-950/80 px-6 text-center`}>
            <div className={`rounded-2xl p-4 ${meta.accentClassName}`}>
                <Icon className="h-10 w-10" />
            </div>
            <div>
                <p className="text-sm font-semibold text-white">{meta.label}</p>
                <p className="mt-1 text-xs text-gray-500">{meta.helper}</p>
            </div>
        </div>
    );
}

export function Documents() {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const { documents, loading, refreshing, reload, upload, update, remove, download } = useUserDocuments();

    const [selectedId, setSelectedId] = useState<string>('');
    const [uploadTitle, setUploadTitle] = useState('');
    const [uploadDescription, setUploadDescription] = useState('');
    const [uploadTags, setUploadTags] = useState('');
    const [uploadFileDataUrl, setUploadFileDataUrl] = useState('');
    const [uploadFileMimeType, setUploadFileMimeType] = useState('');
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [downloadingId, setDownloadingId] = useState('');
    const [documentToDelete, setDocumentToDelete] = useState<UserDocumentAsset | null>(null);

    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editTags, setEditTags] = useState('');

    const selectedDocument = documents.find((item) => item.id === selectedId) ?? null;
    const totalBytes = documents.reduce((sum, item) => sum + item.sizeBytes, 0);
    const totalTags = documents.reduce((sum, item) => sum + item.tags.length, 0);

    useEffect(() => {
        if (!documents.length) {
            if (selectedId) {
                setSelectedId('');
            }
            return;
        }

        if (!selectedDocument) {
            setSelectedId(documents[0].id);
        }
    }, [documents, selectedId, selectedDocument]);

    useEffect(() => {
        if (!selectedDocument) {
            setEditTitle('');
            setEditDescription('');
            setEditTags('');
            return;
        }

        setEditTitle(selectedDocument.title);
        setEditDescription(selectedDocument.description ?? '');
        setEditTags(tagsToInput(selectedDocument.tags));
    }, [selectedDocument?.id, selectedDocument?.updatedAt]);

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const mimeType = inferMimeTypeFromFile(file);
        if (!mimeType) {
            toast.error('Selecione uma imagem, um PDF ou um ZIP.');
            event.target.value = '';
            return;
        }

        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
            toast.error('Use um arquivo de ate 10 MB.');
            event.target.value = '';
            return;
        }

        try {
            const dataUrl = await readFileAsDataUrl(file, mimeType);
            setUploadFileDataUrl(dataUrl);
            setUploadFileMimeType(mimeType);
            setUploadTitle(stripExtension(file.name).slice(0, 80));
        } catch (error) {
            console.error(error);
            toast.error('Nao foi possivel ler o arquivo.');
        } finally {
            event.target.value = '';
        }
    };

    const resetUploadForm = () => {
        setUploadTitle('');
        setUploadDescription('');
        setUploadTags('');
        setUploadFileDataUrl('');
        setUploadFileMimeType('');
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleUpload = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!uploadFileDataUrl) {
            toast.error('Selecione um arquivo para enviar.');
            return;
        }

        setUploading(true);
        try {
            await upload({
                title: uploadTitle.trim(),
                description: uploadDescription.trim(),
                tags: inputToTags(uploadTags),
                fileDataUrl: uploadFileDataUrl,
            });
            setSelectedId('');
            resetUploadForm();
        } finally {
            setUploading(false);
        }
    };

    const handleSaveMetadata = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selectedDocument) return;

        setSaving(true);
        try {
            await update(selectedDocument.id, {
                title: editTitle.trim(),
                description: editDescription.trim(),
                tags: inputToTags(editTags),
            });
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteDocument = async () => {
        if (!documentToDelete) return;

        setDeleting(true);
        try {
            await remove(documentToDelete.id);
            setSelectedId('');
            setDocumentToDelete(null);
        } finally {
            setDeleting(false);
        }
    };

    const handleDownload = async (documentId: string) => {
        setDownloadingId(documentId);
        try {
            await download(documentId);
        } finally {
            setDownloadingId('');
        }
    };

    if (loading) {
        return (
            <div className="space-y-6 animate-fade-in">
                <div className="grid gap-4 md:grid-cols-3">
                    <LoadingSkeleton variant="card" />
                    <LoadingSkeleton variant="card" />
                    <LoadingSkeleton variant="card" />
                </div>
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
                    <LoadingSkeleton variant="row" className="h-[480px]" />
                    <LoadingSkeleton variant="row" className="h-[480px]" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Biblioteca de Arquivos</h1>
                    <p className="mt-1 text-sm text-gray-400">
                        Veja os arquivos salvos no Supabase, baixe, exclua, altere metadados e envie imagens, PDFs ou ZIPs.
                    </p>
                </div>
                <Button
                    variant="secondary"
                    onClick={() => void reload()}
                    isLoading={refreshing}
                    className="w-full xl:w-auto"
                >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Atualizar
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-surface-800/70 to-surface-900 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-400">Arquivos salvos</p>
                            <p className="mt-2 text-3xl font-bold text-white">{documents.length}</p>
                        </div>
                        <div className="rounded-2xl bg-indigo-500/10 p-3 text-indigo-400">
                            <Files className="h-6 w-6" />
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-surface-800/70 to-surface-900 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-400">Espaco exibido</p>
                            <p className="mt-2 text-3xl font-bold text-white">{formatFileSize(totalBytes)}</p>
                        </div>
                        <div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-400">
                            <HardDrive className="h-6 w-6" />
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-surface-800/70 to-surface-900 p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-400">Tags personalizadas</p>
                            <p className="mt-2 text-3xl font-bold text-white">{totalTags}</p>
                        </div>
                        <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-400">
                            <Tag className="h-6 w-6" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
                <section className="space-y-4">
                    <form
                        onSubmit={handleUpload}
                        className="rounded-2xl border border-surface-700 bg-surface-900/70 p-5"
                    >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                                <h2 className="text-lg font-semibold text-white">Upload de novo arquivo</h2>
                                <p className="mt-1 text-sm text-gray-400">
                                    Envie imagens, PDFs e ZIPs direto para o storage privado e mantenha tudo organizado.
                                </p>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Upload className="mr-2 h-4 w-4" />
                                Selecionar arquivo
                            </Button>
                        </div>

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={ACCEPTED_FILE_TYPES}
                            className="hidden"
                            onChange={(event) => void handleFileSelect(event)}
                        />

                        <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                            <div className="overflow-hidden rounded-2xl border border-dashed border-surface-700 bg-surface-950/60">
                                {uploadFileDataUrl ? (
                                    renderDocumentVisual(
                                        uploadFileDataUrl,
                                        uploadFileMimeType,
                                        uploadTitle || 'Preview do arquivo',
                                        'h-56'
                                    )
                                ) : (
                                    <div className="flex h-56 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-gray-500">
                                        <Files className="h-8 w-8" />
                                        Escolha uma imagem, um PDF ou um ZIP para gerar o preview correto.
                                    </div>
                                )}
                            </div>

                            <div className="space-y-4">
                                <Input
                                    label="Nome do arquivo"
                                    value={uploadTitle}
                                    onChange={(event) => setUploadTitle(event.target.value)}
                                    maxLength={80}
                                    placeholder="Ex.: comprovante-marco"
                                />

                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-gray-300">
                                        Descricao
                                    </label>
                                    <textarea
                                        value={uploadDescription}
                                        onChange={(event) => setUploadDescription(event.target.value)}
                                        rows={4}
                                        maxLength={300}
                                        className="block w-full resize-none rounded-lg border border-surface-700 bg-surface-900/50 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                        placeholder="Contexto do arquivo, onde foi usado, o que ele representa..."
                                    />
                                </div>

                                <Input
                                    label="Tags"
                                    value={uploadTags}
                                    onChange={(event) => setUploadTags(event.target.value)}
                                    placeholder="ex.: recibo, energia, marco"
                                />

                                <div className="flex gap-3 pt-2">
                                    <Button type="submit" isLoading={uploading} className="flex-1">
                                        Enviar arquivo
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={resetUploadForm}
                                        disabled={uploading}
                                    >
                                        Limpar
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </form>

                    {documents.length === 0 ? (
                        <EmptyState
                            icon={Files}
                            title="Nenhum arquivo salvo"
                            description="As imagens, PDFs e ZIPs enviados por aqui aparecerao nesta biblioteca."
                            actionLabel="Selecionar arquivo"
                            onAction={() => fileInputRef.current?.click()}
                        />
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2">
                            {documents.map((item) => (
                                <article
                                    key={item.id}
                                    className={`overflow-hidden rounded-2xl border transition-all ${
                                        selectedId === item.id
                                            ? 'border-indigo-500/60 bg-surface-900 shadow-lg shadow-indigo-500/10'
                                            : 'border-surface-700 bg-surface-900/70 hover:border-surface-600'
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => setSelectedId(item.id)}
                                        className="block w-full text-left"
                                    >
                                        {renderDocumentVisual(item.previewUrl, item.mimeType, item.title, 'h-52')}
                                    </button>

                                    <div className="space-y-3 p-4">
                                        <div>
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <h3 className="truncate font-semibold text-white">{item.title}</h3>
                                                    <p className="mt-1 text-xs text-gray-500">
                                                        {formatFileSize(item.sizeBytes)} | {formatDateTime(item.createdAt)}
                                                    </p>
                                                </div>
                                                <div className="flex flex-col items-end gap-1">
                                                    <span className="rounded-full bg-surface-800 px-2.5 py-1 text-[11px] font-medium text-gray-300">
                                                        {item.source === 'manual_upload' ? 'Upload' : 'WhatsApp'}
                                                    </span>
                                                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-gray-400">
                                                        {getDocumentTypeLabel(item.mimeType)}
                                                    </span>
                                                </div>
                                            </div>

                                            {item.description ? (
                                                <p className="mt-2 line-clamp-2 text-sm text-gray-400">{item.description}</p>
                                            ) : (
                                                <p className="mt-2 text-sm text-gray-500">Sem descricao.</p>
                                            )}
                                        </div>

                                        <div className="flex min-h-7 flex-wrap gap-2">
                                            {item.tags.length > 0 ? (
                                                item.tags.map((tag) => (
                                                    <span
                                                        key={`${item.id}-${tag}`}
                                                        className="rounded-full bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-300"
                                                    >
                                                        #{tag}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="text-xs text-gray-500">Sem tags personalizadas.</span>
                                            )}
                                        </div>

                                        <div className="flex flex-wrap gap-2 border-t border-surface-800 pt-3">
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => setSelectedId(item.id)}
                                            >
                                                Editar
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                isLoading={downloadingId === item.id}
                                                onClick={() => void handleDownload(item.id)}
                                            >
                                                <Download className="mr-2 h-4 w-4" />
                                                Baixar
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="danger"
                                                onClick={() => setDocumentToDelete(item)}
                                            >
                                                <Trash2 className="mr-2 h-4 w-4" />
                                                Excluir
                                            </Button>
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </section>

                <aside className="space-y-4 xl:sticky xl:top-0">
                    <div className="rounded-2xl border border-surface-700 bg-surface-900/70 p-5">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-lg font-semibold text-white">Editar arquivo</h2>
                                <p className="mt-1 text-sm text-gray-400">
                                    Ajuste nome, descricao e tags do arquivo selecionado.
                                </p>
                            </div>
                            {selectedDocument ? (
                                <span className="rounded-full bg-surface-800 px-2.5 py-1 text-[11px] font-medium text-gray-300">
                                    {selectedDocument.source === 'manual_upload' ? 'Upload manual' : 'Recebido no WhatsApp'}
                                </span>
                            ) : null}
                        </div>

                        {!selectedDocument ? (
                            <div className="mt-5 rounded-2xl border border-dashed border-surface-700 bg-surface-950/60 p-6 text-sm text-gray-500">
                                Selecione um arquivo da galeria para editar os metadados ou baixar o conteudo.
                            </div>
                        ) : (
                            <form onSubmit={handleSaveMetadata} className="mt-5 space-y-4">
                                <div className="overflow-hidden rounded-2xl border border-surface-700 bg-surface-950/60">
                                    {renderDocumentVisual(
                                        selectedDocument.previewUrl,
                                        selectedDocument.mimeType,
                                        selectedDocument.title,
                                        isPdfMimeType(selectedDocument.mimeType) ? 'h-80' : 'h-56'
                                    )}
                                </div>

                                <div className="flex items-center justify-between rounded-2xl bg-surface-950/60 px-4 py-3 text-sm text-gray-400">
                                    <span>Tipo</span>
                                    <span className="font-medium text-gray-200">{getDocumentTypeLabel(selectedDocument.mimeType)}</span>
                                </div>

                                <Input
                                    label="Nome"
                                    value={editTitle}
                                    onChange={(event) => setEditTitle(event.target.value)}
                                    maxLength={80}
                                />

                                <div>
                                    <label className="mb-1.5 block text-sm font-medium text-gray-300">
                                        Descricao
                                    </label>
                                    <textarea
                                        value={editDescription}
                                        onChange={(event) => setEditDescription(event.target.value)}
                                        rows={5}
                                        maxLength={300}
                                        className="block w-full resize-none rounded-lg border border-surface-700 bg-surface-900/50 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    />
                                </div>

                                <Input
                                    label="Tags"
                                    value={editTags}
                                    onChange={(event) => setEditTags(event.target.value)}
                                    placeholder="Separadas por virgula"
                                />

                                <div className="rounded-2xl bg-surface-950/60 p-4 text-sm text-gray-400">
                                    <div className="flex items-center gap-2">
                                        <CalendarClock className="h-4 w-4 text-indigo-400" />
                                        <span>Atualizado em {formatDateTime(selectedDocument.updatedAt)}</span>
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                        <Download className="h-4 w-4 text-emerald-400" />
                                        <span>Ultimo download: {formatDateTime(selectedDocument.lastAccessedAt)}</span>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3 sm:flex-row">
                                    <Button type="submit" isLoading={saving} className="flex-1">
                                        Salvar alteracoes
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        isLoading={downloadingId === selectedDocument.id}
                                        onClick={() => void handleDownload(selectedDocument.id)}
                                        className="flex-1"
                                    >
                                        <Download className="mr-2 h-4 w-4" />
                                        Baixar
                                    </Button>
                                </div>
                                <Button
                                    type="button"
                                    variant="danger"
                                    onClick={() => setDocumentToDelete(selectedDocument)}
                                    className="w-full"
                                >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Excluir arquivo
                                </Button>
                            </form>
                        )}
                    </div>
                </aside>
            </div>

            <Modal
                isOpen={!!documentToDelete}
                onClose={() => !deleting && setDocumentToDelete(null)}
                title="Excluir arquivo"
                size="sm"
            >
                <div className="space-y-4">
                    <p className="text-sm text-gray-300">
                        O arquivo <strong className="text-white">{documentToDelete?.title}</strong> sera removido do Supabase e saira da sua biblioteca.
                    </p>
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
                        Esta acao exclui o arquivo e nao tem desfazer.
                    </div>
                    <div className="flex gap-3 border-t border-surface-700 pt-4">
                        <Button
                            variant="ghost"
                            onClick={() => setDocumentToDelete(null)}
                            disabled={deleting}
                            className="flex-1"
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="danger"
                            isLoading={deleting}
                            onClick={() => void handleDeleteDocument()}
                            className="flex-1"
                        >
                            Excluir
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
