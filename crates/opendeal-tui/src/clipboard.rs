//! Clipboard access with a manual-copy fallback. Only public values are ever copied.

pub trait Clipboard {
    fn copy(&mut self, text: &str) -> Result<(), String>;
}

/// System clipboard via `arboard`, opened lazily so a headless terminal still starts.
#[derive(Default)]
pub struct SystemClipboard {
    inner: Option<arboard::Clipboard>,
}

impl Clipboard for SystemClipboard {
    fn copy(&mut self, text: &str) -> Result<(), String> {
        if self.inner.is_none() {
            self.inner = Some(arboard::Clipboard::new().map_err(|e| e.to_string())?);
        }
        let clipboard = self.inner.as_mut().expect("clipboard initialized above");
        return clipboard.set_text(text.to_owned()).map_err(|e| {
            // Drop a broken handle so the next attempt reconnects.
            self.inner = None;
            e.to_string()
        });
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CopyOutcome {
    Copied {
        label: String,
    },
    /// Clipboard unavailable: the UI shows `value` for manual selection.
    Fallback {
        label: String,
        value: String,
        reason: String,
    },
}

pub fn copy_with_fallback(clipboard: &mut dyn Clipboard, label: &str, value: &str) -> CopyOutcome {
    return match clipboard.copy(value) {
        Ok(()) => CopyOutcome::Copied {
            label: label.to_string(),
        },
        Err(reason) => CopyOutcome::Fallback {
            label: label.to_string(),
            value: value.to_string(),
            reason,
        },
    };
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    pub struct FakeClipboard {
        pub fail: bool,
        pub copied: Arc<Mutex<Vec<String>>>,
    }

    impl Clipboard for FakeClipboard {
        fn copy(&mut self, text: &str) -> Result<(), String> {
            if self.fail {
                return Err("no display".into());
            }
            self.copied.lock().unwrap().push(text.to_string());
            return Ok(());
        }
    }

    #[test]
    fn falls_back_to_manual_copy_when_clipboard_fails() {
        let mut ok = FakeClipboard::default();
        assert_eq!(
            copy_with_fallback(&mut ok, "Buyer key", "abc"),
            CopyOutcome::Copied {
                label: "Buyer key".into()
            }
        );
        assert_eq!(ok.copied.lock().unwrap().as_slice(), ["abc"]);
        let mut broken = FakeClipboard {
            fail: true,
            ..Default::default()
        };
        match copy_with_fallback(&mut broken, "Buyer key", "abc") {
            CopyOutcome::Fallback { value, reason, .. } => {
                assert_eq!(value, "abc");
                assert_eq!(reason, "no display");
            }
            other => panic!("expected fallback, got {:?}", other),
        }
    }
}
