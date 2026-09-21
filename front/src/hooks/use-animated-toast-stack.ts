import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnimatedToast, ToastInput } from '../components/ui/animated-toast-stack'

interface UseAnimatedToastStackOptions {
  defaultDuration?: number
  limit?: number
}

let toastSequence = 0

function createToast(input: ToastInput, defaultDuration: number): AnimatedToast {
  return {
    duration: defaultDuration,
    dismissible: true,
    ...input,
    id: input.id ?? `toast-${Date.now()}-${toastSequence++}`,
    createdAt: Date.now(),
  }
}

export function useAnimatedToastStack({ defaultDuration = 4200, limit = 8 }: UseAnimatedToastStackOptions = {}) {
  const timers = useRef<Map<string, { timer: number; signature: string }>>(new Map())
  const [toasts, setToasts] = useState<AnimatedToast[]>([])

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showToast = useCallback((input: ToastInput) => {
    const toast = createToast(input, defaultDuration)
    setToasts((current) => [...current, toast].slice(-limit))
    return toast.id
  }, [defaultDuration, limit])

  const updateToast = useCallback((id: string, patch: Partial<ToastInput>) => {
    setToasts((current) => current.map((toast) => toast.id === id ? {
      ...toast,
      ...patch,
      id,
      createdAt: patch.duration === undefined ? toast.createdAt : Date.now(),
    } : toast))
  }, [])

  useEffect(() => {
    const activeIds = new Set(toasts.map((toast) => toast.id))
    timers.current.forEach((entry, id) => {
      if (activeIds.has(id)) return
      window.clearTimeout(entry.timer)
      timers.current.delete(id)
    })

    toasts.forEach((toast) => {
      const duration = toast.duration ?? defaultDuration
      const existing = timers.current.get(toast.id)
      if (duration <= 0) {
        if (existing) window.clearTimeout(existing.timer)
        timers.current.delete(toast.id)
        return
      }

      const signature = `${toast.createdAt}:${duration}`
      if (existing?.signature === signature) return
      if (existing) window.clearTimeout(existing.timer)
      const elapsed = Date.now() - (toast.createdAt ?? Date.now())
      const timer = window.setTimeout(() => dismissToast(toast.id), Math.max(duration - elapsed, 0))
      timers.current.set(toast.id, { timer, signature })
    })
  }, [defaultDuration, dismissToast, toasts])

  useEffect(() => {
    const activeTimers = timers.current
    return () => {
      activeTimers.forEach(({ timer }) => window.clearTimeout(timer))
      activeTimers.clear()
    }
  }, [])

  return useMemo(() => ({ toasts, showToast, updateToast, dismissToast }), [dismissToast, showToast, toasts, updateToast])
}
