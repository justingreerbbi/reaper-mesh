//! Keeps the screen on and the computer awake while the portal follows its position on the map or
//! records a track, as on a laptop in a vehicle. The page asks with `keep_awake`; see
//! agents/web/keep-awake.ts. System webviews do not all offer the Screen Wake Lock API, and it
//! would not stop the computer itself sleeping.

use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct Awake(Mutex<Option<keepawake::KeepAwake>>);

/// Turns keeping awake on or off. Dropping the handle releases it, as does quitting the app.
#[tauri::command]
pub fn keep_awake(on: bool, awake: State<'_, Awake>) -> Result<(), String> {
    let mut held = awake
        .0
        .lock()
        .map_err(|_| "keep awake is unavailable".to_string())?;
    if !on {
        *held = None;
        return Ok(());
    }
    if held.is_none() {
        *held = Some(
            keepawake::Builder::default()
                .display(true)
                .idle(true)
                .reason("Following position or recording a track")
                .app_name("Reaper Mesh")
                .app_reverse_domain("com.reapermesh.desktop")
                .create()
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(())
}
