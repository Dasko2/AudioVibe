export const colors = {
  bg: "#000000",
  surface: "#121212",
  surfaceAlt: "#181818",
  elevated: "#242424",
  border: "#2A2A2A",
  text: "#FFFFFF",
  textMuted: "#B3B3B3",
  accent: "#1DB954",
  accentDim: "#169C46",
  danger: "#E22134",
};

export const spacing = (n) => n * 8;

export const radius = { sm: 4, md: 8, lg: 16, pill: 999 };

export const font = {
  h1: { fontSize: 28, fontWeight: "800", color: colors.text },
  h2: { fontSize: 20, fontWeight: "700", color: colors.text },
  body: { fontSize: 14, color: colors.text },
  muted: { fontSize: 12, color: colors.textMuted },
};
