use std::path::PathBuf;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

    if let Some(target) = host_target_triple() {
        let sidecar_name = if cfg!(windows) {
            format!("ffprobe-{target}.exe")
        } else {
            format!("ffprobe-{target}")
        };
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(sidecar_name),
        );
    }

    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/ffprobe"),
        PathBuf::from("/usr/local/bin/ffprobe"),
        PathBuf::from("/usr/bin/ffprobe"),
    ]);

    candidates
}

fn host_target_triple() -> Option<&'static str> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("aarch64-apple-darwin")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("x86_64-apple-darwin")
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("x86_64-pc-windows-msvc")
    } else {
        None
    }
}

fn build_ffprobe_command(ffprobe: &PathBuf, path: &str) -> Command {
    let mut command = Command::new(ffprobe);
    command.args([
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
    ]);

    hide_windows_console(&mut command);
    command
}

#[cfg(windows)]
fn hide_windows_console(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_windows_console(_command: &mut Command) {}

pub fn probe_duration(path: &str) -> Result<f64, String> {
    let mut launch_errors = Vec::new();

    for ffprobe in ffprobe_candidates() {
        let output = match build_ffprobe_command(&ffprobe, path).output() {
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
