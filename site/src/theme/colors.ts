/**
 * Leaflet draws to a canvas, which cannot read CSS variables, so the colours the map needs are kept here too
 */
export const MAP_COLORS = {
  dark: {station: "#7d8896", route: "#8ab4ff", split: "#7fd49b", end: "#11141a"},
  light: {station: "#61686f", route: "#1f5fbf", split: "#1f7a3f", end: "#f7f6f3"}
} as const;

export type Theme = keyof typeof MAP_COLORS;
