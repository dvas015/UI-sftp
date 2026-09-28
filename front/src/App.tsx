import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Connection, type ConnectionCreateInput, type ConnectionUpdateInput, type DirectoryListing, type DownloadProgress, type RemoteFile } from './api'
import { ConnectionModal, type ConnectionModalMode } from './components/ConnectionModal'
import { FileManager, type FolderTab } from './components/FileManager'
import { AnimatedToastStack } from './components/ui/animated-toast-stack'
import { useAnimatedToastStack } from './hooks/use-animated-toast-stack'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from './components/ui/alert-dialog'
import './App.css'

interface ModalState {
  open: boolean
  mode: ConnectionModalMode
  connection?: Connection
}

interface AlertDialogState {
  title: string
  description: string
  actionLabel: string
  cancelLabel?: string
  destructive?: boolean
  onAction?: () => Promise<void> | void
}

interface OperationFeedback {
  loadingTitle?: string
  loadingDescription?: string
  successTitle?: string
  successDescription?: string
  errorTitle?: string
  refresh?: boolean
}

function folderTabId(connectionId: string, path: string) {
  return `${connectionId}:${path}`
}

function formatTransferSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[unit]}`
}

function downloadProgressDescription(progress: DownloadProgress) {
  if (progress.status === 'preparing' || progress.total_bytes === null) return 'Conectando ao servidor SFTP…'
  const percentage = progress.total_bytes > 0
    ? Math.min(100, Math.round((progress.bytes_transferred / progress.total_bytes) * 100))
    : 100
  return `${percentage}% · ${formatTransferSize(progress.bytes_transferred)} de ${formatTransferSize(progress.total_bytes)}`
}

type ApiHealthStatus = 'checking' | 'connected' | 'disconnected'

function App() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [activeConnectionId, setActiveConnectionId] = useState<string>()
  const [directory, setDirectory] = useState<DirectoryListing | null>(null)
  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [directoryError, setDirectoryError] = useState<string>()
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [folderTabs, setFolderTabs] = useState<FolderTab[]>([])
  const [activeFolderTabId, setActiveFolderTabId] = useState<string>()
  const [loadingConnections, setLoadingConnections] = useState(true)
  const [apiHealth, setApiHealth] = useState<{ status: ApiHealthStatus; version?: string }>({ status: 'checking' })
  const [modal, setModal] = useState<ModalState>({ open: false, mode: 'create' })
  const [alertDialog, setAlertDialog] = useState<AlertDialogState | null>(null)
  const [alertDialogPending, setAlertDialogPending] = useState(false)
  const directoryRequestId = useRef(0)
  const folderTabsRef = useRef<FolderTab[]>([])
  const { toasts, showToast, updateToast, dismissToast } = useAnimatedToastStack({ limit: 8 })

  const activeConnection = useMemo(
    () => connections.find((connection) => connection.id === activeConnectionId),
    [activeConnectionId, connections],
  )

  useEffect(() => {
    let active = true
    let requestController: AbortController | undefined

    async function checkApiHealth() {
      requestController?.abort()
      const controller = new AbortController()
      requestController = controller
      const timeoutId = window.setTimeout(() => controller.abort(), 5000)

      try {
        const health = await api.health(controller.signal)
        if (active) setApiHealth({ status: 'connected', version: health.version })
      } catch {
        if (active) setApiHealth({ status: 'disconnected' })
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    void checkApiHealth()
    const intervalId = window.setInterval(() => void checkApiHealth(), 15_000)

    return () => {
      active = false
      window.clearInterval(intervalId)
      requestController?.abort()
    }
  }, [])

  const fetchDirectory = useCallback(async (connection: Connection, path?: string) => {
    const requestId = ++directoryRequestId.current
    setDirectoryLoading(true)
    setDirectoryError(undefined)
    try {
      const listing = await api.listFiles(connection.id, path)
      if (requestId !== directoryRequestId.current) return null
      setDirectory(listing)
      return listing
    } catch (error) {
      if (requestId !== directoryRequestId.current) return null
      const message = error instanceof Error ? error.message : 'Não foi possível listar o diretório.'
      setDirectory(null)
      setDirectoryError(message)
      showToast({ status: 'error', title: 'Não foi possível abrir a pasta', description: message, duration: 6000 })
      return null
    } finally {
      if (requestId === directoryRequestId.current) setDirectoryLoading(false)
    }
  }, [showToast])

  const ensureFolderTab = useCallback((connectionId: string, path: string) => {
    const id = folderTabId(connectionId, path)
    setFolderTabs((current) => {
      const next = current.some((tab) => tab.id === id)
        ? current
        : [...current, { id, connectionId, path }]
      folderTabsRef.current = next
      return next
    })
    setActiveFolderTabId(id)
  }, [])

  const clearDirectory = useCallback(() => {
    directoryRequestId.current += 1
    setDirectory(null)
    setDirectoryLoading(false)
    setHistory([])
    setHistoryIndex(-1)
  }, [])

  const activateConnection = useCallback(async (connection: Connection) => {
    setActiveConnectionId(connection.id)
    if (connection.status !== 'connected') {
      clearDirectory()
      return
    }

    const existingTab = [...folderTabsRef.current].reverse().find((tab) => tab.connectionId === connection.id)
    const listing = await fetchDirectory(connection, existingTab?.path || connection.initial_path)
    if (!listing) return
    ensureFolderTab(connection.id, listing.path)
    setHistory([listing.path])
    setHistoryIndex(0)
  }, [clearDirectory, ensureFolderTab, fetchDirectory])

  useEffect(() => {
    let active = true
    api.listConnections()
      .then((items) => {
        if (!active) return
        setConnections(items)
        if (items[0]) void activateConnection(items[0])
        if (items.length === 0) setModal({ open: true, mode: 'create' })
      })
      .catch((error: Error) => {
        if (!active) return
        setDirectoryError(error.message)
        showToast({ status: 'error', title: 'Falha ao carregar conexões', description: error.message, duration: 6000 })
      })
      .finally(() => active && setLoadingConnections(false))
    return () => { active = false }
  }, [activateConnection, showToast])

  function replaceConnection(next: Connection) {
    setConnections((current) => current.map((item) => item.id === next.id ? next : item))
  }

  async function submitConnection(payload: ConnectionCreateInput | ConnectionUpdateInput) {
    try {
      if (modal.mode === 'create') {
        const created = await api.createConnection(payload as ConnectionCreateInput)
        setConnections((current) => [...current, created])
        await activateConnection(created)
        showToast({ status: 'success', title: 'Conectado ao servidor', description: `${created.name} · ${created.username}@${created.host}` })
      } else if (modal.mode === 'reconnect' && modal.connection) {
        const password = (payload as ConnectionCreateInput).password
        const connected = await api.reconnectConnection(modal.connection.id, password)
        replaceConnection(connected)
        await activateConnection(connected)
        showToast({ status: 'success', title: 'Conectado ao servidor', description: `${connected.name} · ${connected.username}@${connected.host}` })
      } else if (modal.connection) {
        const updated = await api.updateConnection(modal.connection.id, payload)
        replaceConnection(updated)
        showToast({ status: 'success', title: 'Conexão atualizada', description: updated.name })
      }
      setModal((current) => ({ ...current, open: false }))
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Não foi possível concluir a conexão.', 'Falha na conexão SFTP')
      throw error
    }
  }

  async function navigate(path: string) {
    if (!activeConnection) return
    const listing = await fetchDirectory(activeConnection, path)
    if (!listing || listing.path === directory?.path) return
    ensureFolderTab(activeConnection.id, listing.path)
    const nextHistory = [...history.slice(0, historyIndex + 1), listing.path]
    setHistory(nextHistory)
    setHistoryIndex(nextHistory.length - 1)
  }

  async function moveInHistory(nextIndex: number) {
    if (!activeConnection || !history[nextIndex]) return
    const listing = await fetchDirectory(activeConnection, history[nextIndex])
    if (listing) {
      ensureFolderTab(activeConnection.id, listing.path)
      setHistoryIndex(nextIndex)
    }
  }

  async function selectFolderTab(tab: FolderTab) {
    const connection = connections.find((item) => item.id === tab.connectionId)
    if (!connection) return
    setActiveConnectionId(connection.id)
    setActiveFolderTabId(tab.id)
    if (connection.status !== 'connected') {
      clearDirectory()
      return
    }
    const listing = await fetchDirectory(connection, tab.path)
    if (!listing) return
    setHistory([listing.path])
    setHistoryIndex(0)
  }

  function closeFolderTab(tab: FolderTab) {
    const tabIndex = folderTabs.findIndex((item) => item.id === tab.id)
    const remaining = folderTabs.filter((item) => item.id !== tab.id)
    folderTabsRef.current = remaining
    setFolderTabs(remaining)
    if (tab.id !== activeFolderTabId) return

    const replacement = remaining[Math.min(tabIndex, remaining.length - 1)]
    if (replacement) {
      void selectFolderTab(replacement)
      return
    }
    setActiveFolderTabId(undefined)
    clearDirectory()
  }

  async function disconnect(connection: Connection) {
    try {
      replaceConnection(await api.disconnectConnection(connection.id))
      if (connection.id === activeConnectionId) clearDirectory()
      showToast({ status: 'info', title: 'Servidor desconectado', description: connection.name })
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Não foi possível desconectar.', 'Falha ao desconectar')
    }
  }

  function showError(description: string, title = 'Não foi possível concluir a operação') {
    showToast({ status: 'error', title, description, duration: 6000 })
  }

  async function handleAlertDialogAction() {
    if (!alertDialog?.onAction) {
      setAlertDialog(null)
      return
    }

    setAlertDialogPending(true)
    try {
      await alertDialog.onAction()
      setAlertDialog(null)
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Não foi possível concluir a operação.')
    } finally {
      setAlertDialogPending(false)
    }
  }

  async function deleteConnection(connection: Connection) {
    setAlertDialog({
      title: 'Excluir servidor?',
      description: `A conexão “${connection.name}” será removida deste navegador. Esta ação não pode ser desfeita.`,
      actionLabel: 'Excluir servidor',
      cancelLabel: 'Cancelar',
      destructive: true,
      onAction: async () => {
        await api.deleteConnection(connection.id)
        const remaining = connections.filter((item) => item.id !== connection.id)
        const remainingTabs = folderTabsRef.current.filter((tab) => tab.connectionId !== connection.id)
        setConnections(remaining)
        folderTabsRef.current = remainingTabs
        setFolderTabs(remainingTabs)
        if (activeConnectionId === connection.id) {
          setActiveFolderTabId(undefined)
          if (remaining[0]) void activateConnection(remaining[0])
          else {
            setActiveConnectionId(undefined)
            clearDirectory()
          }
        }
        if (remaining.length === 0) setModal({ open: true, mode: 'create' })
        showToast({ status: 'success', title: 'Servidor removido', description: connection.name })
      }
    })
  }

  async function renameConnection(connection: Connection, name: string) {
    try {
      replaceConnection(await api.updateConnection(connection.id, { name }))
      showToast({ status: 'success', title: 'Conexão renomeada', description: name })
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Não foi possível renomear a conexão.')
    }
  }

  function selectConnection(id: string) {
    const selected = connections.find((connection) => connection.id === id)
    if (selected) void activateConnection(selected)
  }

  const currentPath = directory?.path || activeConnection?.initial_path || '/'

  useEffect(() => {
    const folderName = currentPath === '/' ? '/' : currentPath.split('/').filter(Boolean).at(-1) || '/'
    document.title = `SFTP | ${folderName}`
  }, [currentPath])

  function joinRemotePath(parent: string, child: string) {
    return `${parent === '/' ? '' : parent}/${child.replaceAll('\\', '/')}`
  }

  async function executeFileOperation(operation: () => Promise<unknown>, refresh = true) {
    await operation()
    if (refresh && activeConnection) await fetchDirectory(activeConnection, currentPath)
  }

  async function runFileOperation(operation: () => Promise<unknown>, feedback: OperationFeedback = {}) {
    const toastId = feedback.loadingTitle ? showToast({
      status: 'loading',
      title: feedback.loadingTitle,
      description: feedback.loadingDescription,
      duration: 0,
      dismissible: false,
    }) : undefined

    try {
      await executeFileOperation(operation, feedback.refresh ?? true)
      if (feedback.successTitle) {
        const successToast = { status: 'success' as const, title: feedback.successTitle, description: feedback.successDescription, duration: 4200, dismissible: true }
        if (toastId) updateToast(toastId, successToast)
        else showToast(successToast)
      } else if (toastId) {
        dismissToast(toastId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível concluir a operação.'
      if (toastId) updateToast(toastId, { status: 'error', title: feedback.errorTitle || 'Não foi possível concluir a operação', description: message, duration: 6000, dismissible: true })
      else showError(message, feedback.errorTitle)
    }
  }

  async function deleteEntry(file: RemoteFile) {
    if (!activeConnection) return
    setAlertDialog({
      title: 'Excluir item?',
      description: `“${file.name}” será excluído permanentemente do servidor. Esta ação não pode ser desfeita.`,
      actionLabel: 'Excluir item',
      cancelLabel: 'Cancelar',
      destructive: true,
      onAction: () => runFileOperation(
        () => api.deleteEntry(activeConnection.id, file.path),
        { successTitle: 'Item excluído', successDescription: file.name, errorTitle: 'Não foi possível excluir o item' },
      ),
    })
  }

  async function download(file: RemoteFile) {
    if (!activeConnection) return
    const toastId = showToast({
      status: 'loading',
      title: 'Preparando download…',
      description: file.size === null ? file.name : `0 B de ${formatTransferSize(file.size)} · ${file.name}`,
      progress: 0,
      duration: 0,
      dismissible: false,
    })
    try {
      await api.downloadFile(activeConnection.id, file.path, file.name, (progress) => {
        const percentage = progress.total_bytes && progress.total_bytes > 0
          ? Math.min(100, (progress.bytes_transferred / progress.total_bytes) * 100)
          : progress.status === 'completed' ? 100 : 0
        updateToast(toastId, {
          status: 'loading',
          title: `Baixando ${file.name}`,
          description: downloadProgressDescription(progress),
          progress: percentage,
          duration: 0,
          dismissible: false,
        })
      })
      updateToast(toastId, {
        status: 'success',
        title: 'Download concluído',
        description: file.name,
        progress: 100,
        duration: 4200,
        dismissible: true,
      })
    } catch (error) {
      updateToast(toastId, {
        status: 'error',
        title: 'Não foi possível baixar o arquivo',
        description: error instanceof Error ? error.message : 'O download foi interrompido.',
        progress: undefined,
        duration: 6000,
        dismissible: true,
      })
    }
  }

  async function upload(files: File[]) {
    if (!activeConnection) return
    const count = files.length
    await runFileOperation(async () => {
      for (const file of files) {
        const relativePath = file.webkitRelativePath || file.name
        await api.uploadFile(
          activeConnection.id,
          joinRemotePath(currentPath, relativePath),
          file,
          Boolean(file.webkitRelativePath),
        )
      }
    }, {
      loadingTitle: count === 1 ? 'Enviando arquivo…' : `Enviando ${count} arquivos…`,
      loadingDescription: count === 1 ? `${files[0]?.name} → ${currentPath}` : `Destino: ${currentPath}`,
      successTitle: count === 1 ? 'Upload concluído' : 'Uploads concluídos',
      successDescription: count === 1 ? files[0]?.name : `${count} arquivos enviados para ${currentPath}`,
      errorTitle: 'Falha no upload',
    })
  }

  return (
    <>
      <FileManager
        connections={connections}
        apiHealthStatus={apiHealth.status}
        apiVersion={apiHealth.version}
        activeConnection={activeConnection}
        folderTabs={folderTabs}
        activeFolderTabId={activeFolderTabId}
        files={directory?.items || []}
        currentPath={currentPath}
        loading={loadingConnections || directoryLoading}
        error={directoryError}
        canGoBack={historyIndex > 0}
        canGoForward={historyIndex >= 0 && historyIndex < history.length - 1}
        onSelectFolderTab={(tab) => void selectFolderTab(tab)}
        onCloseFolderTab={closeFolderTab}
        onSelectConnection={selectConnection}
        onOpenConnection={() => setModal({ open: true, mode: 'create' })}
        onEditConnection={(connection) => setModal({ open: true, mode: 'edit', connection })}
        onReconnect={(connection) => setModal({ open: true, mode: 'reconnect', connection })}
        onDisconnect={disconnect}
        onDeleteConnection={deleteConnection}
        onRenameConnection={renameConnection}
        onOpenFolder={(file) => void navigate(file.path)}
        onBack={() => void moveInHistory(historyIndex - 1)}
        onForward={() => void moveInHistory(historyIndex + 1)}
        onUp={() => {
          const current = directory?.path || '/'
          const parent = current === '/' ? '/' : current.slice(0, current.lastIndexOf('/')) || '/'
          void navigate(parent)
        }}
        onRefresh={() => activeConnection && void fetchDirectory(activeConnection, directory?.path)}
        onDownload={download}
        onUpload={upload}
        onCreateDirectory={(name) => !activeConnection ? Promise.resolve() : runFileOperation(
          () => api.createDirectory(activeConnection.id, joinRemotePath(currentPath, name)),
          { loadingTitle: 'Criando pasta…', loadingDescription: name, successTitle: 'Pasta criada', successDescription: name, errorTitle: 'Não foi possível criar a pasta' },
        )}
        onRenameEntry={(file, name) => !activeConnection ? Promise.resolve() : runFileOperation(
          () => api.renameEntry(activeConnection.id, file.path, name),
          { successTitle: 'Item renomeado', successDescription: name, errorTitle: 'Não foi possível renomear o item' },
        )}
        onMoveEntry={(file, destination) => !activeConnection ? Promise.resolve() : runFileOperation(
          () => api.moveEntry(activeConnection.id, file.path, destination),
          { successTitle: 'Item movido', successDescription: file.name, errorTitle: 'Não foi possível mover o item' },
        )}
        onDuplicateEntry={(file) => !activeConnection ? Promise.resolve() : runFileOperation(
          () => api.duplicateEntry(activeConnection.id, file.path),
          { successTitle: 'Item duplicado', successDescription: file.name, errorTitle: 'Não foi possível duplicar o item' },
        )}
        onChangePermissions={(file, mode) => !activeConnection ? Promise.resolve() : runFileOperation(
          () => api.changePermissions(activeConnection.id, file.path, mode),
          { successTitle: 'Permissões atualizadas', successDescription: `${file.name} · ${mode}`, errorTitle: 'Não foi possível alterar as permissões' },
        )}
        onDeleteEntry={deleteEntry}
      />
      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} />
      {modal.open && (
        <ConnectionModal
          key={`${modal.mode}-${modal.connection?.id || 'new'}`}
          open
          mode={modal.mode}
          connection={modal.connection}
          onClose={() => setModal((current) => ({ ...current, open: false }))}
          onSubmit={submitConnection}
        />
      )}
      <AlertDialog open={Boolean(alertDialog)} onOpenChange={(open) => {
        if (!open && !alertDialogPending) setAlertDialog(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{alertDialog?.title}</AlertDialogTitle>
            <AlertDialogDescription>{alertDialog?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {alertDialog?.cancelLabel && (
              <AlertDialogCancel disabled={alertDialogPending}>{alertDialog.cancelLabel}</AlertDialogCancel>
            )}
            <AlertDialogAction
              className={alertDialog?.destructive ? 'destructive' : ''}
              disabled={alertDialogPending}
              onClick={(event) => {
                event.preventDefault()
                void handleAlertDialogAction()
              }}
            >
              {alertDialogPending ? 'Aguarde…' : alertDialog?.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default App
