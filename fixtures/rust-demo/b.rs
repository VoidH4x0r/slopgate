fn duplicate_b(x: i32) -> i32 {
    let mut y = x + 1;
    if y > 10 {
        y = y * 2;
    }
    y += 3;
    y
}
