import {
  Copy, Download, Ellipsis, FilePenLine, FolderInput, Link2, ShieldCheck, Trash2,
} from 'lucide-react'
import type { ReactElement } from 'react'
import type { RemoteFile } from '../api'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from './ui/context-menu'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu'

interface FileActionsMenuProps {
  file: RemoteFile
  onDownload: (file: RemoteFile) => void
  onRename: (file: RemoteFile) => void
  onMove: (file: RemoteFile) => void
  onDuplicate: (file: RemoteFile) => void
  onPermissions: (file: RemoteFile) => void
  onDelete: (file: RemoteFile) => void
}

function FileActionItems({
  file, onDownload, onRename, onMove, onDuplicate, onPermissions, onDelete, context = false,
}: FileActionsMenuProps & { context?: boolean }) {
  const copyPath = () => navigator.clipboard?.writeText(file.path)
  const MenuItem = context ? ContextMenuItem : DropdownMenuItem
  const MenuSeparator = context ? ContextMenuSeparator : DropdownMenuSeparator

  return (
    <>
      <MenuItem disabled={file.kind === 'folder'} onSelect={() => onDownload(file)}><Download /><span>Baixar</span></MenuItem>
      <MenuItem onSelect={() => onRename(file)}><FilePenLine /><span>Renomear</span></MenuItem>
      <MenuItem onSelect={() => onMove(file)}><FolderInput /><span>Mover para…</span></MenuItem>
      <MenuItem onSelect={() => onDuplicate(file)}><Copy /><span>Duplicar</span></MenuItem>
      <MenuItem onSelect={copyPath}><Link2 /><span>Copiar caminho</span></MenuItem>
      <MenuItem onSelect={() => onPermissions(file)}><ShieldCheck /><span>Alterar permissões</span></MenuItem>
      <MenuSeparator />
      <MenuItem destructive onSelect={() => onDelete(file)}><Trash2 /><span>Excluir</span></MenuItem>
    </>
  )
}

export function FileActionsMenu(props: FileActionsMenuProps) {
  const { file } = props
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="row-menu" type="button" aria-label={`Ações para ${file.name}`}><Ellipsis size={18} /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={12}>
        <FileActionItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function FileContextMenu({ children, ...props }: FileActionsMenuProps & { children: ReactElement }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="file-context-trigger" role="presentation">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent collisionPadding={12}>
        <FileActionItems {...props} context />
      </ContextMenuContent>
    </ContextMenu>
  )
}
