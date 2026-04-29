pub fn validate_fields(
    head: f64,
    tail: f64,
    ratio: f64,
    mode: u8,
    duration: f64,
) -> Result<(), String> {
    if !(1..=4).contains(&mode) {
        return Err("mode_out_of_range".into());
    }
    if !(ratio > 0.0 && ratio <= 2.0) {
        return Err("ratio_out_of_range".into());
    }
    if head < 0.0 || tail < 0.0 {
        return Err("cut_negative".into());
    }
    if head + tail >= duration {
        return Err("cut_exceeds_duration".into());
    }
    Ok(())
}
