// Hue identifies context kinds; themePalette adjusts lightness for the surfaces they sit on.
export const CONTEXT_CHIP_ACCENTS = {
  image: { L: 0.62, C: 0.16, h: 16 },
  video: { L: 0.62, C: 0.16, h: 48 },
  file: { L: 0.62, C: 0.136, h: 237 },
  mention: { L: 0.62, C: 0.11, h: 215 },
  terminal: { L: 0.62, C: 0.134, h: 163 },
  element: { L: 0.62, C: 0.134, h: 70 },
  "preview-annotation": { L: 0.62, C: 0.134, h: 70 },
  "review-comment": { L: 0.62, C: 0.16, h: 292 },
  "pull-request": { L: 0.62, C: 0.16, h: 277 },
  "pr-open": { L: 0.62, C: 0.134, h: 163 },
  "pr-draft": { L: 0.62, C: 0.02, h: 259 },
  "pr-merged": { L: 0.62, C: 0.16, h: 292 },
  "pr-closed": { L: 0.62, C: 0.16, h: 16 },
  skill: { L: 0.62, C: 0.16, h: 322 },
  thread: { L: 0.62, C: 0.12, h: 190 },
  citation: { L: 0.62, C: 0.16, h: 259 },
} as const;
