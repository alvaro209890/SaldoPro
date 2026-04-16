import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import {
    createUserDocumentAsset,
    deleteUserDocumentAsset,
    getUserDocumentDownloadUrl,
    onUserDocumentsSnapshot,
    triggerDataRefresh,
    updateUserDocumentAsset,
} from '@/supabase/data';
import type {
    UserDocumentAsset,
    UserDocumentInput,
    UserDocumentUpdateInput,
} from '@/types';

export function useUserDocuments() {
    const { user } = useAuth();
    const uid = user?.id ?? null;
    const [documents, setDocuments] = useState<UserDocumentAsset[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        if (!uid) {
            setDocuments([]);
            setLoading(false);
            setRefreshing(false);
            return;
        }

        setLoading(true);
        setRefreshing(false);
        const unsubscribe = onUserDocumentsSnapshot(
            uid,
            (items) => {
                setDocuments(items);
                setLoading(false);
                setRefreshing(false);
            },
            (error) => {
                console.error(error);
                toast.error('Erro ao carregar suas imagens.');
                setLoading(false);
                setRefreshing(false);
            }
        );

        return unsubscribe;
    }, [uid]);

    const upload = async (data: UserDocumentInput) => {
        if (!uid) return;

        try {
            await createUserDocumentAsset(uid, data);
            toast.success('Arquivo enviado com sucesso.');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao enviar o arquivo.');
            throw error;
        }
    };

    const update = async (documentId: string, data: UserDocumentUpdateInput) => {
        if (!uid) return;

        try {
            await updateUserDocumentAsset(uid, documentId, data);
            toast.success('Arquivo atualizado.');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao atualizar o arquivo.');
            throw error;
        }
    };

    const remove = async (documentId: string) => {
        if (!uid) return;

        try {
            await deleteUserDocumentAsset(uid, documentId);
            toast.success('Arquivo removido.');
        } catch (error) {
            console.error(error);
            toast.error('Erro ao excluir o arquivo.');
            throw error;
        }
    };

    const download = async (documentId: string) => {
        if (!uid) return;

        try {
            const { url, fileName } = await getUserDocumentDownloadUrl(uid, documentId);
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
        reload: async () => {
            setRefreshing(true);
            triggerDataRefresh(['documents']);
        },
        upload,
        update,
        remove,
        download,
    };
}
