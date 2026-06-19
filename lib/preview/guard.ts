import { readPreviewSession } from '@/lib/preview/cookie'

/** True when the current request carries a valid preview cookie. */
export async function isPreviewRequest(): Promise<boolean> {
  const nowSec = Math.floor(Date.now() / 1000)
  return (await readPreviewSession(nowSec)) !== null
}
