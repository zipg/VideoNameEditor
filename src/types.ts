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

export type ResolutionRatioStatus = "nineSixteen" | "needsCrop" | "horizontal" | "failed";
export type ResolutionProcessStatus =
  | "pending"
  | "selected"
  | "processing"
  | "success"
  | "failed"
  | "skippedHorizontal"
  | "skippedAlready";

export type ResolutionRow = {
  id: string;
  path: string;
  fileName: string;
  width: number;
  height: number;
  durationSec: number;
  targetWidth: number;
  targetHeight: number;
  orientation: "vertical" | "horizontal" | "unknown";
  ratioStatus: ResolutionRatioStatus;
  processStatus: ResolutionProcessStatus;
  processError?: string;
  progress: number;
  selected: boolean;
};

export type ResolutionInfoDto = Omit<ResolutionRow, "progress" | "selected">;

export type ResolutionProcessInput = {
  id: string;
  sourcePath: string;
  targetWidth: number;
  targetHeight: number;
  overwriteSource: boolean;
};

export type ResolutionProcessResult = {
  id: string;
  success: boolean;
  outputPath?: string;
  outputDir?: string;
  reason?: string;
};

export type ResolutionProgressEvent = {
  id: string;
  progress: number;
};
