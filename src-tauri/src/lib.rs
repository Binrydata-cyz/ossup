//! OSS 上传助手 — a thin, reliable GUI over the official `ossutil` CLI.
//!
//! Design notes
//! -------------
//! * Credentials never touch the command line by default. They are written to a
//!   0600 config file that is passed with `--config-file` and removed when the
//!   upload finishes.
//! * The checkpoint directory is stable across runs, which is what makes
//!   "close the app, reopen, press start again" resume instead of restart.
//! * `ossutil` renders progress with carriage returns, so stdout is consumed as
//!   a byte stream and split on both `\r` and `\n`.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use walkdir::WalkDir;

const EVENT: &str = "upload://event";

/* ------------------------------------------------------------------ */
/* config                                                              */
/* ------------------------------------------------------------------ */

fn d_jobs() -> u32 {
    5
}
fn d_parallel() -> u32 {
    8
}
fn d_part() -> u64 {
    16
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    #[serde(default)]
    pub access_key_id: String,
    #[serde(default)]
    pub access_key_secret: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub bucket: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub remember: bool,
    #[serde(default = "d_jobs")]
    pub jobs: u32,
    #[serde(default = "d_parallel")]
    pub parallel: u32,
    #[serde(default = "d_part")]
    pub part_size_mb: u64,
    #[serde(default)]
    pub ossutil_path: String,
    #[serde(default)]
    pub cli_creds: bool,
    /// Optional allow-list shown as a dropdown in the UI.
    #[serde(default)]
    pub buckets: Vec<String>,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            access_key_id: String::new(),
            access_key_secret: String::new(),
            endpoint: "oss-cn-hangzhou.aliyuncs.com".into(),
            bucket: String::new(),
            prefix: String::new(),
            remember: false,
            jobs: d_jobs(),
            parallel: d_parallel(),
            part_size_mb: d_part(),
            ossutil_path: String::new(),
            cli_creds: false,
            buckets: Vec::new(),
        }
    }
}

/// On-disk shape. The secret is base64 encoded so it is not readable at a
/// glance. This is obfuscation, not encryption — see README.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StoredConfig {
    access_key_id: String,
    access_key_secret_enc: String,
    endpoint: String,
    bucket: String,
    prefix: String,
    remember: bool,
    jobs: u32,
    parallel: u32,
    part_size_mb: u64,
    ossutil_path: String,
    cli_creds: bool,
    buckets: Vec<String>,
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建配置目录: {e}"))?;
    Ok(dir)
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("config.json"))
}

#[tauri::command]
fn load_config(app: AppHandle) -> Result<ClientConfig, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(ClientConfig::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let stored: StoredConfig = serde_json::from_str(&raw).unwrap_or_default();

    let secret = B64
        .decode(stored.access_key_secret_enc.as_bytes())
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_default();

    let defaults = ClientConfig::default();
    Ok(ClientConfig {
        access_key_id: stored.access_key_id,
        access_key_secret: secret,
        endpoint: if stored.endpoint.is_empty() {
            defaults.endpoint
        } else {
            stored.endpoint
        },
        bucket: stored.bucket,
        prefix: stored.prefix,
        remember: stored.remember,
        jobs: if stored.jobs == 0 { d_jobs() } else { stored.jobs },
        parallel: if stored.parallel == 0 {
            d_parallel()
        } else {
            stored.parallel
        },
        part_size_mb: if stored.part_size_mb == 0 {
            d_part()
        } else {
            stored.part_size_mb
        },
        ossutil_path: stored.ossutil_path,
        cli_creds: stored.cli_creds,
        buckets: stored.buckets,
    })
}

#[tauri::command]
fn save_config(app: AppHandle, cfg: ClientConfig) -> Result<(), String> {
    let path = config_path(&app)?;
    let stored = StoredConfig {
        access_key_id: cfg.access_key_id,
        access_key_secret_enc: B64.encode(cfg.access_key_secret.as_bytes()),
        endpoint: cfg.endpoint,
        bucket: cfg.bucket,
        prefix: cfg.prefix,
        remember: cfg.remember,
        jobs: cfg.jobs,
        parallel: cfg.parallel,
        part_size_mb: cfg.part_size_mb,
        ossutil_path: cfg.ossutil_path,
        cli_creds: cfg.cli_creds,
        buckets: cfg.buckets,
    };
    let json = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    restrict_permissions(&path);
    Ok(())
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

/* ------------------------------------------------------------------ */
/* ossutil discovery                                                   */
/* ------------------------------------------------------------------ */

fn binary_name() -> &'static str {
    if cfg!(windows) {
        "ossutil.exe"
    } else {
        "ossutil"
    }
}

/// Resolution order: user override -> bundled resource -> system PATH.
fn resolve_ossutil(app: &AppHandle, custom: &str) -> PathBuf {
    let custom = custom.trim();
    if !custom.is_empty() {
        return PathBuf::from(custom);
    }
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("binaries").join(binary_name());
        if bundled.exists() {
            return bundled;
        }
    }
    PathBuf::from(binary_name())
}

fn base_command(app: &AppHandle, custom: &str) -> Command {
    let mut cmd = Command::new(resolve_ossutil(app, custom));
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW — keeps a console from flashing on every call.
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

#[tauri::command]
async fn check_ossutil(app: AppHandle, ossutil_path: String) -> Result<String, String> {
    let output = base_command(&app, &ossutil_path)
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("无法启动 ossutil: {e}"))?;

    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let line = text
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("ossutil")
        .trim()
        .to_string();
    Ok(line)
}

/* ------------------------------------------------------------------ */
/* requests + events                                                   */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    pub local_path: String,
    pub bucket: String,
    #[serde(default)]
    pub prefix: String,
    pub access_key_id: String,
    pub access_key_secret: String,
    pub endpoint: String,
    #[serde(default = "d_jobs")]
    pub jobs: u32,
    #[serde(default = "d_parallel")]
    pub parallel: u32,
    #[serde(default = "d_part")]
    pub part_size_mb: u64,
    #[serde(default)]
    pub ossutil_path: String,
    #[serde(default)]
    pub cli_creds: bool,
}

impl UploadRequest {
    fn target(&self) -> String {
        let prefix = self.prefix.trim().trim_matches('/');
        if prefix.is_empty() {
            format!("oss://{}/", self.bucket.trim())
        } else {
            format!("oss://{}/{}/", self.bucket.trim(), prefix)
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadEvent {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    speed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_num: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ok_num: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<i32>,
}

impl UploadEvent {
    fn log(line: String) -> Self {
        Self {
            kind: "log",
            line: Some(line),
            percent: None,
            speed: None,
            total_num: None,
            ok_num: None,
            code: None,
        }
    }
}

/* ------------------------------------------------------------------ */
/* progress parsing                                                    */
/* ------------------------------------------------------------------ */

fn re(pattern: &'static str, cell: &'static OnceLock<Regex>) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

fn cap_f64(text: &str, pattern: &'static str, cell: &'static OnceLock<Regex>) -> Option<f64> {
    re(pattern, cell)
        .captures(text)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().replace(',', "").parse().ok())
}

fn cap_u64(text: &str, pattern: &'static str, cell: &'static OnceLock<Regex>) -> Option<u64> {
    cap_f64(text, pattern, cell).map(|v| v as u64)
}

fn cap_str(text: &str, pattern: &'static str, cell: &'static OnceLock<Regex>) -> Option<String> {
    re(pattern, cell)
        .captures(text)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
}

/// `ossutil` progress lines differ between 1.x and 2.x, so every field is
/// parsed independently and treated as optional.
fn parse_line(line: &str) -> UploadEvent {
    static PERCENT: OnceLock<Regex> = OnceLock::new();
    static SPEED: OnceLock<Regex> = OnceLock::new();
    static TOTAL: OnceLock<Regex> = OnceLock::new();
    static OK: OnceLock<Regex> = OnceLock::new();

    let percent = cap_f64(line, r"(\d+(?:\.\d+)?)\s*%", &PERCENT);
    let speed = cap_str(line, r"(?i)speed:\s*([\d.]+\s*[KMGT]?B/s)", &SPEED);
    let total_num = cap_u64(line, r"(?i)total\s+num:\s*([\d,]+)", &TOTAL);
    let ok_num = cap_u64(line, r"(?i)(?:ok|dealt)\s+num:\s*([\d,]+)", &OK);

    let is_progress =
        percent.is_some() || speed.is_some() || total_num.is_some() || ok_num.is_some();

    UploadEvent {
        kind: if is_progress { "progress" } else { "log" },
        line: Some(line.to_string()),
        percent,
        speed,
        total_num,
        ok_num,
        code: None,
    }
}

/* ------------------------------------------------------------------ */
/* stream pump                                                         */
/* ------------------------------------------------------------------ */

/// Reads a child stream byte by byte and flushes a segment on `\n` **or**
/// `\r`. Line-oriented readers hang forever on `ossutil`'s progress output
/// because it repaints the same line with carriage returns.
async fn pump<R>(mut reader: R, app: AppHandle)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let mut chunk = [0u8; 4096];
    let mut acc: Vec<u8> = Vec::with_capacity(256);

    loop {
        match reader.read(&mut chunk).await {
            Ok(0) => break,
            Ok(n) => {
                for &byte in &chunk[..n] {
                    if byte == b'\n' || byte == b'\r' {
                        flush(&mut acc, &app);
                    } else {
                        acc.push(byte);
                    }
                }
            }
            Err(_) => break,
        }
    }
    flush(&mut acc, &app);
}

fn flush(acc: &mut Vec<u8>, app: &AppHandle) {
    if acc.is_empty() {
        return;
    }
    let text = String::from_utf8_lossy(acc).trim_end().to_string();
    acc.clear();
    if text.is_empty() {
        return;
    }
    let _ = app.emit(EVENT, parse_line(&text));
}

/* ------------------------------------------------------------------ */
/* credential file                                                     */
/* ------------------------------------------------------------------ */

fn write_cred_file(app: &AppHandle, req: &UploadRequest) -> Result<PathBuf, String> {
    let path = config_dir(app)?.join("session.ossutilconfig");
    let body = format!(
        "[Credentials]\nlanguage=CH\nendpoint={}\naccessKeyID={}\naccessKeySecret={}\n",
        req.endpoint.trim(),
        req.access_key_id.trim(),
        req.access_key_secret
    );
    std::fs::write(&path, body).map_err(|e| format!("无法写入临时凭证文件: {e}"))?;
    restrict_permissions(&path);
    Ok(path)
}

/* ------------------------------------------------------------------ */
/* upload                                                              */
/* ------------------------------------------------------------------ */

#[derive(Default)]
pub struct AppState {
    child: Arc<Mutex<Option<Child>>>,
}

#[tauri::command]
async fn start_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    req: UploadRequest,
) -> Result<(), String> {
    if state.child.lock().await.is_some() {
        return Err("已有上传任务在运行".into());
    }

    let source = PathBuf::from(&req.local_path);
    if !source.exists() {
        return Err(format!("本地路径不存在: {}", req.local_path));
    }

    let cfg_dir = config_dir(&app)?;
    let checkpoint = cfg_dir.join("checkpoints");
    std::fs::create_dir_all(&checkpoint).map_err(|e| e.to_string())?;
    let cred_file = write_cred_file(&app, &req)?;

    let part_bytes = req.part_size_mb.max(1) * 1024 * 1024;
    let target = req.target();

    let mut cmd = base_command(&app, &req.ossutil_path);
    cmd.arg("cp")
        .arg("-r") // recurse into the folder
        .arg("-u") // skip objects that are already up to date
        .arg("-f") // never prompt
        .arg("--config-file")
        .arg(&cred_file)
        .arg("--checkpoint-dir")
        .arg(&checkpoint)
        .arg("--jobs")
        .arg(req.jobs.max(1).to_string())
        .arg("--parallel")
        .arg(req.parallel.max(1).to_string())
        .arg("--part-size")
        .arg(part_bytes.to_string())
        .arg(&source)
        .arg(&target);

    if req.cli_creds {
        cmd.arg("-i")
            .arg(req.access_key_id.trim())
            .arg("-k")
            .arg(&req.access_key_secret)
            .arg("-e")
            .arg(req.endpoint.trim());
    }

    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .kill_on_drop(true);

    let _ = app.emit(
        EVENT,
        UploadEvent::log(format!(
            "[start] {} -> {}  (jobs={}, parallel={}, part-size={}MB)",
            source.display(),
            target,
            req.jobs,
            req.parallel,
            req.part_size_mb
        )),
    );

    let mut child = cmd.spawn().map_err(|e| {
        let _ = std::fs::remove_file(&cred_file);
        format!("无法启动 ossutil: {e}")
    })?;

    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(pump(stdout, app.clone()));
    }
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(pump(stderr, app.clone()));
    }

    let slot = state.child.clone();
    *slot.lock().await = Some(child);

    // Poll instead of awaiting `wait()` so `cancel_upload` can take the lock.
    tokio::spawn(async move {
        let code = loop {
            tokio::time::sleep(Duration::from_millis(250)).await;
            let mut guard = slot.lock().await;
            let Some(child) = guard.as_mut() else {
                break -1;
            };
            match child.try_wait() {
                Ok(Some(status)) => {
                    *guard = None;
                    break status.code().unwrap_or(-1);
                }
                Ok(None) => continue,
                Err(_) => {
                    *guard = None;
                    break -1;
                }
            }
        };

        let _ = std::fs::remove_file(&cred_file);
        let _ = app.emit(
            EVENT,
            UploadEvent {
                kind: "finished",
                line: Some(format!("[exit] ossutil 退出码 {code}")),
                percent: None,
                speed: None,
                total_num: None,
                ok_num: None,
                code: Some(code),
            },
        );
    });

    Ok(())
}

#[tauri::command]
async fn cancel_upload(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.child.lock().await;
    if let Some(child) = guard.as_mut() {
        child.start_kill().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("没有正在运行的上传任务".into())
    }
}

/* ------------------------------------------------------------------ */
/* verification                                                        */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    local_count: u64,
    local_size: u64,
    local_size_human: String,
    remote_count: u64,
}

fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.2} {}", UNITS[unit])
    }
}

fn scan_local(root: &Path) -> (u64, u64) {
    let mut count = 0;
    let mut size = 0;
    for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
        if entry.file_type().is_file() {
            count += 1;
            if let Ok(meta) = entry.metadata() {
                size += meta.len();
            }
        }
    }
    (count, size)
}

#[tauri::command]
async fn verify_upload(app: AppHandle, req: UploadRequest) -> Result<VerifyResult, String> {
    let source = PathBuf::from(&req.local_path);
    let (local_count, local_size) = tokio::task::spawn_blocking(move || scan_local(&source))
        .await
        .map_err(|e| e.to_string())?;

    let cred_file = write_cred_file(&app, &req)?;
    let output = base_command(&app, &req.ossutil_path)
        .arg("ls")
        .arg("-s")
        .arg("--config-file")
        .arg(&cred_file)
        .arg(req.target())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .output()
        .await;
    let _ = std::fs::remove_file(&cred_file);

    let output = output.map_err(|e| format!("校验失败: {e}"))?;
    let text = String::from_utf8_lossy(&output.stdout).to_string();

    static OBJ: OnceLock<Regex> = OnceLock::new();
    let remote_count = cap_u64(&text, r"(?i)object\s+number\s+is:\s*([\d,]+)", &OBJ)
        .unwrap_or_else(|| text.lines().filter(|l| l.starts_with("oss://")).count() as u64);

    Ok(VerifyResult {
        local_count,
        local_size,
        local_size_human: human_size(local_size),
        remote_count,
    })
}

/* ------------------------------------------------------------------ */
/* entry point                                                         */
/* ------------------------------------------------------------------ */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            check_ossutil,
            start_upload,
            cancel_upload,
            verify_upload,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
