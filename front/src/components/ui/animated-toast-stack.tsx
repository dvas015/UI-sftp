// Adaptado de https://beui.dev/components/motion/animated-toast-stack (MIT).
import { AlertCircle, Bell, Check, Info, LoaderCircle, X, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { memo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ToastStatus = 'neutral' | 'info' | 'loading' | 'success' | 'error'

export interface AnimatedToast {
  id: string
  title: ReactNode
  description?: ReactNode
  status?: ToastStatus
  duration?: number
  dismissible?: boolean
  createdAt?: number
}

export type ToastInput = Omit<AnimatedToast, 'id' | 'createdAt'> & { id?: string }

interface AnimatedToastStackProps {
  toasts: AnimatedToast[]
  onDismiss: (id: string) => void
  maxVisible?: number
}

const STACK_SPRING: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.75 }
const EASE_OUT = [0.16, 1, 0.3, 1] as const

const statusIcons: Record<ToastStatus, LucideIcon> = {
  neutral: Bell,
  info: Info,
  loading: LoaderCircle,
  success: Check,
  error: AlertCircle,
}

export function AnimatedToastStack({ toasts, onDismiss, maxVisible = 4 }: AnimatedToastStackProps) {
  const portalTarget = typeof document === 'undefined' ? null : document.body
  if (!portalTarget) return null

  return createPortal(
    <ol className="animated-toast-stack" aria-label="Notificações" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false} mode="popLayout">
        {toasts.slice(-maxVisible).map((toast, index) => (
          <ToastItem toast={toast} index={index} onDismiss={onDismiss} key={toast.id} />
        ))}
      </AnimatePresence>
    </ol>,
    portalTarget,
  )
}

const ToastItem = memo(function ToastItem({ toast, index, onDismiss }: {
  toast: AnimatedToast
  index: number
  onDismiss: (id: string) => void
}) {
  const reduceMotion = useReducedMotion()
  const status = toast.status ?? 'neutral'
  const StatusIcon = statusIcons[status]
  const canDismiss = toast.dismissible !== false

  return (
    <motion.li
      layout
      className="animated-toast-item"
      style={{ zIndex: 20 - index }}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 22, scale: 0.96, filter: 'blur(10px)' }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 32, scale: 0.96, filter: 'blur(8px)', transition: { duration: 0.18, ease: EASE_OUT } }}
      transition={STACK_SPRING}
      drag={canDismiss && !reduceMotion ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.18}
      onDragEnd={(_, info) => {
        if (canDismiss && (Math.abs(info.offset.x) > 72 || Math.abs(info.velocity.x) > 520)) onDismiss(toast.id)
      }}
    >
      <div className={`animated-toast-surface ${status}`}>
        <motion.span layout className="animated-toast-icon" aria-hidden="true">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              className={status === 'loading' ? 'animated-toast-spinner' : undefined}
              key={status}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.8, filter: 'blur(6px)' }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.9, filter: 'blur(6px)' }}
              transition={{ duration: 0.28, ease: EASE_OUT }}
            ><StatusIcon size={15} /></motion.span>
          </AnimatePresence>
        </motion.span>

        <div className="animated-toast-content">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={`${toast.id}-${status}-${String(toast.title)}`}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(6px)' }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, filter: 'blur(6px)' }}
              transition={{ duration: 0.28, ease: EASE_OUT }}
            >
              <strong>{toast.title}</strong>
              {toast.description && <p>{toast.description}</p>}
            </motion.div>
          </AnimatePresence>
        </div>

        {canDismiss && (
          <button type="button" className="animated-toast-close" aria-label="Fechar notificação" onClick={() => onDismiss(toast.id)}>
            <X size={14} />
          </button>
        )}
      </div>
    </motion.li>
  )
})
