use std::path::PathBuf;
use std::process::Command;

pub fn parse_duration_stdout(out: &str) -> Result<f64, String> {
    let value = out
        .trim()
        .parse::<f64>()
        .map_err(|_| "duration_parse_failed".to_string())?;

    Ok((value * 100.0).round() / 100.0)
}

fn ffprobe_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from("ffprobe")];

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join("ffprobe"));
            candidates.push(exe_dir.join("ffprobe.exe"));
        }
    }

    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/ffprobe"),
        PathBuf::from("/usr/local/bin/ffprobe"),
        PathBuf::from("/usr/bin/ffprobe"),
    ]);

    candidates
}

pub fn probe_duration(path: &str) -> Result<f64, String> {
    let mut launch_errors = Vec::new();

    for ffprobe in ffprobe_candidates() {
        let output = match Command::new(&ffprobe)
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
        {
            Ok(output) => output,
            Err(error) => {
                launch_errors.push(format!("{}:{}", ffprobe.display(), error));
                continue;
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("ffprobe_failed:{}:{}", ffprobe.display(), stderr));
        }

        let stdout =
            String::from_utf8(output.stdout).map_err(|_| "duration_parse_failed".to_string())?;
        return parse_duration_stdout(&stdout);
    }

    Err(format!("ffprobe_not_found:{}", launch_errors.join(";")))
}
