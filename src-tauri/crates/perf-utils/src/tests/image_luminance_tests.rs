use crate::image_luminance::*;

#[test]
fn test_luminance_calculation() {
    // Pure white = 1.0
    assert!((calculate_pixel_luminance(255, 255, 255) - 1.0).abs() < 0.01);
    // Pure black = 0.0
    assert!((calculate_pixel_luminance(0, 0, 0) - 0.0).abs() < 0.01);
    // Gray should be in the middle
    let gray = calculate_pixel_luminance(128, 128, 128);
    assert!(gray > 0.1 && gray < 0.5);
}
