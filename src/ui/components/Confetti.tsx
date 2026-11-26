import { useEffect, useRef } from 'preact/hooks'

interface ConfettiProps {
  failingStreak: boolean
  lastVerified200: boolean
  calmMode: boolean
}

export function Confetti({ failingStreak, lastVerified200, calmMode }: ConfettiProps) {
  const firedForStreakRef = useRef(false)
  const hadFailureRef = useRef(false)

  useEffect(() => {
    if (failingStreak) {
      hadFailureRef.current = true
      firedForStreakRef.current = false
      return
    }

    if (hadFailureRef.current && lastVerified200 && !firedForStreakRef.current) {
      firedForStreakRef.current = true
      hadFailureRef.current = false
      if (calmMode) return

      void import('canvas-confetti').then((mod) => {
        const confetti = mod.default
        void confetti({
          particleCount: 70,
          spread: 60,
          origin: { y: 0.7 },
        })
      })
    }
  }, [failingStreak, lastVerified200, calmMode])

  return null
}
