'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, FileVideo, Loader2, ChevronDown, ChevronUp, RefreshCw, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DashboardLayout } from '@/components/dashboard-layout'
import { listVideos, summarizeVideo, createChunk, clipPlayUrl, type TopicSummary } from '@/lib/api'

type VideoRow = {
  id: string
  filename: string
  source: string
}

type SummaryResult = {
  title: string
  topics: TopicSummary[]
}

export default function SummaryPage() {
  const [videos, setVideos] = useState<VideoRow[]>([])
  const [loadingVideos, setLoadingVideos] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [summaries, setSummaries] = useState<Record<string, SummaryResult | null>>({})
  const [generating, setGenerating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set())
  const [clippingSegment, setClippingSegment] = useState<string | null>(null)

  useEffect(() => {
    listVideos()
      .then((v) => setVideos(v.map((r) => ({ id: r.id, filename: r.filename, source: r.source }))))
      .catch(() => setError('Failed to load videos'))
      .finally(() => setLoadingVideos(false))
  }, [])

  const handleGenerate = async (filename: string) => {
    setError(null)
    setGenerating(filename)
    setSelected(filename)
    try {
      const res = await summarizeVideo(filename)
      if (res.success && res.topics.length > 0) {
        setSummaries((prev) => ({ ...prev, [filename]: { title: res.title, topics: res.topics } }))
      } else {
        setError(res.message || 'Could not generate a summary for this video.')
        setSummaries((prev) => ({ ...prev, [filename]: null }))
      }
    } catch {
      setError('Failed to generate summary.')
    } finally {
      setGenerating(null)
    }
  }

  const toggleTopic = (key: string) => {
    setExpandedTopics((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const handleWatchSegment = async (doc: string, start: number, end: number) => {
    const key = `${doc}:${start}-${end}`
    setClippingSegment(key)
    try {
      const res = await createChunk(doc, start, end)
      if (res.url?.startsWith('http')) window.open(res.url, '_blank')
      else if (res.filename) window.open(clipPlayUrl(res.filename), '_blank')
    } catch {
      setError('Failed to create clip')
    } finally {
      setClippingSegment(null)
    }
  }

  const selectedSummary = selected ? summaries[selected] : undefined

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Video Summaries
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Select a video to generate a structured, topic-by-topic summary.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Video list */}
          <div className="lg:col-span-1">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Your Videos
            </h2>
            {loadingVideos ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />Loading…
              </div>
            ) : videos.length === 0 ? (
              <p className="text-sm text-muted-foreground">No videos indexed yet. Go to Ingest to add videos.</p>
            ) : (
              <div className="space-y-1">
                {videos.map((v) => {
                  const isSelected = selected === v.filename
                  const hasSummary = summaries[v.filename] !== undefined
                  const isGenerating = generating === v.filename
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setSelected(v.filename)
                        if (!hasSummary && !isGenerating) handleGenerate(v.filename)
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm transition-colors border ${
                        isSelected
                          ? 'bg-primary/10 border-primary/30 text-foreground'
                          : 'border-transparent hover:bg-muted/60 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {isGenerating
                        ? <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />
                        : <FileVideo className="h-4 w-4 shrink-0" />
                      }
                      <span className="truncate flex-1">{v.filename}</span>
                      {hasSummary && summaries[v.filename] && (
                        <span className="text-xs text-primary shrink-0">✓</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Summary panel */}
          <div className="lg:col-span-2">
            {error && (
              <div className="mb-4 text-sm text-destructive bg-destructive/10 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {!selected && (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground border border-dashed border-border rounded-xl">
                <BookOpen className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">Select a video from the list to generate its summary.</p>
              </div>
            )}

            {selected && generating === selected && (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-3 text-primary" />
                <p className="text-sm">Analyzing video content…</p>
                <p className="text-xs mt-1 opacity-60">This may take a few seconds</p>
              </div>
            )}

            <AnimatePresence mode="wait">
              {selected && summaries[selected] && generating !== selected && (
                <motion.div
                  key={selected}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.35 }}
                >
                  {/* Summary header */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-semibold">{summaries[selected]!.title}</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {summaries[selected]!.topics.length} topic{summaries[selected]!.topics.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5 shrink-0"
                      onClick={() => handleGenerate(selected)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Regenerate
                    </Button>
                  </div>

                  {/* Topic cards */}
                  <div className="space-y-3">
                    {summaries[selected]!.topics.map((topic, idx) => {
                      const topicKey = `${selected}-${idx}`
                      const isExpanded = expandedTopics.has(topicKey)
                      const timeLabel =
                        topic.start_time != null &&
                        topic.end_time != null &&
                        (topic.start_time > 0 || topic.end_time > 0)
                          ? `${Math.floor(topic.start_time)}s – ${Math.floor(topic.end_time)}s`
                          : null

                      return (
                        <motion.div
                          key={topicKey}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className="border border-border rounded-xl overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() => toggleTopic(topicKey)}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                          >
                            <span className="text-xs font-bold text-primary/60 shrink-0 w-6 text-center">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <span className="font-medium text-sm flex-1">{topic.title}</span>
                            {timeLabel && (
                              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                                {timeLabel}
                              </span>
                            )}
                            {isExpanded
                              ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                              : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                            }
                          </button>

                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                              >
                                <div className="px-4 pb-4 pt-3 border-t border-border/50 space-y-4">
                                  {/* Explanation */}
                                  <p className="text-sm leading-relaxed">
                                    {topic.explanation}
                                  </p>

                                  {/* Deeper details */}
                                  {topic.details && (
                                    <p className="text-sm leading-relaxed text-muted-foreground border-l-2 border-primary/30 pl-3">
                                      {topic.details}
                                    </p>
                                  )}

                                  {/* Key points */}
                                  {topic.key_points.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Key Points</p>
                                      <ul className="space-y-1.5">
                                        {topic.key_points.map((pt, pi) => (
                                          <li key={pi} className="flex items-start gap-2 text-sm">
                                            <span className="text-primary mt-0.5 shrink-0 font-bold">•</span>
                                            <span>{pt}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}

                                  {/* Watch segment button */}
                                  {topic.start_time != null && topic.end_time != null &&
                                    (topic.start_time > 0 || topic.end_time > 0) && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="text-xs gap-1.5"
                                      disabled={clippingSegment === `${topic.document_name}:${topic.start_time}-${topic.end_time}`}
                                      onClick={() => handleWatchSegment(topic.document_name, topic.start_time, topic.end_time)}
                                    >
                                      {clippingSegment === `${topic.document_name}:${topic.start_time}-${topic.end_time}` ? (
                                        <><Loader2 className="h-3 w-3 animate-spin" />Creating clip…</>
                                      ) : (
                                        <><Play className="h-3 w-3" />Watch this segment</>
                                      )}
                                    </Button>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {selected && summaries[selected] === null && generating !== selected && (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground border border-dashed border-border rounded-xl">
                <p className="text-sm">No summary available for this video.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 text-xs gap-1.5"
                  onClick={() => handleGenerate(selected)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try again
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
