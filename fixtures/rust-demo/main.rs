use serde::Serialize;
use std::collections::HashMap;
use missing_crate::Thing;

fn main() {
    let mut map: HashMap<String, String> = HashMap::new();
    map.insert("key".to_string(), "value".to_string());
}
