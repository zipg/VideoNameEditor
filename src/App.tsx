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
  return {
    videoName: draft.videoName,
    headCut: Number(draft.headCut),
    tailCut: Number(draft.tailCut),
    zoomRatio: Number(draft.zoomRatio),
    zoomMode: Number(draft.zoomMode) as 1 | 2 | 3 | 4,
  };
}

function trimNum(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return `${rounded}`;
  return rounded.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function buildTargetName(
  row: FileRow,
  fields: Pick<RowFields, "headCut" | "tailCut" | "zoomRatio" | "zoomMode">,
): string {
  const stem = row.fileName.replace(/\.mp4$/i, "");
  const base = row.parseStatus === "success" && row.parsedFields ? row.parsedFields.videoName : stem;
  return `${base}-${trimNum(fields.headCut)}-${trimNum(fields.tailCut)}-${trimNum(fields.zoomRatio)}-${fields.zoomMode}.mp4`;
}

function App() {
  const [appState, dispatch] = useReducer(reducer, initialState);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [summary, setSummary] = useState<RenameBatchSummary | null>(null);
  const [showBatchEdit, setShowBatchEdit] = useState(false);
  const [batchForm, setBatchForm] = useState({ headCut: "", tailCut: "", zoomRatio: "", zoomMode: "" });
  const [showGuardModal, setShowGuardModal] = useState(false);
  const [errorLog, setErrorLog] = useState<string[]>([]);
  const pendingFilesRef = useRef<string[] | null>(null);

  const failedRows = useMemo(() => rows.filter((row) => row.parseStatus === "failed"), [rows]);
  const successRows = useMemo(() => rows.filter((row) => row.parseStatus === "success"), [rows]);

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
    const failedCount = parsedRows.length - successCount;
    window.alert(`文件名解析成功 ${successCount} 个，失败 ${failedCount} 个`);

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
    const mp4Paths = paths.filter((p) => p.toLowerCase().endsWith(".mp4"));
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
    const droppedPaths = Array.from(event.dataTransfer.files || [])
      .map((file) => (file as File & { path?: string }).path)
      .filter(Boolean) as string[];

    if (hasUnfinishedChanges()) {
      pendingFilesRef.current = droppedPaths;
      setShowGuardModal(true);
      return;
    }

    if (!droppedPaths.length) {
      appendError("拖拽导入失败", "未能读取拖拽文件路径，请使用“批量解析”按钮选择文件。");
      window.alert("拖拽导入失败，请使用“批量解析”按钮。\n详细错误见下方错误信息区。");
      return;
    }

    await parseInputPaths(droppedPaths);
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

  function onApplyManual(rowId: string) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId || !row.manualDraft) return row;

        const draft = row.manualDraft;
        const error = validateBatchInput(
          draft.headCut,
          draft.tailCut,
          draft.zoomRatio,
          draft.zoomMode,
          row.durationSec,
        );
        if (error || !draft.videoName.trim()) {
          window.alert("手动设置参数不合法，请检查输入。\n规则：模式1-4、比例<=2、头尾和<时长");
          return row;
        }

        return {
          ...row,
          parseStatus: "success",
          parsedFields: fieldsFromDraft(draft),
          parseError: undefined,
          manualOpen: false,
        };
      }),
    );
  }

  function onBatchEdit() {
    setShowBatchEdit(true);
    setRows((prev) => prev.map((row) => ({ ...row, selected: true })));
  }

  function onToggleSelect(rowId: string, value: boolean) {
    setRows((prev) => prev.map((row) => (row.id === rowId ? { ...row, selected: value } : row)));
  }

  async function onSaveBatch() {
    if (!showBatchEdit) return;

    const selectedRows = rows.filter((row) => row.selected);
    if (!selectedRows.length) return;

    for (const row of selectedRows) {
      const error = validateBatchInput(
        batchForm.headCut,
        batchForm.tailCut,
        batchForm.zoomRatio,
        batchForm.zoomMode,
        row.durationSec,
      );
      if (error) {
        window.alert(`批量参数校验失败: ${error}`);
        return;
      }
    }

    dispatch({ type: "RENAME_STARTED" });

    const fields = {
      headCut: Number(batchForm.headCut),
      tailCut: Number(batchForm.tailCut),
      zoomRatio: Number(batchForm.zoomRatio),
      zoomMode: Number(batchForm.zoomMode) as 1 | 2 | 3 | 4,
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
      </section>

      {showBatchEdit && (
        <section className="batch-editor">
          <div className="batch-grid">
            <label>
              视频名
              <input value="保持原名称" disabled />
            </label>
            <label>
              头部切除
              <input
                value={batchForm.headCut}
                onChange={(e) => setBatchForm((v) => ({ ...v, headCut: e.target.value }))}
              />
            </label>
            <label>
              尾部切除
              <input
                value={batchForm.tailCut}
                onChange={(e) => setBatchForm((v) => ({ ...v, tailCut: e.target.value }))}
              />
            </label>
            <label>
              放大比例
              <input
                value={batchForm.zoomRatio}
                onChange={(e) => setBatchForm((v) => ({ ...v, zoomRatio: e.target.value }))}
              />
            </label>
            <label>
              放大模式
              <input
                value={batchForm.zoomMode}
                onChange={(e) => setBatchForm((v) => ({ ...v, zoomMode: e.target.value }))}
              />
            </label>
          </div>
          <button type="button" onClick={onSaveBatch}>
            保存修改
          </button>
        </section>
      )}

      <section
        className="dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDropFiles}
        role="presentation"
      >
        拖拽 MP4 文件到这里
      </section>

      {!!failedRows.length && (
        <section className="failed-panel">
          <h2>解析失败（需处理）</h2>
          {failedRows.map((row) => (
            <div key={row.id} className="row-failed">
              {!row.manualOpen ? (
                <button type="button" onClick={() => onManualOpen(row.id)}>
                  解析失败，点击手动设置（{row.fileName}）
                </button>
              ) : (
                <div className="manual-editor">
                  <input
                    placeholder="视频名"
                    value={row.manualDraft?.videoName || ""}
                    onChange={(e) => onManualFieldChange(row.id, "videoName", e.target.value)}
                  />
                  <input
                    placeholder="头部切除"
                    value={row.manualDraft?.headCut || ""}
                    onChange={(e) => onManualFieldChange(row.id, "headCut", e.target.value)}
                  />
                  <input
                    placeholder="尾部切除"
                    value={row.manualDraft?.tailCut || ""}
                    onChange={(e) => onManualFieldChange(row.id, "tailCut", e.target.value)}
                  />
                  <input
                    placeholder="放大比例"
                    value={row.manualDraft?.zoomRatio || ""}
                    onChange={(e) => onManualFieldChange(row.id, "zoomRatio", e.target.value)}
                  />
                  <input
                    placeholder="放大模式"
                    value={row.manualDraft?.zoomMode || ""}
                    onChange={(e) => onManualFieldChange(row.id, "zoomMode", e.target.value)}
                  />
                  <button type="button" onClick={() => onApplyManual(row.id)}>
                    应用
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {!!successRows.length && (
        <section className="table-wrap">
          <table>
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
              {rows.map((row) => {
                const fields = row.parsedFields;
                return (
                  <tr
                    key={row.id}
                    className={
                      row.parseStatus === "failed"
                        ? "danger"
                        : row.warningFlags.includes("name_contains_hyphen")
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
                    <td>{fields?.videoName || "-"}</td>
                    <td>{fields?.headCut ?? "-"}</td>
                    <td>{fields?.tailCut ?? "-"}</td>
                    <td>{fields?.zoomRatio ?? "-"}</td>
                    <td>{fields?.zoomMode ?? "-"}</td>
                    <td>{row.durationSec}</td>
                    <td>
                      <button type="button" onClick={() => onReveal(row.path)}>
                        定位文件
                      </button>
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
