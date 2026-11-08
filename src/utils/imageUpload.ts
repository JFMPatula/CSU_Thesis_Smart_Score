import { supabase } from '@/lib/supabase'
import { buildStorageProxyUrl, extractStoragePath } from '@/lib/storage'

export const uploadImageToStorage = async (
  file: File | Blob,
  bucket: string = 'student-answers',
  folder: string = 'answers'
): Promise<string> => {
  try {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = file instanceof File ? file.name.split('.').pop() : 'jpg';
    const fileName = `${folder}/${timestamp}-${randomString}.${extension}`;

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }

    return buildStorageProxyUrl(bucket, data.path);

  } catch (error) {
    console.error('Error uploading image:', error);
    throw error;
  }
};

export const deleteImageFromStorage = async (
  imageUrl: string,
  bucket: string = 'student-answers'
): Promise<void> => {
  try {
    const fileName = extractStoragePath(imageUrl, bucket);

    const { error } = await supabase.storage
      .from(bucket)
      .remove([fileName]);

    if (error) {
      throw new Error(`Delete failed: ${error.message}`);
    }

  } catch (error) {
    console.error('Error deleting image:', error);
    throw error;
  }
};
