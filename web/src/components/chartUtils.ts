import { useEffect, useRef, useState } from 'react'

/** Track an element's content width for responsive SVG. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** Round tick values from 0 up to the first tick at or above max. */
export function niceTicks(max: number, target = 5): number[] {
  const raw = max / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const ticks: number[] = []
  for (let v = 0; ticks.length < 2 || ticks[ticks.length - 1] < max - step * 1e-9; v += step) ticks.push(v)
  return ticks
}
