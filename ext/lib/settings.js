// Settings shared by sw, offscreen and options. Stored in chrome.storage.sync.
export const SETTINGS_DEFAULTS = {
  shadow: true,          // first run: detect and log, never switch
  spotifyMode: 'resume', // 'resume' | 'uri'
  spotifyUri: '',
  launchSpotify: true,
  fadeMs: 300,
  keepEmbeddings: false, // log the audio embedding every second (big export, for offline tuning)
  detector: {},          // overrides for detector DEFAULTS
};
export function mergeSettings(stored = {}) {
  return { ...SETTINGS_DEFAULTS, ...stored, detector: { ...(stored.detector ?? {}) } };
}
