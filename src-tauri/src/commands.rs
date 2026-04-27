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

            let duration = probe_duration(&path).unwrap_or(0.0);
            let parse_result = parse_filename(&file_name, duration);

            match parse_result {
                Ok(parsed) => FileRowDto {
                    id: path.clone(),
                    path,
                    file_name,
                    duration_sec: duration,
                    parse_status: "success".to_string(),
                    parse_error: None,
                    warning_flags: parsed.warnings.clone(),
                    parsed_fields: Some(parsed),
                },
                Err(error) => FileRowDto {
                    id: path.clone(),
                    path,
                    file_name,
                    duration_sec: duration,
                    parse_status: "failed".to_string(),
                    parse_error: Some(error),
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
