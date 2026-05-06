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

fn file_stem(name: &str) -> &str {
    name.strip_suffix(".mp4")
        .or_else(|| name.strip_suffix(".mov"))
        .unwrap_or(name)
}

fn file_ext(name: &str) -> &str {
    if name.ends_with(".mov") { ".mov" } else { ".mp4" }
}

pub fn build_target_name(
    original_file_name: &str,
    video_name: &str,
    categories: &[String],
    head: f64,
    tail: f64,
    ratio: f64,
    mode: u8,
    parsed_success: bool,
) -> String {
    let stem = file_stem(original_file_name);
    let ext = file_ext(original_file_name);
    let base = if parsed_success { video_name } else { stem };
    let cat_str = if categories.is_empty() {
        String::new()
    } else {
        categories.join("&")
    };

    if cat_str.is_empty() {
        format!(
            "{}-{}-{}-{}-{}{}",
            base,
            trim_num(head),
            trim_num(tail),
            trim_num(ratio),
            mode,
            ext
        )
    } else {
        format!(
            "{}-{}-{}-{}-{}-{}{}",
            base,
            cat_str,
            trim_num(head),
            trim_num(tail),
            trim_num(ratio),
            mode,
            ext
        )
    }
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
