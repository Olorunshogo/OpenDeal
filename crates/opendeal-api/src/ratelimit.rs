use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    per_minute: u32,
    hits: Mutex<HashMap<String, Vec<Instant>>>,
}

impl RateLimiter {
    pub fn new(per_minute: u32) -> Self {
        return RateLimiter {
            per_minute,
            hits: Mutex::new(HashMap::new()),
        };
    }

    pub fn allow(&self, key: &str) -> bool {
        if self.per_minute == 0 {
            return true;
        }
        let mut hits = self.hits.lock().expect("rate limiter mutex");
        let now = Instant::now();
        let window = Duration::from_secs(60);
        let entry = hits.entry(key.to_string()).or_default();
        entry.retain(|at| now.duration_since(*at) < window);
        if entry.len() as u32 >= self.per_minute {
            return false;
        }
        entry.push(now);
        return true;
    }
}
