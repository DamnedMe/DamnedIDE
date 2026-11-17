// Shared look of the remote access settings (RemotePanel, PairingCard).
export const SURFACE = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 12px'
} as const

const BTN = {
  display: 'flex',
  alignItems: 'center',
  gap: '5px',
  padding: '5px 12px',
  height: '28px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 'calc(10px * var(--ui-text-scale, 1))',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600
} as const

export function PrimaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{
        ...BTN,
        background: rest.disabled ? 'var(--bg-subtle)' : 'var(--accent-color)',
        border: 'none',
        color: rest.disabled ? 'var(--text-muted)' : 'var(--text-inverse)',
        cursor: rest.disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {children}
    </button>
  )
}

export function GhostButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{
        ...BTN,
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border-color)',
        color: 'var(--text-secondary)',
        cursor: rest.disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {children}
    </button>
  )
}
