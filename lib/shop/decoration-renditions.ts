export interface DecorationRendition {
  id: string
  artworkId: string
  label: string
  artworkName: string
  artworkUrl: string
  artworkStoragePath: string
  artworkSha256: string | null
  overlayUrl: string | null
  active: boolean
}

export type DecorationRenditionResolutionSource =
  | 'exact_variant'
  | 'decoration_default'
  | 'legacy_default'

export interface ResolvedDecorationRendition {
  rendition: DecorationRendition
  source: DecorationRenditionResolutionSource
}

export interface ResolvedRenditionPresentation {
  linkId: string
  renditionId: string
  renditionLabel: string
  artworkId: string
  artworkName: string
  artworkUrl: string
  overlayUrl: string | null
  snapshotUrl: string | null
  resolutionSource: DecorationRenditionResolutionSource
}

/**
 * Applies the variant-specific file identity to a decoration presentation while
 * leaving the decoration/pricing identity untouched. The generic shape keeps
 * this helper independent of the heavier PDP DecorationOption type.
 */
export function applyResolvedRendition<
  T extends {
    linkId: string
    artworkUrl: string | null
    artworkName: string | null
    snapshotUrl: string | null
    overlay: { artworkUrl: string } | null
  },
>(
  option: T,
  variantId: string | null,
  resolvedByVariantId: Readonly<Record<string, ResolvedRenditionPresentation>>,
): T & { renditionId?: string; renditionLabel?: string } {
  const resolved = variantId ? resolvedByVariantId[variantId] : undefined
  if (!resolved) return option
  return {
    ...option,
    linkId: resolved.linkId,
    artworkUrl: resolved.artworkUrl,
    artworkName: resolved.artworkName,
    snapshotUrl: resolved.snapshotUrl,
    renditionId: resolved.renditionId,
    renditionLabel: resolved.renditionLabel,
    overlay: option.overlay
      ? {
          ...option.overlay,
          artworkUrl: resolved.overlayUrl ?? resolved.artworkUrl,
        }
      : null,
  } as T & { renditionId?: string; renditionLabel?: string }
}

export class InvalidDecorationRenditionAssignmentError extends Error {
  constructor(variantId: string) {
    super(`The artwork rendition assigned to colourway ${variantId} is unavailable.`)
    this.name = 'InvalidDecorationRenditionAssignmentError'
  }
}

export function resolveDecorationRendition(args: {
  variantId: string | null
  defaultArtworkId: string | null
  renditions: readonly DecorationRendition[]
  assignmentByVariantId: Readonly<Record<string, string>>
}): ResolvedDecorationRendition | null {
  const assignedRenditionId = args.variantId
    ? args.assignmentByVariantId[args.variantId]
    : undefined

  if (assignedRenditionId) {
    const assigned = args.renditions.find((rendition) => rendition.id === assignedRenditionId)
    if (!assigned?.active) {
      throw new InvalidDecorationRenditionAssignmentError(args.variantId!)
    }
    return { rendition: assigned, source: 'exact_variant' }
  }

  const defaultRendition = args.renditions.find(
    (rendition) => rendition.artworkId === args.defaultArtworkId && rendition.active,
  )
  return defaultRendition
    ? { rendition: defaultRendition, source: 'decoration_default' }
    : null
}
