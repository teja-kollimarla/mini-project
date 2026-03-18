'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Upload, Loader2, CheckCircle, AlertCircle, Youtube } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card } from '@/components/ui/card'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ingestYoutube, uploadVideos } from '@/lib/api'

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

type IngestionState = 'idle' | 'loading' | 'success' | 'error'

export default function IngestPage() {
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [youtubeState, setYoutubeState] = useState<IngestionState>('idle')
  const [youtubeError, setYoutubeError] = useState<string | null>(null)
  const [replaceIndex, setReplaceIndex] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([])
  const [uploadState, setUploadState] = useState<IngestionState>('idle')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleYoutubeIngest = async () => {
    if (!youtubeUrl) return
    setYoutubeState('loading')
    setYoutubeError(null)
    try {
      await ingestYoutube(youtubeUrl, replaceIndex)
      setYoutubeState('success')
      setYoutubeUrl('')
      setTimeout(() => setYoutubeState('idle'), 3000)
    } catch (err) {
      setYoutubeState('error')
      setYoutubeError(err instanceof Error ? err.message : String(err))
      setTimeout(() => {
        setYoutubeState('idle')
        setYoutubeError(null)
      }, 4000)
    }
  }

  const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'video/avi', 'video/x-msvideo', 'video/flv', 'audio/mp4', 'video/*']
  const isVideo = (file: File) => file.type.startsWith('video/') || ALLOWED_VIDEO_TYPES.includes(file.type) || /\.(mp4|mov|mkv|webm|avi|flv|m4a)$/i.test(file.name)

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter(isVideo)
    setUploadedFiles(prev => [...prev, ...files])
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    if (input.files && input.files.length > 0) {
      const files = Array.from(input.files).filter(isVideo)
      setUploadedFiles(prev => [...prev, ...files])
    }
    input.value = ''
  }

  const handleUpload = async () => {
    if (uploadedFiles.length === 0) return
    setUploadState('loading')
    setUploadProgress(10)
    setUploadError(null)
    try {
      await uploadVideos(uploadedFiles, replaceIndex)
      setUploadProgress(100)
      setUploadState('success')
      setUploadedFiles([])
      setTimeout(() => {
        setUploadState('idle')
        setUploadProgress(0)
      }, 3000)
    } catch (err) {
      setUploadState('error')
      setUploadError(err instanceof Error ? err.message : String(err))
      setTimeout(() => {
        setUploadState('idle')
        setUploadError(null)
      }, 8000)
    } finally {
      setUploadProgress(0)
    }
  }

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index))
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
        <motion.div variants={itemVariants}>
          <h1 className="text-3xl font-bold mb-2">Add Videos</h1>
          <p className="text-muted-foreground">Ingest videos from YouTube or upload custom files</p>
        </motion.div>

        {/* Tabs */}
        <motion.div variants={itemVariants}>
          <Tabs defaultValue="youtube" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="youtube" className="gap-2">
                <Youtube className="h-4 w-4" />
                YouTube
              </TabsTrigger>
              <TabsTrigger value="upload" className="gap-2">
                <Upload className="h-4 w-4" />
                Custom Upload
              </TabsTrigger>
            </TabsList>

            {/* YouTube Tab */}
            <TabsContent value="youtube" className="space-y-6">
              <Card className="p-6">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="youtube-url" className="mb-2 block">
                      YouTube Video or Playlist URL
                    </Label>
                    <Input
                      id="youtube-url"
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      disabled={youtubeState === 'loading'}
                      className="bg-background border-border"
                    />
                    <p className="text-xs text-muted-foreground mt-2">
                      Paste a YouTube video URL or playlist link. Playlists will be fully indexed.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="replace-youtube"
                      checked={replaceIndex}
                      onCheckedChange={(checked) => setReplaceIndex(checked as boolean)}
                      disabled={youtubeState === 'loading'}
                    />
                    <label
                      htmlFor="replace-youtube"
                      className="text-sm text-muted-foreground cursor-pointer"
                    >
                      Replace existing index
                    </label>
                  </div>

                  {youtubeState === 'success' && (
                    <Alert className="border-green-500/30 bg-green-500/10">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <AlertDescription className="text-green-500">
                        Ingested.
                      </AlertDescription>
                    </Alert>
                  )}

                  {youtubeState === 'error' && (
                    <Alert className="border-red-500/30 bg-red-500/10">
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <AlertDescription className="text-red-500">
                        {youtubeError || 'Something went wrong. Please try again.'}
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button
                    onClick={handleYoutubeIngest}
                    disabled={!youtubeUrl || youtubeState === 'loading'}
                    className="w-full gap-2"
                  >
                    {youtubeState === 'loading' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Ingesting...
                      </>
                    ) : (
                      <>
                        <Youtube className="h-4 w-4" />
                        Ingest Video
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            </TabsContent>

            {/* Upload Tab */}
            <TabsContent value="upload" className="space-y-6">
              <Card className="p-6">
                <div className="space-y-4">
                  {/* Drag and Drop */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleFileDrop}
                    className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors"
                  >
                    <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                    <p className="font-medium mb-1">Drag and drop your videos here</p>
                    <p className="text-sm text-muted-foreground mb-4">
                      Supported formats: MP4, MOV, MKV
                    </p>
                    <label>
                      <Button variant="outline" asChild>
                        <span>Select Video File</span>
                      </Button>
                      <input
                        type="file"
                        multiple
                        accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.flv,.m4a"
                        onChange={handleFileSelect}
                        className="hidden"
                        disabled={uploadState === 'loading'}
                      />
                    </label>
                  </div>

                  {/* Selected Files */}
                  {uploadedFiles.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Selected Files ({uploadedFiles.length})
                      </Label>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {uploadedFiles.map((file, index) => (
                          <motion.div
                            key={index}
                            className="flex items-center justify-between p-3 bg-card border border-border rounded-lg"
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                          >
                            <div className="flex items-center gap-3 flex-1">
                              <div className="p-2 bg-muted rounded">
                                <Upload className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{file.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {(file.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                              </div>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeFile(index)}
                              disabled={uploadState === 'loading'}
                            >
                              Remove
                            </Button>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Options */}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="replace-upload"
                      checked={replaceIndex}
                      onCheckedChange={(checked) => setReplaceIndex(checked as boolean)}
                      disabled={uploadState === 'loading'}
                    />
                    <label
                      htmlFor="replace-upload"
                      className="text-sm text-muted-foreground cursor-pointer"
                    >
                      Replace existing index
                    </label>
                  </div>

                  {/* Progress */}
                  {uploadState === 'loading' && uploadProgress > 0 && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Uploading and indexing...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <motion.div
                          className="bg-primary h-2 rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${uploadProgress}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </div>
                  )}

                  {uploadState === 'success' && (
                    <Alert className="border-green-500/30 bg-green-500/10">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <AlertDescription className="text-green-500">
                        Ingested.
                      </AlertDescription>
                    </Alert>
                  )}

                  {uploadState === 'error' && (
                    <Alert className="border-red-500/30 bg-red-500/10">
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <AlertDescription className="text-red-500">
                        {uploadError || 'Something went wrong. Please try again.'}
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button
                    onClick={handleUpload}
                    disabled={uploadedFiles.length === 0 || uploadState === 'loading'}
                    className="w-full gap-2"
                  >
                    {uploadState === 'loading' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        Upload and Index
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </motion.div>
      </motion.div>
    </DashboardLayout>
  )
}
