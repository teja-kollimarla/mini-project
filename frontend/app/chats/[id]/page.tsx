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
import { getChat, addChatMessage, retrieve, createChunk, clipPlayUrl } from '@/lib/api'

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

/** Assistant message can store rich content: { text, chunk_refs } for "Watch segment" links */
interface AssistantContent {
  text: string
  chunk_refs?: Array< { document_name: string; start_time: number; end_time: number } >
}

function parseAssistantContent(content: string): { text: string; chunk_refs?: AssistantContent['chunk_refs'] } | null {
  try {
    const parsed = JSON.parse(content) as AssistantContent
    if (typeof parsed?.text === 'string') return parsed
  } catch {
    /* plain text */
  }
  return null
}

type RetrieveChunk = {
  text: string
  document_name: string
  start_time?: number
  end_time?: number
  display_text?: string
  video_description?: string
  audio_transcript?: string
}

/** Build a readable chat reply from RAG chunks (no raw JSON). */
function buildChatReplyFromChunks(chunks: RetrieveChunk[]): string {
  const parts: string[] = []
  const seen = new Set<string>()
  for (const c of chunks) {
    let content =
      c.display_text ||
      c.video_description ||
      (c.audio_transcript && c.audio_transcript.length > 500 ? c.audio_transcript.slice(0, 500) + '...' : c.audio_transcript) ||
      (c.text && !c.text.trim().startsWith('{') ? c.text : '')
    // If still empty, chunk.text might be the JSON blob — parse it
    if (!content.trim() && c.text?.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(c.text) as { video_description?: string; audio_transcript?: string }
        content = (parsed.video_description || parsed.audio_transcript || '').slice(0, 800)
        if ((parsed.audio_transcript?.length ?? 0) > 800) content += '...'
      } catch {
        content = c.text.slice(0, 600) + (c.text.length > 600 ? '...' : '')
      }
    }
    if (!content.trim()) continue
    const timeRange =
      c.start_time != null && c.end_time != null
        ? ` (${Math.floor(c.start_time)}s–${Math.floor(c.end_time)}s)`
        : ''
    const key = `${c.document_name}:${content.slice(0, 100)}`
    if (seen.has(key)) continue
    seen.add(key)
    parts.push(`**From ${c.document_name}**${timeRange}:\n\n${content.trim()}`)
  }
  if (parts.length === 0) return 'No matching segments found in your videos.'
  return parts.join('\n\n---\n\n')
}

export default function ChatPage() {
  const params = useParams()
  const chatId = params?.id as string
  const [chat, setChat] = useState<{ id: string; title: string | null; messages: Message[] } | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clippingSegment, setClippingSegment] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const handleWatchSegment = async (doc: string, start: number, end: number) => {
    const key = `${doc}:${start}-${end}`
    setClippingSegment(key)
    try {
      const res = await createChunk(doc, start, end)
      if (res.url?.startsWith('http')) window.open(res.url, '_blank')
      else if (res.filename) window.open(clipPlayUrl(res.filename), '_blank')
    } catch {
      setLoadError('Failed to create clip')
    } finally {
      setClippingSegment(null)
    }
  }

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
        ? buildChatReplyFromChunks(res.chunks)
        : 'No matching segments found in your videos.'
      const chunk_refs = (res.chunks ?? [])
        .filter((c) => c.start_time != null && c.end_time != null)
        .map((c) => ({
          document_name: c.document_name,
          start_time: c.start_time!,
          end_time: c.end_time!,
        }))
      const assistantContent =
        chunk_refs.length > 0
          ? JSON.stringify({ text: reply, chunk_refs })
          : reply
      await addChatMessage(chatId, 'assistant', assistantContent)
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
                {message.role === 'assistant' ? (() => {
                  const parsed = parseAssistantContent(message.content)
                  const displayText = parsed?.text ?? message.content
                  const refs = parsed?.chunk_refs ?? []
                  return (
                    <>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{displayText}</p>
                      {refs.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Watch segments:</p>
                          <div className="flex flex-wrap gap-2">
                            {refs.map((r, i) => {
                              const key = `${r.document_name}:${r.start_time}-${r.end_time}`
                              const label = `${Math.floor(r.start_time)}s–${Math.floor(r.end_time)}s`
                              const isClipping = clippingSegment === key
                              return (
                                <Button
                                  key={key + i}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="text-xs"
                                  disabled={isClipping}
                                  onClick={() => handleWatchSegment(r.document_name, r.start_time, r.end_time)}
                                >
                                  {isClipping ? (
                                    <>
                                      <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                                      Creating…
                                    </>
                                  ) : (
                                    <>▶ {label}</>
                                  )}
                                </Button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      <p className="text-xs mt-2 text-muted-foreground">
                        {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </>
                  )
                })() : (
                  <>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                    <p className="text-xs mt-2 text-primary-foreground/70">
                      {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </>
                )}
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
