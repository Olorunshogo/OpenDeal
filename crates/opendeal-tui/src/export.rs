//! Writes the prepared configuration to disk without silently overwriting anything.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

#[derive(Debug, PartialEq, Eq)]
pub enum ExportError {
    AlreadyExists,
    Io(String),
}

impl std::fmt::Display for ExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        return match self {
            ExportError::AlreadyExists => write!(f, "file already exists"),
            ExportError::Io(e) => write!(f, "{}", e),
        };
    }
}

/// Creates parent directories (0700) and writes the file (0600 on Unix).
/// With `overwrite == false` an existing file is never touched.
pub fn write_file(path: &Path, contents: &str, overwrite: bool) -> Result<(), ExportError> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        create_private_dir(parent).map_err(|e| ExportError::Io(e.to_string()))?;
    }
    if overwrite {
        // Write a sibling temp file then rename, so a failure never leaves a half-written file.
        let tmp = path.with_extension("json.tmp");
        let _ = std::fs::remove_file(&tmp);
        write_new(&tmp, contents)?;
        return std::fs::rename(&tmp, path).map_err(|e| ExportError::Io(e.to_string()));
    }
    return write_new(path, contents);
}

fn write_new(path: &Path, contents: &str) -> Result<(), ExportError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            ExportError::AlreadyExists
        } else {
            ExportError::Io(e.to_string())
        }
    })?;
    file.write_all(contents.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .map_err(|e| ExportError::Io(e.to_string()))?;
    return Ok(());
}

fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    return builder.create(dir);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("opendeal-tui-test-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        return dir;
    }

    #[test]
    fn refuses_to_overwrite_without_confirmation() {
        let dir = temp_dir("overwrite");
        let path = dir.join("nested/prepared.json");
        write_file(&path, "{\"a\":1}", false).unwrap();
        assert_eq!(
            write_file(&path, "{\"a\":2}", false),
            Err(ExportError::AlreadyExists)
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":1}\n");
        write_file(&path, "{\"a\":2}", true).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"a\":2}\n");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("perms");
        let path = dir.join("prepared.json");
        write_file(&path, "{}", false).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        write_file(&path, "{}", true).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_dir_all(dir);
    }
}
