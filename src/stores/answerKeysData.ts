import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { supabase } from '@/lib/supabase';
import { useToast } from 'vue-toastification';

// Define the base domain for the quiz application.
// Prefer an explicit env override, otherwise use the origin the app is actually served from
// (so QR links always match the current deployment, including previews).
const BASE_DOMAIN =
    import.meta.env.VITE_APP_URL ||
    (typeof window !== 'undefined' ? window.location.origin : 'https://csu-smartscore.vercel.app');
const QUIZ_PATH = '/student/quiz';

// Define the base URL for answer images storage
const STORAGE_PUBLIC_BASE_URL = (import.meta.env.VITE_SUPABASE_STORAGE_PUBLIC_URL || `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public`)
    .replace(/\/$/, '');
const ANSWER_IMAGES_BASE_URL = `${STORAGE_PUBLIC_BASE_URL}/answer_keys/`;

// Define Answer Key interface
export interface AnswerKey {
  id?: number;
  title: string;
  description?: string;
  qr_link: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  answer_keys?: any; // JSONB field
  answer_images?: string;
}

/**
 * Pinia Store for managing answer keys and QR code generation parameters and logic.
 * This is meant to be used by teachers to manage quiz answer keys.
 */
export const useAnswerKeysStore = defineStore('answerKeys', () => {
    const toast = useToast();

    // State: Configuration for the quiz system
    const quizConfig = ref({
        // The base URL used for the QR code link (to the student quiz)
        baseUrl: `${BASE_DOMAIN}${QUIZ_PATH}`,
        // The base URL for answer images storage
        answerImagesBaseUrl: ANSWER_IMAGES_BASE_URL,
    });

    // State: Answer keys data
    const answerKeys = ref<AnswerKey[]>([]);
    const loading = ref(false);
    const selectedAnswerKey = ref<AnswerKey | null>(null);

    /**
     * Constructs a quiz URL with optional parameters
     * @param params Optional query parameters
     * @returns The full URL string
     */
    const generateQuizLink = (params?: Record<string, string | number>): string => {
        const url = new URL(quizConfig.value.baseUrl);
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                url.searchParams.set(key, value.toString());
            });
        }
        return url.toString();
    };

    /**
     * Constructs a full URL for an answer image
     * @param imagePath The image path/filename
     * @returns The full URL string for the image
     */
    const generateAnswerImageUrl = (imagePath: string): string => {
        return `${quizConfig.value.answerImagesBaseUrl}${imagePath}`;
    };

    /**
     * Extracts the image filename from a full URL
     * @param imageUrl The full image URL
     * @returns The image filename/path
     */
    const extractImagePathFromUrl = (imageUrl: string): string => {
        return imageUrl.replace(quizConfig.value.answerImagesBaseUrl, '');
    };

    /**
     * Fetch all answer keys from the database
     */
    const fetchAnswerKeys = async () => {
        loading.value = true;
        try {
            const { data, error } = await supabase
                .from('answer_keys')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            answerKeys.value = data || [];
            return { data, error: null };
        } catch (error: any) {
            console.error('Error fetching answer keys:', error);
            toast.error('Failed to fetch answer keys');
            return { data: null, error };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Fetch a specific answer key by ID
     */
    const fetchAnswerKeyById = async (id: string | number) => {
        loading.value = true;
        try {
            const { data, error } = await supabase
                .from('answer_keys')
                .select('*')
                .eq('id', id)
                .maybeSingle();

            if (error) throw error;

            return { data, error: null };
        } catch (error: any) {
            console.error('Error fetching answer key:', error);
            toast.error('Failed to fetch answer key');
            return { data: null, error };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Create a new answer key record in the database
     */
    const createAnswerKey = async (answerKeyData: Omit<AnswerKey, 'id' | 'created_at' | 'updated_at' | 'qr_link'>) => {
        loading.value = true;
        try {
            const { data: userData } = await supabase.auth.getUser();

            // First, create the answer key without the QR link
            const answerKeyWithUser = {
                ...answerKeyData,
                qr_link: '', // Temporary placeholder
                created_by: userData.user?.id
            };

            const { data, error } = await supabase
                .from('answer_keys')
                .insert([answerKeyWithUser])
                .select()
                .single();

            if (error) throw error;

            // Generate QR link with the primary ID
            const qrLink = `${BASE_DOMAIN}/student/quiz/${data.id}`;

            // Update the record with the correct QR link
            const { data: updatedData, error: updateError } = await supabase
                .from('answer_keys')
                .update({ qr_link: qrLink })
                .eq('id', data.id)
                .select()
                .single();

            if (updateError) throw updateError;

            answerKeys.value.unshift(updatedData);
            toast.success('Answer key created successfully!');
            return { data: updatedData, error: null };
        } catch (error: any) {
            console.error('Error creating answer key:', error);
            toast.error('Failed to create answer key');
            return { data: null, error };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Update an existing answer key record
     */
    const updateAnswerKey = async (id: number, updates: Partial<AnswerKey>) => {
        loading.value = true;
        try {
            const updateData = {
                ...updates,
                updated_at: new Date().toISOString()
            };

            const { data, error } = await supabase
                .from('answer_keys')
                .update(updateData)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;

            const index = answerKeys.value.findIndex((answerKey: AnswerKey) => answerKey.id === id);
            if (index !== -1) {
                answerKeys.value[index] = { ...answerKeys.value[index], ...data };
            }

            toast.success('Answer key updated successfully!');
            return { data, error: null };
        } catch (error: any) {
            console.error('Error updating answer key:', error);
            toast.error('Failed to update answer key');
            return { data: null, error };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Delete an answer key record and its associated image
     */
    const deleteAnswerKey = async (id: number) => {
        loading.value = true;
        try {
            // First, get the answer key to retrieve the image path
            const answerKeyToDelete = answerKeys.value.find(answerKey => answerKey.id === id);

            // Delete the answer key from database
            const { error } = await supabase
                .from('answer_keys')
                .delete()
                .eq('id', id);

            if (error) throw error;

            // If there's an associated image, delete it from storage
            if (answerKeyToDelete?.answer_images) {
                const imagePath = extractImagePathFromUrl(answerKeyToDelete.answer_images);
                const { error: storageError } = await supabase.storage
                    .from('answer_keys')
                    .remove([imagePath]);

                if (storageError) {
                    console.warn('Failed to delete image from storage:', storageError);
                    // Don't fail the entire operation if image deletion fails
                }
            }

            answerKeys.value = answerKeys.value.filter((answerKey: AnswerKey) => answerKey.id !== id);
            toast.success('Answer key deleted successfully!');
            return { error: null };
        } catch (error: any) {
            console.error('Error deleting answer key:', error);
            toast.error('Failed to delete answer key');
            return { error };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Upload an image to the answer_keys storage bucket
     */
    const uploadAnswerImage = async (file: File, path: string) => {
        try {
            const { data, error } = await supabase.storage
                .from('answer_keys')
                .upload(path, file);

            if (error) throw error;

            const imageUrl = generateAnswerImageUrl(path);
            return { data, imageUrl, error: null };
        } catch (error: any) {
            console.error('Error uploading image:', error);
            toast.error('Failed to upload image');
            return { data: null, imageUrl: null, error };
        }
    };

    /**
     * Delete an image from the answer_keys storage bucket
     */
    const deleteAnswerImage = async (imagePath: string) => {
        try {
            const { error } = await supabase.storage
                .from('answer_keys')
                .remove([imagePath]);

            if (error) throw error;

            return { error: null };
        } catch (error: any) {
            console.error('Error deleting image:', error);
            toast.error('Failed to delete image');
            return { error };
        }
    };

    /**
     * Toggle answer key active status
     */
    const toggleAnswerKeyStatus = async (id: number, isActive: boolean) => {
        return await updateAnswerKey(id, { is_active: isActive });
    };

    /**
     * Set selected answer key for editing
     */
    const setSelectedAnswerKey = (answerKey: AnswerKey | null) => {
        selectedAnswerKey.value = answerKey;
    };

    return {
        // Config
        quizConfig,

        // State
        answerKeys,
        loading,
        selectedAnswerKey,

        // Actions
        generateQuizLink,
        generateAnswerImageUrl,
        extractImagePathFromUrl,
        fetchAnswerKeys,
        fetchAnswerKeyById,
        createAnswerKey,
        updateAnswerKey,
        deleteAnswerKey,
        uploadAnswerImage,
        deleteAnswerImage,
        toggleAnswerKeyStatus,
        setSelectedAnswerKey,
    };
});
