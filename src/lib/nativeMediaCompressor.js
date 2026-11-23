export async function withMediaCompressor(operation) {
  try {
    const loaded = require('react-native-compressor');
    const compressor = loaded?.default || loaded;
    if (!compressor || typeof compressor !== 'object'
      || !('Video' in compressor || 'Image' in compressor || 'getVideoMetaData' in compressor)) {
      throw new Error('Media compression is unavailable in this app build. Expo Go does not include the required native module; use a development or production build.');
    }
    return await operation(compressor);
  } catch (error) {
    const message = typeof error?.message === 'string' ? error.message : '';
    if (message.includes('NitroModules') || message.includes('NativeNitroModules')) {
      throw new Error('Media compression is unavailable in this app build. Expo Go does not include the required native module; use a development or production build.');
    }
    throw error;
  }
}
