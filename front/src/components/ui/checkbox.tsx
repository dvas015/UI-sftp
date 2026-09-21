import type { ComponentProps } from 'react'
import { Check, Minus } from 'lucide-react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'

export function Checkbox({ className = '', checked, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={`shadcn-checkbox ${className}`.trim()}
      checked={checked}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator className="shadcn-checkbox-indicator" data-slot="checkbox-indicator">
        {checked === 'indeterminate' ? <Minus aria-hidden="true" /> : <Check aria-hidden="true" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
