import { type DragEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import {
  Archive, ArrowLeft, ArrowRight, ArrowUp, Check, Download, File as FileIcon, FileCode2, Folder,
  ChevronDown, FileUp, FolderLock, FolderPlus, FolderUp, Headphones, Image, LayoutGrid, List, LogIn, LogOut,
  Moon, PanelLeft, Pencil, Plus, RefreshCw, Server, Sun, Trash2, Video, X,
} from 'lucide-react'
import type { Connection, FileKind, RemoteFile } from '../api'
import { FileActionsMenu, FileContextMenu } from './FileActionsMenu'
import { Checkbox } from './ui/checkbox'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from './ui/dialog'

interface FileManagerProps {
  connections: Connection[]
  apiHealthStatus: 'checking' | 'connected' | 'disconnected'
  apiVersion?: string
  activeConnection?: Connection
  folderTabs: FolderTab[]
  activeFolderTabId?: string
  files: RemoteFile[]
  currentPath: string
  loading: boolean
  error?: string
  canGoBack: boolean
  canGoForward: boolean
  onSelectFolderTab: (tab: FolderTab) => void
  onCloseFolderTab: (tab: FolderTab) => void
  onSelectConnection: (id: string) => void
  onOpenConnection: () => void
  onEditConnection: (connection: Connection) => void
  onReconnect: (connection: Connection) => void
  onDisconnect: (connection: Connection) => Promise<void>
  onDeleteConnection: (connection: Connection) => Promise<void>
  onRenameConnection: (connection: Connection, name: string) => Promise<void>
  onOpenFolder: (file: RemoteFile) => void
  onBack: () => void
  onForward: () => void
  onUp: () => void
  onRefresh: () => void
  onDownload: (file: RemoteFile) => Promise<void>
  onUpload: (files: File[]) => Promise<void>
  onCreateDirectory: (name: string) => Promise<void>
  onRenameEntry: (file: RemoteFile, name: string) => Promise<void>
  onMoveEntry: (file: RemoteFile, destination: string) => Promise<void>
  onDuplicateEntry: (file: RemoteFile) => Promise<void>
  onChangePermissions: (file: RemoteFile, mode: string) => Promise<void>
  onDeleteEntry: (file: RemoteFile) => Promise<void>
}

export interface FolderTab {
  id: string
  connectionId: string
  path: string
}

type ViewMode = 'list' | 'grid'
type Theme = 'dark' | 'light'

type InputDialogMode = 'create-directory' | 'rename' | 'move' | 'permissions'

interface InputDialogState {
  mode: InputDialogMode
  title: string
  description: string
  label: string
  value: string
  file?: RemoteFile
  extension?: string
}

const fileIcons = {
  folder: Folder,
  code: FileCode2,
  image: Image,
  video: Video,
  audio: Headphones,
  archive: Archive,
  file: FileIcon,
} satisfies Record<FileKind, typeof Folder>

const skeletonItems = Array.from({ length: 8 }, (_, index) => index)

function FileListSkeleton() {
  return (
    <div className="file-table skeleton-container" role="status" aria-label="Carregando diretório" aria-busy="true">
      <span className="visually-hidden">Carregando diretório…</span>
      <div className="table-row table-head" role="row" aria-hidden="true">
        <span className="checkbox-cell"><span className="skeleton skeleton-checkbox" /></span>
        <span>Nome</span><span>Tamanho</span><span>Modificado</span><span />
      </div>
      {skeletonItems.map((item) => (
        <div className="table-row skeleton-row" aria-hidden="true" key={item}>
          <span className="checkbox-cell"><span className="skeleton skeleton-checkbox" /></span>
          <span className="skeleton-file-name">
            <span className="skeleton skeleton-file-icon" />
            <span className="skeleton-file-copy"><span className="skeleton skeleton-line skeleton-name" /><span className="skeleton skeleton-line skeleton-meta" /></span>
          </span>
          <span className="skeleton skeleton-line skeleton-size" />
          <span className="skeleton skeleton-line skeleton-date" />
          <span className="skeleton skeleton-more" />
        </div>
      ))}
    </div>
  )
}

function FileGridSkeleton() {
  return (
    <div className="file-grid skeleton-container" role="status" aria-label="Carregando diretório" aria-busy="true">
      <span className="visually-hidden">Carregando diretório…</span>
      {skeletonItems.map((item) => (
        <article className="file-card skeleton-card" aria-hidden="true" key={item}>
          <span className="skeleton skeleton-card-more" />
          <span className="skeleton skeleton-card-icon" />
          <span className="skeleton skeleton-line skeleton-card-name" />
          <span className="skeleton skeleton-line skeleton-card-type" />
          <span className="skeleton-card-metadata"><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line" /></span>
        </article>
      ))}
    </div>
  )
}

function formatSize(size: number | null) {
  if (size === null) return '—'
  if (size < 1024) return `${size} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[unit]}`
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function pathLabel(path: string) {
  if (path === '/') return '/'
  return path.split('/').filter(Boolean).at(-1) || path
}

function splitFileName(file: RemoteFile) {
  if (file.kind === 'folder') return { name: file.name, extension: '' }
  const extensionStart = file.name.lastIndexOf('.')
  if (extensionStart <= 0 || extensionStart === file.name.length - 1) {
    return { name: file.name, extension: '' }
  }
  return {
    name: file.name.slice(0, extensionStart),
    extension: file.name.slice(extensionStart),
  }
}

export function FileManager(props: FileManagerProps) {
  const {
    connections, apiHealthStatus, apiVersion, activeConnection, folderTabs, activeFolderTabId, files, currentPath, loading, error, canGoBack, canGoForward,
    onSelectFolderTab, onCloseFolderTab,
    onSelectConnection, onOpenConnection, onEditConnection, onReconnect, onDisconnect,
    onDeleteConnection, onRenameConnection, onOpenFolder, onBack, onForward, onUp, onRefresh,
    onDownload, onUpload, onCreateDirectory, onRenameEntry, onMoveEntry, onDuplicateEntry,
    onChangePermissions, onDeleteEntry,
  } = props
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set())
  const [inspectedFilePath, setInspectedFilePath] = useState<string>()
  const [viewMode, setViewMode] = useState<ViewMode>(() => sessionStorage.getItem('sftp-view-mode') === 'grid' ? 'grid' : 'list')
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem('sftp-theme')
    if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [collapsedConnections, setCollapsedConnections] = useState<Set<string>>(() => new Set())
  const [renamingConnectionId, setRenamingConnectionId] = useState<string>()
  const [connectionNameDraft, setConnectionNameDraft] = useState('')
  const [inputDialog, setInputDialog] = useState<InputDialogState | null>(null)
  const [inputDialogPending, setInputDialogPending] = useState(false)
  const [draggingFiles, setDraggingFiles] = useState(false)
  const dragDepth = useRef(0)
  const allSelected = files.length > 0 && files.every((file) => selectedFiles.has(file.path))
  const someSelected = files.some((file) => selectedFiles.has(file.path))
  const selectAllState = allSelected ? true : someSelected ? 'indeterminate' : false
  const inspectedFile = files.find((file) => file.path === inspectedFilePath)

  useEffect(() => sessionStorage.setItem('sftp-view-mode', viewMode), [viewMode])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('sftp-theme', theme)
  }, [theme])
  useEffect(() => {
    if (selectedFiles.size === 0 && !inspectedFile) return
    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSelectedFiles(new Set())
      setInspectedFilePath(undefined)
    }
    window.addEventListener('keydown', clearOnEscape)
    return () => window.removeEventListener('keydown', clearOnEscape)
  }, [inspectedFile, selectedFiles.size])

  function toggleFile(path: string) {
    setSelectedFiles((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleAllFiles() {
    setSelectedFiles((current) => {
      const next = new Set(current)
      files.forEach((file) => allSelected ? next.delete(file.path) : next.add(file.path))
      return next
    })
  }

  function openFolder(file: RemoteFile) {
    setInspectedFilePath(undefined)
    onOpenFolder(file)
  }

  function navigate(action: () => void) {
    setInspectedFilePath(undefined)
    action()
  }

  function startRenaming(connection: Connection) {
    setRenamingConnectionId(connection.id)
    setConnectionNameDraft(connection.name)
  }

  async function finishRenaming(connection: Connection) {
    const nextName = connectionNameDraft.trim()
    setRenamingConnectionId(undefined)
    if (nextName && nextName !== connection.name) await onRenameConnection(connection, nextName)
  }

  const unavailable = !activeConnection || activeConnection.status !== 'connected'

  function hasDraggedFiles(event: DragEvent<HTMLDivElement>) {
    return Array.from(event.dataTransfer.types).includes('Files')
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    if (unavailable) return
    dragDepth.current += 1
    setDraggingFiles(true)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = unavailable ? 'none' : 'copy'
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event) || unavailable) return
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDraggingFiles(false)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setDraggingFiles(false)
    if (unavailable) return
    const droppedFiles = Array.from(event.dataTransfer.files)
    if (droppedFiles.length > 0) void onUpload(droppedFiles)
  }

  const fileActions = {
    onDownload: (file: RemoteFile) => { void onDownload(file) },
    onRename: (file: RemoteFile) => {
      const { name, extension } = splitFileName(file)
      setInputDialog({
        mode: 'rename',
        title: 'Renomear item',
        description: 'Informe o novo nome para o arquivo ou pasta.',
        label: 'Novo nome',
        value: name,
        file,
        extension,
      })
    },
    onMove: (file: RemoteFile) => {
      setInputDialog({
        mode: 'move',
        title: 'Mover item',
        description: `Informe o diretório de destino para “${file.name}”.`,
        label: 'Diretório de destino',
        value: currentPath,
        file,
      })
    },
    onDuplicate: (file: RemoteFile) => { void onDuplicateEntry(file) },
    onPermissions: (file: RemoteFile) => {
      setInputDialog({
        mode: 'permissions',
        title: 'Alterar permissões',
        description: `Defina as permissões octais de “${file.name}”.`,
        label: 'Permissões octais',
        value: file.kind === 'folder' ? '755' : '644',
        file,
      })
    },
    onDelete: (file: RemoteFile) => { void onDeleteEntry(file) },
  }

  function chooseUpload(folder: boolean) {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (folder) input.setAttribute('webkitdirectory', '')
    input.onchange = () => {
      if (input.files?.length) void onUpload(Array.from(input.files))
    }
    input.click()
  }

  function createDirectory() {
    setInputDialog({
      mode: 'create-directory',
      title: 'Criar nova pasta',
      description: 'Informe um nome para a pasta no diretório atual.',
      label: 'Nome da pasta',
      value: '',
    })
  }

  async function submitInputDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!inputDialog) return

    const value = inputDialog.value.trim()
    if (!value) return

    setInputDialogPending(true)
    try {
      if (inputDialog.mode === 'create-directory') await onCreateDirectory(value)
      else if (inputDialog.mode === 'rename' && inputDialog.file) {
        const nextName = `${value}${inputDialog.extension || ''}`
        if (nextName !== inputDialog.file.name) await onRenameEntry(inputDialog.file, nextName)
      } else if (inputDialog.mode === 'move' && inputDialog.file) {
        await onMoveEntry(inputDialog.file, value)
      } else if (inputDialog.mode === 'permissions' && inputDialog.file) {
        await onChangePermissions(inputDialog.file, value)
      }
      setInputDialog(null)
    } finally {
      setInputDialogPending(false)
    }
  }

  const selectedEntries = files.filter((file) => selectedFiles.has(file.path))
  const downloadableEntries = selectedEntries.filter((file) => file.kind !== 'folder')
  const toolbarDownloadEntries = selectedEntries.length > 0
    ? downloadableEntries
    : inspectedFile && inspectedFile.kind !== 'folder' ? [inspectedFile] : []

  return (
    <div
      className={`sftp-app ${sidebarOpen ? '' : 'sidebar-collapsed'}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {draggingFiles && (
        <div className="upload-drop-overlay" role="status" aria-live="polite">
          <div className="upload-drop-content">
            <span className="upload-drop-icon"><FileUp size={28} aria-hidden="true" /></span>
            <strong>Solte para fazer upload</strong>
            <small>Os arquivos serão enviados diretamente para</small>
            <code>{currentPath}</code>
          </div>
        </div>
      )}
      {sidebarOpen ? (
      <aside className="sessions-sidebar">
        <div className="app-brand">
          <span><FolderLock size={19} /></span>
          <strong>Gerenciador SFTP</strong>
          <button
            className={`theme-toggle ${theme}`}
            type="button"
            aria-pressed={theme === 'light'}
            aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
            title={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
            onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
          >
            <Sun size={12} aria-hidden="true" />
            <Moon size={12} aria-hidden="true" />
            <i aria-hidden="true" />
          </button>
        </div>

        <div className="session-list">
          {connections.map((connection) => {
            const expanded = !collapsedConnections.has(connection.id)
            const isActive = activeConnection?.id === connection.id
            return (
              <section className={`session-card ${expanded ? '' : 'collapsed'} ${isActive ? 'active' : ''}`} key={connection.id} onClick={() => {
                setInspectedFilePath(undefined)
                onSelectConnection(connection.id)
              }}>
                <header>
                  <span className="server-symbol"><Server size={17} /><i className={`session-online ${connection.status}`} aria-hidden="true" /></span>
                  <span className="connection-identity">
                    {renamingConnectionId === connection.id ? (
                      <input
                        className="connection-name-input"
                        value={connectionNameDraft}
                        aria-label="Nome da conexão"
                        autoFocus
                        maxLength={48}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setConnectionNameDraft(event.target.value)}
                        onBlur={() => void finishRenaming(connection)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur()
                          if (event.key === 'Escape') {
                            setConnectionNameDraft(connection.name)
                            setRenamingConnectionId(undefined)
                          }
                        }}
                      />
                    ) : (
                      <button className="connection-name-button" type="button" onClick={(event) => { event.stopPropagation(); startRenaming(connection) }} title="Renomear conexão">
                        <strong>{connection.name}</strong><Pencil size={12} aria-hidden="true" />
                      </button>
                    )}
                    <small>{connection.username}@{connection.host}:{connection.port}</small>
                  </span>
                  <button
                    className="session-collapse"
                    type="button"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Recolher sessão' : 'Expandir sessão'}
                    onClick={(event) => {
                      event.stopPropagation()
                      setCollapsedConnections((current) => {
                        const next = new Set(current)
                        if (expanded) next.add(connection.id)
                        else next.delete(connection.id)
                        return next
                      })
                    }}
                  ><ChevronDown className="session-collapse-chevron" size={15} /></button>
                </header>
                <div className="session-actions" onClick={(event) => event.stopPropagation()}>
                  {connection.status === 'connected' ? (
                    <button type="button" onClick={() => void onDisconnect(connection)}><LogOut size={14} /> Desconectar</button>
                  ) : (
                    <button type="button" onClick={() => onReconnect(connection)}><LogIn size={14} /> Reconectar</button>
                  )}
                  <button type="button" onClick={() => onEditConnection(connection)}><Pencil size={14} /> Editar</button>
                  <button className="delete-session" type="button" aria-label="Excluir servidor" onClick={() => void onDeleteConnection(connection)}><Trash2 size={15} /></button>
                </div>
              </section>
            )
          })}
        </div>

        <button className="new-session-button" type="button" onClick={onOpenConnection}><Plus size={16} /> Nova conexão</button>
        <footer className="sidebar-status">
          <div className="sidebar-status-summary">
            <span className={`sidebar-api-status ${apiHealthStatus}`} role="status" aria-live="polite">
              <i />
              {apiHealthStatus === 'checking' && 'Verificando API…'}
              {apiHealthStatus === 'connected' && `API conectada${apiVersion ? ` v${apiVersion}` : ''}`}
              {apiHealthStatus === 'disconnected' && 'API indisponível'}
            </span>
            <small>{connections.length} servidor(es)</small>
          </div>
          <small className="sidebar-credit">Feito no CEFET Leopoldina-MG</small>
        </footer>
      </aside>
      ) : (
        <aside className="sessions-rail" aria-label="Conexões SFTP">
          <div className="rail-brand" aria-hidden="true"><FolderLock size={19} /></div>
          <div className="rail-divider" />
          <div className="rail-sessions">
            {connections.map((connection) => {
              const isActive = activeConnection?.id === connection.id
              return (
                <button
                  className={`rail-session ${isActive ? 'active' : ''}`}
                  type="button"
                  key={connection.id}
                  aria-label={`${connection.name}, ${connection.username}@${connection.host}`}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => {
                    setInspectedFilePath(undefined)
                    onSelectConnection(connection.id)
                  }}
                >
                  <Server size={17} />
                  <i className={`rail-status ${connection.status}`} aria-hidden="true" />
                  <span className="rail-tooltip" role="tooltip" aria-hidden="true">
                    <strong>{connection.name}</strong>
                    <small>{connection.username}@{connection.host}</small>
                  </span>
                </button>
              )
            })}
            <button className="rail-session rail-add" type="button" aria-label="Nova conexão" onClick={onOpenConnection}>
              <Plus size={18} />
              <span className="rail-tooltip rail-tooltip-short" role="tooltip" aria-hidden="true"><strong>Nova conexão</strong></span>
            </button>
          </div>
        </aside>
      )}

      <main className="workspace-window">
        <header className="workspace-header">
          <button className="window-icon-button" type="button" aria-pressed={!sidebarOpen} aria-label={sidebarOpen ? 'Recolher painel de sessões' : 'Expandir painel de sessões'} title={sidebarOpen ? 'Recolher painel' : 'Expandir painel'} onClick={() => setSidebarOpen((open) => !open)}><PanelLeft size={17} /></button>
          <div className="folder-tabs" role="tablist" aria-label="Pastas abertas">
            {folderTabs.map((tab) => {
              const connection = connections.find((item) => item.id === tab.connectionId)
              const isActive = tab.id === activeFolderTabId
              if (!connection) return null
              return (
                <div className={`folder-tab ${isActive ? 'active' : ''}`} role="presentation" key={tab.id}>
                  <button
                    className="folder-tab-select"
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    title={tab.path}
                    onClick={() => onSelectFolderTab(tab)}
                  >
                    <Folder size={14} /><span>{pathLabel(tab.path)}</span><small>— {connection.name}</small>
                  </button>
                  <button
                    className="folder-tab-close"
                    type="button"
                    aria-label={`Fechar pasta ${pathLabel(tab.path)}`}
                    title="Fechar aba"
                    onClick={() => onCloseFolderTab(tab)}
                  ><X size={13} /></button>
                </div>
              )
            })}
          </div>
        </header>

        <section className="workspace-toolbar" aria-label="Comandos do diretório">
          <div className="navigation-controls">
            <button type="button" aria-label="Voltar" disabled={!canGoBack || unavailable || loading} onClick={() => navigate(onBack)}><ArrowLeft size={16} /></button>
            <button type="button" aria-label="Avançar" disabled={!canGoForward || unavailable || loading} onClick={() => navigate(onForward)}><ArrowRight size={16} /></button>
            <button type="button" aria-label="Subir um nível" disabled={unavailable || loading || currentPath === '/'} onClick={() => navigate(onUp)}><ArrowUp size={16} /></button>
            <button type="button" aria-label="Atualizar" disabled={unavailable || loading} onClick={onRefresh}><RefreshCw className={loading ? 'spin' : ''} size={16} /></button>
          </div>
          <div className="location-field"><span>/</span><strong>{currentPath.replace(/^\//, '')}</strong></div>
          <div className="directory-actions">
            <div className="view-switcher" role="group" aria-label="Modo de visualização">
              <button type="button" aria-label="Visualizar em lista" aria-pressed={viewMode === 'list'} title="Lista" onClick={() => setViewMode('list')}><List size={16} /></button>
              <button type="button" aria-label="Visualizar em cards" aria-pressed={viewMode === 'grid'} title="Cards" onClick={() => setViewMode('grid')}><LayoutGrid size={16} /></button>
            </div>
            <button className="toolbar-action" type="button" disabled={toolbarDownloadEntries.length === 0 || unavailable} onClick={() => toolbarDownloadEntries.forEach((file) => void onDownload(file))}><Download size={15} /> Baixar</button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button className="new-action" type="button" aria-label="Criar ou enviar" disabled={unavailable}><Plus size={16} /> Novo <ChevronDown className="new-action-chevron" size={14} /></button></DropdownMenuTrigger>
              <DropdownMenuContent className="new-menu-content" align="end" collisionPadding={12}>
                <DropdownMenuItem onSelect={createDirectory}><FolderPlus /><span>Nova pasta</span></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => chooseUpload(false)}><FileUp /><span>Upload de arquivo</span></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => chooseUpload(true)}><FolderUp /><span>Upload de pasta</span></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </section>

        {selectedEntries.length > 1 && <div className="bulk-actions" role="status"><strong>{selectedEntries.length} itens selecionados</strong><button type="button" disabled={downloadableEntries.length === 0} onClick={() => downloadableEntries.forEach((file) => void onDownload(file))}><Download size={14} /> Baixar selecionados</button><button className="clear-selection" type="button" onClick={() => setSelectedFiles(new Set())}>Limpar</button></div>}

        <section className="file-browser" aria-label="Arquivos do diretório atual" onClick={(event) => {
          if ((event.target as HTMLElement).closest('.file-entry, .table-head, .details-panel')) return
          setSelectedFiles(new Set())
          setInspectedFilePath(undefined)
        }}>
          {!activeConnection ? (
            <div className="browser-state"><Server size={34} /><strong>Nenhum servidor cadastrado</strong><span>Crie uma conexão para começar.</span><button type="button" onClick={onOpenConnection}><Plus size={15} /> Nova conexão</button></div>
          ) : activeConnection.status === 'disconnected' ? (
            <div className="browser-state"><LogOut size={34} /><strong>Servidor desconectado</strong><span>Informe novamente a senha para acessar os arquivos.</span><button type="button" onClick={() => onReconnect(activeConnection)}><LogIn size={15} /> Reconectar</button></div>
          ) : loading ? (
            viewMode === 'list' ? <FileListSkeleton /> : <FileGridSkeleton />
          ) : error ? (
            <div className="browser-state error-state"><Server size={34} /><strong>Não foi possível abrir o diretório</strong><span>{error}</span><button type="button" onClick={onRefresh}><RefreshCw size={15} /> Tentar novamente</button></div>
          ) : files.length === 0 ? (
            <div className="browser-state"><Folder size={34} /><strong>Diretório vazio</strong><span>{currentPath}</span></div>
          ) : viewMode === 'list' ? (
            <div className="file-table" role="table" aria-label="Arquivos remotos">
              <div className="table-row table-head" role="row">
                <span className="checkbox-cell" role="columnheader"><Checkbox checked={selectAllState} onCheckedChange={toggleAllFiles} aria-label="Selecionar todos os arquivos" /></span>
                <span role="columnheader">Nome</span><span role="columnheader">Tamanho</span><span role="columnheader">Modificado</span><span aria-hidden="true" />
              </div>
              {files.map((file) => {
                const Icon = fileIcons[file.kind]
                const isSelected = selectedFiles.has(file.path)
                return (
                  <FileContextMenu file={file} {...fileActions} key={file.path}>
                    <div className={`file-entry table-row ${file.kind === 'folder' ? 'folder-row' : ''} ${isSelected ? 'selected-row' : ''} ${inspectedFile?.path === file.path ? 'inspected-row' : ''}`} role="row" tabIndex={0} onClick={(event) => {
                      if (!(event.target as HTMLElement).closest('button')) setInspectedFilePath(file.path)
                    }} onDoubleClick={() => file.kind === 'folder' && openFolder(file)} onKeyDown={(event) => {
                      if (file.kind === 'folder' && event.key === 'Enter') openFolder(file)
                      if (event.key === ' ') {
                        event.preventDefault()
                        setInspectedFilePath(file.path)
                      }
                    }}>
                      <span className="checkbox-cell" role="cell"><Checkbox checked={isSelected} onCheckedChange={() => toggleFile(file.path)} aria-label={`Selecionar ${file.name}`} /></span>
                      <span className="file-name-cell" role="cell"><i className={`file-symbol ${file.kind}`}><Icon size={17} /></i><span><strong>{file.name}</strong><small>{file.type} · {file.permissions}</small></span></span>
                      <span role="cell">{formatSize(file.size)}</span><span role="cell">{formatDate(file.modified_at)}</span>
                      <FileActionsMenu file={file} {...fileActions} />
                    </div>
                  </FileContextMenu>
                )
              })}
            </div>
          ) : (
            <div className="file-grid" role="list" aria-label="Arquivos remotos em cards">
              {files.map((file) => {
                const Icon = fileIcons[file.kind]
                const isSelected = selectedFiles.has(file.path)
                return (
                  <FileContextMenu file={file} {...fileActions} key={file.path}>
                    <article className={`file-entry file-card ${file.kind === 'folder' ? 'folder-card' : ''} ${isSelected ? 'selected-card' : ''} ${inspectedFile?.path === file.path ? 'inspected-card' : ''}`} role="listitem" tabIndex={0} onClick={(event) => {
                      if (!(event.target as HTMLElement).closest('button')) setInspectedFilePath(file.path)
                    }} onDoubleClick={() => file.kind === 'folder' && openFolder(file)} onKeyDown={(event) => {
                      if (file.kind === 'folder' && event.key === 'Enter') openFolder(file)
                      if (event.key === ' ') {
                        event.preventDefault()
                        setInspectedFilePath(file.path)
                      }
                    }}>
                      <div className="card-controls"><FileActionsMenu file={file} {...fileActions} /></div>
                      <i className={`file-symbol card-symbol ${file.kind}`}><Icon size={25} /></i>
                      <div className="card-file-name"><strong title={file.name}>{file.name}</strong><small>{file.type}</small></div>
                      <dl className="card-metadata"><div><dt>Tamanho</dt><dd>{formatSize(file.size)}</dd></div><div><dt>Modificado</dt><dd>{formatDate(file.modified_at)}</dd></div></dl>
                    </article>
                  </FileContextMenu>
                )
              })}
            </div>
          )}

          {inspectedFile && (() => {
            const DetailIcon = fileIcons[inspectedFile.kind]
            return (
              <aside className="details-panel" aria-label={`Detalhes de ${inspectedFile.name}`}>
                <header className="details-header">
                  <strong>Detalhes</strong>
                  <button type="button" aria-label="Fechar detalhes" title="Fechar detalhes" onClick={() => setInspectedFilePath(undefined)}><X size={16} /></button>
                </header>
                <div className="details-body">
                  <div className="details-identity">
                    <i className={`file-symbol details-symbol ${inspectedFile.kind}`}><DetailIcon size={28} /></i>
                    <div>
                      <strong title={inspectedFile.name}>{inspectedFile.name}</strong>
                      <span>{inspectedFile.type}</span>
                    </div>
                  </div>

                  <section className="details-section">
                    <h3>Informações</h3>
                    <dl className="details-list">
                      <div><dt>Tipo</dt><dd>{inspectedFile.kind === 'folder' ? 'Pasta' : inspectedFile.type}</dd></div>
                      <div><dt>Tamanho</dt><dd>{formatSize(inspectedFile.size)}</dd></div>
                      <div><dt>Modificado</dt><dd>{formatDate(inspectedFile.modified_at)}</dd></div>
                      <div><dt>Permissões</dt><dd><code>{inspectedFile.permissions}</code></dd></div>
                    </dl>
                  </section>

                  <section className="details-section details-location">
                    <h3>Local</h3>
                    <p>{inspectedFile.path}</p>
                  </section>
                </div>
              </aside>
            )
          })()}
        </section>

        <footer className="workspace-statusbar">
          {activeConnection ? <span className="server-pill"><Server size={13} /> {activeConnection.name} <i className={activeConnection.status} /></span> : <span>Nenhuma conexão</span>}
          <span>{files.length} itens</span><span className="status-spacer" />
          {activeConnection?.status === 'connected' && <span><Check size={13} /> Credenciais validadas</span>}
        </footer>
      </main>
      <Dialog open={Boolean(inputDialog)} onOpenChange={(open) => {
        if (!open && !inputDialogPending) setInputDialog(null)
      }}>
        <DialogContent>
          <form onSubmit={submitInputDialog}>
            <DialogHeader>
              <DialogTitle>{inputDialog?.title}</DialogTitle>
              <DialogDescription>{inputDialog?.description}</DialogDescription>
            </DialogHeader>
            <label className="shadcn-dialog-field">
              <span>{inputDialog?.label}</span>
              <div className={inputDialog?.extension ? 'rename-input-shell' : undefined}>
                <input
                  autoFocus
                  required
                  maxLength={inputDialog?.mode === 'move' ? 4096 : 255 - (inputDialog?.extension?.length || 0)}
                  pattern={inputDialog?.mode === 'permissions' ? '[0-7]{3,4}' : undefined}
                  inputMode={inputDialog?.mode === 'permissions' ? 'numeric' : undefined}
                  title={inputDialog?.mode === 'permissions' ? 'Use 3 ou 4 dígitos entre 0 e 7.' : undefined}
                  value={inputDialog?.value || ''}
                  onFocus={(event) => inputDialog?.mode === 'rename' && event.currentTarget.select()}
                  onChange={(event) => setInputDialog((current) => current ? { ...current, value: event.target.value } : current)}
                />
                {inputDialog?.extension && (
                  <span className="rename-input-extension" title="A extensão do arquivo será preservada">
                    {inputDialog.extension}
                  </span>
                )}
              </div>
            </label>
            <DialogFooter>
              <DialogClose type="button" disabled={inputDialogPending}>Cancelar</DialogClose>
              <button className="shadcn-dialog-button primary" type="submit" disabled={inputDialogPending || !inputDialog?.value.trim()}>
                {inputDialogPending ? 'Aguarde…' : 'Confirmar'}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
