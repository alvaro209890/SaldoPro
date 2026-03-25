import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import {
    createUserDocumentAsset,
    deleteUserDocumentAsset,
    getUserDocumentDownloadUrl,
    getUserDocuments,
    updateUserDocumentAsset,
} from '@/supabase/data';
import type {
    UserDocumentAsset,
    UserDocumentInput,
    UserDocumentUpdateInput,
} from '@/types';

interface LoadOptions {
    silent?: boolean;
    suppressToast?: boolean;
    rethrow?: boolean;
}

export function useUserDocuments() {
    const { user } = useAuth();
    const [documents, setDocuments] = useState<UserDocumentAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const loadDocuments = async (options: LoadOptions = {}) => {
        if (!user) {
            setDocuments([]);
            setLoading(false);
            setRefreshing(false);
            return;
        }

        if (options.silent) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }

        try {
            const items = await getUserDocuments(user.id);
            setDocuments(items);
        } catch (error) {
            console.error(error);
            if (!options.suppressToast) {
                toast.error('Erro ao carregar suas imagens.');
            }
            if (options.rethrow) {
                throw error;
            }
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        if (!user) {
            setDocuments([]);
            setLoading(false);
            return;
        }

        void loadDocuments({ suppressToast: true });
    }, [user]);

    const upload = async (data: UserDocumentInput) => {
        if (!user) return;

        try {
            await createUserDocumentAsset(user.id, data);
            await loadDocuments({ silent: true, suppressToast: true });
            toast.success('Arquivo enviado com sucesso.');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao enviar o arquivo.');
            throw error;
        }
    };

    const update = async (documentId: string, data: UserDocumentUpdateInput) => {
        if (!user) return;

        try {
            await updateUserDocumentAsset(user.id, documentId, data);
            await loadDocuments({ silent: true, suppressToast: true });
            toast.success('Arquivo atualizado.');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao atualizar o arquivo.');
            throw error;
        }
    };

    const remove = async (documentId: string) => {
        if (!user) return;

        try {
            await deleteUserDocumentAsset(user.id, documentId);
            await loadDocuments({ silent: true, suppressToast: true });
            toast.success('Arquivo removido.');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao excluir o arquivo.');
            throw error;
        }
    };

    const download = async (documentId: string) => {
        if (!user) return;

        try {
            const { url, fileName } = await getUserDocumentDownloadUrl(user.id, documentId);
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Falha ao baixar o arquivo.');
            }

            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(objectUrl);

            await loadDocuments({ silent: true, suppressToast: true });
            toast.success('Download iniciado.');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao baixar o arquivo.');
            throw error;
        }
    };

    return {
        documents,
        loading,
        refreshing,
        reload: () => loadDocuments({ silent: true }),
        upload,
        update,
        remove,
        download,
    };
}
