'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Search as SearchIcon, Play, Scissors, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { DashboardLayout } from '@/components/dashboard-layout'
import { retrieve, createChunk, clipPlayUrl } from '@/lib/api'

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

type ChunkResult = {
  text: string
  document_name: string
  start_time?: number
  end_time?: number
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [chunks, setChunks] = useState<ChunkResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creatingClip, setCreatingClip] = useState<string | null>(null)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setIsSearching(true)
    setError(null)
    try {
      const res = await retrieve(query.trim())
      setChunks(res.chunks || [])
      setHasSearched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
      setChunks([])
    } finally {
      setIsSearching(false)
    }
  }

  const handleCreateClip = async (doc: ChunkResult) => {
    const start = doc.start_time ?? 0
    const end = doc.end_time ?? start + 30
    const key = `${doc.document_name}-${start}-${end}`
    setCreatingClip(key)
    try {
      const res = await createChunk(doc.document_name, start, end)
      if (res.url) window.open(clipPlayUrl(res.filename!), '_blank')
    } finally {
      setCreatingClip(null)
    }
  }

  const formatTime = (s: number | undefined) => (s != null ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '')

  return (
    <DashboardLayout>
      <motion.div
        className="max-w-4xl space-y-8"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Header */}
        <motion.div variants={itemVariants}>
          <h1 className="text-3xl font-bold mb-2">Search Your Videos</h1>
          <p className="text-muted-foreground">Ask anything about your video content</p>
        </motion.div>

        {/* Search Input */}
        <motion.form onSubmit={handleSearch} variants={itemVariants}>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Ask anything about your videos..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={isSearching}
                className="pl-10 bg-background border-border h-12"
              />
            </div>
            <Button
              type="submit"
              disabled={!query.trim() || isSearching}
              className="gap-2"
              size="lg"
            >
              {isSearching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <SearchIcon className="h-4 w-4" />
                  Search
                </>
              )}
            </Button>
          </div>
        </motion.form>

        {/* Error */}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Results */}
        {hasSearched && !isSearching && (
          <motion.div
            className="space-y-4"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
          >
            <p className="text-sm text-muted-foreground">
              Found {chunks.length} results for &quot;{query}&quot;
            </p>

            {chunks.map((result, idx) => (
              <motion.div
                key={`${result.document_name}-${result.start_time}-${idx}`}
                variants={itemVariants}
                whileHover={{ y: -2 }}
              >
                <Card className="p-6 hover:border-primary/50 transition-all duration-300">
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{result.document_name}</p>
                      <p className="text-foreground">{result.text}</p>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex gap-4 text-sm text-muted-foreground">
                        <span>{formatTime(result.start_time)} - {formatTime(result.end_time)}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => handleCreateClip(result)}
                          disabled={!!creatingClip}
                        >
                          {creatingClip === `${result.document_name}-${result.start_time ?? 0}-${result.end_time ?? 0}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Scissors className="h-4 w-4" />
                          )}
                          Clip
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Empty State */}
        {!hasSearched && (
          <motion.div
            className="rounded-lg border border-dashed border-border p-12 text-center"
            variants={itemVariants}
          >
            <SearchIcon className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No searches yet</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              Start by typing a question about your videos. Search works across all your indexed content.
            </p>
          </motion.div>
        )}
      </motion.div>
    </DashboardLayout>
  )
}
