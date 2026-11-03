// Web agent entry point: wires the UI modules together and runs the render loop.
import './style.css';
import { WIPE_SIGNAL } from './local-data.ts';
import { current, encryption, models, recovery, render, setRenderer } from './app-state.ts';
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
import { initChannels, renderEncryption } from './channels-ui.ts';
import {
  initSettings,
  renderCommandHistory,
  renderDiscovery,
  renderPosition,
  renderRadio,
} from './settings-ui.ts';
import { fieldMap, initMap, mapWorkspace, renderMap } from './map-ui.ts';
import { initConnection, renderConnection } from './connection-ui.ts';

setRenderer(renderApp);
initAccess();
initMessages();
initChannels();
initSettings();
initMap();
initConnection();

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
  renderDiscovery();
  renderRadio();
  renderEncryption();
  renderMessages();
  renderInbox();
  mapWorkspace.update();
  renderMap();
  renderCommandHistory(model, ready);
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
