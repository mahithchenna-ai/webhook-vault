import { useEffect, useState } from 'preact/hooks'

const STORAGE_KEY = 'webhook-vault-calm-mode'

function getInitialCalmMode(): boolean {
  if (typeof window === 'undefined') return false
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'true') return true
  if (stored === 'false') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function useCalmMode(): [boolean, (next: boolean) => void] {
  const [calm, setCalm] = useState<boolean>(getInitialCalmMode)

  useEffect(() => {
    document.documentElement.dataset.calm = String(calm)
    window.localStorage.setItem(STORAGE_KEY, String(calm))
  }, [calm])

  return [calm, setCalm]
}
