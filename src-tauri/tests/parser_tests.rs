use usersstaffvideo_name_lib::parser::parse_filename;

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
fn parse_name_with_hyphen_warns() {
    let result = parse_filename("我的-素材-0.5-1-1.2-2.mp4", 100.0).unwrap();
    assert_eq!(result.video_name, "我的-素材");
    assert!(result
        .warnings
        .contains(&"name_contains_hyphen".to_string()));
}
