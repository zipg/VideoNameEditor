pub mod commands;
pub mod errors;
pub mod models;
pub mod parser;
pub mod probe;
pub mod rename;
pub mod validator;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::parse_files,
            commands::execute_batch_rename
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
