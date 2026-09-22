import { buildName, matchItem } from './item-model.js';

const itemFields = [
  'title', 'subtitle', 'types', 'types_sort', 'image', 'image_base', 'list_prefix',
  'layout', 'show_name', 'enable_quantity', 'quantity_step', 'quantity_max',
  'remove_zero', 'on_icon', 'off_icon', 'on_color', 'off_color',
  'colorize_background', 'hold_action', 'haptic',
];

function itemOptions(options) {
  return Object.fromEntries(itemFields.filter(field => Object.hasOwn(options, field)).map(field => [field, options[field]]));
}

function typeNames(types) {
  const entries = typeof types === 'string' ? types.split(/[,\n]/) : Array.isArray(types) ? types : [];
  return entries.map(entry => typeof entry === 'string' ? entry.trim() : String(entry?.name ?? '').trim()).filter(Boolean);
}

export function searchText(value) {
  return String(value).normalize('NFKD').replace(/\p{Mark}/gu, '').toLocaleLowerCase();
}

export function readCatalog(hass, config) {
  const entity = hass.states?.[config.catalog_entity];
  if (!entity) throw new Error(`Catalog entity not found: ${config.catalog_entity}`);
  if (entity.state === 'unavailable' || entity.state === 'unknown') throw new Error('The product catalog is unavailable.');
  let data = config.catalog_attribute ? entity.attributes?.[config.catalog_attribute] : entity.attributes;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); }
    catch { throw new Error('The catalog attribute does not contain valid JSON.'); }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('The catalog must contain categories with product arrays.');
  }
  const defaults = { layout: 'vertical', enable_quantity: true, ...itemOptions(config.item_options || {}) };
  const groups = [];
  for (const [category, entries] of Object.entries(data)) {
    if (!Array.isArray(entries)) {
      if (config.catalog_attribute) throw new Error(`Category "${category}" must be an array.`);
      continue;
    }
    if (!category.trim()) throw new Error('Catalog categories must have a name.');
    const identities = new Map();
    const products = entries.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || typeof entry.title !== 'string' || !entry.title.trim()) {
        throw new Error(`Product ${index + 1} in "${category}" needs a title.`);
      }
      const options = {
        ...defaults, ...itemOptions(entry), type: 'custom:shopping-list-card', todo_list: config.todo_list,
      };
      for (const field of ['subtitle', 'image', 'image_base', 'list_prefix', 'on_icon', 'off_icon', 'on_color', 'off_color']) {
        if (options[field] != null && typeof options[field] !== 'string') {
          throw new Error(`Product "${entry.title}" has an invalid ${field}.`);
        }
      }
      if (options.types != null && typeof options.types !== 'string' && !Array.isArray(options.types)) {
        throw new Error(`Product "${entry.title}" has invalid variants.`);
      }
      const identity = typeof entry.id === 'string' && entry.id ? entry.id : buildName(options, options.subtitle);
      const occurrence = identities.get(identity) || 0;
      identities.set(identity, occurrence + 1);
      const names = typeNames(options.types);
      return {
        key: JSON.stringify([category, identity, occurrence]),
        config: options,
        search: searchText([category, options.title, options.subtitle || '', ...names].join(' ')),
        names: [...new Set([buildName(options, options.subtitle), ...names.map(name => buildName(options, name))])],
      };
    });
    groups.push({ name: category, products });
  }
  return groups;
}

export function productOnList(product, items) {
  return product.names.some(name => matchItem(items, name, product.config).isOn);
}