import { existsSync, readFileSync } from 'node:fs'

/**
 * Apple's "Add to Apple Wallet" badge and Google's "Add to Google Wallet" button, which both
 * platforms require instead of our own text buttons before going live. Their artwork comes from their
 * sites and may not be changed, so it is not in the code: whoever has downloaded it puts the four
 * files in assets/wallet-badges/ (the README there says which). Until then, the card page shows its
 * plain text buttons.
 */
export const BADGE_FILES = ['apple-en.svg', 'apple-ar.svg', 'google-en.svg', 'google-ar.svg'] as const
export type Badges = Map<string, string>

export function loadBadges(dir: URL = new URL('../assets/wallet-badges/', import.meta.url)): Badges {
  const out: Badges = new Map()
  for (const name of BADGE_FILES) {
    const file = new URL(name, dir)
    if (!existsSync(file)) continue
    const svg = readFileSync(file, 'utf8')
    if (/<svg[\s>]/i.test(svg)) out.set(name, svg)
    else console.warn(`assets/wallet-badges/${name} is not an SVG; using the text button`)
  }
  return out
}
