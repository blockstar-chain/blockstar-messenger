// mobile/src/constants/theme.ts
// BlockStar Cypher - Dark Midnight Theme Constants

export const COLORS = {
  // Background Colors
  bgPrimary: '#000000',      // Pure black
  bgSecondary: '#030308',    // Secondary backgrounds
  bgCard: '#06060c',         // Card backgrounds
  bgCardHover: '#0a0a12',    // Card hover state
  bgInput: '#0a0a12',        // Input backgrounds
  
  // Border Colors
  border: '#12121f',         // Borders
  borderGlow: '#0066FF',     // Glowing borders
  
  // Text Colors
  textPrimary: '#ffffff',    // Primary text
  textSecondary: '#8a8a9a',  // Secondary text
  textMuted: '#4a4a5a',      // Muted text
  
  // Primary Blue (BlockStar Blue)
  primary: '#0066FF',
  primaryLight: '#1a8cff',
  primaryDark: '#0052cc',
  
  // Cyan Accent
  cyan: '#00c8ff',
  cyanDark: '#00a0cc',
  
  // Status Colors
  success: '#00d67f',
  successDark: '#00a862',
  danger: '#ff3b5c',
  dangerDark: '#cc2f4a',
  warning: '#ffb800',
  warningDark: '#cc9300',
  
  // Gradient Colors
  gradientStart: '#0066FF',
  gradientMid: '#0088ff',
  gradientEnd: '#00c8ff',
  
  // Glow Effects (for shadows)
  glowBlue: 'rgba(0, 102, 255, 0.6)',
  glowCyan: 'rgba(0, 200, 255, 0.4)',
  glowGreen: 'rgba(0, 214, 127, 0.4)',
};

export const SHADOWS = {
  glow: {
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 10,
  },
  glowCyan: {
    shadowColor: COLORS.cyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  glowGreen: {
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 15,
    elevation: 8,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const BORDER_RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const FONT_SIZES = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const FONTS = {
  regular: 'System',
  medium: 'System',
  semibold: 'System',
  bold: 'System',
};

// Common style presets
export const STYLES = {
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
  card: {
    backgroundColor: COLORS.bgCard,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
  },
  input: {
    backgroundColor: COLORS.bgInput,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
  },
  inputFocused: {
    borderColor: COLORS.primary,
  },
  buttonPrimary: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  buttonText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    fontWeight: '600' as const,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.xxxl,
    fontWeight: 'bold' as const,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.lg,
    fontWeight: '600' as const,
    marginBottom: SPACING.sm,
  },
};

export default {
  COLORS,
  SHADOWS,
  SPACING,
  BORDER_RADIUS,
  FONT_SIZES,
  FONTS,
  STYLES,
};
