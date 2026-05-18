import { useEffect } from 'react'

export function useCountdown({
  active,
  value,
  onTick,
}: {
  active: boolean
  value: number
  onTick: (nextValue: number) => void
}) {
  useEffect(() => {
    if (!active || value <= 0) return undefined

    const timer = window.setTimeout(() => {
      onTick(value - 1)
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [active, onTick, value])
}
