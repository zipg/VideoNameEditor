use usersstaffvideo_name_lib::probe::parse_duration_stdout;

#[test]
fn parse_duration_stdout_ok() {
    let d = parse_duration_stdout("12.345\n").unwrap();
    assert_eq!(d, 12.35);
}

#[test]
fn parse_duration_stdout_invalid() {
    assert!(parse_duration_stdout("abc").is_err());
}
