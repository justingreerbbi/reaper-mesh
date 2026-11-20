//! Reaper Mesh desktop app (D58): the web portal and the firmware installer in a native window,
//! with USB serial provided by the app because system webviews have no Web Serial. The pages are
//! the same builds the website serves; see docs/guides/desktop-app.md.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod power;
mod serial;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::DownloadEvent;
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// Gives the page a Web Serial `navigator.serial` backed by `serial.rs`. Built from
/// agents/desktop/serial-shim.ts by `npm run build:desktop-shim`.
const SERIAL_SHIM: &str = include_str!("../../../../dist/desktop-shim/serial-shim.js");
const WEBSITE: &str = "https://reapermesh.com";

/// The app's own pages: the portal (web/) and the installer (flash/).
fn local_path(url: &Url) -> Option<&str> {
    let local = url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost");
    local.then(|| url.path())
}

/// Keeps the window on the app's pages. The website's other pages and outside links open in the
/// system browser instead.
fn allow_navigation(url: &Url) -> bool {
    match local_path(url) {
        Some(path) if path == "/" || path.starts_with("/web/") || path.starts_with("/flash/") => {
            true
        }
        Some(path) => {
            let _ = open::that_detached(format!("{WEBSITE}{path}"));
            false
        }
        None if matches!(url.scheme(), "http" | "https" | "mailto") => {
            let _ = open::that_detached(url.as_str());
            false
        }
        None => false,
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(serial::Ports::default())
        .manage(power::Awake::default())
        .invoke_handler(tauri::generate_handler![
            power::keep_awake,
            serial::serial_list,
            serial::serial_open,
            serial::serial_write,
            serial::serial_set_signals,
            serial::serial_close,
        ])
        .setup(|app| {
            let portal = MenuItem::with_id(app, "portal", "Web Portal", true, Some("CmdOrCtrl+1"))?;
            let installer = MenuItem::with_id(
                app,
                "installer",
                "Install Firmware",
                true,
                Some("CmdOrCtrl+2"),
            )?;
            let website =
                MenuItem::with_id(app, "website", "Reaper Mesh Website", true, None::<&str>)?;
            let about = AboutMetadata {
                website: Some(WEBSITE.into()),
                ..Default::default()
            };
            let menu = Menu::with_items(
                app,
                &[
                    &Submenu::with_items(
                        app,
                        "Reaper Mesh",
                        true,
                        &[
                            &PredefinedMenuItem::about(app, None, Some(about))?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::hide(app, None)?,
                            &PredefinedMenuItem::quit(app, None)?,
                        ],
                    )?,
                    &Submenu::with_items(
                        app,
                        "Edit",
                        true,
                        &[
                            &PredefinedMenuItem::undo(app, None)?,
                            &PredefinedMenuItem::redo(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::cut(app, None)?,
                            &PredefinedMenuItem::copy(app, None)?,
                            &PredefinedMenuItem::paste(app, None)?,
                            &PredefinedMenuItem::select_all(app, None)?,
                        ],
                    )?,
                    &Submenu::with_items(app, "Go", true, &[&portal, &installer, &website])?,
                ],
            )?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let Some(window) = app.get_webview_window("main") else {
                    return;
                };
                let page = match event.id().as_ref() {
                    "portal" => "web/index.html",
                    "installer" => "flash/index.html",
                    "website" => {
                        let _ = open::that_detached(WEBSITE);
                        return;
                    }
                    _ => return,
                };
                if let Ok(base) = window.url() {
                    if let Ok(url) = base.join(&format!("/{page}")) {
                        let _ = window.navigate(url);
                    }
                }
            });

            let downloads = app.path().download_dir().ok();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("web/index.html".into()))
                .title("Reaper Mesh")
                .inner_size(1280.0, 860.0)
                .min_inner_size(380.0, 600.0)
                .initialization_script(SERIAL_SHIM)
                .on_navigation(allow_navigation)
                // Settings exports and firmware downloads go to the Downloads folder.
                .on_download(move |_, event| {
                    if let DownloadEvent::Requested { url, destination } = event {
                        let name = destination
                            .file_name()
                            .map(|name| name.to_owned())
                            .or_else(|| url.path_segments()?.next_back().map(Into::into))
                            .unwrap_or_else(|| "download".into());
                        if let Some(folder) = &downloads {
                            *destination = folder.join(name);
                        }
                    }
                    true
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Reaper Mesh failed to start");
}
