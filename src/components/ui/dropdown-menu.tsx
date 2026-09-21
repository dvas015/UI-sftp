import type { ComponentProps } from 'react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

export function DropdownMenuContent({ className = '', sideOffset = 6, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={`shadcn-dropdown-content ${className}`.trim()}
        sideOffset={sideOffset}
        data-slot="dropdown-menu-content"
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuLabel({ className = '', ...props }: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={`shadcn-dropdown-label ${className}`.trim()} data-slot="dropdown-menu-label" {...props} />
}

export function DropdownMenuItem({ className = '', destructive = false, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={`shadcn-dropdown-item ${destructive ? 'destructive' : ''} ${className}`.trim()}
      data-slot="dropdown-menu-item"
      {...props}
    />
  )
}

export function DropdownMenuSeparator({ className = '', ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={`shadcn-dropdown-separator ${className}`.trim()} data-slot="dropdown-menu-separator" {...props} />
}
