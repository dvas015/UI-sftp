import { useEffect, useState } from 'react'
import { Eye, EyeOff, Globe, KeyRound, Network, PlugZap, Server, ShieldCheck, UserRound, X } from 'lucide-react'

interface ConnectionModalProps {
  open: boolean
  onClose: () => void
}

export function ConnectionModal({ open, onClose }: ConnectionModalProps) {
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <span className="modal-symbol"><Server size={20} /></span>
          <span className="modal-heading">
            <strong id="connection-title">Conectar ao servidor SFTP</strong>
            <small>Informe as credenciais do servidor remoto.</small>
          </span>
          <button className="icon-button close-button" type="button" aria-label="Fechar" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="modal-divider" />

        <form className="connection-form" onSubmit={(event) => { event.preventDefault(); onClose() }}>
          <label className="field">
            <span>Host</span>
            <span className="input-shell input-shell-active"><Globe size={16} /><input defaultValue="files.acme.io" aria-label="Host" /></span>
          </label>
          <div className="field-row">
            <label className="field port-field">
              <span>Porta</span>
              <span className="input-shell"><Network size={16} /><input defaultValue="22" inputMode="numeric" aria-label="Porta" /></span>
            </label>
            <label className="field">
              <span>Usuário</span>
              <span className="input-shell"><UserRound size={16} /><input defaultValue="deploy" aria-label="Usuário" /></span>
            </label>
          </div>
          <label className="field">
            <span>Senha</span>
            <span className="input-shell">
              <KeyRound size={16} />
              <input defaultValue="sftp-session" type={showPassword ? 'text' : 'password'} aria-label="Senha" />
              <button className="password-toggle" type="button" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </span>
          </label>
          <div className="security-notice"><ShieldCheck size={16} /><span>As credenciais serão mantidas somente durante esta sessão.</span></div>
          <footer className="modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
            <button className="primary-button connect-button" type="submit"><PlugZap size={16} /> Conectar</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
