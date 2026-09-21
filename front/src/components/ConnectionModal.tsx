import { useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff, Globe, KeyRound, LogIn, Network, Save, Server, ShieldCheck, UserRound, X } from 'lucide-react'
import type { Connection, ConnectionCreateInput, ConnectionUpdateInput } from '../api'

export type ConnectionModalMode = 'create' | 'edit' | 'reconnect'
type RequiredField = 'host' | 'port' | 'username' | 'password'

interface ConnectionModalProps {
  open: boolean
  mode: ConnectionModalMode
  connection?: Connection
  onClose: () => void
  onSubmit: (payload: ConnectionCreateInput | ConnectionUpdateInput) => Promise<void>
}

function formatIPv4Input(value: string) {
  const octets = ['']

  for (const character of value.replace(/[^\d.]/g, '')) {
    const lastIndex = octets.length - 1
    if (character === '.') {
      if (octets[lastIndex] && octets.length < 4) octets.push('')
      continue
    }
    if (octets[lastIndex].length === 3) {
      if (octets.length === 4) break
      octets.push(character)
    } else {
      octets[lastIndex] += character
    }
  }

  return octets.join('.')
}

function isValidIPv4(value: string) {
  const octets = value.split('.')
  return octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
}

export function ConnectionModal({ open, mode, connection, onClose, onSubmit }: ConnectionModalProps) {
  const [name, setName] = useState(connection?.name || '')
  const [host, setHost] = useState(connection?.host || '')
  const [port, setPort] = useState(String(connection?.port || 22))
  const [username, setUsername] = useState(connection?.username || '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()
  const [invalidFields, setInvalidFields] = useState<Set<RequiredField>>(() => new Set())

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && !submitting && onClose()
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, submitting])

  if (!open) return null

  const title = mode === 'create' ? 'Conectar ao servidor SFTP' : mode === 'edit' ? 'Editar servidor SFTP' : 'Reconectar ao servidor SFTP'
  const action = mode === 'create' ? 'Conectar' : mode === 'edit' ? 'Salvar' : 'Reconectar'
  const pendingAction = mode === 'create' ? 'Conectando…' : mode === 'edit' ? 'Salvando…' : 'Reconectando…'
  const ActionIcon = mode === 'edit' ? Save : LogIn

  function clearInvalidField(field: RequiredField) {
    setInvalidFields((current) => {
      if (!current.has(field)) return current
      const next = new Set(current)
      next.delete(field)
      return next
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)

    const invalid = new Set<RequiredField>()
    if (mode !== 'reconnect') {
      if (!isValidIPv4(host.trim())) invalid.add('host')
      const numericPort = Number(port)
      if (!port.trim() || numericPort < 1 || numericPort > 65535) invalid.add('port')
      if (!username.trim()) invalid.add('username')
    }
    if (mode !== 'edit' && !password) invalid.add('password')

    setInvalidFields(invalid)
    if (invalid.size > 0) {
      const firstInvalid = invalid.values().next().value
      const form = event.currentTarget
      if (firstInvalid) {
        window.requestAnimationFrame(() => {
          (form.elements.namedItem(firstInvalid) as HTMLInputElement | null)?.focus()
        })
      }
      return
    }

    setSubmitting(true)
    try {
      if (mode === 'reconnect') {
        await onSubmit({ password })
      } else {
        const payload: ConnectionCreateInput | ConnectionUpdateInput = {
          name: name.trim() || host.trim(),
          host: host.trim(),
          port: Number(port),
          username: username.trim(),
          ...(password ? { password } : {}),
        }
        await onSubmit(payload)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível concluir a conexão.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => !submitting && onClose()}>
      <section className="connection-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <span className="modal-symbol"><Server size={20} /></span>
          <span className="modal-heading">
            <strong id="connection-title">{title}</strong>
            <small>{mode === 'reconnect' ? 'Informe novamente a senha da conta.' : 'Informe os dados do servidor remoto.'}</small>
          </span>
          <button className="icon-button close-button" type="button" aria-label="Fechar" disabled={submitting} onClick={onClose}><X size={17} /></button>
        </header>
        <div className="modal-divider" />

        <form className="connection-form" noValidate onSubmit={handleSubmit}>
          {mode === 'reconnect' ? (
            <div className="connection-summary"><Server size={16} /><span><strong>{connection?.name}</strong><small>{connection?.username}@{connection?.host}:{connection?.port}</small></span></div>
          ) : <>
            <label className="field">
              <span>Nome da conexão</span>
              <span className="input-shell"><Server size={16} /><input value={name} maxLength={48} placeholder="Servidor de produção" onChange={(event) => setName(event.target.value)} /></span>
            </label>
            <label className="field">
              <span>Host</span>
              <span className={`input-shell ${invalidFields.has('host') ? 'input-shell-invalid' : ''}`}><Globe size={16} /><input name="host" value={host} required aria-invalid={invalidFields.has('host')} maxLength={15} inputMode="decimal" placeholder="192.168.1.100" onChange={(event) => { setHost(formatIPv4Input(event.target.value)); clearInvalidField('host') }} /></span>
            </label>
            <div className="field-row">
              <label className="field port-field">
                <span>Porta</span>
                <span className={`input-shell ${invalidFields.has('port') ? 'input-shell-invalid' : ''}`}><Network size={16} /><input name="port" value={port} required aria-invalid={invalidFields.has('port')} type="number" min="1" max="65535" placeholder="22" onChange={(event) => { setPort(event.target.value); clearInvalidField('port') }} /></span>
              </label>
              <label className="field">
                <span>Usuário</span>
                <span className={`input-shell ${invalidFields.has('username') ? 'input-shell-invalid' : ''}`}><UserRound size={16} /><input name="username" value={username} required aria-invalid={invalidFields.has('username')} maxLength={255} placeholder="usuario_sftp" onChange={(event) => { setUsername(event.target.value); clearInvalidField('username') }} /></span>
              </label>
            </div>
          </>}
          <label className="field">
            <span>Senha {mode === 'edit' && <small className="field-help">(deixe vazia para manter)</small>}</span>
            <span className={`input-shell ${invalidFields.has('password') ? 'input-shell-invalid' : ''}`}>
              <KeyRound size={16} />
              <input name="password" value={password} required={mode !== 'edit'} aria-invalid={invalidFields.has('password')} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder={mode === 'edit' ? 'Digite apenas para alterar' : 'Senha da conta SFTP'} onChange={(event) => { setPassword(event.target.value); clearInvalidField('password') }} />
              <button className="password-toggle" type="button" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </span>
          </label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="security-notice"><ShieldCheck size={16} /><span>A conexão SFTP usa SSH. Sua senha não é gravada em disco.</span></div>
          <footer className="modal-actions">
            <button className="secondary-button" type="button" disabled={submitting} onClick={onClose}>Cancelar</button>
            <button className="primary-button connect-button" type="submit" disabled={submitting}><ActionIcon size={16} /> {submitting ? pendingAction : action}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
