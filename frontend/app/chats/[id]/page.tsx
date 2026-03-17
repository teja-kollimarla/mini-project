'use client'

import { useState, useRef, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { Send, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getChat, addChatMessage, retrieve, createChunk, clipPlayUrl, updateChat } from '@/lib/api'
import DOMPurify from 'dompurify'
import type QuillNamespace from 'quill'

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

/** Assistant message can store rich content: { text/html, chunk_refs } for "Watch segment" links */
interface AssistantContent {
  text?: string
  html?: string
  chunk_refs?: Array< { document_name: string; start_time: number; end_time: number } >
}

function parseAssistantContent(
  content: string,
): { text?: string; html?: string; chunk_refs?: AssistantContent['chunk_refs'] } | null {
  try {
    const parsed = JSON.parse(content) as AssistantContent
    if (typeof parsed?.html === 'string' || typeof parsed?.text === 'string') return parsed
  } catch {
    /* plain text */
  }
  return null
}

function stripHtmlToText(html: string): string {
  if (!html) return ''
  if (typeof window === 'undefined') return html
  const el = document.createElement('div')
  el.innerHTML = html
  const text = (el.textContent || el.innerText || '').replace(/\u00a0/g, ' ')
  return text
}

function isProbablyHtml(s: string): boolean {
  const t = (s || '').trim()
  return t.startsWith('<') && t.includes('>')
}

function useQuillEditor(opts: {
  value: string
  onChange: (html: string) => void
  readOnly: boolean
}) {
  const { value, onChange, readOnly } = opts
  const hostRef = useRef<HTMLDivElement>(null)
  const quillRef = useRef<any>(null)
  const lastHtmlRef = useRef<string>('')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const mod = (await import('quill')) as unknown as { default: typeof QuillNamespace }
        const Quill = mod.default
      if (!mounted) return
      if (!hostRef.current) return
      if (quillRef.current) return
      const q = new Quill(hostRef.current, {
        theme: 'snow',
        placeholder: 'Message…',
        modules: {
          toolbar: [[{ header: [false, 2, 3] }], ['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['clean']],
        },
      })
      q.enable(!readOnly)
      quillRef.current = q

      q.on('text-change', () => {
        const html = (q.root as HTMLElement | null)?.innerHTML ?? ''
        lastHtmlRef.current = html
        onChange(html)
      })

      // init value
      if (value && value.trim()) {
        q.clipboard.dangerouslyPasteHTML(value)
        lastHtmlRef.current = (q.root as HTMLElement).innerHTML
      } else {
        q.setText('')
        lastHtmlRef.current = (q.root as HTMLElement).innerHTML
      }
        setReady(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Editor failed to load')
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const q = quillRef.current
    if (!q) return
    q.enable(!readOnly)
  }, [readOnly])

  // External value updates (e.g. when we clear after send)
  useEffect(() => {
    const q = quillRef.current
    if (!q) return
    if ((value || '') === (lastHtmlRef.current || '')) return
    if (value && value.trim()) {
      q.clipboard.dangerouslyPasteHTML(value)
    } else {
      // Important: Quill expects an empty doc to still be <p><br></p>
      q.setText('')
    }
    lastHtmlRef.current = (q.root as HTMLElement | null)?.innerHTML ?? ''
  }, [value])

  return { hostRef, ready, error }
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

function escapeHtml(s: string): string {
  return (s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Basic HTML version (bold headers + hr separators) for rich assistant rendering. */
function buildChatReplyHtmlFromText(text: string): string {
  const safe = escapeHtml(text || '')
  // **From X** -> <strong>From X</strong>
  const withBold = safe.replaceAll(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  const blocks = withBold.split(/\n{2,}/g).map((b) => b.trim()).filter(Boolean)
  const out: string[] = []
  for (const b of blocks) {
    if (b === '---') out.push('<hr />')
    else out.push(`<p>${b.replaceAll('\n', '<br />')}</p>`)
  }
  return out.join('')
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
  const quill = useQuillEditor({ value: inputValue, onChange: setInputValue, readOnly: isLoading })

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

    const html = inputValue.trim()
    const content = stripHtmlToText(html).trim()
    if (!content) return
    setInputValue('')
    setIsLoading(true)

    try {
      // If chat has no title yet, set it from the first user message (persist so chats list isn't "Untitled")
      if (!chat.title || !chat.title.trim()) {
        const t = content.length > 60 ? content.slice(0, 60) + '…' : content
        try {
          await updateChat(chatId, { title: t })
          setChat((prev) => (prev ? { ...prev, title: t } : prev))
        } catch {
          // non-fatal: chat still works even if title update fails
        }
      }
      await addChatMessage(chatId, 'user', html)
      const res = await retrieve(content)
      const reply =
        (res.answer_text && res.answer_text.trim()) ||
        (res.message && res.message.trim()) ||
        (res.chunks?.length ? buildChatReplyFromChunks(res.chunks) : 'No matching segments found in your videos.')
      const replyHtml = (res.answer_html && res.answer_html.trim()) ? res.answer_html : buildChatReplyHtmlFromText(reply)
      const chunk_refs = (res.chunks ?? [])
        .filter((c) => c.start_time != null && c.end_time != null)
        .map((c) => ({
          document_name: c.document_name,
          start_time: c.start_time!,
          end_time: c.end_time!,
        }))
      const assistantContent =
        chunk_refs.length > 0
          ? JSON.stringify({ text: reply, html: replyHtml, chunk_refs })
          : JSON.stringify({ text: reply, html: replyHtml })
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

  const derivedTitle = (() => {
    const t = (chat.title || '').trim()
    if (t) return t
    const firstUserRaw = messages.find((m) => m.role === 'user')?.content?.trim() || ''
    const firstUser = stripHtmlToText(firstUserRaw).trim()
    if (!firstUser) return 'New chat'
    return firstUser.length > 60 ? firstUser.slice(0, 60) + '…' : firstUser
  })()

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-140px)] flex flex-col w-full max-w-5xl mx-auto">
        {/* Chat Header */}
        <motion.div
          className="mb-6 pb-4 border-b border-border"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-2xl font-semibold">{derivedTitle}</h1>
          <p className="text-sm text-muted-foreground">Ask about your videos — answers are from your indexed content</p>
        </motion.div>

        {/* Messages */}
        <motion.div
          className="flex-1 overflow-y-auto space-y-6 mb-4 px-1 pr-2"
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
                className={`max-w-[85%] ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-2xl rounded-tr-md'
                    : 'bg-card border border-border rounded-2xl rounded-tl-md'
                } px-4 py-3`}
              >
                {message.role === 'assistant' ? (() => {
                  const parsed = parseAssistantContent(message.content)
                  const displayText = parsed?.text ?? message.content
                  const displayHtml = parsed?.html
                  const refs = parsed?.chunk_refs ?? []
                  return (
                    <>
                      {displayHtml ? (
                        <div
                          className="text-sm leading-relaxed prose max-w-none"
                          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(displayHtml) }}
                        />
                      ) : (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{displayText}</p>
                      )}
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
                    {isProbablyHtml(message.content) ? (
                      <div
                        className="text-sm leading-relaxed prose prose-invert:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(message.content) }}
                      />
                    ) : (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                    )}
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
          className="sticky bottom-0 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-border pt-4 pb-2"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <div className="min-h-[120px]">
                {quill.error ? (
                  <textarea
                    className="w-full min-h-[120px] rounded-md border border-border bg-background px-3 py-2 text-sm"
                    placeholder="Message…"
                    value={stripHtmlToText(inputValue)}
                    onChange={(e) => setInputValue(e.target.value)}
                    disabled={isLoading}
                  />
                ) : (
                  <div ref={quill.hostRef} />
                )}
              </div>
            </div>
            <Button type="submit" disabled={!inputValue.trim() || isLoading} size="icon">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </motion.form>
      </div>
    </DashboardLayout>
  )
}
