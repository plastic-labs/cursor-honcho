/**
 * Shared color scheme and styling utilities for honcho CLI
 */

// ANSI color codes - orange to pale light blue gradient
export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  orange: "\x1b[38;5;208m",
  lightOrange: "\x1b[38;5;214m",
  peach: "\x1b[38;5;215m",
  palePeach: "\x1b[38;5;223m",
  paleBlue: "\x1b[38;5;195m",
  lightBlue: "\x1b[38;5;159m",
  skyBlue: "\x1b[38;5;117m",
  brightBlue: "\x1b[38;5;81m",
  success: "\x1b[38;5;114m",
  error: "\x1b[38;5;203m",
  warn: "\x1b[38;5;214m",
  white: "\x1b[38;5;255m",
  gray: "\x1b[38;5;245m",
};

export const symbols = {
  check: String.fromCodePoint(0x2713),
  cross: String.fromCodePoint(0x2717),
  dot: String.fromCodePoint(0x00B7),
  bullet: String.fromCodePoint(0x2022),
  arrow: String.fromCodePoint(0x2192),
  line: String.fromCodePoint(0x2500),
  corner: String.fromCodePoint(0x2514),
  pipe: String.fromCodePoint(0x2502),
  sparkle: String.fromCodePoint(0x2726),
};

export function header(text: string): string {
  const line = symbols.line.repeat(text.length);
  return `${colors.orange}${text}${colors.reset}\n${colors.dim}${line}${colors.reset}`;
}

export function section(text: string): string {
  return `${colors.lightBlue}${text}${colors.reset}`;
}

export function label(text: string): string {
  return `${colors.skyBlue}${text}${colors.reset}`;
}

export function value(text: string): string {
  return `${colors.white}${text}${colors.reset}`;
}

export function dim(text: string): string {
  return `${colors.dim}${text}${colors.reset}`;
}

export function success(message: string): string {
  return `${colors.success}${symbols.check}${colors.reset} ${message}`;
}

export function error(message: string): string {
  return `${colors.error}${symbols.cross}${colors.reset} ${message}`;
}

export function warn(message: string): string {
  return `${colors.warn}!${colors.reset} ${message}`;
}

export function listItem(text: string, indent: number = 0): string {
  const padding = "  ".repeat(indent);
  return `${padding}${colors.dim}${symbols.bullet}${colors.reset} ${text}`;
}

export function keyValue(key: string, val: string): string {
  return `${label(key)}: ${value(val)}`;
}

export function current(text: string): string {
  return `${colors.palePeach}(${text})${colors.reset}`;
}

export function hr(width: number = 40): string {
  return `${colors.dim}${symbols.line.repeat(width)}${colors.reset}`;
}

export function path(p: string): string {
  return `${colors.gray}${p}${colors.reset}`;
}

export function highlight(text: string): string {
  return `${colors.peach}${text}${colors.reset}`;
}
