use crate::models::ParsedFields;

fn has_max_two_decimals(raw: &str) -> bool {
    if let Some((_, decimal)) = raw.split_once('.') {
        return decimal.len() <= 2;
    }
    true
}

pub fn parse_filename(file_name: &str, duration_sec: f64) -> Result<ParsedFields, String> {
    let base = file_name
        .strip_suffix(".mp4")
        .or_else(|| file_name.strip_suffix(".mov"))
        .ok_or("not_mp4_or_mov")?;
    let parts: Vec<&str> = base.split('-').collect();
    if parts.len() < 5 {
        return Err("segment_count_invalid".into());
    }

    let has_categories = parts.len() >= 6;

    let categories_raw = if has_categories {
        parts[parts.len() - 5].trim()
    } else {
        ""
    };
    let head_raw = if has_categories {
        parts[parts.len() - 4].trim()
    } else {
        parts[parts.len() - 4].trim()
    };
    let tail_raw = if has_categories {
        parts[parts.len() - 3].trim()
    } else {
        parts[parts.len() - 3].trim()
    };
    let ratio_raw = if has_categories {
        parts[parts.len() - 2].trim()
    } else {
        parts[parts.len() - 2].trim()
    };
    let mode_raw = parts[parts.len() - 1].trim();

    if !has_max_two_decimals(head_raw)
        || !has_max_two_decimals(tail_raw)
        || !has_max_two_decimals(ratio_raw)
    {
        return Err("precision_out_of_range".into());
    }

    let mode = mode_raw.parse::<u8>().map_err(|_| "mode_invalid")?;
    let ratio = ratio_raw.parse::<f64>().map_err(|_| "ratio_invalid")?;
    let tail = tail_raw.parse::<f64>().map_err(|_| "tail_invalid")?;
    let head = head_raw.parse::<f64>().map_err(|_| "head_invalid")?;

    // If new format (with categories): name segment count = parts - 5
    // If old format (no categories): name segment count = parts - 4
    let name_part_count = if has_categories {
        parts.len() - 5
    } else {
        parts.len() - 4
    };
    let video_name = parts[..name_part_count].join("-");

    if video_name.trim().is_empty() {
        return Err("video_name_invalid".into());
    }

    let mut warnings = vec![];
    if video_name.contains('-') {
        warnings.push("name_contains_hyphen".to_string());
    }

    let categories: Vec<String> = if has_categories && !categories_raw.is_empty() {
        categories_raw
            .split('&')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    } else {
        vec![]
    };

    if !(1..=4).contains(&mode) {
        return Err("mode_out_of_range".into());
    }
    if !(ratio > 0.0 && ratio <= 2.0) {
        return Err("ratio_out_of_range".into());
    }
    if head < 0.0 || tail < 0.0 {
        return Err("cut_negative".into());
    }
    if duration_sec > 0.0 && head + tail >= duration_sec {
        return Err("cut_exceeds_duration".into());
    }

    Ok(ParsedFields {
        video_name,
        categories,
        head_cut: head,
        tail_cut: tail,
        zoom_ratio: ratio,
        zoom_mode: mode,
        warnings,
    })
}
