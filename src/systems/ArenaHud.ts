export const DICE_PREVIEW_ROW_LIMIT = 20;
export const DICE_PREVIEW_ROW_HEIGHT = 16;

export function formatTurnWaveLabel(turn: number, turnLimit: number, wave?: number, maxWaves?: number): string {
  const safeTurn = Number.isFinite(turn) ? Math.max(1, Math.floor(turn)) : 1;
  const turnLimitLabel = Number.isFinite(turnLimit) && turnLimit >= 0 ? `/${Math.floor(turnLimit)}` : '';
  const waveLabel = wave !== undefined && Number.isFinite(wave) && maxWaves !== undefined && Number.isFinite(maxWaves)
    ? ` - WAVE ${Math.max(1, Math.floor(wave))}/${Math.max(1, Math.floor(maxWaves))}`
    : '';
  return `TURN ${safeTurn}${turnLimitLabel}${waveLabel}`;
}

export interface DicePreviewScrollMetrics {
  maxRows: number;
  rowHeight: number;
  viewportHeight: number;
  contentHeight: number;
  maxScroll: number;
  scrollOffset: number;
}

export function getDicePreviewScrollMetrics(
  diceCount: number,
  scrollOffset = 0,
  rowLimit = DICE_PREVIEW_ROW_LIMIT,
  rowHeight = DICE_PREVIEW_ROW_HEIGHT
): DicePreviewScrollMetrics {
  const count = Number.isFinite(diceCount) ? Math.max(0, Math.floor(diceCount)) : 0;
  const rows = Number.isFinite(rowLimit) ? Math.max(1, Math.floor(rowLimit)) : DICE_PREVIEW_ROW_LIMIT;
  const height = Number.isFinite(rowHeight) ? Math.max(1, Math.floor(rowHeight)) : DICE_PREVIEW_ROW_HEIGHT;
  const viewportHeight = Math.min(count, rows) * height;
  const contentHeight = count * height;
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const offset = Number.isFinite(scrollOffset) ? Math.max(0, Math.min(maxScroll, scrollOffset)) : 0;
  return {
    maxRows: rows,
    rowHeight: height,
    viewportHeight,
    contentHeight,
    maxScroll,
    scrollOffset: offset
  };
}
