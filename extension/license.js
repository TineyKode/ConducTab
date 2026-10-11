// License management module
// Handles free vs premium feature gating
// Uses chrome.storage.sync so license persists across devices

const License = {
  TIERS: {
    FREE: 'free',
    PREMIUM: 'premium',
    PRO: 'pro',
  },

  // Features gated by tier
  FEATURES: {
    volumeControl:  'premium',
    soundProfiles:  'premium',
    sleepTimer:     'premium',
    playbackSpeed:  'premium',
    pipMode:        'premium',
    focusScheduler: 'pro',
    audioHistory:   'pro',
    crossDeviceSync:'pro',
    audioDucking:   'pro',
    apiWebhooks:    'pro',
  },

  _cache: null,

  freeLicense() {
    return {
      tier: this.TIERS.FREE,
      key: null,
      activatedAt: null,
      expiresAt: null,
    };
  },

  // Paid tiers are accepted only after a server marks the record.
  // Prefix keys stored by older builds are cleared.
  async get() {
    if (this._cache) return this._cache;
    const stored = await chrome.storage.sync.get('license');
    const license = stored.license;
    const trusted = license
      && license.serverValidated === true
      && (license.tier === this.TIERS.PREMIUM || license.tier === this.TIERS.PRO);
    if (trusted) {
      this._cache = license;
      return this._cache;
    }
    if (license && license.tier && license.tier !== this.TIERS.FREE) {
      await chrome.storage.sync.set({ license: this.freeLicense() });
    }
    this._cache = this.freeLicense();
    return this._cache;
  },

  // Check if a specific feature is unlocked
  async hasFeature(featureName) {
    const license = await this.get();
    const requiredTier = this.FEATURES[featureName];
    if (!requiredTier) return true; // Unknown features default to free

    if (license.tier === this.TIERS.PRO) return true;
    if (license.tier === this.TIERS.PREMIUM && requiredTier === 'premium') return true;
    return false;
  },

  // Check if user is on any paid tier
  async isPaid() {
    const license = await this.get();
    return license.tier !== this.TIERS.FREE;
  },

  // Paid plans stay locked until a license server checks the key.
  async activate() {
    return { success: false, error: 'Paid plans are not available yet.' };
  },

  // Deactivate / reset to free
  async deactivate() {
    const license = this.freeLicense();
    await chrome.storage.sync.set({ license });
    this._cache = license;
  },

  // Listen for license changes (e.g. activated on another device)
  onChange(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.license) {
        this._cache = null;
        this.get().then(callback);
      }
    });
  },
};
