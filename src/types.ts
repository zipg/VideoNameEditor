export type ParseStatus = "success" | "failed";
export type RenameResult = "pending" | "success" | "failed";

export type RowFields = {
  videoName: string;
  headCut: number;
  tailCut: number;
  zoomRatio: number;
  zoomMode: 1 | 2 | 3 | 4;
};

export type ManualDraft = {
  videoName: string;
  headCut: string;
  tailCut: string;
  zoomRatio: string;
  zoomMode: string;
};

export type FileRow = {
  id: string;
  path: string;
  fileName: string;
  durationSec: number;
  parseStatus: ParseStatus;
  parseError?: string;
  warningFlags: string[];
  parsedFields?: RowFields;

  selected: boolean;
  renameResult: RenameResult;
  renameError?: string;

  manualOpen?: boolean;
  manualDraft?: ManualDraft;
  modified?: boolean;
};

export type ParseFileRowDto = {
  id: string;
  path: string;
  fileName: string;
  durationSec: number;
  parseStatus: ParseStatus;
  parseError?: string;
  warningFlags: string[];
  parsedFields?: RowFields;
};

export type RenameItemInput = {
  id: string;
  sourcePath: string;
  targetFileName: string;
};

export type RenameItemResult = {
  id: string;
  success: boolean;
  reason?: string;
};

export type RenameBatchSummary = {
  total: number;
  success: number;
  failed: number;
  results: RenameItemResult[];
};
