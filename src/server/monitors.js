import { createDataLockMonitor } from './datalock.js';
import { createNetMonitor } from './netmon.js';
import { createThermalMonitor } from './thermal.js';

// The network, thermal and data-lock monitors (sets ctx.monitor, ctx.thermalMonitor, ctx.dataMonitor).
// Returns whenUnlocked: a promise that resolves once the data lock is open (at once without a data lock).
export function startMonitors(ctx, { netmon, thermal, dataLock }) {
  if (netmon) {
    ctx.monitor = createNetMonitor({
      log: (m) => console.error(m), ...netmon,
      onChange: (online) => { if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewNetwork', online }, true); },
    });
  }
  if (thermal) {
    ctx.thermalMonitor = createThermalMonitor({
      log: (m) => console.error(m), ...thermal,
      onChange: ({ hot, lowPower }) => { if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewThermal', hot, lowPower }, true); },
    });
  }
  let resolveUnlocked = () => {};
  const whenUnlocked = !dataLock ? Promise.resolve() : new Promise((r) => { resolveUnlocked = r; });
  if (dataLock) {
    ctx.dataMonitor = createDataLockMonitor({
      log: (m) => console.error(m), ...dataLock,
      onChange: (locked) => {
        if (!locked) resolveUnlocked();
        if (!ctx.closed) ctx.apply({ hook_event_name: 'RevviewDataLock', locked }, true);
        if (!ctx.closed) ctx.settings?.dataChanged(locked); // kept settings: read at the unlock, no write while locked
      },
    });
    ctx.dataMonitor.check();
  }
  return whenUnlocked;
}
