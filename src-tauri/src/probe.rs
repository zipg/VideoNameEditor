use std::process::Command;

pub fn parse_duration_stdout(out: &str) -> Result<f64, String> {
    let value = out
        .trim()
        .parse::<f64>()
        .map_err(|_| "duration_parse_failed".to_string())?;

    Ok((value * 100.0).round() / 100.0)
}

pub fn probe_duration(path: &str) -> Result<f64, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .map_err(|_| "ffprobe_not_found".to_string())?;

    if !output.status.success() {
        return Err("ffprobe_failed".to_string());
    }

    let stdout = String::from_utf8(output.stdout).map_err(|_| "duration_parse_failed".to_string())?;
    parse_duration_stdout(&stdout)
}
