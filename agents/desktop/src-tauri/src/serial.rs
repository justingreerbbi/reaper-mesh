//! USB serial ports for the page, behind the Web Serial shim in `agents/desktop/serial-shim.ts`.
//!
//! The system webviews have no Web Serial, so the app provides the same operations: list USB
//! ports, open one at a baud rate, read, write, set DTR and RTS, and close. Received bytes go to the
//! page over a Tauri channel; an empty message means the port was lost (unplugged or reset).

use serialport::{SerialPort, SerialPortType};
use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::State;

/// A USB serial port as the page sees it, with the IDs Web Serial's `getInfo()` reports.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    path: String,
    vendor_id: u16,
    product_id: u16,
    serial_number: Option<String>,
    manufacturer: Option<String>,
    product: Option<String>,
}

struct OpenPort {
    port: Box<dyn SerialPort>,
    stop: Arc<AtomicBool>,
    reader: Option<JoinHandle<()>>,
}

/// Every port the page has open, by the ID `serial_open` returned.
#[derive(Default)]
pub struct Ports {
    next: AtomicU32,
    open: Mutex<HashMap<u32, OpenPort>>,
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// USB serial ports only: Bluetooth and debug ports are never offered.
#[tauri::command]
pub fn serial_list() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(text)?;
    Ok(ports
        .into_iter()
        // macOS lists each device twice; the call-out (cu) device is the one to open.
        .filter(|port| !port.port_name.starts_with("/dev/tty."))
        .filter_map(|port| match port.port_type {
            SerialPortType::UsbPort(usb) => Some(PortInfo {
                path: port.port_name,
                vendor_id: usb.vid,
                product_id: usb.pid,
                serial_number: usb.serial_number,
                manufacturer: usb.manufacturer,
                product: usb.product,
            }),
            _ => None,
        })
        .collect())
}

/// Opens a port and starts sending what it receives to `on_data`. Returns the port's ID.
#[tauri::command]
pub fn serial_open(
    path: String,
    baud_rate: u32,
    on_data: Channel<InvokeResponseBody>,
    ports: State<'_, Ports>,
) -> Result<u32, String> {
    let mut port = serialport::new(&path, baud_rate)
        .flow_control(serialport::FlowControl::None)
        .timeout(Duration::from_millis(20))
        .open()
        .map_err(text)?;
    // Web Serial asserts DTR and RTS when it opens a port; boards and bootloaders expect that.
    port.write_data_terminal_ready(true).map_err(text)?;
    port.write_request_to_send(true).map_err(text)?;
    let mut input = port.try_clone().map_err(text)?;
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    let reader = std::thread::Builder::new()
        .name(format!("serial {path}"))
        .spawn(move || {
            let mut buffer = [0u8; 4096];
            while !stopped.load(Ordering::Relaxed) {
                match input.read(&mut buffer) {
                    Ok(0) => {}
                    Ok(size) => {
                        if on_data
                            .send(InvokeResponseBody::Raw(buffer[..size].to_vec()))
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(error) if error.kind() == ErrorKind::TimedOut => {}
                    Err(error) if error.kind() == ErrorKind::Interrupted => {}
                    Err(_) => {
                        // Lost: tell the page, unless it closed the port itself.
                        if !stopped.load(Ordering::Relaxed) {
                            let _ = on_data.send(InvokeResponseBody::Raw(Vec::new()));
                        }
                        break;
                    }
                }
            }
        })
        .map_err(text)?;
    let id = ports.next.fetch_add(1, Ordering::Relaxed) + 1;
    ports.open.lock().map_err(text)?.insert(
        id,
        OpenPort {
            port,
            stop,
            reader: Some(reader),
        },
    );
    Ok(id)
}

/// Writes the request body (raw bytes) to the port named by the `port-id` header.
#[tauri::command]
pub fn serial_write(request: Request<'_>, ports: State<'_, Ports>) -> Result<(), String> {
    let id: u32 = request
        .headers()
        .get("port-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
        .ok_or("missing port-id")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let mut open = ports.open.lock().map_err(text)?;
    let port = open.get_mut(&id).ok_or("the port is not open")?;
    port.port.write_all(bytes).map_err(text)?;
    port.port.flush().map_err(text)
}

/// Web Serial's `setSignals()`: only the lines given change.
#[tauri::command]
pub fn serial_set_signals(
    id: u32,
    dtr: Option<bool>,
    rts: Option<bool>,
    brk: Option<bool>,
    ports: State<'_, Ports>,
) -> Result<(), String> {
    let mut open = ports.open.lock().map_err(text)?;
    let port = open.get_mut(&id).ok_or("the port is not open")?;
    if let Some(level) = dtr {
        port.port.write_data_terminal_ready(level).map_err(text)?;
    }
    if let Some(level) = rts {
        port.port.write_request_to_send(level).map_err(text)?;
    }
    match brk {
        Some(true) => port.port.set_break().map_err(text)?,
        Some(false) => port.port.clear_break().map_err(text)?,
        None => {}
    }
    Ok(())
}

/// Closes the port. Closing drops DTR, which some boards read as "the host went away".
#[tauri::command]
pub fn serial_close(id: u32, ports: State<'_, Ports>) -> Result<(), String> {
    let removed = ports.open.lock().map_err(text)?.remove(&id);
    if let Some(mut port) = removed {
        port.stop.store(true, Ordering::Relaxed);
        if let Some(reader) = port.reader.take() {
            let _ = reader.join();
        }
        drop(port.port);
    }
    Ok(())
}
