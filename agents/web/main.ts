// Web agent entry point: wires the UI modules together and runs the render loop.
import 'leaflet/dist/leaflet.css';
import './style.css';
import { WIPE_SIGNAL } from './local-data.ts';
import {
  applyTheme,
  current,
  encryption,
  models,
  recovery,
  render,
  setRenderer,
} from './app-state.ts';
import {
  disconnectLocalApp,
  initAccess,
  isAppStopped,
  onLocalAppStop,
  renderAccess,
  renderPinSettings,
  resetLanding,
  stopLocalApp,
} from './access-ui.ts';
import { initMessages, renderInbox, renderMessages } from './messages-ui.ts';
import { initChannels, renderChannels } from './channels-ui.ts';
import {
  initSettings,
  settleCommands,
  renderDiscovery,
  renderPosition,
  renderScreen,
  renderBluetooth,
  renderRadio,
} from './settings-ui.ts';
import { fieldMap, initMap, mapWorkspace, renderMap } from './map-ui.ts';
import { connectOnLoad, initConnection, renderConnection } from './connection-ui.ts';
import { initNodes, renderNodes } from './nodes-ui.ts';
import { initDevice, renderDevice } from './device-ui.ts';
import { initNavigation } from './nav.ts';
import { hydrateIcons, syncSegmented } from './ui.ts';

applyTheme();
hydrateIcons();
setRenderer(renderApp);
initNavigation();
initAccess();
initMessages();
initChannels();
initSettings();
initMap();
initConnection();
initNodes();
initDevice();

function renderApp() {
  if (isAppStopped()) return;
  const model = current();
  model.refresh();
  const { connection, active, cleanupError } = model.adapter;
  if (renderAccess(active)) {
    mapWorkspace.update();
    return;
  }
  const ready = connection.sync.state === 'ready';
  renderConnection(model, active, cleanupError);
  renderPinSettings();
  renderPosition();
  renderScreen();
  renderBluetooth();
  renderDiscovery();
  renderRadio();
  renderMessages();
  renderInbox();
  renderNodes();
  renderChannels();
  renderDevice();
  mapWorkspace.update();
  renderMap();
  syncSegmented();
  settleCommands(model, ready);
}

const timer = setInterval(render, 100);
onLocalAppStop(() => clearInterval(timer));
if (localStorage.getItem(WIPE_SIGNAL)) {
  stopLocalApp();
  void disconnectLocalApp().finally(() => resetLanding());
}
window.addEventListener('pagehide', () => {
  clearInterval(timer);
  encryption?.lock();
  void models.demo.adapter.disconnect();
  void models.usb.adapter.disconnect();
  recovery.release();
});
document.addEventListener('visibilitychange', render);
window.addEventListener('focus', render);
render();
fieldMap.invalidate();
void connectOnLoad().catch(() => {});
