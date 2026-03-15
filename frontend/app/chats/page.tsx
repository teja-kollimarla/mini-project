'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageCircle, Plus, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DashboardLayout } from '@/components/dashboard-layout'
import { listChats, createChat } from '@/lib/api'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: 'easeOut' },
  },
}

type ChatRow = { id: string; title: string | null; created_at: string; updated_at: string }

export default function ChatsPage() {
  const [chats, setChats] = useState<ChatRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const router = useRouter()

  useEffect(() => {
    listChats()
      .then(setChats)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load chats'))
      .finally(() => setLoading(false))
  }, [])

  const handleNewChat = async () => {
    setCreating(true)
    try {
      const chat = await createChat()
      router.push(`/chats/${chat.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create chat')
    } finally {
      setCreating(false)
    }
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`
    return d.toLocaleDateString()
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Loading chats...</span>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <motion.div
        className="max-w-4xl space-y-8"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Header */}
        <motion.div
          className="flex items-center justify-between"
          variants={itemVariants}
        >
          <div>
            <h1 className="text-3xl font-bold mb-2">Chats</h1>
            <p className="text-muted-foreground">Conversations with your video content</p>
          </div>
          <Button className="gap-2" onClick={handleNewChat} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            New Chat
          </Button>
        </motion.div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Chats List */}
        <motion.div
          className="space-y-3"
          variants={containerVariants}
        >
          {chats.map((chat) => (
            <motion.div
              key={chat.id}
              variants={itemVariants}
              whileHover={{ x: 4 }}
            >
              <Link href={`/chats/${chat.id}`}>
                <Card className="p-6 hover:border-primary/50 transition-all duration-300 cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg mb-2">{chat.title || 'Untitled chat'}</h3>
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>{formatTime(chat.updated_at)}</span>
                      </div>
                    </div>
                    <MessageCircle className="h-5 w-5 text-primary opacity-50 ml-4" />
                  </div>
                </Card>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </DashboardLayout>
  )
}
