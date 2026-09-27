import type { SVGProps } from 'react'
/** Neutral panel glyph for the OmicOS host. No upstream wordmark or logo geometry. */
export interface BrandMarkProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size: number
  tone?: 'default' | 'paper' | 'reverse' | 'mono'
  title?: string
}
export function BrandMark({ size, tone: _tone, title, ...props }: BrandMarkProps) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    data-omicos-glyph="figure-studio"
    {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })} {...props}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M3 9h18M9 9v11M12 16l3-3 3 3" />
  </svg>
}
