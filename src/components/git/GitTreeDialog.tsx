import { AlertTriangle, Download, FolderSearch } from 'lucide-react'
import { Modal } from '../layout/Modal'
import { useSettingsStore } from '../../store'
import { useI18n } from '../../i18n'

interface GitTreeDialogProps {
  downloadUrl: string
  // called after the user picked the executable (already saved in settings)
  onRetry: () => void
  onClose: () => void
}

// GitTree was not found in the known install locations: download it, or locate
// the executable once (persisted in settings.gitTreePath, detection skips it next time).
export function GitTreeDialog({ downloadUrl, onRetry, onClose }: GitTreeDialogProps) {
  const t = useI18n()

  const locate = async () => {
    const filters = window.electronAPI.platform === 'win32'
      ? [{ name: 'GitTree', extensions: ['exe'] }]
      // Linux AppImages and plain binaries have no extension
      : [{ name: 'All files', extensions: ['*'] }]
    const picked = await window.electronAPI.dialog.openFile(t('select the GitTree executable'), filters).catch(() => null)
    if (!picked) return
    useSettingsStore.getState().updateSettings({ gitTreePath: picked })
    onRetry()
  }

  const btn = (primary: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', height: '26px',
    background: primary ? 'var(--accent-color)' : 'var(--bg-card)',
    border: primary ? 'none' : '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
    color: primary ? 'var(--text-inverse)' : 'var(--text-secondary)', cursor: 'pointer',
    fontSize: 'calc(11px * var(--ui-text-scale, 1))', fontFamily: 'var(--font-mono)', fontWeight: 600
  })

  return (
    <Modal onClose={onClose} width={460} label="GitTree not found">
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertTriangle size={16} style={{ color: 'var(--warning-color)', flexShrink: 0 }} />
          <span style={{ fontSize: 'calc(13px * var(--ui-text-scale, 1))', fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('GitTree not found')}
          </span>
        </div>
        <div style={{ fontSize: 'calc(11px * var(--ui-text-scale, 1))', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {t('the Git entry opens the repository in GitTree, which is not installed in the usual locations. Download it, or locate it if it is installed elsewhere: the choice is remembered.')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} style={btn(false)}>{t('cancel')}</button>
          <button onClick={() => { void window.electronAPI.shell.openExternal(downloadUrl).catch(() => {}); onClose() }}
            title={t('download GitTree')} data-tip-desc={downloadUrl} style={btn(false)}>
            <Download size={11} /> {t('download GitTree')}
          </button>
          <button onClick={() => { void locate() }}
            title={t('locate GitTree…')} data-tip-desc="pick the GitTree executable; it is remembered for the next time" style={btn(true)}>
            <FolderSearch size={11} /> {t('locate GitTree…')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
