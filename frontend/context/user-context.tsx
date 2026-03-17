'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { getUserId, setUserId as persistUserId, onAuthChanged } from '@/lib/api'

type UserContextType = {
  userId: string | null
  setUserId: (id: string) => void
  isReady: boolean
}

const UserContext = createContext<UserContextType | null>(null)

export function UserProvider({ children }: { children: ReactNode }) {
  const [userId, setUserIdState] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    setUserIdState(getUserId())
    setIsReady(true)
    const off = onAuthChanged(() => setUserIdState(getUserId()))
    return off
  }, [])

  const setUserId = useCallback((id: string) => {
    persistUserId(id)
    setUserIdState(getUserId())
  }, [])

  return (
    <UserContext.Provider value={{ userId, setUserId, isReady }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  const ctx = useContext(UserContext)
  if (!ctx) throw new Error('useUser must be used within UserProvider')
  return ctx
}
