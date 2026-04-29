use video_name_editor_lib::parser::parse_filename;

#[test]
fn parse_standard_filename_success() {
    let result = parse_filename("精品视频073116-0.65-2-1.25-1.mp4", 60.0).unwrap();
    assert_eq!(result.video_name, "精品视频073116");
    assert_eq!(result.head_cut, 0.65);
    assert_eq!(result.tail_cut, 2.0);
    assert_eq!(result.zoom_ratio, 1.25);
    assert_eq!(result.zoom_mode, 1);
    assert!(result.warnings.is_empty());
}

#[test]
fn parse_mode_with_trailing_space_success() {
    let result = parse_filename("渐变暗色003-1-2.11-1.25-1 .mp4", 30.0).unwrap();
    assert_eq!(result.video_name, "渐变暗色003");
    assert_eq!(result.head_cut, 1.0);
    assert_eq!(result.tail_cut, 2.11);
    assert_eq!(result.zoom_ratio, 1.25);
    assert_eq!(result.zoom_mode, 1);
}
