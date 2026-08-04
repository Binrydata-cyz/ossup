//! OSS 上传助手 — a thin, reliable GUI over the official `ossutil` CLI.
//!
//! Targets **ossutil 2.x**, which differs from 1.x in ways that matter here:
//! `version` is a subcommand (not `--version`), the config file uses a
//! `[default]` profile, `--jobs` became `-j`, and v4 signing makes `region`
//! mandatory — so it is derived from the endpoint, see `region_from_endpoint`.
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
            // 留空，让用户自己选地域，避免默认值把数据传到错误的地域
            endpoint: String::new(),
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

    Ok(ClientConfig {
        access_key_id: stored.access_key_id,
        access_key_secret: secret,
        endpoint: stored.endpoint,
        bucket: stored.bucket,
        prefix: stored.prefix,
        remember: stored.remember,
        jobs: if stored.jobs == 0 {
            d_jobs()
        } else {
            stored.jobs
        },
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

/// ossutil 直接嵌进 exe，单文件下载即用；首次运行解到缓存目录。
#[cfg(windows)]
const EMBEDDED_OSSUTIL: &[u8] = include_bytes!("../binaries/ossutil.exe");

/// 解出内嵌的 ossutil。长度不一致视为旧版本，覆盖重写。
#[cfg(windows)]
fn extract_embedded(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(binary_name());
    let fresh = std::fs::metadata(&path)
        .map(|m| m.len() == EMBEDDED_OSSUTIL.len() as u64)
        .unwrap_or(false);
    // ponytail: 只比长度，不算哈希——同长度不同内容的 ossutil 不会出现在发布流程里
    if !fresh {
        std::fs::write(&path, EMBEDDED_OSSUTIL).ok()?;
    }
    Some(path)
}

#[cfg(not(windows))]
fn extract_embedded(_app: &AppHandle) -> Option<PathBuf> {
    None
}

/// Resolution order: user override -> bundled resource -> embedded copy -> system PATH.
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
    if let Some(path) = extract_embedded(app) {
        return path;
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
    // 2.x 是 `ossutil version`；1.x 只认 `--version`，两个都试一下。
    let mut output = base_command(&app, &ossutil_path)
        .arg("version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("无法启动 ossutil: {e}"))?;

    if !output.status.success() {
        output = base_command(&app, &ossutil_path)
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("无法启动 ossutil: {e}"))?;
    }

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
    // 2.x 的 `version` 只吐一个裸版本号（"2.3.0"），补上名字界面上才看得懂。
    if line.to_lowercase().contains("ossutil") {
        Ok(line)
    } else {
        Ok(format!("ossutil {line}"))
    }
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
///
/// 1.x: `Total num: 12, size: ... OK num: 3 ... speed: 1.2 MB/s`
/// 2.x: `Total 2 files, 12 B, 1 dirs, Upload done:(1 objects) failed:(0 objects)`
///
/// 2.x 压根不打百分比，所以百分比按文件数自己算。
fn parse_line(line: &str) -> UploadEvent {
    static PERCENT: OnceLock<Regex> = OnceLock::new();
    static SPEED: OnceLock<Regex> = OnceLock::new();
    static TOTAL_1X: OnceLock<Regex> = OnceLock::new();
    static OK_1X: OnceLock<Regex> = OnceLock::new();
    static TOTAL_2X: OnceLock<Regex> = OnceLock::new();
    static OK_2X: OnceLock<Regex> = OnceLock::new();

    // 1.x 写成 "speed: 1.2 MB/s"，2.x 直接是 "1.2 MiB/s"，所以前缀可有可无。
    let speed = cap_str(line, r"(?i)([\d.]+\s*[KMGT]?i?B/s)", &SPEED);
    let total_num = cap_u64(line, r"(?i)total\s+num:\s*([\d,]+)", &TOTAL_1X)
        .or_else(|| cap_u64(line, r"(?i)total\s+([\d,]+)\s+files?\b", &TOTAL_2X));
    // 只认 "done:("，别把 "failed:(3 objects)" 当成传好了
    let ok_num = cap_u64(line, r"(?i)(?:ok|dealt)\s+num:\s*([\d,]+)", &OK_1X)
        .or_else(|| cap_u64(line, r"(?i)\bdone:\(\s*([\d,]+)\s+objects?", &OK_2X));

    let percent = cap_f64(line, r"(\d+(?:\.\d+)?)\s*%", &PERCENT).or(match (ok_num, total_num) {
        (Some(ok), Some(total)) if total > 0 => Some(ok as f64 * 100.0 / total as f64),
        _ => None,
    });

    let is_progress = percent.is_some() || speed.is_some() || total_num.is_some();

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

/// ossutil 2.x 默认用 v4 签名，v4 强制要求 region，而界面上只让填 endpoint，
/// 所以从 endpoint 反推。推不出来（自定义域名、传输加速域名）就返回 None，
/// 调用方会退回 v1 签名。
fn region_from_endpoint(endpoint: &str) -> Option<String> {
    static REGION: OnceLock<Regex> = OnceLock::new();
    re(
        r"(?i)^oss-([a-z]{2}-[a-z0-9-]+?)(?:-internal)?\.aliyuncs\.com$",
        &REGION,
    )
    .captures(endpoint.trim())
    .map(|c| c[1].to_lowercase())
}

fn write_cred_file(app: &AppHandle, req: &UploadRequest) -> Result<PathBuf, String> {
    let path = config_dir(app)?.join("session.ossutilconfig");
    let endpoint = req.endpoint.trim();
    let mut body = format!(
        "[default]\nlanguage=CH\naccessKeyID={}\naccessKeySecret={}\n",
        req.access_key_id.trim(),
        req.access_key_secret
    );
    if !endpoint.is_empty() {
        body.push_str(&format!("endpoint={endpoint}\n"));
    }
    if let Some(region) = region_from_endpoint(endpoint) {
        body.push_str(&format!("region={region}\n"));
    }
    std::fs::write(&path, body).map_err(|e| format!("无法写入临时凭证文件: {e}"))?;
    restrict_permissions(&path);
    Ok(path)
}

/// 凭证 + 签名版本，`cp` 和 `ls` 都要带。
fn add_auth_args(cmd: &mut Command, cred_file: &Path, endpoint: &str) {
    cmd.arg("--config-file").arg(cred_file);
    if region_from_endpoint(endpoint).is_none() {
        cmd.arg("--sign-version").arg("v1");
    }
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
        .arg("-f"); // never prompt
    add_auth_args(&mut cmd, &cred_file, &req.endpoint);
    cmd.arg("--checkpoint-dir")
        .arg(&checkpoint)
        // 2.x 的错误报告默认写到当前工作目录的 ossutil_output/，挪进配置目录
        .arg("--output-dir")
        .arg(cfg_dir.join("output"))
        .arg("-j") // 2.x 把 --jobs 改成了 -j
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
    let mut cmd = base_command(&app, &req.ossutil_path);
    cmd.arg("ls").arg("--short-format"); // 2.x 去掉了 -s 短写法
    add_auth_args(&mut cmd, &cred_file, &req.endpoint);
    let output = cmd
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

#[cfg(test)]
mod tests {
    use super::{parse_line, region_from_endpoint};

    #[test]
    fn progress_parsing() {
        // 2.x 实测输出
        let e =
            parse_line("Total 8 files, 12 B, 1 dirs, Upload done:(2 objects) failed:(0 objects)");
        assert_eq!(e.kind, "progress");
        assert_eq!(e.total_num, Some(8));
        assert_eq!(e.ok_num, Some(2));
        assert_eq!(e.percent, Some(25.0));

        // failed:( 不能被当成 done:(
        let e = parse_line(
            "Total 4 files, 12 B, 1 dirs, Upload done:(0 objects) failed:(4 objects, 12 B)",
        );
        assert_eq!(e.ok_num, Some(0));
        assert_eq!(e.percent, Some(0.0));

        // 1.x 输出，百分比和速度用它自己打的
        let e = parse_line("Total num: 10, size: 100. OK num: 5. 50% speed: 1.2 MB/s");
        assert_eq!(
            (e.total_num, e.ok_num, e.percent),
            (Some(10), Some(5), Some(50.0))
        );
        assert_eq!(e.speed.as_deref(), Some("1.2 MB/s"));

        // 2.x 裸速度，没有 "speed:" 前缀
        assert_eq!(
            parse_line("copying 3.5 MiB/s").speed.as_deref(),
            Some("3.5 MiB/s")
        );

        // 普通日志行不该被当成进度
        assert_eq!(parse_line("Error: NoSuchBucket").kind, "log");
    }

    #[test]
    fn region_derivation() {
        let r = |e| region_from_endpoint(e);
        assert_eq!(
            r("oss-cn-hangzhou.aliyuncs.com").as_deref(),
            Some("cn-hangzhou")
        );
        assert_eq!(
            r("oss-cn-hangzhou-internal.aliyuncs.com").as_deref(),
            Some("cn-hangzhou")
        );
        assert_eq!(
            r("oss-ap-southeast-1.aliyuncs.com").as_deref(),
            Some("ap-southeast-1")
        );
        assert_eq!(
            r(" oss-us-west-1.aliyuncs.com ").as_deref(),
            Some("us-west-1")
        );
        // 推不出 region 的：传输加速、自定义域名、空值 —— 调用方退回 v1 签名
        assert_eq!(r("oss-accelerate.aliyuncs.com"), None);
        assert_eq!(r("cdn.example.com"), None);
        assert_eq!(r(""), None);
    }
}
