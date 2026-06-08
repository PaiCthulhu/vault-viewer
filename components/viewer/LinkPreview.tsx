'use client'

import { useState } from 'react'

export interface PreviewData {
  title: string
  image: string | null
  snippet: string
  imagePosition?: string | null
}

export interface ExternalPreviewData {
  title: string | null
  description: string | null
  image: string | null
  favicon: string | null
  themeColor: string | null
  siteName: string | null
  url: string
}

export type LinkPreviewState =
  | { kind: 'loading'; x: number; y: number; flip: boolean }
  | { kind: 'internal'; title: string; image: string | null; snippet: string; imagePosition?: string | null; x: number; y: number; flip: boolean }
  | { kind: 'external'; url: string; data: ExternalPreviewData | null; x: number; y: number; flip: boolean }
  | null

interface LinkPreviewProps {
  state: LinkPreviewState
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// External card has its own component so the broken-media fallback state
// (image → favicon → none) resets each time a different link is shown.
function ExternalCard({
  state,
}: {
  state: Extract<NonNullable<LinkPreviewState>, { kind: 'external' }>
}) {
  const [imageBroken, setImageBroken] = useState(false)
  const [faviconBroken, setFaviconBroken] = useState(false)

  const data = state.data
  // While loading (data still null), render nothing — no skeleton flash.
  if (!data) return null

  const domain = domainOf(data.url || state.url)
  const title = data.title || domain
  const showImage = data.image && !imageBroken
  const showFavicon = !showImage && data.favicon && !faviconBroken

  return (
    <div
      className="link-preview"
      style={{
        left: state.x,
        top: state.y,
        transform: state.flip ? 'translateY(-100%)' : undefined,
      }}
    >
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="link-preview-img"
          src={data.image as string}
          alt=""
          onError={() => setImageBroken(true)}
        />
      )}
      {showFavicon && (
        <div
          className="link-preview-favicon-banner"
          style={{ background: data.themeColor ?? 'var(--accent-bg)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="link-preview-favicon"
            src={data.favicon as string}
            alt=""
            onError={() => setFaviconBroken(true)}
          />
        </div>
      )}
      <div className="link-preview-body">
        <div className={`link-preview-title${data.title ? '' : ' is-domain'}`}>{title}</div>
        {data.description && (
          <div className="link-preview-desc">{data.description}</div>
        )}
        <div className="link-preview-domain">{domain}</div>
      </div>
    </div>
  )
}

export function LinkPreview({ state }: LinkPreviewProps) {
  if (!state) return null

  if (state.kind === 'loading') {
    return (
      <div
        className="link-preview link-preview-skeleton"
        style={{
          left: state.x,
          top: state.y,
          transform: state.flip ? 'translateY(-100%)' : undefined,
        }}
      >
        <div className="sk-img" />
        <div className="link-preview-body">
          <div className="sk-line" />
          <div className="sk-line short" />
        </div>
      </div>
    )
  }

  if (state.kind === 'external') {
    // Key by url so the card (and its fallback state) remounts per target.
    return <ExternalCard key={state.url} state={state} />
  }

  return (
    <div
      className="link-preview"
      style={{
        left: state.x,
        top: state.y,
        transform: state.flip ? 'translateY(-100%)' : undefined,
      }}
    >
      {state.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="link-preview-img"
          src={state.image}
          alt=""
          style={{ objectPosition: state.imagePosition || 'center' }}
        />
      )}
      <div className="link-preview-body">
        <div className="link-preview-title">{state.title}</div>
        {state.snippet && <div className="link-preview-snippet">{state.snippet}</div>}
      </div>
    </div>
  )
}
