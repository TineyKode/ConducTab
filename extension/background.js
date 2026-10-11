// Background service worker. Event-driven, and the only writer of mediaTabs.

let writeQueue = Promise.resolve();

function enqueue(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function readMap(stored) {
  if (!stored || !stored.mediaTabs) return new Map();
  try {
    return new Map(JSON.parse(stored.mediaTabs));
  } catch {
    return new Map();
  }
}

function writeMap(mediaTabs) {
  return chrome.storage.local.set({
    mediaTabs: JSON.stringify(Array.from(mediaTabs.entries())),
  });
}

function isRestricted(url) {
  if (!url) return true;
  return /^(chrome|chrome-extension|edge|about|brave|vivaldi|opera):/i.test(url);
}

async function updateMediaTabs(mutator) {
  return enqueue(async () => {
    const stored = await chrome.storage.local.get('mediaTabs');
    const mediaTabs = readMap(stored);
    const keep = await mutator(mediaTabs);
    if (keep !== false) await writeMap(mediaTabs);
    return mediaTabs;
  });
}

async function inspectTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (isRestricted(tab.url)) return { tab, media: null };
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const allMedia = document.querySelectorAll('video, audio');
      for (const media of allMedia) {
        const hasSrc = media.currentSrc || media.src || media.querySelector('source');
        if (hasSrc && media.duration > 5) {
          return { hasMedia: true, isPlaying: !media.paused };
        }
      }
      return { hasMedia: false, isPlaying: false };
    },
  });
  return { tab, media: result?.result || null };
}

function remember(mediaTabs, tab, media) {
  if (media?.hasMedia) {
    const previous = mediaTabs.get(tab.id) || {};
    mediaTabs.set(tab.id, {
      ...previous,
      id: tab.id,
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl,
      isPlaying: media.isPlaying,
    });
    return;
  }
  mediaTabs.delete(tab.id);
}

async function controlPlayback(tabId, pause) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (shouldPause) => {
      const allMedia = [...document.querySelectorAll('video, audio')].filter(
        (media) => (media.currentSrc || media.src) && media.duration > 0
      );
      if (shouldPause) {
        allMedia.forEach((media) => media.pause());
        return false;
      }
      const played = await Promise.all(
        allMedia.map((media) => media.play().then(() => true).catch(() => false))
      );
      if (played.some((ok) => !ok)) {
        const playButton = document.querySelector('.ytp-play-button');
        if (playButton) playButton.click();
      }
      return [...document.querySelectorAll('video, audio')].some(
        (media) => !media.paused && (media.currentSrc || media.src)
      );
    },
    args: [pause],
  });
  return Boolean(result?.result);
}

async function setAll(mediaTabs, pause) {
  let changed = false;
  for (const [tabId, tabInfo] of mediaTabs) {
    if (Boolean(tabInfo.isPlaying) === !pause) continue;
    try {
      const isPlaying = await controlPlayback(tabId, pause);
      mediaTabs.set(tabId, { ...tabInfo, isPlaying, lastAccessed: Date.now() });
      changed = true;
    } catch {
      mediaTabs.delete(tabId);
      changed = true;
    }
  }
  if (!changed) return false;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.audible === undefined && changeInfo.status !== 'complete') return;
  updateMediaTabs(async (mediaTabs) => {
    try {
      const { tab, media } = await inspectTab(tabId);
      remember(mediaTabs, tab, media);
    } catch {
      if (!mediaTabs.delete(tabId)) return false;
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateMediaTabs(async (mediaTabs) => {
    if (!mediaTabs.delete(tabId)) return false;
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'pause-all') {
    updateMediaTabs((mediaTabs) => setAll(mediaTabs, true));
  } else if (command === 'play-all') {
    updateMediaTabs((mediaTabs) => setAll(mediaTabs, false));
  } else if (command === 'toggle-current') {
    updateMediaTabs(async (mediaTabs) => {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || !mediaTabs.has(activeTab.id)) return false;
      const tabInfo = mediaTabs.get(activeTab.id);
      const isPlaying = await controlPlayback(activeTab.id, tabInfo.isPlaying);
      mediaTabs.set(activeTab.id, { ...tabInfo, isPlaying, lastAccessed: Date.now() });
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message && message.type;
  if (!['toggle-tab', 'set-volume', 'set-playing-all', 'refresh-media'].includes(type)) return;

  updateMediaTabs((mediaTabs) => handleMessage(mediaTabs, message))
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function handleMessage(mediaTabs, message) {
  if (message.type === 'toggle-tab') {
    const tabId = Number(message.tabId);
    const tabInfo = mediaTabs.get(tabId);
    if (!tabInfo) return false;
    const isPlaying = await controlPlayback(tabId, tabInfo.isPlaying);
    mediaTabs.set(tabId, { ...tabInfo, isPlaying, lastAccessed: Date.now() });
    return;
  }

  if (message.type === 'set-volume') {
    const tabId = Number(message.tabId);
    const tabInfo = mediaTabs.get(tabId);
    if (!tabInfo) return false;
    const volume = Math.min(1, Math.max(0, Number(message.volume) || 0));
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (vol) => {
        document.querySelectorAll('video, audio').forEach((media) => {
          media.volume = vol;
        });
      },
      args: [volume],
    });
    mediaTabs.set(tabId, { ...tabInfo, volume });
    return;
  }

  if (message.type === 'set-playing-all') {
    return setAll(mediaTabs, Boolean(message.pause));
  }

  mediaTabs.clear();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    try {
      const { tab: fresh, media } = await inspectTab(tab.id);
      if (fresh) remember(mediaTabs, fresh, media);
    } catch {
      // Restricted or closed tab.
    }
  }
}

updateMediaTabs(async (mediaTabs) => {
  let changed = false;
  for (const tabId of [...mediaTabs.keys()]) {
    try {
      await chrome.tabs.get(tabId);
    } catch {
      mediaTabs.delete(tabId);
      changed = true;
    }
  }
  if (!changed) return false;
});
