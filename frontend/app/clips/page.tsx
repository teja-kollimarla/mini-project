'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Play, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DashboardLayout } from '@/components/dashboard-layout'
import { listChunks, clipPlayUrl } from '@/lib/api'

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

export default function ClipsPage() {
  const [chunks, setChunks] = useState<Array<{ id: string; filename: string; document_name: string; start_time: number; end_time: number; video_id: string | null; created_at: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listChunks()
      .then((res) => setChunks(res.chunks ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load clips'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Loading clips...</span>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <motion.div
        className="space-y-8"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Header */}
        <motion.div variants={itemVariants}>
          <h1 className="text-3xl font-bold mb-2">My Clips</h1>
          <p className="text-muted-foreground">Auto-generated clips from your videos</p>
        </motion.div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Grid */}
        <motion.div
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-6"
          variants={containerVariants}
        >
          {chunks.map((chunk) => (
            <motion.div
              key={chunk.id}
              variants={itemVariants}
              whileHover={{ y: -6 }}
            >
              <Card className="overflow-hidden hover:border-primary/50 transition-all duration-300 h-full flex flex-col">
                <div className="relative w-full aspect-video bg-muted flex items-center justify-center">
                  <video
                    src={clipPlayUrl(chunk.filename)}
                    controls
                    className="w-full h-full object-contain"
                    preload="metadata"
                  />
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <h3 className="font-semibold text-sm mb-2 line-clamp-2">{chunk.document_name}</h3>
                  <p className="text-xs text-muted-foreground mb-2">
                    {chunk.start_time.toFixed(1)}s – {chunk.end_time.toFixed(1)}s
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 mt-2"
                    onClick={() => window.open(clipPlayUrl(chunk.filename), '_blank')}
                  >
                    <Play className="h-3 w-3" />
                    Play in new tab
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        {/* Empty State */}
        {chunks.length === 0 && !error && (
          <motion.div
            className="rounded-lg border border-dashed border-border p-12 text-center"
            variants={itemVariants}
          >
            <Play className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No clips yet</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              Generate clips from your videos using the search feature or chat interface.
            </p>
          </motion.div>
        )}
      </motion.div>
    </DashboardLayout>
  )
}
