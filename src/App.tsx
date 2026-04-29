import { useMemo, useReducer, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import {
  FileRow,
  ManualDraft,
  ParseFileRowDto,
  RenameBatchSummary,
  RenameItemInput,
  RowFields,
} from "./types";
import { reducer, initialState } from "./state/reducer";
import { validateBatchInput } from "./lib/validators";
import "./App.css";

function emptyManualDraft(): ManualDraft {
  return {
    videoName: "",
    headCut: "",
    tailCut: "",
    zoomRatio: "",
    zoomMode: "",
  };
}

function buildFileStem(fileName: string): string {
  return fileName.trim().replace(/\.mp4\s*$/i, "");
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

function fieldsFromDraft(draft: ManualDraft): RowFields {
  const normalized = normalizeDraft(draft);
  return {
    videoName: normalized.videoName,
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
    headCut: normalizeNumericField("headCut", draft.headCut),
    tailCut: normalizeNumericField("tailCut", draft.tailCut),
    zoomRatio: normalizeNumericField("zoomRatio", draft.zoomRatio),
    zoomMode: normalizeNumericField("zoomMode", draft.zoomMode),
  };
}

function normalizeNumericField(field: keyof ManualDraft, value: string): string {
  const trimmed = value.trim();
  const isIncompleteDecimal = trimmed === ".";
  if (field === "headCut" || field === "tailCut") return trimmed && !isIncompleteDecimal ? trimmed : "0";
  if (field === "zoomRatio" || field === "zoomMode") return trimmed && !isIncompleteDecimal ? trimmed : "1";
  return value;
}

function canAcceptNumericInput(field: keyof ManualDraft, value: string): boolean {
  if (field === "videoName") return true;
  if (field === "zoomMode") return value === "" || /^[1-4]$/.test(value);
  return value === "" || /^\d*(\.\d{0,2})?$/.test(value);
}

function trimNum(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return `${rounded}`;
  return rounded.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
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
    case "not_mp4":
      return "文件后缀不是 .mp4（not_mp4）";
    case "cut_negative":
      return "头部或尾部切除不能为负数（cut_negative）";
    default:
      return `${error}`;
  }
}

function buildTargetName(
  row: FileRow,
  fields: Pick<RowFields, "headCut" | "tailCut" | "zoomRatio" | "zoomMode"> & Partial<Pick<RowFields, "videoName">>,
): string {
  const stem = buildFileStem(row.fileName);
  const base = fields.videoName ?? (row.parseStatus === "success" && row.parsedFields ? row.parsedFields.videoName : stem);
  return `${base}-${trimNum(fields.headCut)}-${trimNum(fields.tailCut)}-${trimNum(fields.zoomRatio)}-${fields.zoomMode}.mp4`;
}

function buildTargetPath(sourcePath: string, targetFileName: string): string {
  const separator = sourcePath.includes("\\") ? "\\" : "/";
  const index = sourcePath.lastIndexOf(separator);
  return index === -1 ? targetFileName : `${sourcePath.slice(0, index + 1)}${targetFileName}`;
}

function App() {
  const [appState, dispatch] = useReducer(reducer, initialState);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [summary, setSummary] = useState<RenameBatchSummary | null>(null);
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [batchForm, setBatchForm] = useState({ headCut: "", tailCut: "", zoomRatio: "", zoomMode: "" });
  const [showGuardModal, setShowGuardModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [errorLog, setErrorLog] = useState<string[]>([]);
  const pendingFilesRef = useRef<string[] | null>(null);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => (a.parseStatus === b.parseStatus ? 0 : a.parseStatus === "failed" ? -1 : 1)),
    [rows],
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
    const successCount = parsedRows.filter((row) => row.parseStatus === "success").length;
    const failedRows = parsedRows.filter((row) => row.parseStatus === "failed");
    const failedCount = failedRows.length;
    window.alert(`文件名解析成功 ${successCount} 个，失败 ${failedCount} 个`);

    const diagnostics = parsedRows.filter((row) => (row.parseError || "").includes("probe_"));

    if (failedRows.length || diagnostics.length) {
      setErrorLog((prev) => [
        ...prev,
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
    setSummary(null);
    setProgress({ current: 0, total: 0 });
    setShowBatchEdit(false);
    setBatchForm({ headCut: "", tailCut: "", zoomRatio: "", zoomMode: "" });
  }


  function hasUnfinishedChanges() {
    return (
      appState.guard.hasUnsavedChanges || appState.guard.isRenaming || appState.guard.hasPartialFailure
    );
  }

  async function parseInputPaths(paths: string[]) {
    const normalizedPaths = paths.map((p) => p.trim()).filter(Boolean);
    const mp4Paths = normalizedPaths.filter((p) => p.toLowerCase().endsWith(".mp4"));
    if (!mp4Paths.length) {
      appendError("未找到可解析的 MP4 文件", "请确认选择或拖拽的是 .mp4 文件");
      return;
    }

    try {
      setErrorLog([]);
      const result = await invoke<ParseFileRowDto[]>("parse_files", { paths: mp4Paths });
      const parsedRows = result.map(dtoToRow);
      resetAfterParse(parsedRows);
    } catch (error) {
      appendError("调用 parse_files 失败", error);
      window.alert("解析失败，请查看下方错误信息。\n如果是拖拽导入，建议优先使用“批量解析”按钮。");
    }
  }

  async function onPickFiles() {
    if (hasUnfinishedChanges()) {
      setShowGuardModal(true);
      return;
    }

    try {
      const picked = await open({
        multiple: true,
        filters: [{ name: "MP4", extensions: ["mp4"] }],
      });
      if (!picked) return;

      const paths = Array.isArray(picked) ? picked : [picked];
      await parseInputPaths(paths);
    } catch (error) {
      appendError("打开文件选择器失败", error);
      window.alert("打开文件选择器失败，请查看下方错误信息。");
    }
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

    if (hasUnfinishedChanges()) {
      pendingFilesRef.current = droppedPaths;
      setShowGuardModal(true);
      return;
    }

    if (!droppedPaths.length) {
      appendError("拖拽导入失败", "未能读取拖拽文件路径，请点击拖拽区域或“批量解析”按钮选择文件。");
      window.alert("拖拽导入失败，请点击拖拽区域或“批量解析”按钮。\n详细错误见下方错误信息区。");
      return;
    }

    await parseInputPaths(droppedPaths);
  }

  function onClearList() {
    setShowClearModal(true);
  }

  function onConfirmClearList() {
    setShowClearModal(false);
    pendingFilesRef.current = null;
    setRows([]);
    setSummary(null);
    setProgress({ current: 0, total: 0 });
    setShowBatchEdit(false);
    setBatchForm({ headCut: "", tailCut: "", zoomRatio: "", zoomMode: "" });
    setErrorLog([]);
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
        const normalizedValue = normalizeNumericField(field, draft[field]);

        return {
          ...row,
          manualDraft: { ...draft, [field]: normalizedValue },
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

  function onApplyManual(rowId: string) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId || !row.manualDraft) return row;

        const draft = normalizeDraft(row.manualDraft);
        const error = validateBatchInput(
          draft.headCut,
          draft.tailCut,
          draft.zoomRatio,
          draft.zoomMode,
          row.durationSec,
        );
        if (error) {
          window.alert("手动设置参数不合法，请检查输入。\n规则：模式1-4、比例<=2、头尾和<时长");
          return row;
        }

        return {
          ...row,
          parseStatus: "success",
          parsedFields: {
            ...fieldsFromDraft(draft),
            videoName: draft.videoName.trim() || buildFileStem(row.fileName),
          },
          parseError: undefined,
          manualDraft: undefined,
          manualOpen: false,
          modified: false,
        };
      }),
    );
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
    setProgress({ current: 1, total: 1 });

    try {
      const result = await invoke<RenameBatchSummary>("execute_batch_rename", {
        items: [{ id: row.id, sourcePath: row.path, targetFileName }],
      });
      const itemResult = result.results[0];
      setSummary(result);
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
  }

  function onBatchFieldBlur(field: "headCut" | "tailCut" | "zoomRatio" | "zoomMode") {
    setBatchForm((prev) => ({ ...prev, [field]: normalizeNumericField(field, prev[field]) }));
  }

  async function onSaveBatch() {
    if (!showBatchEdit) return;

    const selectedRows = rows.filter((row) => row.selected);
    if (!selectedRows.length) return;
    const normalizedBatchForm = normalizeDraft({ videoName: "", ...batchForm });

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
    });
    dispatch({ type: "RENAME_STARTED" });

    const fields = {
      headCut: Number(normalizedBatchForm.headCut),
      tailCut: Number(normalizedBatchForm.tailCut),
      zoomRatio: Number(normalizedBatchForm.zoomRatio),
      zoomMode: Number(normalizedBatchForm.zoomMode) as 1 | 2 | 3 | 4,
    };

    const renameItems: RenameItemInput[] = selectedRows.map((row) => ({
      id: row.id,
      sourcePath: row.path,
      targetFileName: buildTargetName(row, fields),
    }));

    setProgress({ current: 0, total: renameItems.length });

    for (let i = 0; i < renameItems.length; i += 1) {
      setProgress({ current: i + 1, total: renameItems.length });
    }

    try {
      const result = await invoke<RenameBatchSummary>("execute_batch_rename", {
        items: renameItems,
      });

      setSummary(result);
      dispatch({ type: "RENAME_FINISHED", success: result.success, failed: result.failed });

      setRows((prev) =>
        prev.map((row) => {
          const matched = result.results.find((item) => item.id === row.id);
          if (!matched) return row;
          return {
            ...row,
            renameResult: matched.success ? "success" : "failed",
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
      await parseInputPaths(paths);
    }
  }

  return (
    <main className="page">

      <section className="toolbar">
        <button type="button" onClick={onPickFiles}>
          批量解析
        </button>
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
        拖拽 MP4 文件到这里，或点击选择文件
      </section>


      {!!rows.length && (
        <section className="table-wrap">
          <table style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "48px" }} />
              <col style={{ width: "320px" }} />
              <col style={{ width: "96px" }} />
              <col style={{ width: "96px" }} />
              <col style={{ width: "96px" }} />
              <col style={{ width: "96px" }} />
              <col style={{ width: "96px" }} />
              <col style={{ width: "112px" }} />
            </colgroup>
            <thead>
              <tr>
                <th>选中</th>
                <th>视频名</th>
                <th>头部切除</th>
                <th>尾部切除</th>
                <th>放大比例</th>
                <th>放大模式</th>
                <th>视频时长</th>
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
                    <input value="保持原名称" disabled className="video-name-input" />
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
                      onChange={(e) => onBatchFieldChange("zoomMode", e.target.value)}
                      onBlur={() => onBatchFieldBlur("zoomMode")}
                    />
                  </td>
                  <td>-</td>
                  <td>
                    <button type="button" className="batch-save-btn" onClick={onSaveBatch}>
                      保存修改
                    </button>
                  </td>
                </tr>
              )}
              {sortedRows.map((row) => {
                const draft = draftFromRow(row);
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
                    <td>
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) => onToggleSelect(row.id, e.target.checked)}
                      />
                    </td>
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
                            onChange={(e) => onParsedFieldChange(row.id, "zoomMode", e.target.value)}
                            onBlur={() => onDraftFieldBlur(row.id, "zoomMode")}
                          />
                        </td>
                      </>
                    )}
                    <td>{row.durationSec}</td>
                    <td>
                      {row.parseStatus === "failed" ? (
                        row.manualOpen ? (
                          <button
                            type="button"
                            onClick={() => onApplyManual(row.id)}
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

      <section className="result-panel">
        <div>
          进度：{progress.current}/{progress.total}
        </div>
        {summary && (
          <>
            <div className="ok">{summary.success} 个文件修改成功</div>
            <div className="err">{summary.failed} 个文件修改失败</div>
            {summary.failed > 0 && (
              <ul>
                {summary.results
                  .filter((item) => !item.success)
                  .map((item) => (
                    <li key={item.id}>
                      {item.id} - {item.reason}
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="error-panel">
        <h2>错误信息</h2>
        {!errorLog.length ? (
          <div className="error-empty">暂无错误</div>
        ) : (
          <pre className="error-log">{errorLog.join("\n\n")}</pre>
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
              <button type="button" onClick={onConfirmClearList}>
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
              <button type="button" onClick={() => setShowGuardModal(false)}>
                我再想想
              </button>
              <button type="button" onClick={onGuardContinue}>
                忽略警告
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
