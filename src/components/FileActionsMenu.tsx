import {
  Copy, Download, Ellipsis, FilePenLine, FolderInput, Link2, ShieldCheck, Trash2,
} from 'lucide-react'
import type { ReactElement } from 'react'
import type { RemoteFile } from '../mockData'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from './ui/context-menu'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu'

interface FileActionsMenuProps {
  file: RemoteFile
}

function FileActionItems({ file, context = false }: FileActionsMenuProps & { context?: boolean }) {
  const copyPath = () => navigator.clipboard?.writeText(`/diretório/atual/app/${file.name}`)
  const MenuItem = context ? ContextMenuItem : DropdownMenuItem
  const MenuSeparator = context ? ContextMenuSeparator : DropdownMenuSeparator

  return (
    <>
      <MenuItem><Download /><span>Baixar</span></MenuItem>
      <MenuItem><FilePenLine /><span>Renomear</span></MenuItem>
      <MenuItem><FolderInput /><span>Mover para…</span></MenuItem>
      <MenuItem><Copy /><span>Duplicar</span></MenuItem>
      <MenuItem onSelect={copyPath}><Link2 /><span>Copiar caminho</span></MenuItem>
      <MenuItem><ShieldCheck /><span>Alterar permissões</span></MenuItem>
      <MenuSeparator />
      <MenuItem destructive><Trash2 /><span>Excluir</span></MenuItem>
    </>
  )
}

export function FileActionsMenu({ file }: FileActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="row-menu" type="button" aria-label={`Ações para ${file.name}`}><Ellipsis size={18} /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={12}>
        <FileActionItems file={file} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function FileContextMenu({ file, children }: FileActionsMenuProps & { children: ReactElement }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="file-context-trigger" role="presentation">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent collisionPadding={12}>
        <FileActionItems file={file} context />
      </ContextMenuContent>
    </ContextMenu>
  )
}
