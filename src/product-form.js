import { CARD_DEFAULTS } from './card-defaults.js';
import { itemFields } from './catalog-model.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The value the card uses at runtime when a config sets (or omits) a field.
export function effectiveOption(field, config) {
  const value = config[field];
  switch (field) {
    case 'layout': return value === 'vertical' ? 'vertical' : 'horizontal';
    case 'enable_quantity':
    case 'haptic': return !!value;
    case 'show_name':
    case 'remove_zero':
    case 'colorize_background':
    case 'show_undo': return value !== false;
    case 'quantity_step': return Math.max(1, parseInt(value, 10) || 1);
    case 'hold_action': return value?.action && value.action !== 'default' ? value.action : 'default';
    case 'on_icon':
    case 'off_icon':
    case 'on_color':
    case 'off_color': return value || CARD_DEFAULTS[`DEFAULT_${field.toUpperCase()}`];
    default: return value === undefined || value === '' ? null : value;
  }
}

/**
 * Turns the Single editor's form state into a catalog product: fields that match the
 * catalog defaults are omitted, unchanged fields keep their original form, and fields
 * the editor doesn't know are kept as they were.
 */
export function productFromForm(form, original, defaults) {
  const merged = { ...defaults, ...original };
  const decide = field => {
    const value = effectiveOption(field, form);
    if (Object.hasOwn(original, field) && same(value, effectiveOption(field, merged))) return [true, original[field]];
    if (same(value, effectiveOption(field, defaults))) return [false];
    return [true, field === 'hold_action' ? { action: value } : value];
  };
  const product = {};
  for (const [key, value] of Object.entries(original)) {
    if (!itemFields.includes(key)) product[key] = value;
    else {
      const [keep, stored] = decide(key);
      if (keep) product[key] = stored;
    }
  }
  for (const field of itemFields) {
    if (Object.hasOwn(original, field)) continue;
    const [keep, stored] = decide(field);
    if (keep) product[field] = stored;
  }
  return product;
}
