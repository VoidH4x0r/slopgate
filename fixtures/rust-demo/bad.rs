fn unreachable() -> i32 {
    return 1;
    println!("dead");
}

fn stub() -> i32 {
    todo!()
}

fn swallowed(result: Result<(), Error>) {
    if let Err(_) = result {
    }
}
