use std::path::Path;

use crate::models::{FileRowDto, RenameBatchSummary, RenameItemInput};
use crate::parser::parse_filename;
use crate::probe::probe_duration;

#[tauri::command]
pub fn parse_files(paths: Vec<String>) -> Vec<FileRowDto> {
    paths
        .into_iter()
        .map(|path| {
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
        })
        .collect()
}

#[tauri::command]
pub fn execute_batch_rename(items: Vec<RenameItemInput>) -> RenameBatchSummary {
    crate::rename::execute_rename_batch(items)
}
