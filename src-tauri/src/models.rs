use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedFields {
    pub video_name: String,
    pub categories: Vec<String>,
    pub head_cut: f64,
    pub tail_cut: f64,
    pub zoom_ratio: f64,
    pub zoom_mode: u8,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRowDto {
    pub id: String,
    pub path: String,
    pub file_name: String,
    pub duration_sec: f64,
    pub parse_status: String,
    pub parse_error: Option<String>,
    pub warning_flags: Vec<String>,
    pub parsed_fields: Option<ParsedFields>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameItemInput {
    pub id: String,
    pub source_path: String,
    pub target_file_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameItemResult {
    pub id: String,
    pub success: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameBatchSummary {
    pub total: usize,
    pub success: usize,
    pub failed: usize,
    pub results: Vec<RenameItemResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameProgressEvent {
    pub current: usize,
    pub total: usize,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionInfoDto {
    pub id: String,
    pub path: String,
    pub file_name: String,
    pub width: u32,
    pub height: u32,
    pub duration_sec: f64,
    pub target_width: u32,
    pub target_height: u32,
    pub orientation: String,
    pub ratio_status: String,
    pub process_status: String,
    pub process_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionProcessInput {
    pub id: String,
    pub source_path: String,
    pub target_width: u32,
    pub target_height: u32,
    pub overwrite_source: bool,
    pub open_output_folder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionProcessResult {
    pub id: String,
    pub success: bool,
    pub output_path: Option<String>,
    pub output_dir: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionProgressEvent {
    pub id: String,
    pub progress: f64,
}
