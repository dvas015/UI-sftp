import { useState } from 'react'
import { ConnectionModal } from './components/ConnectionModal'
import { FileManager } from './components/FileManager'
import './App.css'

function App() {
  const [connectionOpen, setConnectionOpen] = useState(
    () => new URLSearchParams(window.location.search).get('modal') === '1',
  )

  return (
    <>
      <FileManager onOpenConnection={() => setConnectionOpen(true)} />
      <ConnectionModal open={connectionOpen} onClose={() => setConnectionOpen(false)} />
    </>
  )
}

export default App
