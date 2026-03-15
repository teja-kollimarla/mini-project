'use client'

import { useState, useRef, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Send, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getChat, addChatMessage, retrieve } from '@/lib/api'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: 'easeOut' },
  },
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export default function ChatPage() {
  const params = useParams()
  const chatId = params?.id as string
  const [chat, setChat] = useState<{ id: string; title: string | null; messages: Message[] } | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chatId) return
    getChat(chatId)
      .then((c) => setChat({ id: c.id, title: c.title, messages: c.messages as Message[] }))
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load chat'))
  }, [chatId])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [chat?.messages])

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim() || !chatId || !chat) return

    const content = inputValue.trim()
    setInputValue('')
    setIsLoading(true)

    try {
      await addChatMessage(chatId, 'user', content)
      const res = await retrieve(content)
      const reply = res.chunks?.length
        ? res.chunks.map((c) => `[${c.document_name}] ${c.text}`).join('\n\n')
        : 'No matching segments found in your videos.'
      await addChatMessage(chatId, 'assistant', reply)
      const updated = await getChat(chatId)
      setChat((prev) => (prev ? { ...prev, messages: updated.messages as Message[] } : null))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setIsLoading(false)
    }
  }

  if (loadError && !chat) {
    return (
      <DashboardLayout>
        <p className="text-destructive py-8">{loadError}</p>
      </DashboardLayout>
    )
  }

  if (!chat) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Loading chat...</span>
        </div>
      </DashboardLayout>
    )
  }

  const messages = chat.messages

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-140px)] flex flex-col max-w-4xl">
        {/* Chat Header */}
        <motion.div
          className="mb-6 pb-4 border-b border-border"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-2xl font-bold">{chat.title || 'Chat'}</h1>
          <p className="text-sm text-muted-foreground">Ask about your videos — answers are from your indexed content</p>
        </motion.div>

        {/* Messages */}
        <motion.div
          className="flex-1 overflow-y-auto space-y-4 mb-6 pr-4"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {messages.map((message) => (
            <motion.div
              key={message.id}
              variants={itemVariants}
              className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.role === 'assistant' && (
                <div className="flex-shrink-0">
                  <Avatar className="h-8 w-8 bg-primary/20">
                    <AvatarFallback className="text-xs font-semibold">AI</AvatarFallback>
                  </Avatar>
                </div>
              )}

              <div
                className={`max-w-md lg:max-w-xl ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-lg rounded-tr-none'
                    : 'bg-card border border-border rounded-lg rounded-tl-none'
                } p-4`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                <p className={`text-xs mt-2 ${
                  message.role === 'user'
                    ? 'text-primary-foreground/70'
                    : 'text-muted-foreground'
                }`}>
                  {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>

              {message.role === 'user' && (
                <div className="flex-shrink-0">
                  <Avatar className="h-8 w-8 bg-accent/20">
                    <AvatarFallback className="text-xs font-semibold">You</AvatarFallback>
                  </Avatar>
                </div>
              )}
            </motion.div>
          ))}

          {isLoading && (
            <motion.div
              variants={itemVariants}
              className="flex gap-3 justify-start"
            >
              <div className="flex-shrink-0">
                <Avatar className="h-8 w-8 bg-primary/20">
                  <AvatarFallback className="text-xs font-semibold">AI</AvatarFallback>
                </Avatar>
              </div>
              <div className="bg-card border border-border rounded-lg rounded-tl-none p-4">
                <div className="flex gap-2 items-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Thinking...</span>
                </div>
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </motion.div>

        {loadError && <p className="text-sm text-destructive mb-4">{loadError}</p>}

        {/* Input */}
        <motion.form
          onSubmit={handleSendMessage}
          className="flex gap-2"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Input
            placeholder="Ask something about your videos..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading}
            className="bg-background border-border"
          />
          <Button
            type="submit"
            disabled={!inputValue.trim() || isLoading}
            size="icon"
            className="gap-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </motion.form>
      </div>
    </DashboardLayout>
  )
}
