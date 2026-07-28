/** Advance to the next image, wrapping past the end back to the start. */
export function nextIndex(current: number, length: number): number {
  if (length <= 0) return 0
  return (current + 1) % length
}

/** Step to the previous image, wrapping before the start round to the end. */
export function prevIndex(current: number, length: number): number {
  if (length <= 0) return 0
  return (current - 1 + length) % length
}

/** Whether prev/next controls should show at all. */
export function hasMultiple(length: number): boolean {
  return length > 1
}
