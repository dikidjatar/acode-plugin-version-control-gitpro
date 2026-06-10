export const Color = {
  reset: '\x1b[0m',
  green: '\x1b[38;2;106;153;85m',     // #6a9955
  cyan: '\x1b[38;2;78;201;176m',      // #4ec9b0 (cyan)
  orange: '\x1b[38;2;206;145;120m',   // #ce9178 (orange)
  red: '\x1b[38;2;244;71;71m',        // #f44747 (red),
  magenta: '\x1b[35m',
  default: '\x1b[37m',                // #ffffff (white)
} as const;