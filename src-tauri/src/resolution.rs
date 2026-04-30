use std::collections::{HashSet, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::thread;

use tauri::{AppHandle, Emitter};

use crate::models::{
    ResolutionInfoDto, ResolutionProcessInput, ResolutionProcessResult, ResolutionProgressEvent,
};
use crate::probe::{build_ffmpeg_command, ffmpeg_candidates, probe_resolution};

pub fn probe_resolution_files(paths: Vec<String>) -> Vec<ResolutionInfoDto> {
    if paths.len() <= 1 {
        return paths.into_iter().map(probe_one_resolution_file).collect();
    }

    let worker_count = thread::available_parallelism()
        .map(|v| v.get())
        .unwrap_or(4)
        .min(4)
        .min(paths.len());
    let task_count = paths.len();
    let tasks = Arc::new(Mutex::new(
        paths.into_iter().enumerate().collect::<VecDeque<_>>(),
    ));
    let results = Arc::new(Mutex::new(vec![None; task_count]));

    thread::scope(|scope| {
        for _ in 0..worker_count {
            let tasks = Arc::clone(&tasks);
            let results = Arc::clone(&results);

            scope.spawn(move || loop {
                let next_task = tasks
                    .lock()
                    .expect("resolution task queue poisoned")
                    .pop_front();
                let Some((index, path)) = next_task else {
                    break;
                };

                let row = probe_one_resolution_file(path);
                results.lock().expect("resolution results poisoned")[index] = Some(row);
            });
        }
    });

    let rows = results
        .lock()
        .expect("resolution results poisoned")
        .iter()
        .map(|row| {
            row.clone()
                .expect("resolution worker did not produce a row")
        })
        .collect();
    rows
}

fn probe_one_resolution_file(path: String) -> ResolutionInfoDto {
    let file_name = Path::new(&path)
        .file_name()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_default();

    match probe_resolution(&path) {
        Ok((width, height, duration_sec)) => {
            let orientation = if width >= height {
                "horizontal"
            } else {
                "vertical"
            };
            let ratio_status = if width * 16 == height * 9 {
                "nineSixteen"
            } else if orientation == "vertical" {
                "needsCrop"
            } else {
                "horizontal"
            };
            let (target_width, target_height) = closest_nine_sixteen(width, height);
            let process_status = if orientation == "horizontal" {
                "skippedHorizontal"
            } else if ratio_status == "nineSixteen" {
                "skippedAlready"
            } else {
                "pending"
            };

            ResolutionInfoDto {
                id: path.clone(),
                path,
                file_name,
                width,
                height,
                duration_sec,
                target_width,
                target_height,
                orientation: orientation.to_string(),
                ratio_status: ratio_status.to_string(),
                process_status: process_status.to_string(),
                process_error: None,
            }
        }
        Err(error) => ResolutionInfoDto {
            id: path.clone(),
            path,
            file_name,
            width: 0,
            height: 0,
            duration_sec: 0.0,
            target_width: 0,
            target_height: 0,
            orientation: "unknown".to_string(),
            ratio_status: "failed".to_string(),
            process_status: "failed".to_string(),
            process_error: Some(error),
        },
    }
}

fn closest_nine_sixteen(width: u32, height: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (0, 0);
    }

    let max_unit = (width / 9).min(height / 16);
    let even_unit = max_unit - (max_unit % 2);
    if even_unit == 0 {
        return (0, 0);
    }

    (even_unit * 9, even_unit * 16)
}

pub fn process_resolution_batch(
    app: AppHandle,
    items: Vec<ResolutionProcessInput>,
) -> Vec<ResolutionProcessResult> {
    let mut results = Vec::with_capacity(items.len());
    let mut output_dirs = HashSet::new();

    for item in items {
        let result = process_one_resolution(&app, &item);
        if result.success {
            if let Some(output_dir) = &result.output_dir {
                output_dirs.insert(output_dir.clone());
            }
        }
        results.push(result);
    }

    for output_dir in output_dirs {
        let _ = tauri_plugin_opener::open_path(output_dir, None::<&str>);
    }

    results
}

fn process_one_resolution(
    app: &AppHandle,
    item: &ResolutionProcessInput,
) -> ResolutionProcessResult {
    if item.target_width == 0 || item.target_height == 0 {
        return failed_result(item, "目标分辨率无效");
    }

    let source = PathBuf::from(&item.source_path);
    let Some(file_name) = source.file_name().map(|value| value.to_os_string()) else {
        return failed_result(item, "源文件名无效");
    };
    let Some(parent) = source.parent() else {
        return failed_result(item, "源文件目录无效");
    };

    let (output_path, final_path) = if item.overwrite_source {
        let tmp_name = format!(".9_16_tmp_{}", file_name.to_string_lossy());
        let tmp_path = parent.join(tmp_name);
        (tmp_path.clone(), source.clone())
    } else {
        let output_dir = parent.join("9_16");
        if let Err(error) = fs::create_dir_all(&output_dir) {
            return failed_result(item, &format!("创建输出目录失败：{error}"));
        }
        let output_path = output_dir.join(&file_name);
        (output_path.clone(), output_path)
    };

    let ffmpeg = match first_usable_ffmpeg() {
        Ok(path) => path,
        Err(error) => return failed_result(item, &error),
    };

    let duration = probe_resolution(&item.source_path)
        .map(|(_, _, duration)| duration)
        .unwrap_or(0.0);
    let crop_filter = format!(
        "crop={}:{}:(in_w-{})/2:(in_h-{})/2",
        item.target_width, item.target_height, item.target_width, item.target_height
    );

    let mut command = build_ffmpeg_command(&ffmpeg);
    command
        .args([
            "-y",
            "-i",
            &item.source_path,
            "-vf",
            &crop_filter,
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-preset",
            "medium",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
            output_path.to_string_lossy().as_ref(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return failed_result(item, &format!("启动 ffmpeg 失败：{error}")),
    };

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(value) = line.strip_prefix("out_time_ms=") {
                if let Ok(out_time_us) = value.trim().parse::<f64>() {
                    let elapsed = out_time_us / 1_000_000.0;
                    let progress = if duration > 0.0 {
                        (elapsed / duration * 100.0).clamp(0.0, 99.0)
                    } else {
                        0.0
                    };
                    emit_progress(app, &item.id, progress);
                }
            } else if line.trim() == "progress=end" {
                emit_progress(app, &item.id, 100.0);
            }
        }
    }

    let status = match child.wait() {
        Ok(status) => status,
        Err(error) => return failed_result(item, &format!("等待 ffmpeg 结束失败：{error}")),
    };

    if !status.success() {
        let _ = fs::remove_file(&output_path);
        return failed_result(item, &format!("ffmpeg 处理失败：{status}"));
    }

    if item.overwrite_source && output_path != source {
        let backup_path = parent.join(format!(".9_16_backup_{}", file_name.to_string_lossy()));
        let _ = fs::remove_file(&backup_path);

        if let Err(error) = fs::rename(&source, &backup_path) {
            let _ = fs::remove_file(&output_path);
            return failed_result(item, &format!("备份源文件失败：{error}"));
        }

        if let Err(error) = fs::rename(&output_path, &source) {
            let _ = fs::rename(&backup_path, &source);
            let _ = fs::remove_file(&output_path);
            return failed_result(item, &format!("覆盖源文件失败：{error}"));
        }

        let _ = fs::remove_file(&backup_path);
    }

    emit_progress(app, &item.id, 100.0);
    ResolutionProcessResult {
        id: item.id.clone(),
        success: true,
        output_path: Some(final_path.to_string_lossy().to_string()),
        output_dir: final_path
            .parent()
            .map(|value| value.to_string_lossy().to_string()),
        reason: None,
    }
}

fn first_usable_ffmpeg() -> Result<PathBuf, String> {
    let mut errors = Vec::new();
    for path in ffmpeg_candidates() {
        let mut command = build_ffmpeg_command(&path);
        match command
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
        {
            Ok(status) if status.success() => return Ok(path),
            Ok(status) => errors.push(format!("{}:{status}", path.display())),
            Err(error) => errors.push(format!("{}:{error}", path.display())),
        }
    }

    Err(format!("ffmpeg_not_found:{}", errors.join(";")))
}

fn emit_progress(app: &AppHandle, id: &str, progress: f64) {
    let _ = app.emit(
        "resolution-progress",
        ResolutionProgressEvent {
            id: id.to_string(),
            progress: (progress * 10.0).round() / 10.0,
        },
    );
}

fn failed_result(item: &ResolutionProcessInput, reason: &str) -> ResolutionProcessResult {
    ResolutionProcessResult {
        id: item.id.clone(),
        success: false,
        output_path: None,
        output_dir: None,
        reason: Some(reason.to_string()),
    }
}
