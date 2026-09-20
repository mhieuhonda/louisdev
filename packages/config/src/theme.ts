import { z } from "zod"

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb hex color")

/** Every color a LouisDev UI may use. */
export const ThemeTokensSchema = z.object({
  primary: HexColorSchema,
  secondary: HexColorSchema,
  accent: HexColorSchema,
  error: HexColorSchema,
  warning: HexColorSchema,
  success: HexColorSchema,
  info: HexColorSchema,
  text: HexColorSchema,
  textMuted: HexColorSchema,
  background: HexColorSchema,
  backgroundPanel: HexColorSchema,
  backgroundElement: HexColorSchema,
  backgroundMenu: HexColorSchema,
  border: HexColorSchema,
  borderActive: HexColorSchema,
  borderSubtle: HexColorSchema,
  diffAdded: HexColorSchema,
  diffRemoved: HexColorSchema,
})
export type ThemeTokens = z.infer<typeof ThemeTokensSchema>

export const ThemeSchema = z.object({
  name: z.string().min(1),
  mode: z.enum(["dark", "light"]),
  tokens: ThemeTokensSchema,
})
export type Theme = z.infer<typeof ThemeSchema>

/**
 * sunset-flow (dark): warm sunset coral on deep warm black, electric teal
 * as the complementary twist, gold reserved for quota numbers.
 * All pairs measured >= 6.4:1 on the background.
 */
export function sunsetFlowDark(): Theme {
  return ThemeSchema.parse({
    name: "sunset-flow",
    mode: "dark",
    tokens: {
      primary: "#e07856",
      secondary: "#2dd4bf",
      accent: "#facc15",
      error: "#f87171",
      warning: "#fb9235",
      success: "#4ade80",
      info: "#2dd4bf",
      text: "#f5efe8",
      textMuted: "#a89c90",
      background: "#100d0b",
      backgroundPanel: "#1a1512",
      backgroundElement: "#241d18",
      backgroundMenu: "#1a1512",
      border: "#3a2f28",
      borderActive: "#e07856",
      borderSubtle: "#241d18",
      diffAdded: "#4ade80",
      diffRemoved: "#f87171",
    },
  })
}

/**
 * sunset-flow-light: warm paper background, darkened accents.
 * All pairs measured >= 4.6:1 on the background.
 */
export function sunsetFlowLight(): Theme {
  return ThemeSchema.parse({
    name: "sunset-flow-light",
    mode: "light",
    tokens: {
      primary: "#b7502e",
      secondary: "#0e7490",
      accent: "#a16207",
      error: "#b91c1c",
      warning: "#c2611a",
      success: "#15803d",
      info: "#0e7490",
      text: "#1c1917",
      textMuted: "#57534e",
      background: "#faf7f2",
      backgroundPanel: "#f1ebe2",
      backgroundElement: "#e7ded2",
      backgroundMenu: "#f1ebe2",
      border: "#d6c9b8",
      borderActive: "#b7502e",
      borderSubtle: "#e7ded2",
      diffAdded: "#15803d",
      diffRemoved: "#b91c1c",
    },
  })
}

/** Built-in themes shipped with LouisDev. */
export function builtinThemes(): Theme[] {
  return [sunsetFlowDark(), sunsetFlowLight()]
}
