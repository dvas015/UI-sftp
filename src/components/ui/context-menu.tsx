import type { ComponentProps } from 'react'
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui'

export const ContextMenu = ContextMenuPrimitive.Root
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger

export function ContextMenuContent({ className = '', ...props }: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={`shadcn-dropdown-content ${className}`.trim()}
        data-slot="context-menu-content"
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

export function ContextMenuItem({ className = '', destructive = false, ...props }: ComponentProps<typeof ContextMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <ContextMenuPrimitive.Item
      className={`shadcn-dropdown-item ${destructive ? 'destructive' : ''} ${className}`.trim()}
      data-slot="context-menu-item"
      {...props}
    />
  )
}

export function ContextMenuSeparator({ className = '', ...props }: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={`shadcn-dropdown-separator ${className}`.trim()} data-slot="context-menu-separator" {...props} />
}
