use video_name_editor_lib::rename::build_target_name;

#[test]
fn build_replace_name_for_parsed_success() {
    let name = build_target_name("old.mp4", "精品视频", 0.5, 2.0, 1.2, 1, true);
    assert_eq!(name, "精品视频-0.5-2-1.2-1.mp4");
}

#[test]
fn build_append_name_for_parse_failed() {
    let name = build_target_name("原名.mp4", "", 0.5, 2.0, 1.2, 1, false);
    assert_eq!(name, "原名-0.5-2-1.2-1.mp4");
}
