/**
 * API client for the video RAG backend.
 * Auth: JWT access token (Bearer) with optional refresh; fallback X-User-Id for clip URLs.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const USER_ID_KEY = 'videobase_user_id'
const ACCESS_TOKEN_KEY = 'videobase_access_token'
const REFRESH_TOKEN_KEY = 'videobase_refresh_token'
const AUTH_EVENT = 'videobase_auth_changed'

function isClient() {
  return typeof window !== 'undefined'
}

/** Get current user id (for clip URLs and legacy). */
export function getUserId(): string | null {
  if (!isClient()) return null
  return localStorage.getItem(USER_ID_KEY)
}

/** Set user id (called after login/register with external_id).
 *  Strips chars outside [a-zA-Z0-9_-] — matches backend _safe_user_id exactly. */
export function setUserId(id: string): void {
  const safe = (id || '').replace(/[^a-zA-Z0-9_-]/g, '') || 'guest'
  if (isClient()) localStorage.setItem(USER_ID_KEY, safe)
}

/** Get access token for Bearer auth. */
export function getAccessToken(): string | null {
  if (!isClient()) return null
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

/** Get refresh token. */
export function getRefreshToken(): string | null {
  if (!isClient()) return null
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

/** Store tokens and user id after login/register. */
export function setTokens(accessToken: string, refreshToken: string, externalId: string): void {
  if (!isClient()) return
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  setUserId(externalId)
  try {
    window.dispatchEvent(new Event(AUTH_EVENT))
  } catch {
    // ignore
  }
}

/** Clear tokens and user id (logout). */
export function clearTokens(): void {
  if (!isClient()) return
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_ID_KEY)
  try {
    window.dispatchEvent(new Event(AUTH_EVENT))
  } catch {
    // ignore
  }
}

export function onAuthChanged(cb: () => void): () => void {
  if (!isClient()) return () => {}
  const handler = () => cb()
  window.addEventListener(AUTH_EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(AUTH_EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

/** Headers for authenticated requests: Bearer token, or X-User-Id for guest. Throws if neither. */
function authHeaders(): HeadersInit {
  const token = getAccessToken()
  const userId = getUserId()
  if (token) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  }
  if (userId) {
    return { 'Content-Type': 'application/json', 'X-User-Id': userId }
  }
  throw new Error('Not signed in')
}

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { detail?: string }).detail || res.statusText || 'Request failed')
  return data as T
}

/** Call /api/refresh and update stored tokens. */
export async function refreshTokens(): Promise<void> {
  const refresh = getRefreshToken()
  if (!refresh) throw new Error('No refresh token')
  const res = await fetch(`${API_URL}/api/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { detail?: string }).detail || 'Refresh failed')
  const d = data as { access_token: string; refresh_token: string; user: { external_id: string } }
  setTokens(d.access_token, d.refresh_token, d.user.external_id)
}

// --- Auth (no token required) ---
export async function register(email: string, name: string, password: string) {
  const res = await fetch(`${API_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), name: name.trim(), password }),
  })
  const data = await handleResponse<{
    id: string
    external_id: string
    email: string | null
    name: string | null
    created_at: string
    access_token: string
    refresh_token: string
    expires_in: number
    token_type?: string
  }>(res)
  setTokens(data.access_token, data.refresh_token, data.external_id)
  return data
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  })
  const data = await handleResponse<{
    access_token: string
    refresh_token: string
    expires_in: number
    token_type?: string
    user: { id: string; external_id: string; email: string | null; name: string | null; created_at: string }
  }>(res)
  setTokens(data.access_token, data.refresh_token, data.user.external_id)
  return data
}

export async function logout(): Promise<void> {
  const refresh = getRefreshToken()
  if (refresh) {
    try {
      await fetch(`${API_URL}/api/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
    } catch {
      // ignore
    }
  }
  clearTokens()
}

// --- Ingest ---
export async function ingestYoutube(url: string, clearExisting: boolean = true) {
  const res = await fetch(`${API_URL}/api/ingest/youtube`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ url, clear_existing: clearExisting }),
  })
  return handleResponse<{ success: boolean; message: string; count: number; documents: string[] }>(res)
}

export async function uploadVideos(files: File[], clearExisting: boolean = true) {
  const form = new FormData()
  files.forEach((file) => {
    // Append with filename so server receives it (required for multipart)
    form.append('files', file, file.name || 'video.mp4')
  })
  form.append('clear_existing', String(clearExisting))
  const headers = { ...authHeaders() } as Record<string, string>
  delete headers['Content-Type']
  const res = await fetch(`${API_URL}/api/ingest/upload`, {
    method: 'POST',
    headers,
    body: form,
  })
  return handleResponse<{ success: boolean; message: string; count: number; documents: string[] }>(res)
}

// --- Retrieve (search) ---
export async function retrieve(query: string) {
  const res = await fetch(`${API_URL}/api/retrieve`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ query }),
  })
  return handleResponse<{
    success: boolean
    chunks: Array<{
      text: string
      document_name: string
      start_time?: number
      end_time?: number
      display_text?: string
      video_description?: string
      audio_transcript?: string
    }>
    answer_text?: string | null
    answer_html?: string | null
    message?: string | null
  }>(res)
}

// --- Summarize video ---
export type TopicSummary = {
  title: string
  start_time: number
  end_time: number
  // new two-paragraph format
  paragraph1?: string
  paragraph2?: string
  // legacy fields kept for backward compat with cached summaries
  explanation?: string
  details?: string
  key_points: string[]
  document_name: string
}

export async function summarizeVideo(documentName: string) {
  const res = await fetch(`${API_URL}/api/summarize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ document_name: documentName }),
  })
  return handleResponse<{
    success: boolean
    title: string
    document_name: string
    topics: TopicSummary[]
    message?: string | null
  }>(res)
}

// --- Chunk (create clip) ---
export async function createChunk(documentName: string, startTime: number, endTime: number) {
  const res = await fetch(`${API_URL}/api/chunk`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ document_name: documentName, start_time: startTime, end_time: endTime }),
  })
  return handleResponse<{ success: boolean; message: string; filename?: string; url?: string }>(res)
}

// --- Clips list and play URL ---
export type ChunkItem = {
  id: string
  filename: string
  document_name: string
  start_time: number
  end_time: number
  video_id: string | null
  created_at: string
}

export async function listChunks() {
  const res = await fetch(`${API_URL}/api/chunks`, { headers: authHeaders() })
  return handleResponse<{ chunks: ChunkItem[] }>(res)
}

export function clipPlayUrl(filename: string): string {
  const token = getAccessToken()
  const userId = getUserId()
  const param = token
    ? `token=${encodeURIComponent(token)}`
    : `user_id=${encodeURIComponent(userId || '')}`
  return `${API_URL}/api/chunks/files/${encodeURIComponent(filename)}?${param}`
}

// --- Videos (from DB) ---
export async function listVideos() {
  const res = await fetch(`${API_URL}/api/videos`, { headers: authHeaders() })
  return handleResponse<Array<{ id: string; filename: string; b2_key: string | null; source: string; source_url: string | null; created_at: string }>>(res)
}

/** Playback URL for a video: Cloudinary (b2_key) or backend stream for local file. */
export function videoPlayUrl(video: { b2_key: string | null; filename: string }): string {
  if (video.b2_key && video.b2_key.startsWith('http')) return video.b2_key
  // Pass JWT token so the backend resolves the path using the same external_id used during ingestion.
  // Falls back to user_id if no token (unauthenticated playback).
  const token = getAccessToken()
  const userId = getUserId()
  const param = token
    ? `token=${encodeURIComponent(token)}`
    : `user_id=${encodeURIComponent(userId || '')}`
  return `${API_URL}/api/videos/stream/${encodeURIComponent(video.filename)}?${param}`
}

// --- Chats ---
export async function listChats() {
  const res = await fetch(`${API_URL}/api/chats`, { headers: authHeaders() })
  return handleResponse<Array<{ id: string; title: string | null; created_at: string; updated_at: string }>>(res)
}

export async function createChat(title?: string) {
  const res = await fetch(`${API_URL}/api/chats`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title: title || null }),
  })
  return handleResponse<{ id: string; title: string | null; created_at: string }>(res)
}

export async function getChat(chatId: string) {
  const res = await fetch(`${API_URL}/api/chats/${chatId}`, { headers: authHeaders() })
  return handleResponse<{
    id: string
    title: string | null
    created_at: string
    updated_at: string
    messages: Array<{ id: string; role: string; content: string; created_at: string }>
  }>(res)
}

export async function addChatMessage(chatId: string, role: 'user' | 'assistant', content: string) {
  const res = await fetch(`${API_URL}/api/chats/${chatId}/messages`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ role, content }),
  })
  return handleResponse<{ id: string; role: string; content: string; created_at: string }>(res)
}

export async function updateChat(chatId: string, updates: { title?: string | null }) {
  const res = await fetch(`${API_URL}/api/chats/${chatId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ title: updates.title ?? null }),
  })
  return handleResponse<{ id: string; title: string | null; updated_at: string }>(res)
}

// --- User ---
export async function getCurrentUser() {
  const res = await fetch(`${API_URL}/api/users/me`, { headers: authHeaders() })
  return handleResponse<{ id: string; external_id: string; email: string | null; name: string | null; created_at: string }>(res)
}
