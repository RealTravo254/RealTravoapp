// SAFE DEFAULT: no native Google module, so the app cannot crash because of it.
// "Continue with Google" then uses the browser sign-in. To get the account chooser inside the app, see src/lib/googleNative.real.js.
export async function nativeGoogle() { return false; }
