export interface TerminalInfo {
  isTty: boolean;
  columns: number;
  rows: number;
  color: boolean;
  unicode: boolean;
}

export const getTerminalInfo = (noColor = false): TerminalInfo => ({
  isTty: Boolean(process.stdout.isTTY),
  columns: process.stdout.columns ?? 80,
  rows: process.stdout.rows ?? 24,
  color: !noColor && !process.env.NO_COLOR,
  unicode: process.platform !== "win32" || process.env.WT_SESSION !== undefined,
});
