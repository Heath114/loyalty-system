# Official wallet buttons

Apple and Google require their own artwork, unchanged, for the buttons that add a card to their
wallet. Put these four SVG files here and restart the server; the customer's card page then shows
them instead of its text buttons (`src/badges.ts`). A missing one keeps its text button.

| File | What | Where it comes from |
|---|---|---|
| `apple-en.svg` | "Add to Apple Wallet", English | developer.apple.com/wallet/add-to-apple-wallet-guidelines → Download the badges → the US English badge, black |
| `apple-ar.svg` | the same in Arabic | same download → the Arabic badge |
| `google-en.svg` | "Add to Google Wallet", English | developers.google.com/wallet/generic/resources/brand-guidelines → download the button assets → English, primary (dark) |
| `google-ar.svg` | the same in Arabic | same download → Arabic |

Rename each file to the name in the first column. Do not edit them: both guidelines forbid changing
the artwork. They are shown 48 pixels high, above Apple's and Google's minimum sizes.
