// Lets a screen ask the map picker for a location and wait for the answer.
let resolver = null;
export const pickLocation = (navigation, title = 'Choose location', options = {}) => new Promise((resolve) => { resolver = resolve; navigation.navigate('PickLocation', { title, ...options }); });
export const finishPick = (value) => { if (resolver) { resolver(value); resolver = null; } };
