'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Radio, X } from 'lucide-react'
import EngineerChat from './EngineerChat'

export default function EngineerDock() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
            className="glass-strong"
            style={{
              position: 'fixed',
              bottom: '150px',
              right: '20px',
              width: '360px',
              height: '480px',
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: 'calc(100vh - 180px)',
              zIndex: 60,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              padding: 0,
            }}
          >
            <EngineerChat compact />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setOpen(v => !v)}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        style={{
          position: 'fixed',
          bottom: '90px',
          right: '20px',
          zIndex: 60,
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.14)',
          background: open ? 'rgba(20,20,20,0.9)' : 'var(--accent)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: open
            ? '0 8px 24px rgba(0,0,0,0.5)'
            : '0 8px 24px rgba(225,6,0,0.45), 0 0 0 1px rgba(225,6,0,0.3)',
        }}
        aria-label={open ? 'Close race engineer' : 'Open race engineer'}
        title="Box Box — Race Engineer"
      >
        {open ? <X size={20} /> : <Radio size={20} />}
      </motion.button>
    </>
  )
}
