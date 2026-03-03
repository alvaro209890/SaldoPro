import { useEffect, useRef, useState } from 'react';
import {
    CalendarClock,
    Download,
    Edit3,
    FileArchive,
    FileImage,
    FileText,
    Files,
    HardDrive,
    RefreshCw,
    Tag,
    Trash2,
    Upload,
    X,
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

/* ------------------------------------------------------------------ */
/*  Gallery card – compact card for the grid                          */
/* ------------------------------------------------------------------ */
function GalleryCard({
    item,
    downloadingId,
    onEdit,
    onDownload,
    onDelete,
}: {
    item: UserDocumentAsset;
    downloadingId: string;
    onEdit: (item: UserDocumentAsset) => void;
    onDownload: (id: string) => void;
    onDelete: (item: UserDocumentAsset) => void;
}) {
    const meta = getDocumentTypeMeta(item.mimeType);

    return (
        <article className="gallery-card-hover group relative overflow-hidden rounded-2xl border border-surface-700 bg-surface-900/70">
            {/* Thumbnail */}
            <div className="relative">
                {renderDocumentVisual(item.previewUrl, item.mimeType, item.title, 'h-40 sm:h-44')}

                {/* Hover overlay with actions (desktop) */}
                <div className="gallery-card-overlay absolute inset-0 hidden items-end justify-center bg-gradient-to-t from-black/70 via-black/30 to-transparent p-3 md:flex">
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => onEdit(item)}
                            className="rounded-xl bg-white/15 p-2.5 text-white backdrop-blur-sm transition-colors hover:bg-indigo-500/80"
                            title="Editar"
                        >
                            <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => onDownload(item.id)}
                            disabled={downloadingId === item.id}
                            className="rounded-xl bg-white/15 p-2.5 text-white backdrop-blur-sm transition-colors hover:bg-emerald-500/80 disabled:opacity-50"
                            title="Baixar"
                        >
                            <Download className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => onDelete(item)}
                            className="rounded-xl bg-white/15 p-2.5 text-white backdrop-blur-sm transition-colors hover:bg-red-500/80"
                            title="Excluir"
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Type badge */}
                <span className={`absolute left-2 top-2 rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.accentClassName}`}>
                    {meta.label}
                </span>
            </div>

            {/* Info */}
            <div className="space-y-2 p-3">
                <h3 className="truncate text-sm font-semibold text-white">{item.title}</h3>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                    <span>{formatFileSize(item.sizeBytes)}</span>
                    <span className="text-surface-700">·</span>
                    <span>{formatDateTime(item.createdAt)}</span>
                </div>

                {item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {item.tags.slice(0, 3).map((tag) => (
                            <span
                                key={`${item.id}-${tag}`}
                                className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300"
                            >
                                #{tag}
                            </span>
                        ))}
                        {item.tags.length > 3 && (
                            <span className="rounded-full bg-surface-800 px-2 py-0.5 text-[10px] font-medium text-gray-400">
                                +{item.tags.length - 3}
                            </span>
                        )}
                    </div>
                )}

                {/* Mobile actions (always visible) */}
                <div className="flex gap-2 border-t border-surface-800 pt-2 md:hidden">
                    <Button size="sm" variant="secondary" onClick={() => onEdit(item)} className="flex-1">
                        <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                        Editar
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        isLoading={downloadingId === item.id}
                        onClick={() => onDownload(item.id)}
                        className="flex-1"
                    >
                        <Download className="mr-1.5 h-3.5 w-3.5" />
                        Baixar
                    </Button>
                    <button
                        type="button"
                        onClick={() => onDelete(item)}
                        className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-500/10"
                        title="Excluir"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </article>
    );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */
export function Documents() {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const { documents, loading, refreshing, reload, upload, update, remove, download } = useUserDocuments();

    /* Upload state */
    const [uploadTitle, setUploadTitle] = useState('');
    const [uploadDescription, setUploadDescription] = useState('');
    const [uploadTags, setUploadTags] = useState('');
    const [uploadFileDataUrl, setUploadFileDataUrl] = useState('');
    const [uploadFileMimeType, setUploadFileMimeType] = useState('');
    const [uploading, setUploading] = useState(false);
    const [showUploadForm, setShowUploadForm] = useState(false);

    /* Edit modal state */
    const [editingDocument, setEditingDocument] = useState<UserDocumentAsset | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editTags, setEditTags] = useState('');
    const [saving, setSaving] = useState(false);

    /* Delete modal state */
    const [deleting, setDeleting] = useState(false);
    const [documentToDelete, setDocumentToDelete] = useState<UserDocumentAsset | null>(null);

    /* Download state */
    const [downloadingId, setDownloadingId] = useState('');

    /* Stats */
    const totalBytes = documents.reduce((sum, item) => sum + item.sizeBytes, 0);
    const totalTags = documents.reduce((sum, item) => sum + item.tags.length, 0);

    /* Sync edit fields when opening the edit modal */
    useEffect(() => {
        if (!editingDocument) {
            setEditTitle('');
            setEditDescription('');
            setEditTags('');
            return;
        }
        setEditTitle(editingDocument.title);
        setEditDescription(editingDocument.description ?? '');
        setEditTags(tagsToInput(editingDocument.tags));
    }, [editingDocument?.id]);

    /* ---- handlers ---- */
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
            setShowUploadForm(true);
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
        setShowUploadForm(false);
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
            resetUploadForm();
        } finally {
            setUploading(false);
        }
    };

    const handleSaveMetadata = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!editingDocument) return;

        setSaving(true);
        try {
            await update(editingDocument.id, {
                title: editTitle.trim(),
                description: editDescription.trim(),
                tags: inputToTags(editTags),
            });
            setEditingDocument(null);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteDocument = async () => {
        if (!documentToDelete) return;

        setDeleting(true);
        try {
            await remove(documentToDelete.id);
            setDocumentToDelete(null);
            /* If editing the same document, close the edit modal too */
            if (editingDocument?.id === documentToDelete.id) {
                setEditingDocument(null);
            }
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

    /* ---- loading skeleton ---- */
    if (loading) {
        return (
            <div className="space-y-6 animate-fade-in">
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                    <LoadingSkeleton variant="card" />
                    <LoadingSkeleton variant="card" />
                    <LoadingSkeleton variant="card" />
                </div>
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    <LoadingSkeleton variant="row" className="h-64" />
                    <LoadingSkeleton variant="row" className="h-64" />
                    <LoadingSkeleton variant="row" className="h-64" />
                </div>
            </div>
        );
    }

    /* ---- main render ---- */
    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-bold text-white sm:text-2xl">Biblioteca de Arquivos</h1>
                    <p className="mt-1 text-xs text-gray-400 sm:text-sm">
                        Gerencie imagens, PDFs e ZIPs salvos no Supabase.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        onClick={() => void reload()}
                        isLoading={refreshing}
                        className="flex-1 sm:flex-initial"
                    >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Atualizar
                    </Button>
                    <Button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 sm:flex-initial"
                    >
                        <Upload className="mr-2 h-4 w-4" />
                        Enviar arquivo
                    </Button>
                </div>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                className="hidden"
                onChange={(event) => void handleFileSelect(event)}
            />

            {/* Stat cards */}
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-surface-800/70 to-surface-900 p-4 sm:p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs text-gray-400 sm:text-sm">Arquivos salvos</p>
                            <p className="mt-1.5 text-2xl font-bold text-white sm:mt-2 sm:text-3xl">{documents.length}</p>
                        </div>
                        <div className="rounded-2xl bg-indigo-500/10 p-2.5 text-indigo-400 sm:p-3">
                            <Files className="h-5 w-5 sm:h-6 sm:w-6" />
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-surface-800/70 to-surface-900 p-4 sm:p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs text-gray-400 sm:text-sm">Espaco utilizado</p>
                            <p className="mt-1.5 text-2xl font-bold text-white sm:mt-2 sm:text-3xl">{formatFileSize(totalBytes)}</p>
                        </div>
                        <div className="rounded-2xl bg-emerald-500/10 p-2.5 text-emerald-400 sm:p-3">
                            <HardDrive className="h-5 w-5 sm:h-6 sm:w-6" />
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-surface-800/70 to-surface-900 p-4 sm:p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs text-gray-400 sm:text-sm">Tags personalizadas</p>
                            <p className="mt-1.5 text-2xl font-bold text-white sm:mt-2 sm:text-3xl">{totalTags}</p>
                        </div>
                        <div className="rounded-2xl bg-amber-500/10 p-2.5 text-amber-400 sm:p-3">
                            <Tag className="h-5 w-5 sm:h-6 sm:w-6" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Gallery */}
            {documents.length === 0 ? (
                <EmptyState
                    icon={Files}
                    title="Nenhum arquivo salvo"
                    description="As imagens, PDFs e ZIPs enviados por aqui aparecerao nesta biblioteca."
                    actionLabel="Selecionar arquivo"
                    onAction={() => fileInputRef.current?.click()}
                />
            ) : (
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {documents.map((item) => (
                        <GalleryCard
                            key={item.id}
                            item={item}
                            downloadingId={downloadingId}
                            onEdit={setEditingDocument}
                            onDownload={(id) => void handleDownload(id)}
                            onDelete={setDocumentToDelete}
                        />
                    ))}
                </div>
            )}

            {/* ======== Upload Modal ======== */}
            <Modal
                isOpen={showUploadForm && !!uploadFileDataUrl}
                onClose={() => !uploading && resetUploadForm()}
                title="Upload de novo arquivo"
                size="lg"
            >
                <form onSubmit={handleUpload} className="space-y-5">
                    {/* Preview */}
                    <div className="overflow-hidden rounded-2xl border border-dashed border-surface-700 bg-surface-950/60">
                        {renderDocumentVisual(
                            uploadFileDataUrl,
                            uploadFileMimeType,
                            uploadTitle || 'Preview do arquivo',
                            'h-48 sm:h-56'
                        )}
                    </div>

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
                            rows={3}
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

                    <div className="flex flex-col gap-3 border-t border-surface-700 pt-4 sm:flex-row">
                        <Button type="submit" isLoading={uploading} className="flex-1">
                            Enviar arquivo
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={resetUploadForm}
                            disabled={uploading}
                            className="w-full sm:w-auto"
                        >
                            Cancelar
                        </Button>
                    </div>
                </form>
            </Modal>

            {/* ======== Edit Modal ======== */}
            <Modal
                isOpen={!!editingDocument}
                onClose={() => !saving && setEditingDocument(null)}
                title="Editar arquivo"
                size="lg"
            >
                {editingDocument && (
                    <form onSubmit={handleSaveMetadata} className="space-y-5">
                        {/* Preview */}
                        <div className="overflow-hidden rounded-2xl border border-surface-700 bg-surface-950/60">
                            {renderDocumentVisual(
                                editingDocument.previewUrl,
                                editingDocument.mimeType,
                                editingDocument.title,
                                isPdfMimeType(editingDocument.mimeType) ? 'h-64 sm:h-80' : 'h-48 sm:h-56'
                            )}
                        </div>

                        {/* Source & type badges */}
                        <div className="flex flex-wrap gap-2">
                            <span className="rounded-full bg-surface-800 px-2.5 py-1 text-[11px] font-medium text-gray-300">
                                {editingDocument.source === 'manual_upload' ? 'Upload manual' : 'Recebido no WhatsApp'}
                            </span>
                            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-gray-400">
                                {getDocumentTypeLabel(editingDocument.mimeType)}
                            </span>
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
                                rows={4}
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

                        {/* Timestamps */}
                        <div className="rounded-2xl bg-surface-950/60 p-4 text-sm text-gray-400">
                            <div className="flex items-start gap-2">
                                <CalendarClock className="h-4 w-4 text-indigo-400" />
                                <span>Atualizado em {formatDateTime(editingDocument.updatedAt)}</span>
                            </div>
                            <div className="mt-2 flex items-start gap-2">
                                <Download className="h-4 w-4 text-emerald-400" />
                                <span>Ultimo download: {formatDateTime(editingDocument.lastAccessedAt)}</span>
                            </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col gap-3 border-t border-surface-700 pt-4 sm:flex-row">
                            <Button type="submit" isLoading={saving} className="flex-1">
                                Salvar alteracoes
                            </Button>
                            <Button
                                type="button"
                                variant="secondary"
                                isLoading={downloadingId === editingDocument.id}
                                onClick={() => void handleDownload(editingDocument.id)}
                                className="flex-1"
                            >
                                <Download className="mr-2 h-4 w-4" />
                                Baixar
                            </Button>
                        </div>
                        <Button
                            type="button"
                            variant="danger"
                            onClick={() => {
                                setDocumentToDelete(editingDocument);
                            }}
                            className="w-full"
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Excluir arquivo
                        </Button>
                    </form>
                )}
            </Modal>

            {/* ======== Delete Confirmation Modal ======== */}
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
                    <div className="flex flex-col gap-3 border-t border-surface-700 pt-4 sm:flex-row">
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
