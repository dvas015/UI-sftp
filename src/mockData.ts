import { Archive, FileCode2, FileText, Headphones, Image, Video } from 'lucide-react'

export type FileKind = 'folder' | 'code' | 'image' | 'video' | 'audio' | 'archive'

export interface RemoteFile {
  name: string
  type: string
  size: string
  modified: string
  permissions: string
  kind: FileKind
}

export const recentFiles = [
  { name: 'server.config.ts', meta: '18 KB · há 8 min', icon: FileCode2, tone: 'blue' },
  { name: 'hero-banner.webp', meta: '1,8 MB · há 42 min', icon: Image, tone: 'purple' },
  { name: 'release-notes.md', meta: '12 KB · há 2 h', icon: FileText, tone: 'gray' },
]

export const remoteFiles: RemoteFile[] = [
  { name: 'logs', type: 'Pasta', size: '—', modified: 'Hoje, 10:32', permissions: 'drwxr-xr-x', kind: 'folder' },
  { name: 'public', type: 'Pasta', size: '—', modified: 'Hoje, 09:18', permissions: 'drwxr-xr-x', kind: 'folder' },
  { name: 'releases', type: 'Pasta', size: '—', modified: 'Ontem', permissions: 'drwxr-xr-x', kind: 'folder' },
  { name: 'server.config.ts', type: 'TypeScript', size: '18 KB', modified: 'Hoje, 10:14', permissions: '-rw-r--r--', kind: 'code' },
  { name: 'hero-banner.webp', type: 'Imagem', size: '1,8 MB', modified: 'Hoje, 09:50', permissions: '-rw-r--r--', kind: 'image' },
  { name: 'app-backup-0422.zip', type: 'Compactado', size: '86,4 MB', modified: '22 abr. 2025', permissions: '-rw-------', kind: 'archive' },
]

export const distribution = [
  { label: 'Documentos', value: '42 arquivos', icon: FileText },
  { label: 'Imagens', value: '75 arquivos', icon: Image },
  { label: 'Vídeos', value: '32 arquivos', icon: Video },
  { label: 'Áudios', value: '20 arquivos', icon: Headphones },
  { label: 'Compactados', value: '14 arquivos', icon: Archive },
]

export const activities = [
  { name: 'assets-v4.zip', meta: 'Enviado · há 2 min', direction: 'up' as const },
  { name: 'access.log', meta: 'Baixado · há 18 min', direction: 'down' as const },
]
