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
  downloadFile: async (id: string, path: string, name: string) => {
    const response = await fetch(`/api/connections/${id}/files/download?${new URLSearchParams({ path })}`, {
      credentials: 'same-origin',
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
      throw new ApiError(body?.error?.code || 'request_failed', body?.error?.message || 'Não foi possível baixar o arquivo.', response.status)
    }
    const url = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
    URL.revokeObjectURL(url)
  },
  uploadFile: (id: string, path: string, file: File, createParents = false) => {
    const query = new URLSearchParams({ path, create_parents: String(createParents) })
    const form = new FormData()
    form.append('file', file, file.name)
    return apiRequest<void>(`/api/connections/${id}/files/upload?${query}`, { method: 'POST', body: form })
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
