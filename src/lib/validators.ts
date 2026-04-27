export function hasMaxTwoDecimals(raw: string): boolean {
  if (!raw.includes(".")) return true;
  const [, decimal] = raw.split(".");
  return decimal.length <= 2;
}

export function parsePositiveNumber(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function validateBatchInput(
  headCutRaw: string,
  tailCutRaw: string,
  zoomRatioRaw: string,
  zoomModeRaw: string,
  durationSec: number,
): string | null {
  if (!headCutRaw || !tailCutRaw || !zoomRatioRaw || !zoomModeRaw) return "required";
  if (!hasMaxTwoDecimals(headCutRaw) || !hasMaxTwoDecimals(tailCutRaw) || !hasMaxTwoDecimals(zoomRatioRaw)) {
    return "precision_out_of_range";
  }

  const headCut = parsePositiveNumber(headCutRaw);
  const tailCut = parsePositiveNumber(tailCutRaw);
  const zoomRatio = parsePositiveNumber(zoomRatioRaw);
  const zoomMode = Number(zoomModeRaw);

  if (headCut === null || tailCut === null || zoomRatio === null) return "number_invalid";
  if (headCut < 0 || tailCut < 0) return "cut_negative";
  if (!(zoomRatio > 0 && zoomRatio <= 2)) return "ratio_out_of_range";
  if (![1, 2, 3, 4].includes(zoomMode)) return "mode_out_of_range";
  if (headCut + tailCut >= durationSec) return "cut_exceeds_duration";

  return null;
}
