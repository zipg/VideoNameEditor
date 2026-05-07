import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import {
  FileRow,
  ManualDraft,
  MediaRow,
  ParseFileRowDto,
  RenameBatchSummary,
  RenameItemInput,
  ResolutionInfoDto,
  ResolutionProcessInput,
  ResolutionProcessResult,
  ResolutionProgressEvent,
  ResolutionRow,
  RowFields,
} from "./types";
import { reducer, initialState } from "./state/reducer";
import { validateBatchInput } from "./lib/validators";
import "./App.css";

type DragDropPayload = {
  paths?: string[];
};

const ZOOM_MODE_TIP = "1.四面放大 2.上下放大 3.向下拉长 4.向上拉长";
const PAGE_STORAGE_KEY = "video-batch-tool-active-page";
const RESOLUTION_OUTPUT_MODE_STORAGE_KEY = "video-batch-tool-resolution-output-mode";
const RESOLUTION_OPEN_FOLDER_STORAGE_KEY = "video-batch-tool-resolution-open-folder";

function emptyManualDraft(): ManualDraft {
  return {
    videoName: "",
    categories: "",
    headCut: "",
    tailCut: "",
    zoomRatio: "",
    zoomMode: "",
  };
}

function buildFileStem(fileName: string): string {
  return fileName.trim().replace(/\.(mp4|mov)\s*$/i, "");
}
function dtoToRow(dto: ParseFileRowDto): FileRow {
  return {
    ...dto,
    selected: true,
    renameResult: "pending",
    manualOpen: false,
    modified: false,
  };
}

export function parseMediaFileName(fileName: string): Pick<MediaRow, "fileName" | "baseName" | "extension" | "categories"> {
  const dotIndex = fileName.lastIndexOf(".");
  const hasExtension = dotIndex > 0;
  const extension = hasExtension ? fileName.slice(dotIndex) : "";
  const stem = hasExtension ? fileName.slice(0, dotIndex) : fileName;
  const dashIndex = stem.lastIndexOf("-");

  if (dashIndex <= 0) {
    return {
      fileName,
      baseName: stem,
      extension,
      categories: "",
    };
  }

  const rawCategories = stem.slice(dashIndex + 1).trim();
  const parsedCategories = rawCategories
    .split("&")
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");

  if (!parsedCategories) {
    return {
      fileName,
      baseName: stem,
      extension,
      categories: "",
    };
  }

  return {
    fileName,
    baseName: stem.slice(0, dashIndex),
    extension,
    categories: parsedCategories,
  };
}

function emptyMediaRow(path: string): MediaRow {
  const separator = path.includes("\\") ? "\\" : "/";
  const fileName = path.slice(path.lastIndexOf(separator) + 1);
  const parsed = parseMediaFileName(fileName);
  return {
    id: path,
    path,
    ...parsed,
    selected: true,
    renameResult: "pending",
    modified: false,
  };
}

function normalizeCategoriesInput(value: string): string {
  return value.replace(/&/g, "\n");
}

function mediaCategoriesList(categories: string): string[] {
  return normalizeCategoriesInput(categories)
    .split("\n")
    .map((value: string) => value.trim())
    .filter(Boolean);
}

function buildMediaTargetName(row: MediaRow, categories?: string): string {
  const categoryList = categories === undefined ? mediaCategoriesList(row.categories) : mediaCategoriesList(categories);
  if (!categoryList.length) return `${row.baseName}${row.extension}`;
  return `${row.baseName}-${categoryList.join("&")}${row.extension}`;
}

function dtoToResolutionRow(dto: ResolutionInfoDto): ResolutionRow {
  return {
    ...dto,
    selected: dto.ratioStatus === "needsCrop",
    progress: dto.processStatus === "skippedHorizontal" || dto.processStatus === "skippedAlready" ? 100 : 0,
  };
}

function formatResolution(width: number, height: number): string {
  if (!width || !height) return "-";
  return `${width}*${height}`;
}

function fieldsFromDraft(draft: ManualDraft): RowFields {
  const normalized = normalizeDraft(draft);
  return {
    videoName: normalized.videoName,
    categories: normalized.categories.split("\n").map((s) => s.trim()).filter(Boolean),
    headCut: Number(normalized.headCut),
    tailCut: Number(normalized.tailCut),
    zoomRatio: Number(normalized.zoomRatio),
    zoomMode: Number(normalized.zoomMode) as 1 | 2 | 3 | 4,
  };
}

function draftFromRow(row: FileRow): ManualDraft {
  if (row.manualDraft) return row.manualDraft;
  if (row.parsedFields) {
    return {
      videoName: row.parsedFields.videoName,
      categories: row.parsedFields.categories.join("\n"),
      headCut: String(row.parsedFields.headCut),
      tailCut: String(row.parsedFields.tailCut),
      zoomRatio: String(row.parsedFields.zoomRatio),
      zoomMode: String(row.parsedFields.zoomMode),
    };
  }
  return {
    ...emptyManualDraft(),
    videoName: buildFileStem(row.fileName),
  };
}

function normalizeDraft(draft: ManualDraft): ManualDraft {
  return {
    videoName: draft.videoName,
    categories: draft.categories,
    headCut: normalizeNumericField("headCut", draft.headCut),
    tailCut: normalizeNumericField("tailCut", draft.tailCut),
    zoomRatio: normalizeNumericField("zoomRatio", draft.zoomRatio),
    zoomMode: normalizeNumericField("zoomMode", draft.zoomMode),
  };
}

function normalizeNumericField(field: keyof ManualDraft, value: string): string {
  if (field === "videoName" || field === "categories") return value;
  const trimmed = value.trim();
  const isIncompleteDecimal = trimmed === ".";
  if (field === "headCut" || field === "tailCut") return trimmed && !isIncompleteDecimal ? trimmed : "0";
  if (field === "zoomRatio" || field === "zoomMode") return trimmed && !isIncompleteDecimal ? trimmed : "1";
  return value;
}

function canAcceptNumericInput(field: keyof ManualDraft, value: string): boolean {
  if (field === "videoName" || field === "categories") return true;
  if (field === "zoomMode") return value === "" || /^[1-4]$/.test(value);
  return value === "" || /^\d*(\.\d{0,2})?$/.test(value);
}

function trimNum(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return `${rounded}`;
  return rounded.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function floorToTwoDecimals(value: number): number {
  return Math.max(0, Math.floor(value * 100) / 100);
}

function formatDuration(durationSec: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationSec));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (hours > 0) return `${String(hours).padStart(2, "0")}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

function draftNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function durationChange(row: FileRow, draft: ManualDraft): { original: string; edited: string | null; warning: boolean } {
  const original = formatDuration(row.durationSec);
  const headCut = Math.max(0, draftNumber(draft.headCut, 0));
  const tailCut = Math.max(0, draftNumber(draft.tailCut, 0));
  const cutTotal = headCut + tailCut;

  if (cutTotal <= 0) return { original, edited: null, warning: false };

  const editedDuration = Math.max(0, row.durationSec - cutTotal);
  return {
    original,
    edited: formatDuration(editedDuration),
    warning: editedDuration < 1,
  };
}

function parseErrorToText(error?: string): string {
  if (!error) return "未知错误";

  const primary = error.split(" | ")[0].trim();

  switch (primary) {
    case "cut_exceeds_duration":
      return "头尾切除时长之和不能大于等于视频总时长（cut_exceeds_duration）";
    case "mode_out_of_range":
      return "放大模式必须是 1-4（mode_out_of_range）";
    case "ratio_out_of_range":
      return "放大比例必须大于 0 且不超过 2（ratio_out_of_range）";
    case "head_invalid":
      return "头部切除数值无效（head_invalid）";
    case "tail_invalid":
      return "尾部切除数值无效（tail_invalid）";
    case "ratio_invalid":
      return "放大比例数值无效（ratio_invalid）";
    case "mode_invalid":
      return "放大模式数值无效（mode_invalid）";
    case "segment_count_invalid":
      return "文件名段数不足，格式不符合规则（segment_count_invalid）";
    case "video_name_invalid":
      return "视频名为空（video_name_invalid）";
    case "precision_out_of_range":
      return "头尾切除和比例最多保留两位小数（precision_out_of_range）";
    case "not_mp4_or_mov":
      return "文件后缀不是 .mp4 或 .mov（not_mp4_or_mov）";
    case "cut_negative":
      return "头部或尾部切除不能为负数（cut_negative）";
    default:
      return `${error}`;
  }
}

function buildTargetName(
  row: FileRow,
  fields: Pick<RowFields, "headCut" | "tailCut" | "zoomRatio" | "zoomMode"> & Partial<Pick<RowFields, "videoName" | "categories">>,
): string {
  const stem = buildFileStem(row.fileName);
  const base = fields.videoName ?? (row.parseStatus === "success" && row.parsedFields ? row.parsedFields.videoName : stem);
  const ext = /\.mov\s*$/i.test(row.fileName.trim()) ? ".mov" : ".mp4";
  const categories = fields.categories ?? (row.parseStatus === "success" ? row.parsedFields?.categories : undefined);
  const catStr = categories && categories.length > 0 ? categories.join("&") : "";
  if (catStr) {
    return `${base}-${catStr}-${trimNum(fields.headCut)}-${trimNum(fields.tailCut)}-${trimNum(fields.zoomRatio)}-${fields.zoomMode}${ext}`;
  }
  return `${base}-${trimNum(fields.headCut)}-${trimNum(fields.tailCut)}-${trimNum(fields.zoomRatio)}-${fields.zoomMode}${ext}`;
}

function buildTargetPath(sourcePath: string, targetFileName: string): string {
  const separator = sourcePath.includes("\\") ? "\\" : "/";
  const index = sourcePath.lastIndexOf(separator);
  return index === -1 ? targetFileName : `${sourcePath.slice(0, index + 1)}${targetFileName}`;
}

function rowBaseVideoName(row: FileRow): string {
  if (row.manualDraft?.videoName.trim()) return row.manualDraft.videoName.trim();
  if (row.parsedFields?.videoName.trim()) return row.parsedFields.videoName.trim();
  return buildFileStem(row.fileName);
}

function renamedFields(
  row: FileRow,
  fields: Pick<RowFields, "headCut" | "tailCut" | "zoomRatio" | "zoomMode"> & Partial<Pick<RowFields, "videoName" | "categories">>,
): RowFields {
  return {
    videoName: fields.videoName?.trim() || rowBaseVideoName(row),
    categories: fields.categories ?? row.parsedFields?.categories ?? [],
    headCut: fields.headCut,
    tailCut: fields.tailCut,
    zoomRatio: fields.zoomRatio,
    zoomMode: fields.zoomMode,
  };
}

function clampCutDraft(draft: ManualDraft, field: keyof ManualDraft, durationSec: number): ManualDraft {
  const normalized = normalizeDraft(draft);
  if (durationSec <= 0 || (field !== "headCut" && field !== "tailCut")) return normalized;

  const otherField = field === "headCut" ? "tailCut" : "headCut";
  const current = Number(normalized[field]);
  const other = Number(normalized[otherField]);
  const maxValue = floorToTwoDecimals(durationSec - other - 0.01);
  const clamped = Math.min(current, maxValue);

  return {
    ...normalized,
    [field]: trimNum(clamped),
  };
}

function App() {
  const [appState, dispatch] = useReducer(reducer, initialState);
  const [activePage, setActivePage] = useState<"filename" | "resolution" | "media">(() => {
    const stored = window.localStorage.getItem(PAGE_STORAGE_KEY);
    return stored === "resolution" || stored === "media" ? stored : "filename";
  });
  const [rows, setRows] = useState<FileRow[]>([]);
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [batchForm, setBatchForm] = useState<Pick<ManualDraft, "headCut" | "tailCut" | "zoomRatio" | "zoomMode" | "categories">>({
    headCut: "",
    tailCut: "",
    zoomRatio: "",
    zoomMode: "",
    categories: "",
  });
  const [showGuardModal, setShowGuardModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showErrorPanel, setShowErrorPanel] = useState(false);
  const [errorLog, setErrorLog] = useState<string[]>([]);
  const [resolutionRows, setResolutionRows] = useState<ResolutionRow[]>([]);
  const [showResolutionBatch, setShowResolutionBatch] = useState(false);
  const [mediaRows, setMediaRows] = useState<MediaRow[]>([]);
  const [showMediaBatchEdit, setShowMediaBatchEdit] = useState(false);
  const [mediaBatchCategories, setMediaBatchCategories] = useState("");
  const [resolutionOutputMode, setResolutionOutputMode] = useState<"newFile" | "overwrite">(() => {
    const stored = window.localStorage.getItem(RESOLUTION_OUTPUT_MODE_STORAGE_KEY);
    return stored === "overwrite" ? "overwrite" : "newFile";
  });
  const [openOutputFolder, setOpenOutputFolder] = useState(() => {
    const stored = window.localStorage.getItem(RESOLUTION_OPEN_FOLDER_STORAGE_KEY);
    return stored !== "false";
  });
  const [isResolutionProcessing, setIsResolutionProcessing] = useState(false);
  const [overallResolutionProgress, setOverallResolutionProgress] = useState(0);
  const pendingFilesRef = useRef<string[] | null>(null);
  const pendingPickRef = useRef(false);
  const rowsRef = useRef<FileRow[]>([]);
  const mediaRowsRef = useRef<MediaRow[]>([]);
  const activePageRef = useRef(activePage);
  const resolutionProcessingRef = useRef(isResolutionProcessing);
  const guardRef = useRef(appState.guard);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    mediaRowsRef.current = mediaRows;
  }, [mediaRows]);

  useEffect(() => {
    activePageRef.current = activePage;
    window.localStorage.setItem(PAGE_STORAGE_KEY, activePage);
  }, [activePage]);

  useEffect(() => {
    resolutionProcessingRef.current = isResolutionProcessing;
  }, [isResolutionProcessing]);

  useEffect(() => {
    window.localStorage.setItem(RESOLUTION_OUTPUT_MODE_STORAGE_KEY, resolutionOutputMode);
  }, [resolutionOutputMode]);

  useEffect(() => {
    window.localStorage.setItem(RESOLUTION_OPEN_FOLDER_STORAGE_KEY, String(openOutputFolder));
  }, [openOutputFolder]);

  useEffect(() => {
    guardRef.current = appState.guard;
  }, [appState.guard]);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => (a.parseStatus === b.parseStatus ? 0 : a.parseStatus === "failed" ? -1 : 1)),
    [rows],
  );
  const resolutionRowsSorted = useMemo(
    () => [
      ...resolutionRows.filter((row) => row.ratioStatus === "needsCrop"),
      ...resolutionRows.filter((row) => row.ratioStatus !== "needsCrop"),
    ],
    [resolutionRows],
  );
  const selectedResolutionRows = useMemo(
    () => resolutionRows.filter((row) => row.selected && row.ratioStatus === "needsCrop"),
    [resolutionRows],
  );
  function appendError(title: string, error: unknown) {
    const message = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error);
    setErrorLog((prev) => [
      ...prev,
      `[${new Date().toLocaleString()}] ${title}\n${message}`,
    ]);
  }

  function resetAfterParse(parsedRows: FileRow[]) {
    setRows(parsedRows);
    setErrorLog([]);
    setShowErrorPanel(false);
    const successCount = parsedRows.filter((row) => row.parseStatus === "success").length;
    const failedRows = parsedRows.filter((row) => row.parseStatus === "failed");
    const failedCount = failedRows.length;
    window.alert(`文件名解析成功 ${successCount} 个，失败 ${failedCount} 个`);

    const diagnostics = parsedRows.filter((row) => (row.parseError || "").includes("probe_"));

    if (failedRows.length || diagnostics.length) {
      setErrorLog([
        ...failedRows.map(
          (row) =>
            `[${new Date().toLocaleString()}] 文件名解析失败\n${row.fileName}\n原因：${parseErrorToText(row.parseError)}`,
        ),
        ...diagnostics.map(
          (row) =>
            `[${new Date().toLocaleString()}] 时长探测诊断\n${row.fileName}\n详情：${row.parseError}`,
        ),
      ]);
    }

    dispatch({ type: "MARK_DIRTY", value: false });
    setShowBatchEdit(false);
    setBatchForm({ headCut: "", tailCut: "", zoomRatio: "", zoomMode: "", categories: "" });
  }

  function resetMediaRows(parsedRows: MediaRow[]) {
    setMediaRows(parsedRows);
    setShowMediaBatchEdit(false);
    setMediaBatchCategories("");
    setErrorLog([]);
    setShowErrorPanel(false);
    dispatch({ type: "MARK_DIRTY", value: false });
  }

  function hasUnfinishedChanges(currentRows = rows, guard = appState.guard) {
    return (
      guard.hasUnsavedChanges ||
      guard.isRenaming ||
      guard.hasPartialFailure ||
      currentRows.some((row) => row.modified)
    );
  }

  function hasUnfinishedMediaChanges(currentRows = mediaRows, guard = appState.guard) {
    return (
      guard.hasUnsavedChanges ||
      guard.isRenaming ||
      guard.hasPartialFailure ||
      currentRows.some((row) => row.modified)
    );
  }

  async function requestParseInputPaths(paths: string[]) {
    if (hasUnfinishedChanges()) {
      pendingPickRef.current = false;
      pendingFilesRef.current = paths;
      setShowGuardModal(true);
      return;
    }

    await parseInputPaths(paths);
  }

  async function requestMediaInputPaths(paths: string[]) {
    if (hasUnfinishedMediaChanges()) {
      pendingPickRef.current = false;
      pendingFilesRef.current = paths;
      setShowGuardModal(true);
      return;
    }

    await parseMediaInputPaths(paths);
  }

  async function routeInputPaths(paths: string[]) {
    if (activePageRef.current === "resolution") {
      await parseResolutionInputPaths(paths);
      return;
    }

    if (activePageRef.current === "media") {
      await requestMediaInputPaths(paths);
      return;
    }

    await requestParseInputPaths(paths);
  }

  async function parseInputPaths(paths: string[]) {
    const normalizedPaths = paths.map((p) => p.trim()).filter(Boolean);
    const videoPaths = normalizedPaths.filter((p) => /\.(mp4|mov)$/i.test(p));
    setErrorLog([]);
    setShowErrorPanel(false);

    if (!videoPaths.length) {
      appendError("未找到可解析的视频文件", "请确认选择或拖拽的是 .mp4 或 .mov 文件");
      return;
    }

    try {
      const result = await invoke<ParseFileRowDto[]>("parse_files", { paths: videoPaths });
      const parsedRows = result.map(dtoToRow);
      resetAfterParse(parsedRows);
    } catch (error) {
      appendError("调用 parse_files 失败", error);
      window.alert("解析失败，请查看下方错误信息。\n如果是拖拽导入，建议优先使用“批量解析”按钮。");
    }
  }

  async function parseMediaInputPaths(paths: string[]) {
    const normalizedPaths = paths.map((p) => p.trim()).filter(Boolean);
    const mediaPaths = normalizedPaths.filter((p) => /\.(png|jpg|jpeg|mp3|wav)$/i.test(p));
    setErrorLog([]);
    setShowErrorPanel(false);

    if (!mediaPaths.length) {
      appendError("未找到可处理的图片/音乐文件", "请确认选择或拖拽的是 .png / .jpg / .jpeg / .mp3 / .wav 文件");
      return;
    }

    resetMediaRows(mediaPaths.map(emptyMediaRow));
  }

  async function parseResolutionInputPaths(paths: string[]) {
    if (resolutionProcessingRef.current) {
      window.alert("正在处理视频，请等待完成后再导入新文件。");
      return;
    }

    const normalizedPaths = paths.map((p) => p.trim()).filter(Boolean);
    const videoPaths = normalizedPaths.filter((p) => /\.(mp4|mov)$/i.test(p));
    setErrorLog([]);
    setShowErrorPanel(false);

    if (!videoPaths.length) {
      appendError("未找到可处理的视频文件", "请确认选择或拖拽的是 .mp4 或 .mov 文件");
      return;
    }

    try {
      const result = await invoke<ResolutionInfoDto[]>("probe_resolution_files", { paths: videoPaths });
      const parsedRows = result.map(dtoToResolutionRow);
      setResolutionRows(parsedRows);
      setShowResolutionBatch(false);
      setOverallResolutionProgress(0);
      const failedRows = parsedRows.filter((row) => row.processStatus === "failed");
      if (failedRows.length) {
        setErrorLog(
          failedRows.map(
            (row) =>
              `[${new Date().toLocaleString()}] 分辨率探测失败\n${row.fileName}\n原因：${row.processError || "未知错误"}`,
          ),
        );
      }
      window.alert(`分辨率读取完成：${parsedRows.length - failedRows.length} 个成功，${failedRows.length} 个失败`);
    } catch (error) {
      appendError("调用 probe_resolution_files 失败", error);
      window.alert("分辨率读取失败，请查看下方错误信息。");
    }
  }

  function onMediaCategoriesChange(rowId: string, value: string) {
    const normalizedValue = normalizeCategoriesInput(value);
    setMediaRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              categories: normalizedValue,
              modified: true,
            }
          : row,
      ),
    );
    dispatch({ type: "MARK_DIRTY", value: true });
  }

  function onMediaBatchEdit() {
    setShowMediaBatchEdit((prev) => !prev);
    setMediaRows((prev) => prev.map((row) => ({ ...row, selected: true })));
  }

  function onToggleMediaSelect(rowId: string, value: boolean) {
    setMediaRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, selected: value } : row)));
  }

  function onMediaBatchCategoriesChange(value: string) {
    setMediaBatchCategories(normalizeCategoriesInput(value));
    dispatch({ type: "MARK_DIRTY", value: true });
  }

  async function onSaveMediaRow(rowId: string) {
    const row = mediaRows.find((item) => item.id === rowId);
    if (!row) return;

    const normalizedCategories = normalizeCategoriesInput(row.categories);
    const targetFileName = buildMediaTargetName(row, normalizedCategories);

    if (targetFileName === row.fileName) {
      setMediaRows((prev) =>
        prev.map((item) =>
          item.id === rowId
            ? {
                ...item,
                categories: normalizedCategories,
                modified: false,
              }
            : item,
        ),
      );
      if (!mediaRows.some((item) => item.id !== rowId && item.modified)) {
        dispatch({ type: "MARK_DIRTY", value: false });
      }
      return;
    }

    dispatch({ type: "RENAME_STARTED" });

    try {
      const result = await invoke<RenameBatchSummary>("execute_batch_rename", {
        items: [{ id: row.id, sourcePath: row.path, targetFileName }],
      });
      const itemResult = result.results[0];
      dispatch({ type: "RENAME_FINISHED", success: result.success, failed: result.failed });

      setMediaRows((prev) =>
        prev.map((item) => {
          if (item.id !== rowId) return item;
          if (!itemResult?.success) {
            return {
              ...item,
              renameResult: "failed",
              renameError: itemResult?.reason,
            };
          }

          const nextPath = buildTargetPath(item.path, targetFileName);
          return {
            ...item,
            id: nextPath,
            path: nextPath,
            fileName: targetFileName,
            categories: normalizedCategories,
            renameResult: "success",
            renameError: undefined,
            modified: false,
          };
        }),
      );
      if (itemResult?.success && !mediaRows.some((item) => item.id !== rowId && item.modified)) {
        dispatch({ type: "MARK_DIRTY", value: false });
      }
    } catch (error) {
      appendError("调用 execute_batch_rename 失败", error);
      dispatch({ type: "RENAME_FINISHED", success: 0, failed: 1 });
      window.alert("单行保存失败，请查看下方错误信息。");
    }
  }

  async function onSaveMediaBatch() {
    if (!showMediaBatchEdit) return;

    const selectedRows = mediaRows.filter((row) => row.selected);
    if (!selectedRows.length) return;

    const normalizedCategories = normalizeCategoriesInput(mediaBatchCategories);
    setMediaBatchCategories(normalizedCategories);

    const renameItems: RenameItemInput[] = [];
    let unchangedCount = 0;

    for (const row of selectedRows) {
      const targetFileName = buildMediaTargetName(row, normalizedCategories);
      if (targetFileName === row.fileName) {
        unchangedCount += 1;
        continue;
      }

      renameItems.push({
        id: row.id,
        sourcePath: row.path,
        targetFileName,
      });
    }

    if (!renameItems.length) {
      setMediaRows((prev) =>
        prev.map((row) =>
          row.selected
            ? {
                ...row,
                categories: normalizedCategories,
                modified: false,
              }
            : row,
        ),
      );
      dispatch({ type: "MARK_DIRTY", value: false });
      window.alert(`${unchangedCount} 个图片/音乐文件名无变化`);
      return;
    }

    dispatch({ type: "RENAME_STARTED" });

    try {
      const result = await invoke<RenameBatchSummary>("execute_batch_rename", {
        items: renameItems,
      });

      dispatch({ type: "RENAME_FINISHED", success: result.success, failed: result.failed });
      window.alert(
        `批量修改完成：${result.success} 个成功，${result.failed} 个失败，${unchangedCount} 个图片/音乐文件名无变化`,
      );

      setMediaRows((prev) =>
        prev.map((row) => {
          const matched = result.results.find((item) => item.id === row.id);
          if (!matched) {
            if (!row.selected) return row;
            return {
              ...row,
              categories: normalizedCategories,
              modified: false,
            };
          }
          if (matched.success) {
            const targetFileName = buildMediaTargetName(row, normalizedCategories);
            const nextPath = buildTargetPath(row.path, targetFileName);
            return {
              ...row,
              id: nextPath,
              path: nextPath,
              fileName: targetFileName,
              categories: normalizedCategories,
              renameResult: "success",
              renameError: undefined,
              modified: false,
            };
          }

          return {
            ...row,
            categories: normalizedCategories,
            renameResult: "failed",
            renameError: matched.reason,
          };
        }),
      );
    } catch (error) {
      appendError("调用 execute_batch_rename 失败", error);
      dispatch({ type: "RENAME_FINISHED", success: 0, failed: renameItems.length });
      window.alert("批量重命名失败，请查看下方错误信息。");
    }
  }


  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<DragDropPayload>(TauriEvent.DRAG_DROP, (event) => {
      const droppedPaths = event.payload.paths || [];
      if (!droppedPaths.length) return;

      if (activePageRef.current === "filename" && hasUnfinishedChanges(rowsRef.current, guardRef.current)) {
        pendingPickRef.current = false;
        pendingFilesRef.current = droppedPaths;
        setShowGuardModal(true);
        return;
      }

      if (activePageRef.current === "media" && hasUnfinishedMediaChanges(mediaRowsRef.current, guardRef.current)) {
        pendingPickRef.current = false;
        pendingFilesRef.current = droppedPaths;
        setShowGuardModal(true);
        return;
      }

      void routeInputPaths(droppedPaths);
    }).then((handler) => {
      unlisten = handler;
    }).catch((error) => appendError("注册拖拽监听失败", error));

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isResolutionProcessing || !selectedResolutionRows.length) return;
    const total = selectedResolutionRows.reduce((sum, row) => sum + row.progress, 0);
    setOverallResolutionProgress(Math.round((total / selectedResolutionRows.length) * 10) / 10);
  }, [isResolutionProcessing, selectedResolutionRows]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<ResolutionProgressEvent>("resolution-progress", (event) => {
      setResolutionRows((prev) =>
        prev.map((row) =>
          row.id === event.payload.id
            ? {
                ...row,
                progress: event.payload.progress,
                processStatus: event.payload.progress >= 100 ? "success" : "processing",
              }
            : row,
        ),
      );
    }).then((handler) => {
      unlisten = handler;
    }).catch((error) => appendError("注册分辨率进度监听失败", error));

    return () => {
      unlisten?.();
    };
  }, []);

  async function pickFilesFromDialog() {
    try {
      const filters = activePage === "media"
        ? [{ name: "图片/音乐文件", extensions: ["png", "jpg", "jpeg", "mp3", "wav"] }]
        : [{ name: "视频文件", extensions: ["mp4", "mov"] }];
      const picked = await open({
        multiple: true,
        filters,
      });
      if (!picked) return;

      const paths = Array.isArray(picked) ? picked : [picked];
      await routeInputPaths(paths);
    } catch (error) {
      appendError("打开文件选择器失败", error);
      window.alert("打开文件选择器失败，请查看下方错误信息。");
    }
  }

  async function onPickFiles() {
    if (activePage === "filename" && hasUnfinishedChanges()) {
      pendingFilesRef.current = null;
      pendingPickRef.current = true;
      setShowGuardModal(true);
      return;
    }

    if (activePage === "media" && hasUnfinishedMediaChanges()) {
      pendingFilesRef.current = null;
      pendingPickRef.current = true;
      setShowGuardModal(true);
      return;
    }

    await pickFilesFromDialog();
  }

  async function onDropFiles(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();

    const filePaths = Array.from(event.dataTransfer.files || [])
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => !!path);

    const itemPaths = Array.from(event.dataTransfer.items || [])
      .map((item) => {
        if (item.kind !== "file") return undefined;
        const file = item.getAsFile();
        return (file as File & { path?: string } | null)?.path;
      })
      .filter((path): path is string => !!path);

    const droppedPaths = [...new Set([...filePaths, ...itemPaths])];

    if (!droppedPaths.length) {
      appendError("拖拽导入失败", "未能读取拖拽文件路径，请点击拖拽区域或“批量解析”按钮选择文件。");
      window.alert("拖拽导入失败，请点击拖拽区域或“批量解析”按钮。\n详细错误见下方错误信息区。");
      return;
    }

    await routeInputPaths(droppedPaths);
  }

  function onClearList() {
    setShowClearModal(true);
  }

  function onConfirmClearList() {
    setShowClearModal(false);
    pendingFilesRef.current = null;
    pendingPickRef.current = false;

    if (activePage === "media") {
      setMediaRows([]);
      setShowMediaBatchEdit(false);
      setMediaBatchCategories("");
      setErrorLog([]);
      setShowErrorPanel(false);
      dispatch({ type: "MARK_DIRTY", value: false });
      return;
    }

    setRows([]);
    setShowBatchEdit(false);
    setBatchForm({ headCut: "", tailCut: "", zoomRatio: "", zoomMode: "", categories: "" });
    setErrorLog([]);
    setShowErrorPanel(false);
    dispatch({ type: "MARK_DIRTY", value: false });
  }

  function onManualOpen(rowId: string) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              manualOpen: true,
              manualDraft: row.manualDraft || emptyManualDraft(),
            }
          : row,
      ),
    );
  }

  function onManualFieldChange(rowId: string, field: keyof ManualDraft, value: string) {
    if (!canAcceptNumericInput(field, value)) return;

    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        return {
          ...row,
          manualDraft: { ...(row.manualDraft || emptyManualDraft()), [field]: value },
          modified: true,
        };
      }),
    );
    dispatch({ type: "MARK_DIRTY", value: true });
  }

  function onDraftFieldBlur(rowId: string, field: keyof ManualDraft) {
    if (field === "videoName") return;

    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        const draft = draftFromRow(row);
        const normalizedDraft = clampCutDraft(draft, field, row.durationSec);

        return {
          ...row,
          manualDraft: normalizedDraft,
        };
      }),
    );
  }

  function onVideoNameChange(rowId: string, value: string) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;

        if (row.parseStatus === "success" && row.parsedFields) {
          const draft = draftFromRow(row);
          return {
            ...row,
            manualDraft: { ...draft, videoName: value },
            modified: true,
          };
        }

        return {
          ...row,
          manualDraft: { ...(row.manualDraft || emptyManualDraft()), videoName: value },
          modified: true,
        };
      }),
    );
    dispatch({ type: "MARK_DIRTY", value: true });
  }

  function onCategoriesChange(rowId: string, value: string) {
    const normalizedValue = normalizeCategoriesInput(value);
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        const draft = draftFromRow(row);
        return {
          ...row,
          manualDraft: { ...draft, categories: normalizedValue },
          modified: true,
        };
      }),
    );
    dispatch({ type: "MARK_DIRTY", value: true });
  }

  function onParsedFieldChange(
    rowId: string,
    field: "headCut" | "tailCut" | "zoomRatio" | "zoomMode",
    value: string,
  ) {
    if (!canAcceptNumericInput(field, value)) return;

    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId || row.parseStatus !== "success" || !row.parsedFields) return row;

        const draft = draftFromRow(row);

        return {
          ...row,
          manualDraft: { ...draft, [field]: value },
          modified: true,
        };
      }),
    );
    dispatch({ type: "MARK_DIRTY", value: true });
  }

  async function onApplyManual(rowId: string) {
    const row = rows.find((item) => item.id === rowId);
    if (!row || !row.manualDraft) return;

    const draft = normalizeDraft(row.manualDraft);
    const error = validateBatchInput(draft.headCut, draft.tailCut, draft.zoomRatio, draft.zoomMode, row.durationSec);
    if (error) {
      window.alert("手动设置参数不合法，请检查输入。\n规则：模式1-4、比例<=2、头尾和<时长");
      return;
    }

    const fields = fieldsFromDraft({
      ...draft,
      videoName: draft.videoName.trim() || buildFileStem(row.fileName),
    });
    const targetFileName = buildTargetName(row, fields);

    if (targetFileName === row.fileName) {
      setRows((prev) =>
        prev.map((item) =>
          item.id === rowId
            ? {
                ...item,
                parseStatus: "success",
                parsedFields: fields,
                parseError: undefined,
                manualDraft: undefined,
                manualOpen: false,
                modified: false,
                renameResult: "success",
                renameError: undefined,
              }
            : item,
        ),
      );
      if (!rows.some((item) => item.id !== rowId && item.modified)) {
        dispatch({ type: "MARK_DIRTY", value: false });
      }
      return;
    }

    dispatch({ type: "RENAME_STARTED" });

    try {
      const result = await invoke<RenameBatchSummary>("execute_batch_rename", {
        items: [{ id: row.id, sourcePath: row.path, targetFileName }],
      });
      const itemResult = result.results[0];
      dispatch({ type: "RENAME_FINISHED", success: result.success, failed: result.failed });

      setRows((prev) =>
        prev.map((item) => {
          if (item.id !== rowId) return item;
          if (!itemResult?.success) {
            return {
              ...item,
              renameResult: "failed",
              renameError: itemResult?.reason,
            };
          }

          const nextPath = buildTargetPath(item.path, targetFileName);
          return {
            ...item,
            id: nextPath,
            path: nextPath,
            fileName: targetFileName,
            parseStatus: "success",
            parsedFields: fields,
            parseError: undefined,
            warningFlags: [],
            manualDraft: undefined,
            manualOpen: false,
            modified: false,
            renameResult: "success",
            renameError: undefined,
          };
        }),
      );
      if (itemResult?.success && !rows.some((item) => item.id !== rowId && item.modified)) {
        dispatch({ type: "MARK_DIRTY", value: false });
      }
    } catch (error) {
      appendError("调用 execute_batch_rename 失败", error);
      dispatch({ type: "RENAME_FINISHED", success: 0, failed: 1 });
      window.alert("手动应用失败，请查看下方错误信息。");
    }
  }

  async function onSaveRow(rowId: string) {
    const row = rows.find((item) => item.id === rowId);
    if (!row || row.parseStatus !== "success") return;

    const draft = normalizeDraft(draftFromRow(row));
    const error = validateBatchInput(draft.headCut, draft.tailCut, draft.zoomRatio, draft.zoomMode, row.durationSec);
    if (error) {
      window.alert(`单行参数校验失败: ${error}`);
      return;
    }

    const fields = fieldsFromDraft({
      ...draft,
      videoName: draft.videoName.trim() || buildFileStem(row.fileName),
    });
    const targetFileName = buildTargetName(row, fields);

    if (targetFileName === row.fileName) {
      setRows((prev) =>
        prev.map((item) =>
          item.id === rowId
            ? {
                ...item,
                parsedFields: fields,
                manualDraft: undefined,
                modified: false,
              }
            : item,
        ),
      );
      if (!rows.some((item) => item.id !== rowId && item.modified)) {
        dispatch({ type: "MARK_DIRTY", value: false });
      }
      return;
    }

    dispatch({ type: "RENAME_STARTED" });

    try {
      const result = await invoke<RenameBatchSummary>("execute_batch_rename", {
        items: [{ id: row.id, sourcePath: row.path, targetFileName }],
      });
      const itemResult = result.results[0];
      dispatch({ type: "RENAME_FINISHED", success: result.success, failed: result.failed });

      setRows((prev) =>
        prev.map((item) => {
          if (item.id !== rowId) return item;
          if (!itemResult?.success) {
            return {
              ...item,
              renameResult: "failed",
              renameError: itemResult?.reason,
            };
          }

          const nextPath = buildTargetPath(item.path, targetFileName);
          return {
            ...item,
            id: nextPath,
            path: nextPath,
            fileName: targetFileName,
            parsedFields: fields,
            manualDraft: undefined,
            modified: false,
            renameResult: "success",
            renameError: undefined,
          };
        }),
      );
      if (itemResult?.success && !rows.some((item) => item.id !== rowId && item.modified)) {
        dispatch({ type: "MARK_DIRTY", value: false });
      }
    } catch (error) {
      appendError("调用 execute_batch_rename 失败", error);
      dispatch({ type: "RENAME_FINISHED", success: 0, failed: 1 });
      window.alert("单行保存失败，请查看下方错误信息。");
    }
  }

  function onBatchEdit() {
    setShowBatchEdit((prev) => !prev);
    setRows((prev) => prev.map((row) => ({ ...row, selected: true })));
  }

  function onToggleSelect(rowId: string, value: boolean) {
    setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, selected: value } : row)));
  }

  function onBatchFieldChange(field: "headCut" | "tailCut" | "zoomRatio" | "zoomMode", value: string) {
    if (!canAcceptNumericInput(field, value)) return;
    setBatchForm((prev) => ({ ...prev, [field]: value }));
    dispatch({ type: "MARK_DIRTY", value: true });
  }

  function onBatchCategoriesChange(value: string) {
    setBatchForm((prev) => ({
      ...prev,
      categories: normalizeCategoriesInput(value),
    }));
    dispatch({ type: "MARK_DIRTY", value: true });
  }

  function onBatchFieldBlur(field: "headCut" | "tailCut" | "zoomRatio" | "zoomMode") {
    const selectedRows = rows.filter((row) => row.selected);
    const shortestDuration = selectedRows
      .map((row) => row.durationSec)
      .filter((duration) => duration > 0)
      .sort((a, b) => a - b)[0] ?? 0;

    setBatchForm((prev) => {
      const normalized = clampCutDraft({ videoName: "", ...prev }, field, shortestDuration);
      return {
        headCut: normalized.headCut,
        tailCut: normalized.tailCut,
        zoomRatio: normalized.zoomRatio,
        zoomMode: normalized.zoomMode,
        categories: prev.categories,
      };
    });
  }

  async function onSaveBatch() {
    if (!showBatchEdit) return;

    const selectedRows = rows.filter((row) => row.selected);
    if (!selectedRows.length) return;
    const normalizedBatchForm = normalizeDraft({ videoName: "", ...batchForm });
    const batchCategories = normalizedBatchForm.categories.trim()
      ? normalizedBatchForm.categories.split("\n").map((value) => value.trim()).filter(Boolean)
      : undefined;

    for (const row of selectedRows) {
      const error = validateBatchInput(
        normalizedBatchForm.headCut,
        normalizedBatchForm.tailCut,
        normalizedBatchForm.zoomRatio,
        normalizedBatchForm.zoomMode,
        row.durationSec,
      );
      if (error) {
        window.alert(`批量参数校验失败: ${error}`);
        return;
      }
    }

    setBatchForm({
      headCut: normalizedBatchForm.headCut,
      tailCut: normalizedBatchForm.tailCut,
      zoomRatio: normalizedBatchForm.zoomRatio,
      zoomMode: normalizedBatchForm.zoomMode,
      categories: normalizedBatchForm.categories,
    });

    const fields = {
      headCut: Number(normalizedBatchForm.headCut),
      tailCut: Number(normalizedBatchForm.tailCut),
      zoomRatio: Number(normalizedBatchForm.zoomRatio),
      zoomMode: Number(normalizedBatchForm.zoomMode) as 1 | 2 | 3 | 4,
      categories: batchCategories,
    };

    const renameItems: RenameItemInput[] = [];
    let unchangedCount = 0;

    for (const row of selectedRows) {
      const targetFileName = buildTargetName(row, fields);
      if (targetFileName === row.fileName) {
        unchangedCount += 1;
        continue;
      }

      renameItems.push({
        id: row.id,
        sourcePath: row.path,
        targetFileName,
      });
    }

    if (!renameItems.length) {
      dispatch({ type: "MARK_DIRTY", value: false });
      window.alert(`${unchangedCount} 个视频文件名无变化`);
      return;
    }

    dispatch({ type: "RENAME_STARTED" });

    try {
      const result = await invoke<RenameBatchSummary>("execute_batch_rename", {
        items: renameItems,
      });

      dispatch({ type: "RENAME_FINISHED", success: result.success, failed: result.failed });
      window.alert(
        `批量修改完成：${result.success} 个成功，${result.failed} 个失败，${unchangedCount} 个视频文件名无变化`,
      );

      setRows((prev) =>
        prev.map((row) => {
          const matched = result.results.find((item) => item.id === row.id);
          if (!matched) return row;
          if (matched.success) {
            const targetFileName = buildTargetName(row, fields);
            const nextPath = buildTargetPath(row.path, targetFileName);
            return {
              ...row,
              id: nextPath,
              path: nextPath,
              fileName: targetFileName,
              parseStatus: "success",
              parseError: undefined,
              warningFlags: [],
              parsedFields: renamedFields(row, fields),
              manualDraft: undefined,
              manualOpen: false,
              modified: false,
              renameResult: "success",
              renameError: undefined,
            };
          }

          return {
            ...row,
            renameResult: "failed",
            renameError: matched.reason,
          };
        }),
      );
    } catch (error) {
      appendError("调用 execute_batch_rename 失败", error);
      dispatch({ type: "RENAME_FINISHED", success: 0, failed: renameItems.length });
      window.alert("批量重命名失败，请查看下方错误信息。");
    }
  }

  function onResolutionBatchEdit() {
    setShowResolutionBatch((prev) => !prev);
    setResolutionRows((prev) =>
      prev.map((row) => ({
        ...row,
        selected: row.ratioStatus === "needsCrop",
      })),
    );
  }

  function onToggleResolutionSelect(rowId: string, value: boolean) {
    setResolutionRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, selected: value } : row)));
  }

  function resolutionInputFromRow(row: ResolutionRow): ResolutionProcessInput {
    return {
      id: row.id,
      sourcePath: row.path,
      targetWidth: row.targetWidth,
      targetHeight: row.targetHeight,
      overwriteSource: resolutionOutputMode === "overwrite",
      openOutputFolder,
    };
  }

  function onClearResolutionList() {
    if (isResolutionProcessing) {
      window.alert("正在处理视频，请等待完成后再清空列表。");
      return;
    }

    setResolutionRows([]);
    setShowResolutionBatch(false);
    setOverallResolutionProgress(0);
    setErrorLog([]);
    setShowErrorPanel(false);
  }

  async function onProcessResolutionBatch() {
    const items = selectedResolutionRows.map(resolutionInputFromRow);

    if (!items.length) {
      window.alert("没有需要处理的竖版非 9:16 视频。");
      return;
    }

    setIsResolutionProcessing(true);
    setOverallResolutionProgress(0);
    setResolutionRows((prev) =>
      prev.map((row) =>
        items.some((item) => item.id === row.id)
          ? { ...row, processStatus: "processing", processError: undefined, progress: 0 }
          : row,
      ),
    );

    try {
      const results = await invoke<ResolutionProcessResult[]>("process_resolution_batch", { items });
      const successCount = results.filter((item) => item.success).length;
      const failedCount = results.length - successCount;
      const resultMap = new Map(results.map((item) => [item.id, item]));

      setResolutionRows((prev) =>
        prev.map((row) => {
          const matched = resultMap.get(row.id);
          if (!matched) return row;
          return {
            ...row,
            id: matched.success ? matched.outputPath || row.id : row.id,
            path: matched.success ? matched.outputPath || row.path : row.path,
            width: matched.success ? row.targetWidth : row.width,
            height: matched.success ? row.targetHeight : row.height,
            ratioStatus: matched.success ? "nineSixteen" : row.ratioStatus,
            processStatus: matched.success ? "success" : "failed",
            processError: matched.reason,
            progress: matched.success ? 100 : row.progress,
            selected: matched.success ? false : row.selected,
          };
        }),
      );
      setOverallResolutionProgress(100);
      window.alert(`处理完成：${successCount} 个成功，${failedCount} 个失败`);
    } catch (error) {
      appendError("调用 process_resolution_batch 失败", error);
      window.alert("批量处理失败，请查看下方错误信息。");
    } finally {
      setIsResolutionProcessing(false);
    }
  }

  async function onProcessResolutionRow(row: ResolutionRow) {
    if (row.ratioStatus !== "needsCrop" || isResolutionProcessing) return;

    const items = [resolutionInputFromRow(row)];
    setIsResolutionProcessing(true);
    setResolutionRows((prev) =>
      prev.map((item) =>
        item.id === row.id ? { ...item, processStatus: "processing", processError: undefined, progress: 0 } : item,
      ),
    );

    try {
      const results = await invoke<ResolutionProcessResult[]>("process_resolution_batch", { items });
      const matched = results[0];
      setResolutionRows((prev) =>
        prev.map((item) => {
          if (item.id !== row.id) return item;
          return {
            ...item,
            id: matched?.success ? matched.outputPath || item.id : item.id,
            path: matched?.success ? matched.outputPath || item.path : item.path,
            width: matched?.success ? item.targetWidth : item.width,
            height: matched?.success ? item.targetHeight : item.height,
            ratioStatus: matched?.success ? "nineSixteen" : item.ratioStatus,
            processStatus: matched?.success ? "success" : "failed",
            processError: matched?.reason,
            progress: matched?.success ? 100 : item.progress,
            selected: matched?.success ? false : item.selected,
          };
        }),
      );

      if (!matched?.success) {
        window.alert(`裁剪失败：${matched?.reason || "未知错误"}`);
      }
    } catch (error) {
      appendError("调用 process_resolution_batch 失败", error);
      window.alert("单个视频裁剪失败，请查看下方错误信息。");
    } finally {
      setIsResolutionProcessing(false);
    }
  }

  async function onReveal(path: string) {
    try {
      await revealItemInDir(path);
    } catch (error) {
      appendError("定位文件失败", error);
      window.alert("定位文件失败，请查看下方错误信息。");
    }
  }

  async function onGuardContinue() {
    setShowGuardModal(false);
    dispatch({ type: "MARK_DIRTY", value: false });

    if (pendingFilesRef.current) {
      const paths = pendingFilesRef.current;
      pendingFilesRef.current = null;
      if (activePageRef.current === "media") {
        await parseMediaInputPaths(paths);
      } else {
        await parseInputPaths(paths);
      }
      return;
    }

    if (pendingPickRef.current) {
      pendingPickRef.current = false;
      await pickFilesFromDialog();
    }
  }

  function onGuardCancel() {
    pendingFilesRef.current = null;
    pendingPickRef.current = false;
    setShowGuardModal(false);
  }

  const pageClass = {
    filename: "filename-page",
    resolution: "resolution-page",
    media: "media-page",
  }[activePage];

  const pageTitle = {
    filename: "视频文件名",
    resolution: "视频分辨率",
    media: "图片/音乐文件名",
  }[activePage];

  return (
    <main className={`page ${pageClass}`}>
      <header className="app-header">
        <h1>{pageTitle}</h1>
        <div className="page-switch">
          <button
            type="button"
            className={activePage === "resolution" ? "active" : ""}
            onClick={() => setActivePage("resolution")}
          >
            视频分辨率
          </button>
          <button
            type="button"
            className={activePage === "filename" ? "active" : ""}
            onClick={() => setActivePage("filename")}
          >
            视频文件名
          </button>
          <button
            type="button"
            className={activePage === "media" ? "active" : ""}
            onClick={() => setActivePage("media")}
          >
            图片/音乐文件名
          </button>
        </div>
      </header>

      {activePage === "filename" ? (
        <>
      <section className="toolbar">
        <button type="button" onClick={onBatchEdit} disabled={!rows.length}>
          批量修改
        </button>
        <button type="button" onClick={onClearList} disabled={!rows.length}>
          清空列表
        </button>
      </section>

      <section
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDropFiles}
        onClick={onPickFiles}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void onPickFiles();
          }
        }}
        role="button"
        tabIndex={0}
      >
        拖拽 MP4/MOV 文件到这里，或点击选择文件
      </section>


      {!!rows.length && (
        <section className="table-wrap">
          <table style={{ tableLayout: "fixed" }}>
            <colgroup>
              {showBatchEdit && <col style={{ width: "48px" }} />}
              <col style={{ width: "240px" }} />
              <col style={{ width: "220px" }} />
              <col style={{ width: "88px" }} />
              <col style={{ width: "88px" }} />
              <col style={{ width: "88px" }} />
              <col style={{ width: "88px" }} />
              <col style={{ width: "88px" }} />
              <col style={{ width: "112px" }} />
            </colgroup>
            <thead>
              <tr>
                {showBatchEdit && <th>选中</th>}
                <th>视频名</th>
                <th>分类</th>
                <th>头部切除</th>
                <th>尾部切除</th>
                <th>放大比例</th>
                <th title={ZOOM_MODE_TIP}>放大模式</th>
                <th>时长变化</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {showBatchEdit && (
                <tr className="batch-inline-row">
                  <td>
                    <input type="checkbox" checked readOnly />
                  </td>
                  <td>
                    <input value="保持原名称" disabled className="video-name-input batch-video-name-input" />
                  </td>
                  <td>
                    <textarea
                      className="categories-input"
                      value={batchForm.categories}
                      onChange={(e) => onBatchCategoriesChange(e.target.value)}
                      rows={2}
                      placeholder={"留空保持不变\n分类1\n分类2"}
                    />
                  </td>
                  <td>
                    <input
                      value={batchForm.headCut}
                      onChange={(e) => onBatchFieldChange("headCut", e.target.value)}
                      onBlur={() => onBatchFieldBlur("headCut")}
                    />
                  </td>
                  <td>
                    <input
                      value={batchForm.tailCut}
                      onChange={(e) => onBatchFieldChange("tailCut", e.target.value)}
                      onBlur={() => onBatchFieldBlur("tailCut")}
                    />
                  </td>
                  <td>
                    <input
                      value={batchForm.zoomRatio}
                      onChange={(e) => onBatchFieldChange("zoomRatio", e.target.value)}
                      onBlur={() => onBatchFieldBlur("zoomRatio")}
                    />
                  </td>
                  <td>
                    <input
                      value={batchForm.zoomMode}
                      title={ZOOM_MODE_TIP}
                      onChange={(e) => onBatchFieldChange("zoomMode", e.target.value)}
                      onBlur={() => onBatchFieldBlur("zoomMode")}
                    />
                  </td>
                  <td>-</td>
                  <td>
                    <button type="button" className="batch-save-btn" onClick={onSaveBatch}>
                      应用到所选文件
                    </button>
                  </td>
                </tr>
              )}
              {sortedRows.map((row) => {
                const draft = draftFromRow(row);
                const duration = durationChange(row, draft);
                return (
                  <tr
                    key={row.id}
                    className={
                      row.parseStatus === "failed"
                        ? "danger"
                        : row.modified
                          ? "warn"
                          : ""
                    }
                  >
                    {showBatchEdit && (
                      <td>
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) => onToggleSelect(row.id, e.target.checked)}
                        />
                      </td>
                    )}
                    <td>
                      <input
                        className="video-name-input"
                        value={
                          row.parseStatus === "success"
                            ? draft.videoName || buildFileStem(row.fileName)
                            : row.manualDraft?.videoName || buildFileStem(row.fileName)
                        }
                        onChange={(e) => onVideoNameChange(row.id, e.target.value)}
                      />
                    </td>
                    <td>
                      <textarea
                        className="categories-input"
                        value={draft.categories}
                        onChange={(e) => onCategoriesChange(row.id, e.target.value)}
                        rows={2}
                        placeholder="分类1&#10;分类2"
                      />
                    </td>
                    {row.parseStatus === "failed" ? (
                      row.manualOpen ? (
                        <>
                          <td colSpan={4}>
                            <div className="manual-editor">
                              <input
                                placeholder="头部切除"
                                value={row.manualDraft?.headCut || ""}
                                onChange={(e) => onManualFieldChange(row.id, "headCut", e.target.value)}
                                onBlur={() => onDraftFieldBlur(row.id, "headCut")}
                              />
                              <input
                                placeholder="尾部切除"
                                value={row.manualDraft?.tailCut || ""}
                                onChange={(e) => onManualFieldChange(row.id, "tailCut", e.target.value)}
                                onBlur={() => onDraftFieldBlur(row.id, "tailCut")}
                              />
                              <input
                                placeholder="放大比例"
                                value={row.manualDraft?.zoomRatio || ""}
                                onChange={(e) => onManualFieldChange(row.id, "zoomRatio", e.target.value)}
                                onBlur={() => onDraftFieldBlur(row.id, "zoomRatio")}
                              />
                              <input
                                placeholder="放大模式"
                                value={row.manualDraft?.zoomMode || ""}
                                title={ZOOM_MODE_TIP}
                                onChange={(e) => onManualFieldChange(row.id, "zoomMode", e.target.value)}
                                onBlur={() => onDraftFieldBlur(row.id, "zoomMode")}
                              />
                            </div>
                          </td>
                        </>
                      ) : (
                        <td colSpan={4}>
                          <button type="button" onClick={() => onManualOpen(row.id)} style={{ width: "100%" }}>
                            文件名解析失败，请手动设置
                          </button>
                        </td>
                      )
                    ) : (
                      <>
                        <td>
                          <input
                            inputMode="decimal"
                            value={draft.headCut}
                            onChange={(e) => onParsedFieldChange(row.id, "headCut", e.target.value)}
                            onBlur={() => onDraftFieldBlur(row.id, "headCut")}
                          />
                        </td>
                        <td>
                          <input
                            inputMode="decimal"
                            value={draft.tailCut}
                            onChange={(e) => onParsedFieldChange(row.id, "tailCut", e.target.value)}
                            onBlur={() => onDraftFieldBlur(row.id, "tailCut")}
                          />
                        </td>
                        <td>
                          <input
                            inputMode="decimal"
                            value={draft.zoomRatio}
                            onChange={(e) => onParsedFieldChange(row.id, "zoomRatio", e.target.value)}
                            onBlur={() => onDraftFieldBlur(row.id, "zoomRatio")}
                          />
                        </td>
                        <td>
                          <input
                            inputMode="numeric"
                            value={draft.zoomMode}
                            title={ZOOM_MODE_TIP}
                            onChange={(e) => onParsedFieldChange(row.id, "zoomMode", e.target.value)}
                            onBlur={() => onDraftFieldBlur(row.id, "zoomMode")}
                          />
                        </td>
                      </>
                    )}
                    <td>
                      <span>{duration.original}</span>
                      <span> → </span>
                      {duration.edited ? (
                        <span className={duration.warning ? "duration-warning" : ""}>{duration.edited}</span>
                      ) : (
                        <span>/</span>
                      )}
                    </td>
                    <td>
                      {row.parseStatus === "failed" ? (
                        row.manualOpen ? (
                          <button
                            type="button"
                            onClick={() => void onApplyManual(row.id)}
                            disabled={!row.modified}
                          >
                            应用
                          </button>
                        ) : (
                          <button type="button" onClick={() => onReveal(row.path)}>
                            定位
                          </button>
                        )
                      ) : (
                        <div className="row-actions">
                          <button
                            type="button"
                            className="row-save-btn"
                            onClick={() => void onSaveRow(row.id)}
                            disabled={!row.modified}
                          >
                            保存
                          </button>
                          <button type="button" onClick={() => onReveal(row.path)}>
                            定位
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
        </>
      ) : activePage === "media" ? (
        <>
          <section className="toolbar">
            <button type="button" onClick={onMediaBatchEdit} disabled={!mediaRows.length}>
              批量修改
            </button>
            <button type="button" onClick={onClearList} disabled={!mediaRows.length}>
              清空列表
            </button>
          </section>

          <section
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropFiles}
            onClick={onPickFiles}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void onPickFiles();
              }
            }}
            role="button"
            tabIndex={0}
          >
            拖拽 PNG/JPG/JPEG/MP3/WAV 文件到这里，或点击选择文件
          </section>

          {!!mediaRows.length && (
            <section className="table-wrap">
              <table style={{ tableLayout: "fixed" }}>
                <colgroup>
                  {showMediaBatchEdit && <col style={{ width: "48px" }} />}
                  <col style={{ width: "320px" }} />
                  <col style={{ width: "240px" }} />
                  <col style={{ width: "320px" }} />
                  <col style={{ width: "112px" }} />
                </colgroup>
                <thead>
                  <tr>
                    {showMediaBatchEdit && <th>选中</th>}
                    <th>原文件名</th>
                    <th>分类</th>
                    <th>目标文件名</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {showMediaBatchEdit && (
                    <tr className="batch-inline-row">
                      <td>
                        <input type="checkbox" checked readOnly />
                      </td>
                      <td>
                        <input value="保持原名称" disabled className="video-name-input batch-video-name-input" />
                      </td>
                      <td>
                        <textarea
                          className="categories-input"
                          value={mediaBatchCategories}
                          onChange={(e) => onMediaBatchCategoriesChange(e.target.value)}
                          rows={2}
                          placeholder={"留空保持不变\n分类1\n分类2"}
                        />
                      </td>
                      <td>-</td>
                      <td>
                        <button type="button" className="batch-save-btn" onClick={() => void onSaveMediaBatch()}>
                          应用到所选文件
                        </button>
                      </td>
                    </tr>
                  )}
                  {mediaRows.map((row) => (
                    <tr key={row.id} className={row.modified ? "warn" : ""}>
                      {showMediaBatchEdit && (
                        <td>
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={(e) => onToggleMediaSelect(row.id, e.target.checked)}
                          />
                        </td>
                      )}
                      <td>{row.fileName}</td>
                      <td>
                        <textarea
                          className="categories-input"
                          value={row.categories}
                          onChange={(e) => onMediaCategoriesChange(row.id, e.target.value)}
                          rows={2}
                          placeholder="分类1&#10;分类2"
                        />
                      </td>
                      <td>{buildMediaTargetName(row)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="row-save-btn"
                            onClick={() => void onSaveMediaRow(row.id)}
                            disabled={!row.modified}
                          >
                            保存
                          </button>
                          <button type="button" onClick={() => onReveal(row.path)}>
                            定位
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="toolbar">
            <button type="button" onClick={onResolutionBatchEdit} disabled={!resolutionRows.length || isResolutionProcessing}>
              批量裁剪
            </button>
            <button type="button" onClick={onClearResolutionList} disabled={!resolutionRows.length || isResolutionProcessing}>
              清空列表
            </button>
            <label className="output-option">
              <input
                type="radio"
                name="resolution-output-mode"
                checked={resolutionOutputMode === "newFile"}
                disabled={isResolutionProcessing}
                onChange={() => setResolutionOutputMode("newFile")}
              />
              输出新文件
            </label>
            <label className="output-option">
              <input
                type="radio"
                name="resolution-output-mode"
                checked={resolutionOutputMode === "overwrite"}
                disabled={isResolutionProcessing}
                onChange={() => setResolutionOutputMode("overwrite")}
              />
              覆盖源文件
            </label>
            <label className="output-option">
              <input
                type="checkbox"
                checked={openOutputFolder}
                disabled={isResolutionProcessing}
                onChange={(e) => setOpenOutputFolder(e.target.checked)}
              />
              完成后自动打开文件夹
            </label>
          </section>

          <section
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropFiles}
            onClick={onPickFiles}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void onPickFiles();
              }
            }}
            role="button"
            tabIndex={0}
          >
            拖拽 MP4/MOV 文件到这里，或点击选择文件
          </section>

          {showResolutionBatch && (
            <section className="resolution-batch-panel">
              <button
                type="button"
                className="primary-action"
                disabled={!selectedResolutionRows.length || isResolutionProcessing}
                onClick={() => void onProcessResolutionBatch()}
              >
                一键全部9:16！
              </button>
              <div className="overall-progress">
                <div className="progress-bar">
                  <span style={{ width: `${overallResolutionProgress}%` }} />
                </div>
                <strong>{overallResolutionProgress.toFixed(1)}%</strong>
              </div>
            </section>
          )}

          {!!resolutionRows.length && (
            <section className="table-wrap">
              <table style={{ tableLayout: "fixed" }}>
                <colgroup>
                  {showResolutionBatch && <col style={{ width: "48px" }} />}
                  <col style={{ width: "360px" }} />
                  <col style={{ width: "140px" }} />
                  <col style={{ width: "140px" }} />
                  <col style={{ width: "220px" }} />
                  <col style={{ width: "148px" }} />
                </colgroup>
                <thead>
                  <tr>
                    {showResolutionBatch && <th>选中</th>}
                    <th>视频名</th>
                    <th>当前分辨率</th>
                    <th>处理后分辨率</th>
                    <th>处理进度</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {resolutionRowsSorted.map((row) => (
                    <tr key={row.id}>
                      {showResolutionBatch && (
                        <td>
                          <input
                            type="checkbox"
                            checked={row.selected}
                            disabled={row.ratioStatus !== "needsCrop" || isResolutionProcessing}
                            onChange={(e) => onToggleResolutionSelect(row.id, e.target.checked)}
                          />
                        </td>
                      )}
                      <td>{row.fileName}</td>
                      <td className={`resolution-status ${row.ratioStatus}`}>
                        {formatResolution(row.width, row.height)}
                      </td>
                      <td>{row.ratioStatus === "needsCrop" ? formatResolution(row.targetWidth, row.targetHeight) : "/"}</td>
                      <td>
                        <div className="progress-cell">
                          {row.processStatus === "skippedHorizontal" ? (
                            <span className="muted">跳过：横版视频</span>
                          ) : row.processStatus === "skippedAlready" ? (
                            <span className="ok">已是 9:16</span>
                          ) : row.processStatus === "failed" ? (
                            <span className="err">{row.processError || "处理失败"}</span>
                          ) : (
                            <>
                              <div className="progress-bar">
                                <span style={{ width: `${row.progress}%` }} />
                              </div>
                              <span>{row.progress.toFixed(1)}%</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            disabled={row.ratioStatus !== "needsCrop" || isResolutionProcessing}
                            onClick={() => void onProcessResolutionRow(row)}
                          >
                            裁剪
                          </button>
                          <button type="button" onClick={() => onReveal(row.path)}>
                            定位
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      <section className={`error-panel ${showErrorPanel ? "expanded" : ""}`}>
        <button type="button" className="error-toggle" onClick={() => setShowErrorPanel((prev) => !prev)}>
          错误信息（{errorLog.length}）{showErrorPanel ? "收起" : "展开"}
        </button>
        {showErrorPanel && (
          !errorLog.length ? (
            <div className="error-empty">暂无错误</div>
          ) : (
            <pre className="error-log">{errorLog.join("\n\n")}</pre>
          )
        )}
      </section>

      {showClearModal && (
        <div className="modal-mask">
          <div className="modal">
            <h3>确认要清空当前列表并放弃本轮修改？</h3>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowClearModal(false)}>
                我再想想
              </button>
              <button type="button" className="danger-btn" onClick={onConfirmClearList}>
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}

      {showGuardModal && (
        <div className="modal-mask">
          <div className="modal">
            <h3>还有未完成的修改，确认要处理新的文件？</h3>
            <div className="modal-actions">
              <button type="button" onClick={onGuardCancel}>
                我再想想
              </button>
              <button type="button" className="danger-btn" onClick={onGuardContinue}>
                放弃修改
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
