use video_name_editor_lib::rename::build_target_name;

#[test]
fn build_replace_name_for_parsed_success() {
    let name = build_target_name("old.mp4", "精品视频", &["分类".to_string()], 0.5, 2.0, 1.2, 1, true);
    assert_eq!(name, "精品视频-分类-0.5-2-1.2-1.mp4");
}

#[test]
fn build_append_name_for_parse_failed() {
    let name = build_target_name("原名.mp4", "", &[], 0.5, 2.0, 1.2, 1, false);
    assert_eq!(name, "原名-0.5-2-1.2-1.mp4");
}

#[test]
fn build_name_for_mov_keeps_extension() {
    let name = build_target_name("视频.mov", "视频", &["教程".to_string()], 0.5, 2.0, 1.2, 1, true);
    assert_eq!(name, "视频-教程-0.5-2-1.2-1.mov");
}

#[test]
fn build_name_for_mov_parse_failed() {
    let name = build_target_name("原名.mov", "", &[], 0.5, 2.0, 1.2, 1, false);
    assert_eq!(name, "原名-0.5-2-1.2-1.mov");
}

#[test]
fn build_name_with_multiple_categories() {
    let name = build_target_name("视频.mp4", "视频", &["搞笑".to_string(), "教程".to_string()], 0.5, 2.0, 1.2, 1, true);
    assert_eq!(name, "视频-搞笑&教程-0.5-2-1.2-1.mp4");
}
