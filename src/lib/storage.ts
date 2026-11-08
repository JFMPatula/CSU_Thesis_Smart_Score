export function buildStorageProxyUrl(bucket: string, path: string): string {
  return `/api/signed-url?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`
}

export function extractStoragePath(value: string, bucket: string): string {
  if (!value) return ''

  try {
    const url = new URL(value, 'http://localhost')
    if (url.pathname === '/api/signed-url') {
      return decodeURIComponent(url.searchParams.get('path') || '')
    }

    const marker = `/storage/v1/object/public/${bucket}/`
    const index = url.pathname.indexOf(marker)
    if (index !== -1) {
      return decodeURIComponent(url.pathname.slice(index + marker.length))
    }
  } catch {
    return value
  }

  return value
}

export function isStorageProxyUrl(value: string): boolean {
  return value.startsWith('/api/signed-url')
}
