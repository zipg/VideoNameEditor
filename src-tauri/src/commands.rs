use std::collections::VecDeque;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;

use crate::models::{FileRowDto, RenameBatchSummary, RenameItemInput};
use crate::parser::parse_filename;
use crate::probe::probe_duration;

#[tauri::command]
pub fn parse_files(paths: Vec<String>) -> Vec<FileRowDto> {
    if paths.len() <= 1 {
        return paths.into_iter().map(parse_one_file).collect();
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
                let next_task = tasks.lock().expect("parse task queue poisoned").pop_front();
                let Some((index, path)) = next_task else {
                    break;
                };

                let row = parse_one_file(path);
                results.lock().expect("parse results poisoned")[index] = Some(row);
            });
        }
    });

    let rows = results
        .lock()
        .expect("parse results poisoned")
        .iter()
        .map(|row| row.clone().expect("parse worker did not produce a row"))
        .collect();
    rows
}

fn parse_one_file(path: String) -> FileRowDto {
    let file_name = Path::new(&path)
        .file_name()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_default();
    let file_name_for_parse = file_name.trim().to_string();

    let first_probe = probe_duration(&path);
    let (duration, probe_error) = match first_probe {
        Ok(v) => (v, None),
        Err(err1) => {
            let fixed = path
                .replace('\u{202A}', "")
                .replace('\u{202C}', "")
                .trim()
                .to_string();
            match probe_duration(&fixed) {
                Ok(v) => (v, Some(format!("probe_retry_ok:first_error={}", err1))),
                Err(err2) => (
                    0.0,
                    Some(format!(
                        "probe_failed:first_error={};retry_error={}",
                        err1, err2
                    )),
                ),
            }
        }
    };
    let parse_result = parse_filename(&file_name_for_parse, duration);

    match parse_result {
        Ok(parsed) => FileRowDto {
            id: path.clone(),
            path,
            file_name,
            duration_sec: duration,
            parse_status: "success".to_string(),
            parse_error: probe_error,
            warning_flags: parsed.warnings.clone(),
            parsed_fields: Some(parsed),
        },
        Err(error) => FileRowDto {
            id: path.clone(),
            path,
            file_name,
            duration_sec: duration,
            parse_status: "failed".to_string(),
            parse_error: Some(match probe_error {
                Some(p) => format!("{} | {}", error, p),
                None => error,
            }),
            warning_flags: vec![],
            parsed_fields: None,
        },
    }
}

#[tauri::command]
pub fn execute_batch_rename(items: Vec<RenameItemInput>) -> RenameBatchSummary {
    crate::rename::execute_rename_batch(items)
}
