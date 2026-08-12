import { useEffect, useRef } from 'react'

interface ModalProps {
  children: React.ReactNode
  onClose: () => void
  width?: number
  height?: number
  label?: string
}

export function Modal({ children, onClose, width = 440, height, label }: ModalProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    ref.current?.querySelector<HTMLElement>('input, textarea, select')?.focus()
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-label={label}
      style={{
        position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, padding: '32px'
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={ref}
        style={{
          background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
          width: `${width}px`, maxWidth: '100%', maxHeight: '100%',
          height: height ? `${height}px` : undefined,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: 'var(--font-mono)', animation: 'modalIn 220ms ease'
        }}
      >
        {children}
      </div>
    </div>
  )
}
