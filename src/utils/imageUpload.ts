import { supabase } from '@/lib/supabase'
import { buildStorageProxyUrl, extractStoragePath } from '@/lib/storage'

const MAX_UPLOAD_BYTES = 2.5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.split(',')[1] || '')
    }
    reader.onerror = () => reject(new Error('Failed to read image'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to decode image'))
    }
    img.src = url
  })
}

async function compressImage(file: Blob): Promise<Blob> {
  if (typeof document === 'undefined') return file

  const img = await loadImage(file)
  const maxDimension = 2400
  const longest = Math.max(img.width, img.height)
  const scale = longest > maxDimension ? maxDimension / longest : 1

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * scale))
  canvas.height = Math.max(1, Math.round(img.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return file

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/jpeg', 0.85)
  })

  return blob && blob.size < file.size ? blob : file
}

export const uploadImageToStorage = async (
  file: File | Blob,
  bucket: string = 'student-answers',
  folder: string = 'answers'
): Promise<string> => {
  try {
    if (bucket === 'student-answers') {
      let uploadBlob = file
      if (file.size > MAX_UPLOAD_BYTES) {
        uploadBlob = await compressImage(file)
      }

      const prepared = uploadBlob
      const finalMime = prepared.type
      if (!ALLOWED_IMAGE_TYPES.has(finalMime)) {
        throw new Error('Unsupported image type. Please use JPEG, PNG, WebP, or GIF.')
      }

      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucket,
          folder,
          mimeType: finalMime,
          data: await blobToBase64(prepared),
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || `Upload failed (${response.status})`)
      }

      return payload.url as string
    }

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
