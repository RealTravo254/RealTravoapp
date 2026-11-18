// tiny event bus (e.g. "location-granted")
const subs = {};
export const on = (name, fn) => { (subs[name] = subs[name] || new Set()).add(fn); return () => subs[name].delete(fn); };
export const emit = (name, data) => { (subs[name] ? [...subs[name]] : []).forEach((fn) => fn(data)); };
