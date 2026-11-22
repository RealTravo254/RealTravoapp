export async function withMediaCompressor(operation) {
  try {
    const compressor = require('react-native-compressor');
    return await operation(compressor);
  } catch (error) {
    const message = typeof error?.message === 'string' ? error.message : '';
    if (message.includes('NitroModules') || message.includes('NativeNitroModules')) {
      throw new Error('Listing media compression is unavailable in Expo Go. Install a development or production build to upload listing media.');
    }
    throw error;
  }
}
