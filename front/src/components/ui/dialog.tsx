import type { ComponentProps } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger

export function DialogContent({ className = '', ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="shadcn-dialog-overlay" data-slot="dialog-overlay" />
      <DialogPrimitive.Content
        className={`shadcn-dialog-content ${className}`.trim()}
        data-slot="dialog-content"
        {...props}
      />
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className = '', ...props }: ComponentProps<'div'>) {
  return <div className={`shadcn-dialog-header ${className}`.trim()} data-slot="dialog-header" {...props} />
}

export function DialogFooter({ className = '', ...props }: ComponentProps<'div'>) {
  return <div className={`shadcn-dialog-footer ${className}`.trim()} data-slot="dialog-footer" {...props} />
}

export function DialogTitle({ className = '', ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={`shadcn-dialog-title ${className}`.trim()} data-slot="dialog-title" {...props} />
}

export function DialogDescription({ className = '', ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={`shadcn-dialog-description ${className}`.trim()} data-slot="dialog-description" {...props} />
}

export function DialogClose({ className = '', ...props }: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close className={`shadcn-dialog-button secondary ${className}`.trim()} data-slot="dialog-close" {...props} />
}
