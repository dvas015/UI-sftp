export type ConnectionStatus = 'connected' | 'disconnected'
export type FileKind = 'folder' | 'code' | 'image' | 'video' | 'audio' | 'archive' | 'file'

export interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  initial_path: string
  status: ConnectionStatus
  last_verified_at: string | null
}

export interface RemoteFile {
  name: string
  path: string
  type: string
  size: number | null
  modified_at: string | null
  permissions: string
  kind: FileKind
}

export interface DirectoryListing {
  path: string
  items: RemoteFile[]
}

export interface HealthResponse {
  status: 'ok'
  version: string
}

export interface DownloadProgress {
  id: string
  status: 'preparing' | 'downloading' | 'completed' | 'failed'
  bytes_transferred: number
  total_bytes: number | null
  error: string | null
}

export interface ConnectionCreateInput {
  name?: string
  host: string
  port: number
  username: string
  password: string
}

export type ConnectionUpdateInput = Partial<ConnectionCreateInput>

export class ApiError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body && !isFormData ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
    throw new ApiError(
      body?.error?.code || 'request_failed',
      body?.error?.message || 'Não foi possível concluir a solicitação.',
      response.status,
    )
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function createTransferId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export const api = {
  health: (signal?: AbortSignal) => apiRequest<HealthResponse>('/api/health', { signal }),
  listConnections: () => apiRequest<Connection[]>('/api/connections'),
  createConnection: (input: ConnectionCreateInput) => apiRequest<Connection>('/api/connections', {
    method: 'POST', body: JSON.stringify(input),
  }),
  updateConnection: (id: string, input: ConnectionUpdateInput) => apiRequest<Connection>(`/api/connections/${id}`, {
    method: 'PATCH', body: JSON.stringify(input),
  }),
  disconnectConnection: (id: string) => apiRequest<Connection>(`/api/connections/${id}/disconnect`, { method: 'POST' }),
  reconnectConnection: (id: string, password: string) => apiRequest<Connection>(`/api/connections/${id}/connect`, {
    method: 'POST', body: JSON.stringify({ password }),
  }),
  deleteConnection: (id: string) => apiRequest<void>(`/api/connections/${id}`, { method: 'DELETE' }),
  listFiles: (id: string, path?: string) => {
    const query = path ? `?${new URLSearchParams({ path })}` : ''
    return apiRequest<DirectoryListing>(`/api/connections/${id}/files${query}`)
  },
  downloadFile: async (
    id: string,
    path: string,
    name: string,
    onProgress?: (progress: DownloadProgress) => void,
  ) => {
    const transferId = createTransferId()
    const query = new URLSearchParams({ path, transfer_id: transferId })
    const url = `/api/connections/${id}/files/download?${query}`
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.hidden = true
    document.body.appendChild(anchor)
    anchor.click()
    window.setTimeout(() => anchor.remove(), 0)

    const startedAt = Date.now()
    while (true) {
      await wait(400)
      let progress: DownloadProgress
      try {
        progress = await apiRequest<DownloadProgress>(`/api/downloads/${transferId}`)
      } catch (error) {
        if (error instanceof ApiError && error.status === 404 && Date.now() - startedAt < 10_000) continue
        throw error
      }
      onProgress?.(progress)
      if (progress.status === 'completed') return progress
      if (progress.status === 'failed') {
        throw new ApiError('download_failed', progress.error || 'O download foi interrompido.', 502)
      }
    }
  },
  uploadFile: (id: string, path: string, file: File, createParents = false) => {
    const query = new URLSearchParams({ path, create_parents: String(createParents) })
    return apiRequest<void>(`/api/connections/${id}/files/upload?${query}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  },
  createDirectory: (id: string, path: string) => apiRequest<void>(`/api/connections/${id}/directories`, {
    method: 'POST', body: JSON.stringify({ path }),
  }),
  renameEntry: (id: string, path: string, name: string) => apiRequest<{ path: string }>(`/api/connections/${id}/entries/rename`, {
    method: 'PATCH', body: JSON.stringify({ path, name }),
  }),
  moveEntry: (id: string, path: string, destination: string) => apiRequest<{ path: string }>(`/api/connections/${id}/entries/move`, {
    method: 'POST', body: JSON.stringify({ path, destination }),
  }),
  duplicateEntry: (id: string, path: string) => apiRequest<{ path: string }>(`/api/connections/${id}/entries/duplicate`, {
    method: 'POST', body: JSON.stringify({ path }),
  }),
  changePermissions: (id: string, path: string, mode: string) => apiRequest<void>(`/api/connections/${id}/entries/permissions`, {
    method: 'PATCH', body: JSON.stringify({ path, mode }),
  }),
  deleteEntry: (id: string, path: string) => apiRequest<void>(`/api/connections/${id}/entries/delete`, {
    method: 'POST', body: JSON.stringify({ path }),
  }),
}
