pub fn map_rename_error(error: &std::io::Error) -> String {
    use std::io::ErrorKind;

    match error.kind() {
        ErrorKind::PermissionDenied => "PermissionDenied".to_string(),
        ErrorKind::NotFound => "NotFound".to_string(),
        ErrorKind::AlreadyExists => "TargetExists".to_string(),
        _ => "Unknown".to_string(),
    }
}
