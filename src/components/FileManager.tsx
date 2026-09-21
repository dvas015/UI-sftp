import { useEffect, useRef, useState } from 'react'
import {
  Archive, ArrowLeft, ArrowRight, ArrowUp, Check, Download, FileCode2, Folder,
  ChevronDown, FileUp, FolderLock, FolderPlus, FolderUp, Headphones, Image, LayoutGrid, List, LogOut, PanelLeft, Pencil, Plus,
  RefreshCw, Server, Trash2, Video, X,
} from 'lucide-react'
import { remoteFiles, type FileKind } from '../mockData'
import { FileActionsMenu, FileContextMenu } from './FileActionsMenu'
import { Checkbox } from './ui/checkbox'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu'

interface FileManagerProps { onOpenConnection: () => void }
interface FolderTab { label: string; path: string }
interface FolderSession { tabs: FolderTab[]; activePath: string }
type ViewMode = 'list' | 'grid'

const defaultFolderSession: FolderSession = {
  tabs: [{ label: 'app', path: '/diretório/atual/app' }],
  activePath: '/diretório/atual/app',
}

function loadFolderSession(): FolderSession {
  try {
    const stored = sessionStorage.getItem('sftp-folder-tabs')
    if (!stored) return defaultFolderSession
    const parsed = JSON.parse(stored) as FolderSession
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0 || !parsed.tabs.some((tab) => tab.path === parsed.activePath)) return defaultFolderSession
    return parsed
  } catch {
    return defaultFolderSession
  }
}

const fileIcons = {
  folder: Folder, code: FileCode2, image: Image, video: Video, audio: Headphones, archive: Archive,
} satisfies Record<FileKind, typeof Folder>

export function FileManager({ onOpenConnection }: FileManagerProps) {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set())
  const [viewMode, setViewMode] = useState<ViewMode>(() => sessionStorage.getItem('sftp-view-mode') === 'grid' ? 'grid' : 'list')
  const [sessionExpanded, setSessionExpanded] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [folderSession, setFolderSession] = useState<FolderSession>(loadFolderSession)
  const [connectionName, setConnectionName] = useState(() => sessionStorage.getItem('sftp-connection-name') || 'files.acme.io')
  const [connectionNameDraft, setConnectionNameDraft] = useState(connectionName)
  const [isRenamingConnection, setIsRenamingConnection] = useState(false)
  const fileUploadInput = useRef<HTMLInputElement>(null)
  const folderUploadInput = useRef<HTMLInputElement>(null)
  const allSelected = remoteFiles.length > 0 && remoteFiles.every((file) => selectedFiles.has(file.name))
  const someSelected = remoteFiles.some((file) => selectedFiles.has(file.name))
  const selectAllState = allSelected ? true : someSelected ? 'indeterminate' : false

  useEffect(() => {
    sessionStorage.setItem('sftp-folder-tabs', JSON.stringify(folderSession))
  }, [folderSession])

  useEffect(() => {
    sessionStorage.setItem('sftp-connection-name', connectionName)
  }, [connectionName])

  useEffect(() => {
    sessionStorage.setItem('sftp-view-mode', viewMode)
  }, [viewMode])

  useEffect(() => {
    if (selectedFiles.size === 0) return
    const clearSelectionOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedFiles(new Set())
    }
    window.addEventListener('keydown', clearSelectionOnEscape)
    return () => window.removeEventListener('keydown', clearSelectionOnEscape)
  }, [selectedFiles.size])

  function startRenamingConnection() {
    setConnectionNameDraft(connectionName)
    setIsRenamingConnection(true)
  }

  function finishRenamingConnection() {
    const nextName = connectionNameDraft.trim()
    if (nextName) setConnectionName(nextName)
    else setConnectionNameDraft(connectionName)
    setIsRenamingConnection(false)
  }

  function toggleFile(name: string) {
    setSelectedFiles((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function toggleAllFiles() {
    setSelectedFiles((current) => {
      const next = new Set(current)
      remoteFiles.forEach((file) => {
        if (allSelected) next.delete(file.name)
        else next.add(file.name)
      })
      return next
    })
  }

  function openFolder(name: string) {
    setFolderSession((current) => {
      const path = `${current.activePath}/${name}`.replace(/\/+/g, '/')
      const alreadyOpen = current.tabs.some((tab) => tab.path === path)
      return {
        tabs: alreadyOpen ? current.tabs : [...current.tabs, { label: name, path }],
        activePath: path,
      }
    })
  }

  function closeFolder(path: string) {
    setFolderSession((current) => {
      if (current.tabs.length === 1) return current
      const closedIndex = current.tabs.findIndex((tab) => tab.path === path)
      const tabs = current.tabs.filter((tab) => tab.path !== path)
      const activePath = current.activePath === path
        ? tabs[Math.max(0, closedIndex - 1)].path
        : current.activePath
      return { tabs, activePath }
    })
  }

  return (
    <div className={`sftp-app ${sidebarOpen ? '' : 'sidebar-hidden'}`}>
      {sidebarOpen && <aside className="sessions-sidebar">
        <div className="app-brand"><span><FolderLock size={19} /></span><strong>SFTP File Manager</strong></div>

        <section className={`session-card ${sessionExpanded ? '' : 'collapsed'}`}>
          <header>
            <span className="server-symbol"><Server size={17} /><i className="session-online" aria-hidden="true" /></span>
            <span className="connection-identity">
              {isRenamingConnection ? (
                <input
                  className="connection-name-input"
                  value={connectionNameDraft}
                  aria-label="Nome da conexão"
                  autoFocus
                  maxLength={48}
                  onChange={(event) => setConnectionNameDraft(event.target.value)}
                  onBlur={finishRenamingConnection}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setConnectionNameDraft(connectionName)
                      setIsRenamingConnection(false)
                    }
                  }}
                />
              ) : (
                <button className="connection-name-button" type="button" onClick={startRenamingConnection} title="Renomear conexão">
                  <strong>{connectionName}</strong><Pencil size={12} aria-hidden="true" />
                </button>
              )}
              <small>deploy@files.acme.io</small>
            </span>
            <button
              className="session-collapse"
              type="button"
              aria-expanded={sessionExpanded}
              aria-label={sessionExpanded ? 'Recolher sessão' : 'Expandir sessão'}
              onClick={() => setSessionExpanded((expanded) => !expanded)}
            >
              <ChevronDown className="session-collapse-chevron" size={15} />
            </button>
          </header>
          <div className="session-actions">
            <button type="button"><LogOut size={14} /> Desconectar</button>
            <button type="button" onClick={onOpenConnection}><Pencil size={14} /> Editar</button>
            <button className="delete-session" type="button" aria-label="Excluir sessão"><Trash2 size={15} /></button>
          </div>
        </section>

        <button className="new-session-button" type="button" onClick={onOpenConnection}><Plus size={15} /> Nova sessão</button>
        <footer className="sidebar-status"><span><i /> SFTP seguro</span><small>Porta 22</small></footer>
      </aside>}

      <main className="workspace-window">
        <header className="workspace-header">
          <button
            className={`window-icon-button ${sidebarOpen ? '' : 'sidebar-is-hidden'}`}
            type="button"
            aria-pressed={!sidebarOpen}
            aria-label={sidebarOpen ? 'Ocultar painel de sessões' : 'Mostrar painel de sessões'}
            onClick={() => setSidebarOpen((open) => !open)}
          ><PanelLeft size={17} /></button>
          <div className="folder-tabs" role="tablist" aria-label="Pastas abertas">
            {folderSession.tabs.map((tab) => {
              const isActive = folderSession.activePath === tab.path
              return (
                <div className={`folder-tab ${isActive ? 'active' : ''}`} role="presentation" key={tab.path}>
                  <button className="folder-tab-select" type="button" role="tab" aria-selected={isActive} onClick={() => setFolderSession((current) => ({ ...current, activePath: tab.path }))}>
                    <Folder size={14} /><span>{tab.label}</span><small>— {connectionName}</small>
                  </button>
                  {folderSession.tabs.length > 1 && <button className="folder-tab-close" type="button" aria-label={`Fechar pasta ${tab.label}`} onClick={() => closeFolder(tab.path)}><X size={13} /></button>}
                </div>
              )
            })}
          </div>
        </header>

        <section className="workspace-toolbar" aria-label="Comandos do diretório">
          <div className="navigation-controls">
            <button type="button" aria-label="Voltar"><ArrowLeft size={16} /></button>
            <button type="button" aria-label="Avançar"><ArrowRight size={16} /></button>
            <button type="button" aria-label="Subir um nível"><ArrowUp size={16} /></button>
            <button type="button" aria-label="Atualizar"><RefreshCw size={16} /></button>
          </div>
          <div className="location-field"><span>/</span><strong>{folderSession.activePath.replace(/^\//, '')}</strong></div>
          <div className="directory-actions">
            <div className="view-switcher" role="group" aria-label="Modo de visualização">
              <button
                type="button"
                aria-label="Visualizar em lista"
                aria-pressed={viewMode === 'list'}
                title="Lista"
                onClick={() => setViewMode('list')}
              ><List size={16} /></button>
              <button
                type="button"
                aria-label="Visualizar em cards"
                aria-pressed={viewMode === 'grid'}
                title="Cards"
                onClick={() => setViewMode('grid')}
              ><LayoutGrid size={16} /></button>
            </div>
            <button className="toolbar-action" type="button" disabled={selectedFiles.size === 0}><Download size={15} /> Baixar</button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="new-action" type="button" aria-label="Criar ou enviar">
                  <Plus size={16} /> Novo <ChevronDown className="new-action-chevron" size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="new-menu-content" align="end" collisionPadding={12}>
                <DropdownMenuItem><FolderPlus /><span>Nova pasta</span></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => fileUploadInput.current?.click()}>
                  <FileUp /><span>Upload de arquivo</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => folderUploadInput.current?.click()}>
                  <FolderUp /><span>Upload de pasta</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input ref={fileUploadInput} className="visually-hidden" type="file" multiple tabIndex={-1} />
            <input
              ref={folderUploadInput}
              className="visually-hidden"
              type="file"
              multiple
              tabIndex={-1}
              {...{ webkitdirectory: '', directory: '' }}
            />
          </div>
        </section>

        {selectedFiles.size > 1 && (
          <div className="bulk-actions" role="status">
            <strong>{selectedFiles.size} {selectedFiles.size === 1 ? 'item selecionado' : 'itens selecionados'}</strong>
            <button type="button"><Download size={14} /> Baixar selecionados</button>
            <button className="clear-selection" type="button" onClick={() => setSelectedFiles(new Set())}>Limpar</button>
          </div>
        )}

        <section
          className="file-browser"
          aria-label="Arquivos do diretório atual"
          onClick={(event) => {
            if (selectedFiles.size > 0 && !(event.target as HTMLElement).closest('.file-entry, .table-head')) {
              setSelectedFiles(new Set())
            }
          }}
          onContextMenu={(event) => {
            if ((event.target as HTMLElement).closest('.file-entry')) event.preventDefault()
          }}
        >
          {viewMode === 'list' ? (
            <div className="file-table" role="table" aria-label="Arquivos remotos">
              <div className="table-row table-head" role="row">
                <span className="checkbox-cell" role="columnheader"><Checkbox checked={selectAllState} onCheckedChange={toggleAllFiles} aria-label="Selecionar todos os arquivos" /></span>
                <span role="columnheader">Nome</span><span role="columnheader">Tamanho</span><span role="columnheader">Modificado</span><span aria-hidden="true" />
              </div>
              {remoteFiles.map((file) => {
                const Icon = fileIcons[file.kind]
                const isSelected = selectedFiles.has(file.name)
                return (
                  <FileContextMenu file={file} key={file.name}>
                    <div
                      className={`file-entry table-row ${file.kind === 'folder' ? 'folder-row' : ''} ${isSelected ? 'selected-row' : ''}`}
                      role="row"
                      tabIndex={file.kind === 'folder' ? 0 : undefined}
                      aria-label={file.kind === 'folder' ? `Abrir pasta ${file.name}` : undefined}
                      onPointerDown={(event) => {
                        if (event.shiftKey && !(event.target as HTMLElement).closest('button')) {
                          event.preventDefault()
                        }
                      }}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('button')) return
                        if (event.shiftKey) {
                          event.preventDefault()
                          toggleFile(file.name)
                          return
                        }
                        if (file.kind === 'folder') openFolder(file.name)
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                        if (event.shiftKey) {
                          event.preventDefault()
                          toggleFile(file.name)
                          return
                        }
                        if (file.kind === 'folder') {
                          event.preventDefault()
                          openFolder(file.name)
                        }
                      }}
                    >
                      <span className="checkbox-cell" role="cell"><Checkbox checked={isSelected} onCheckedChange={() => toggleFile(file.name)} aria-label={`Selecionar ${file.name}`} /></span>
                      <span className="file-name-cell" role="cell">
                        <i className={`file-symbol ${file.kind}`}><Icon size={17} /></i>
                        <span><strong>{file.name}</strong><small>{file.type}</small></span>
                      </span>
                      <span role="cell">{file.size}</span><span role="cell">{file.modified}</span>
                      <FileActionsMenu file={file} />
                    </div>
                  </FileContextMenu>
                )
              })}
            </div>
          ) : (
            <div className="file-grid" role="list" aria-label="Arquivos remotos em cards">
              {remoteFiles.map((file) => {
                const Icon = fileIcons[file.kind]
                const isSelected = selectedFiles.has(file.name)
                return (
                  <FileContextMenu file={file} key={file.name}>
                    <article
                      className={`file-entry file-card ${file.kind === 'folder' ? 'folder-card' : ''} ${isSelected ? 'selected-card' : ''}`}
                      role="listitem"
                      tabIndex={file.kind === 'folder' ? 0 : undefined}
                      aria-label={file.kind === 'folder' ? `Abrir pasta ${file.name}` : file.name}
                      onPointerDown={(event) => {
                        if (event.shiftKey && !(event.target as HTMLElement).closest('button')) {
                          event.preventDefault()
                        }
                      }}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest('button')) return
                        if (event.shiftKey) {
                          event.preventDefault()
                          toggleFile(file.name)
                          return
                        }
                        if (file.kind === 'folder') openFolder(file.name)
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                        if (event.shiftKey) {
                          event.preventDefault()
                          toggleFile(file.name)
                          return
                        }
                        if (file.kind === 'folder') {
                          event.preventDefault()
                          openFolder(file.name)
                        }
                      }}
                    >
                      <div className="card-controls">
                        <FileActionsMenu file={file} />
                      </div>
                      <i className={`file-symbol card-symbol ${file.kind}`}><Icon size={25} /></i>
                      <div className="card-file-name"><strong title={file.name}>{file.name}</strong><small>{file.type}</small></div>
                      <dl className="card-metadata">
                        <div><dt>Tamanho</dt><dd>{file.size}</dd></div>
                        <div><dt>Modificado</dt><dd>{file.modified}</dd></div>
                      </dl>
                    </article>
                  </FileContextMenu>
                )
              })}
            </div>
          )}
        </section>

        <footer className="workspace-statusbar">
          <span className="server-pill"><Server size={13} /> {connectionName} <i /></span>
          <span>{remoteFiles.length} itens</span>
          <span className="status-spacer" />
          <span><Check size={13} /> Conexão segura</span>
        </footer>
      </main>
    </div>
  )
}
