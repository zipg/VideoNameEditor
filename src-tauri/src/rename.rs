use std::path::{Path, PathBuf};

use crate::errors::map_rename_error;
use crate::models::{RenameBatchSummary, RenameItemInput, RenameItemResult};

fn trim_num(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    if rounded.fract() == 0.0 {
        format!("{}", rounded as i64)
    } else {
        let mut s = format!("{rounded:.2}");
        while s.ends_with('0') {
            s.pop();
        }
        if s.ends_with('.') {
            s.pop();
        }
        s
    }
}

pub fn build_target_name(
    original_file_name: &str,
    video_name: &str,
    head: f64,
    tail: f64,
    ratio: f64,
    mode: u8,
    parsed_success: bool,
) -> String {
    let stem = original_file_name.trim_end_matches(".mp4");
    let base = if parsed_success { video_name } else { stem };

    format!(
        "{}-{}-{}-{}-{}.mp4",
        base,
        trim_num(head),
        trim_num(tail),
        trim_num(ratio),
        mode
    )
}

pub fn execute_rename_batch(items: Vec<RenameItemInput>) -> RenameBatchSummary {
    let total = items.len();
    let mut success = 0usize;
    let mut failed = 0usize;
    let mut results = Vec::with_capacity(total);

    for item in items {
        let source = PathBuf::from(&item.source_path);
        let parent = source.parent().unwrap_or_else(|| Path::new("."));
        let target = parent.join(&item.target_file_name);

        if target.exists() {
            failed += 1;
            results.push(RenameItemResult {
                id: item.id,
                success: false,
                reason: Some("TargetExists".to_string()),
            });
            continue;
        }

        match std::fs::rename(&source, &target) {
            Ok(_) => {
                success += 1;
                results.push(RenameItemResult {
                    id: item.id,
                    success: true,
                    reason: None,
                });
            }
            Err(error) => {
                failed += 1;
                results.push(RenameItemResult {
                    id: item.id,
                    success: false,
                    reason: Some(map_rename_error(&error)),
                });
            }
        }
    }

    RenameBatchSummary {
        total,
        success,
        failed,
        results,
    }
}
