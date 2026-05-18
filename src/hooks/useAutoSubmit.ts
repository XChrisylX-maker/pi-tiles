import { useEffect } from 'react'

export function useAutoSubmit({
  enabled,
  onAutoSubmit,
}: {
  enabled: boolean
  onAutoSubmit: () => void
}) {
  useEffect(() => {
    if (!enabled) return
    onAutoSubmit()
  }, [enabled, onAutoSubmit])
}
