use usersstaffvideo_name_lib::validator::validate_fields;

#[test]
fn reject_ratio_over_2() {
    assert!(validate_fields(0.1, 0.1, 2.1, 1, 10.0).is_err());
}

#[test]
fn reject_cut_sum_ge_duration() {
    assert!(validate_fields(3.0, 2.0, 1.0, 1, 5.0).is_err());
}

#[test]
fn accept_valid_fields() {
    assert!(validate_fields(0.5, 1.5, 1.25, 2, 10.0).is_ok());
}
