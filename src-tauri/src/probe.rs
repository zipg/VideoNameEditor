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

fn binary_candidates(name: &str) -> Vec<PathBuf> {
    let exe_name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let mut candidates = vec![PathBuf::from(name), PathBuf::from(&exe_name)];

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(name));
            candidates.push(exe_dir.join(&exe_name));
        }
    }

    if let Some(target) = host_target_triple() {
        let sidecar_name = if cfg!(windows) {
            format!("{name}-{target}.exe")
        } else {
            format!("{name}-{target}")
        };
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(sidecar_name),
        );
    }

    candidates.extend([
        PathBuf::from(format!("/opt/homebrew/bin/{name}")),
        PathBuf::from(format!("/usr/local/bin/{name}")),
        PathBuf::from(format!("/usr/bin/{name}")),
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

pub fn build_ffmpeg_command(path: &PathBuf) -> Command {
    let mut command = Command::new(path);
    hide_windows_console(&mut command);
    command
}

pub fn ffmpeg_candidates() -> Vec<PathBuf> {
    binary_candidates("ffmpeg")
}

#[cfg(windows)]
fn hide_windows_console(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_windows_console(_command: &mut Command) {}

pub fn probe_duration(path: &str) -> Result<f64, String> {
    let mut launch_errors = Vec::new();

    for ffprobe in binary_candidates("ffprobe") {
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

pub fn parse_resolution_stdout(out: &str) -> Result<(u32, u32, f64), String> {
    let normalized = out.replace(',', "\n");
    let mut parts = normalized.lines().filter(|line| !line.trim().is_empty());
    let width = parts
        .next()
        .ok_or("resolution_parse_failed")?
        .trim()
        .parse::<u32>()
        .map_err(|_| "resolution_parse_failed".to_string())?;
    let height = parts
        .next()
        .ok_or("resolution_parse_failed")?
        .trim()
        .parse::<u32>()
        .map_err(|_| "resolution_parse_failed".to_string())?;
    let duration = parts
        .next()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .unwrap_or(0.0);

    Ok((width, height, (duration * 100.0).round() / 100.0))
}

pub fn probe_resolution(path: &str) -> Result<(u32, u32, f64), String> {
    let mut launch_errors = Vec::new();

    for ffprobe in binary_candidates("ffprobe") {
        let mut command = Command::new(&ffprobe);
        command.args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ]);
        hide_windows_console(&mut command);

        let output = match command.output() {
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
            String::from_utf8(output.stdout).map_err(|_| "resolution_parse_failed".to_string())?;
        return parse_resolution_stdout(&stdout);
    }

    Err(format!("ffprobe_not_found:{}", launch_errors.join(";")))
}
