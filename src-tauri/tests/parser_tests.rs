use video_name_editor_lib::parser::parse_filename;

#[test]
fn parse_new_format_filename_success() {
    let result = parse_filename("精品视频073116-分类&标签-0.65-2-1.25-1.mp4", 60.0).unwrap();
    assert_eq!(result.video_name, "精品视频073116");
    assert_eq!(result.categories, vec!["分类", "标签"]);
    assert_eq!(result.head_cut, 0.65);
    assert_eq!(result.tail_cut, 2.0);
    assert_eq!(result.zoom_ratio, 1.25);
    assert_eq!(result.zoom_mode, 1);
    assert!(result.warnings.is_empty());
}

#[test]
fn parse_mode_with_trailing_space_success() {
    let result = parse_filename("渐变暗色003-教程-1-2.11-1.25-1 .mp4", 30.0).unwrap();
    assert_eq!(result.video_name, "渐变暗色003");
    assert_eq!(result.categories, vec!["教程"]);
    assert_eq!(result.head_cut, 1.0);
    assert_eq!(result.tail_cut, 2.11);
    assert_eq!(result.zoom_ratio, 1.25);
    assert_eq!(result.zoom_mode, 1);
}

#[test]
fn parse_mov_filename_success() {
    let result = parse_filename("精品视频-搞笑&教程-0.65-2-1.25-1.mov", 60.0).unwrap();
    assert_eq!(result.video_name, "精品视频");
    assert_eq!(result.categories, vec!["搞笑", "教程"]);
    assert_eq!(result.head_cut, 0.65);
    assert_eq!(result.tail_cut, 2.0);
    assert_eq!(result.zoom_ratio, 1.25);
    assert_eq!(result.zoom_mode, 1);
    assert!(result.warnings.is_empty());
}

#[test]
fn parse_name_with_hyphens_warning() {
    let result = parse_filename("精品-视频-分类A-0.5-2-1.25-1.mp4", 60.0).unwrap();
    assert_eq!(result.video_name, "精品-视频");
    assert_eq!(result.categories, vec!["分类A"]);
    assert_eq!(result.warnings, vec!["name_contains_hyphen"]);
}
