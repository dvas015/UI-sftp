import type { ComponentProps } from 'react'
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'

export const AlertDialog = AlertDialogPrimitive.Root
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger

export function AlertDialogContent({ className = '', ...props }: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="shadcn-alert-dialog-overlay" data-slot="alert-dialog-overlay" />
      <AlertDialogPrimitive.Content
        className={`shadcn-alert-dialog-content ${className}`.trim()}
        data-slot="alert-dialog-content"
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  )
}

export function AlertDialogHeader({ className = '', ...props }: ComponentProps<'div'>) {
  return <div className={`shadcn-alert-dialog-header ${className}`.trim()} data-slot="alert-dialog-header" {...props} />
}

export function AlertDialogFooter({ className = '', ...props }: ComponentProps<'div'>) {
  return <div className={`shadcn-alert-dialog-footer ${className}`.trim()} data-slot="alert-dialog-footer" {...props} />
}

export function AlertDialogTitle({ className = '', ...props }: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return <AlertDialogPrimitive.Title className={`shadcn-alert-dialog-title ${className}`.trim()} data-slot="alert-dialog-title" {...props} />
}

export function AlertDialogDescription({ className = '', ...props }: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return <AlertDialogPrimitive.Description className={`shadcn-alert-dialog-description ${className}`.trim()} data-slot="alert-dialog-description" {...props} />
}

export function AlertDialogAction({ className = '', ...props }: ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return <AlertDialogPrimitive.Action className={`shadcn-alert-dialog-button primary ${className}`.trim()} data-slot="alert-dialog-action" {...props} />
}

export function AlertDialogCancel({ className = '', ...props }: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return <AlertDialogPrimitive.Cancel className={`shadcn-alert-dialog-button secondary ${className}`.trim()} data-slot="alert-dialog-cancel" {...props} />
}
