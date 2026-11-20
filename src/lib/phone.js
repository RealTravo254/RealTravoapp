export const isValidContactPhone = (value) => /^\+[1-9]\d{6,14}$/.test(String(value || '').trim());
