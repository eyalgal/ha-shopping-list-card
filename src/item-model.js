export function buildName(config, subtitle) {
  const base = subtitle ? `${config.title} - ${subtitle}` : config.title;
  return config.list_prefix ? `${config.list_prefix} - ${base}` : base;
}

export function keepZero(config) {
  return !!config.enable_quantity && config.remove_zero === false;
}

export function itemSummary(config, fullName, quantity) {
  if (!config.enable_quantity) return fullName;
  return keepZero(config) || quantity > 1 ? `${fullName} (${quantity})` : fullName;
}

export function matchItem(items, fullName, config) {
  const escaped = fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(?: \\((\\d+)\\))?$`, 'i');
  for (const item of items || []) {
    if (typeof item.summary !== 'string') continue;
    const match = item.summary.match(pattern);
    if (!match) continue;
    const quantity = match[1] != null ? Number(match[1]) : 1;
    return {
      isOn: keepZero(config) ? quantity > 0 : true,
      present: true, qty: quantity, matched: item.summary, matchedUid: item.uid,
    };
  }
  return { isOn: false, present: false, qty: 0, matched: null, matchedUid: null };
}

export function planItemAction(config, items, subtitle, action = 'toggle') {
  const fullName = buildName(config, subtitle);
  const state = matchItem(items, fullName, config);
  const key = fullName.toLowerCase();
  const target = state.matchedUid || state.matched;
  const findTarget = current => current.find(item => state.matchedUid
    ? item.uid === state.matchedUid : item.summary === state.matched);
  const remove = () => ({
    key, service: 'remove_item', data: { item: target },
    confirmed: current => !findTarget(current),
  });
  if (action === 'remove') return state.present ? remove() : null;

  let quantity;
  if (action === 'increment' || action === 'decrement') {
    if (!state.present) return null;
    const step = Math.max(1, parseInt(config.quantity_step, 10) || 1);
    const maximum = parseInt(config.quantity_max, 10);
    quantity = action === 'increment' ? state.qty + step
      : Math.max(keepZero(config) ? 0 : 1, state.qty - step);
    if (action === 'increment' && maximum > 0) quantity = Math.min(quantity, maximum);
    if (quantity === state.qty) return null;
  } else if (keepZero(config)) {
    quantity = state.qty > 0 ? 0 : 1;
  } else if (state.isOn) {
    return !config.enable_quantity || state.qty === 1 ? remove() : null;
  } else {
    quantity = 1;
  }

  const summary = itemSummary(config, fullName, quantity);
  if (!state.present) {
    return {
      key, service: 'add_item', data: { item: summary },
      confirmed: current => current.some(item => item.summary?.toLowerCase() === summary.toLowerCase()),
    };
  }
  return {
    key, service: 'update_item', data: { item: target, rename: summary },
    confirmed: current => state.matchedUid
      ? findTarget(current)?.summary === summary
      : current.some(item => item.summary === summary),
  };
}

export function updateTypeNames(previous, text) {
  const names = text.split('\n').map(name => name.trim()).filter(Boolean);
  const entries = Array.isArray(previous) ? previous
    : typeof previous === 'string' ? previous.split(/[,\n]/) : [];
  const entryName = entry => String(typeof entry === 'string' ? entry : entry?.name || '').trim();
  const used = new Set();
  return names.map((name, index) => {
    let match = entries.findIndex((entry, entryIndex) => !used.has(entryIndex)
      && entryName(entry).toLowerCase() === name.toLowerCase());
    if (match === -1 && entries.length === names.length && !used.has(index)
      && !names.some(next => next.toLowerCase() === entryName(entries[index]).toLowerCase())) {
      match = index;
    }
    used.add(match);
    const original = entries[match];
    return original && typeof original === 'object' ? { ...original, name } : name;
  });
}