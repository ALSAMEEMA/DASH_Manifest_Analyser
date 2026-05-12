// ============================
// UTILITY FUNCTIONS
// ============================

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function resolveUrl(base, relative) {
  if (!relative) return "";
  if (!base) return relative;
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

function formatBandwidth(bw) {
  if (!bw) return "—";
  bw = parseInt(bw);
  if (bw >= 1000000) return (bw / 1000000).toFixed(2) + " Mbps";
  if (bw >= 1000) return (bw / 1000).toFixed(0) + " Kbps";
  return bw + " bps";
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(1);
  if (h > 0) return h + "h " + m + "m " + s + "s";
  if (m > 0) return m + "m " + s + "s";
  return s + "s";
}

function parseISO8601Duration(str) {
  if (!str) return 0;
  const m = str.match(/P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 31536000) +
    (parseInt(m[2] || 0) * 2592000) +
    (parseInt(m[3] || 0) * 86400) +
    (parseInt(m[4] || 0) * 3600) +
    (parseInt(m[5] || 0) * 60) +
    parseFloat(m[6] || 0);
}

function decodeCodec(codec) {
  if (!codec) return "";
  const c = codec.trim().toLowerCase();
  if (c.startsWith("avc1.") || c.startsWith("avc3.")) {
    const profiles = { "42": "Baseline", "4d": "Main", "58": "Extended", "64": "High", "6e": "High 10", "7a": "High 4:2:2" };
    const hex = c.split(".")[1] || "";
    const profileHex = hex.substring(0, 2);
    const levelHex = hex.substring(4, 6);
    const profile = profiles[profileHex] || "";
    const level = levelHex ? (parseInt(levelHex, 16) / 10).toFixed(1).replace(/\.0$/, "") : "";
    return "H.264" + (profile ? " " + profile : "") + (level ? " L" + level : "");
  }
  if (c.startsWith("hvc1.") || c.startsWith("hev1.")) {
    const parts = c.split(".");
    const tier = parts[1] === "2" ? "Main 10" : "Main";
    const level = parts[3] ? "L" + parts[3] : "";
    return "H.265 " + tier + (level ? " " + level : "");
  }
  if (c.startsWith("av01.")) {
    const parts = c.split(".");
    const profiles = { "0": "Main", "1": "High", "2": "Professional" };
    const profile = profiles[parts[1]] || "";
    const level = parts[2] || "";
    return "AV1" + (profile ? " " + profile : "") + (level ? " L" + level : "");
  }
  if (c.startsWith("vp09.") || c === "vp9") return "VP9";
  if (c === "mp4a.40.2") return "AAC-LC";
  if (c === "mp4a.40.5") return "HE-AAC (v1)";
  if (c === "mp4a.40.29") return "HE-AAC v2";
  if (c === "mp4a.40.34") return "MP3";
  if (c === "mp4a.67") return "AAC-LC";
  if (c.startsWith("mp4a.40.")) return "AAC";
  if (c.startsWith("mp4a.")) return "MPEG-4 Audio";
  if (c === "ac-3") return "Dolby AC-3";
  if (c === "ec-3") return "Dolby EC-3 (E-AC-3)";
  if (c.startsWith("dvh1.") || c.startsWith("dvhe.")) return "Dolby Vision";
  if (c === "opus") return "Opus";
  if (c === "flac") return "FLAC";
  if (c === "wvtt" || c === "stpp") return c === "wvtt" ? "WebVTT" : "TTML";
  return codec.trim();
}

function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// ============================
// PSSH / DRM DECODERS
// ============================

function formatUUID(bytes) {
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

function formatPlayReadyGUID(bytes) {
  if (bytes.length < 16) return formatUUID(bytes);
  const swap = new Uint8Array(16);
  swap[0] = bytes[3]; swap[1] = bytes[2]; swap[2] = bytes[1]; swap[3] = bytes[0];
  swap[4] = bytes[5]; swap[5] = bytes[4];
  swap[6] = bytes[7]; swap[7] = bytes[6];
  for (let i = 8; i < 16; i++) swap[i] = bytes[i];
  return formatUUID(swap);
}

function readVarint(data, offset) {
  let value = 0;
  let shift = 0;
  while (offset < data.length) {
    const byte = data[offset];
    offset++;
    value |= (byte & 0x7F) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
    if (shift > 35) return null;
  }
  return null;
}

function decodePSSH(base64String) {
  try {
    const binaryStr = atob(base64String);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    if (bytes.length < 32) return { error: "Too short to be a valid PSSH box" };

    const type = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (type !== 'pssh') return { error: "Not a PSSH box (type: " + type + ")" };

    const version = bytes[8];
    const systemId = formatUUID(bytes.slice(12, 28));

    let offset = 28;
    const keyIds = [];

    if (version >= 1 && offset + 4 <= bytes.length) {
      const keyIdCount = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 4;
      for (let i = 0; i < keyIdCount && offset + 16 <= bytes.length; i++) {
        keyIds.push(formatUUID(bytes.slice(offset, offset + 16)));
        offset += 16;
      }
    }

    let dataSize = 0;
    let data = null;
    if (offset + 4 <= bytes.length) {
      dataSize = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
      offset += 4;
      if (dataSize > 0 && offset + dataSize <= bytes.length) {
        data = bytes.slice(offset, offset + dataSize);
      }
    }

    const drmNames = {
      "edef8ba9-79d6-4ace-a3c8-27dcd51d21ed": "Widevine",
      "9a04f079-9840-4286-ab92-e65be0885f95": "PlayReady",
      "94ce86fb-07ff-4f43-adb8-93d2fa968ca2": "FairPlay",
      "1077efec-c0b2-4d02-ace3-3c1e52e2fb4b": "W3C Common (ClearKey)",
      "e2719d58-a985-b3c9-781a-b030af78d30e": "ClearKey"
    };

    const result = { version, systemId, keyIds, dataSize, drmName: drmNames[systemId] || "Unknown" };

    if (data) {
      if (systemId === "9a04f079-9840-4286-ab92-e65be0885f95") {
        result.playreadyData = decodePlayReadyObject(data);
      }
      if (systemId === "edef8ba9-79d6-4ace-a3c8-27dcd51d21ed") {
        result.widevineData = decodeWidevineInitData(data);
      }
    }

    return result;
  } catch (e) {
    return { error: "Failed to decode PSSH: " + e.message };
  }
}

function decodePlayReadyObject(data) {
  try {
    const result = {};
    const recordCount = data[4] | (data[5] << 8);
    let offset = 6;

    for (let i = 0; i < recordCount && offset + 4 <= data.length; i++) {
      const recordType = data[offset] | (data[offset + 1] << 8);
      const recordLen = data[offset + 2] | (data[offset + 3] << 8);
      offset += 4;

      if (recordType === 1 && recordLen > 0 && offset + recordLen <= data.length) {
        const xmlBytes = data.slice(offset, offset + recordLen);
        let xml = '';
        for (let j = 0; j < xmlBytes.length - 1; j += 2) {
          xml += String.fromCharCode(xmlBytes[j] | (xmlBytes[j + 1] << 8));
        }
        result.headerXml = xml;

        const laMatch = xml.match(/<LA_URL>(.*?)<\/LA_URL>/i);
        if (laMatch) result.laUrl = laMatch[1];

        const kidMatches = xml.match(/KID="([^"]+)"/gi);
        if (kidMatches) {
          result.keyIds = kidMatches.map(m => {
            const kid = m.match(/KID="([^"]+)"/i)[1];
            try {
              const kidBytes = atob(kid);
              const arr = new Uint8Array(kidBytes.length);
              for (let k = 0; k < kidBytes.length; k++) arr[k] = kidBytes.charCodeAt(k);
              return formatPlayReadyGUID(arr);
            } catch { return kid; }
          });
        }

        const algMatch = xml.match(/<ALGID>(.*?)<\/ALGID>/i);
        if (algMatch) result.algorithm = algMatch[1];

        const checkMatch = xml.match(/<CHECKSUM>(.*?)<\/CHECKSUM>/i);
        if (checkMatch) result.checksum = checkMatch[1];
      }

      offset += recordLen;
    }

    return result;
  } catch (e) {
    return { error: e.message };
  }
}

function decodeWidevineInitData(data) {
  try {
    const result = { keyIds: [], provider: '', contentId: '' };
    let offset = 0;

    while (offset < data.length) {
      const tag = readVarint(data, offset);
      if (!tag) break;
      offset = tag.offset;
      const fieldNumber = tag.value >> 3;
      const wireType = tag.value & 0x7;

      if (wireType === 0) {
        const val = readVarint(data, offset);
        if (!val) break;
        offset = val.offset;
        if (fieldNumber === 1) result.algorithm = val.value;
        if (fieldNumber === 8) {
          const s = val.value;
          result.protectionScheme = String.fromCharCode((s >> 24) & 0xFF, (s >> 16) & 0xFF, (s >> 8) & 0xFF, s & 0xFF);
        }
      } else if (wireType === 2) {
        const len = readVarint(data, offset);
        if (!len) break;
        offset = len.offset;
        const fieldData = data.slice(offset, offset + len.value);
        offset += len.value;

        if (fieldNumber === 2) {
          const hex = Array.from(fieldData).map(b => b.toString(16).padStart(2, '0')).join('');
          if (hex.length === 32) {
            result.keyIds.push(hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20));
          } else {
            result.keyIds.push(hex);
          }
        } else if (fieldNumber === 3) {
          result.provider = new TextDecoder().decode(fieldData);
        } else if (fieldNumber === 4) {
          try {
            result.contentId = new TextDecoder('utf-8', { fatal: true }).decode(fieldData);
          } catch {
            result.contentId = Array.from(fieldData).map(b => b.toString(16).padStart(2, '0')).join('');
          }
        }
      } else {
        break;
      }
    }

    return result;
  } catch (e) {
    return { error: e.message };
  }
}

function getHttpErrorMessage(status, statusText) {
  const errors = {
    400: "400 Bad Request — The URL may be malformed.",
    401: "401 Unauthorized — Authentication required.",
    403: "403 Forbidden — Access denied.",
    404: "404 Not Found — The MPD file was not found at this URL.",
    405: "405 Method Not Allowed.",
    408: "408 Request Timeout.",
    429: "429 Too Many Requests — Rate limited.",
    500: "500 Internal Server Error.",
    502: "502 Bad Gateway.",
    503: "503 Service Unavailable.",
    504: "504 Gateway Timeout."
  };
  return errors[status] || ("HTTP " + status + ": " + statusText);
}

function getFetchErrorMessage(error) {
  const msg = error.message || "";
  if (msg === "Failed to fetch") {
    return "Network Error — The request was blocked. Common causes:\n• CORS policy blocking cross-origin requests\n• DNS resolution failed\n• Server unreachable or offline\n• SSL/TLS certificate error";
  }
  if (msg.includes("NetworkError")) return "Network Error — Could not connect to the server.";
  return msg;
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
}

function showError(msg) {
  const el = document.getElementById("errorMessage");
  el.textContent = msg;
  el.style.display = "block";

  let overlay = document.getElementById("errorModal");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "errorModal";
    overlay.className = "modal-overlay";
    overlay.innerHTML = '<div class="modal-box">' +
      '<div class="modal-header"><span class="modal-icon">⚠️</span><span class="modal-title">Error</span></div>' +
      '<div class="modal-body" id="errorModalBody"></div>' +
      '<button class="modal-close-btn" id="errorModalClose">Dismiss</button>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeErrorModal(); });
    document.getElementById("errorModalClose").addEventListener("click", closeErrorModal);
  }
  document.getElementById("errorModalBody").textContent = msg;
  overlay.classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeErrorModal() {
  const overlay = document.getElementById("errorModal");
  if (overlay) { overlay.classList.remove("show"); document.body.style.overflow = ""; }
}

function clearError() {
  document.getElementById("errorMessage").style.display = "none";
  closeErrorModal();
}

function showLoading(show) {
  document.getElementById("loadingIndicator").style.display = show ? "flex" : "none";
}

// ============================
// HISTORY
// ============================

const HISTORY_KEY = "dash_mpd_history";
const MAX_HISTORY = 10;

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

function addToHistory(url) {
  let history = getHistory();
  history = history.filter(u => u !== url);
  history.unshift(url);
  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
  renderHistory();
}

function clearHistory() { try { localStorage.removeItem(HISTORY_KEY); } catch {} renderHistory(); }

function renderHistory() {
  const history = getHistory();
  const container = document.getElementById("historyContainer");
  const list = document.getElementById("historyList");
  if (history.length === 0) { container.style.display = "none"; return; }
  container.style.display = "block";
  list.innerHTML = "";
  history.forEach(url => {
    const btn = document.createElement("button");
    btn.className = "history-item";
    btn.textContent = url;
    btn.title = url;
    btn.addEventListener("click", () => {
      document.getElementById("manifestUrl").value = url;
      loadManifestFromUrl();
    });
    list.appendChild(btn);
  });
  const clearBtn = document.createElement("button");
  clearBtn.className = "history-clear";
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", clearHistory);
  list.appendChild(clearBtn);
}

// ============================
// THEME
// ============================

function initTheme() {
  try {
    const saved = localStorage.getItem("dash_theme") || "dark";
    document.documentElement.setAttribute("data-theme", saved === "light" ? "light" : "");
    updateThemeIcon(saved);
  } catch {
    updateThemeIcon("dark");
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "light" ? "" : "light";
  document.documentElement.setAttribute("data-theme", next);
  const theme = next === "light" ? "light" : "dark";
  try { localStorage.setItem("dash_theme", theme); } catch {}
  updateThemeIcon(theme);
}

function updateThemeIcon(theme) {
  document.getElementById("themeToggle").textContent = theme === "light" ? "🌙" : "☀️";
}

// ============================
// MPD PARSER
// ============================

function parseMPD(xmlString, baseUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    return { error: "Invalid XML: " + parseError.textContent.substring(0, 200) };
  }

  const mpd = doc.querySelector("MPD");
  if (!mpd) {
    return { error: "No <MPD> root element found. This may not be a valid DASH manifest." };
  }

  const result = {
    // MPD-level attributes
    profiles: mpd.getAttribute("profiles") || "",
    type: mpd.getAttribute("type") || "static", // static or dynamic
    mediaPresentationDuration: mpd.getAttribute("mediaPresentationDuration"),
    minBufferTime: mpd.getAttribute("minBufferTime"),
    maxSegmentDuration: mpd.getAttribute("maxSegmentDuration"),
    minimumUpdatePeriod: mpd.getAttribute("minimumUpdatePeriod"),
    availabilityStartTime: mpd.getAttribute("availabilityStartTime"),
    availabilityEndTime: mpd.getAttribute("availabilityEndTime"),
    publishTime: mpd.getAttribute("publishTime"),
    timeShiftBufferDepth: mpd.getAttribute("timeShiftBufferDepth"),
    suggestedPresentationDelay: mpd.getAttribute("suggestedPresentationDelay"),

    // Parsed durations
    durationSeconds: 0,
    minBufferSeconds: 0,

    // Content
    periods: [],
    totalAdaptationSets: 0,
    totalRepresentations: 0,
    videoRepresentations: [],
    audioRepresentations: [],
    subtitleRepresentations: [],
    allCodecs: [],
    allResolutions: [],
    maxBandwidth: 0,
    minBandwidth: Infinity,

    // DRM
    drm: [],

    // Base URLs
    baseUrls: [],

    // UTCTiming
    utcTiming: null,

    // ProgramInformation
    programInfo: null,

    // Location (MPD reload URL)
    locations: [],

    // ServiceDescription (low-latency)
    serviceDescriptions: [],

    // ProducerReferenceTime
    producerReferenceTimes: [],

    // Low-latency flag
    isLowLatency: false,

    // EventStreams (MPD-level)
    eventStreams: [],

    // Essential/Supplemental Properties (trick mode, thumbnails, etc.)
    trickModeAdaptations: [],
    thumbnailAdaptations: [],

    // Warnings
    warnings: []
  };

  // Parse durations
  result.durationSeconds = parseISO8601Duration(result.mediaPresentationDuration);
  result.minBufferSeconds = parseISO8601Duration(result.minBufferTime);

  // Base URLs at MPD level
  const mpdBaseUrls = mpd.querySelectorAll(":scope > BaseURL");
  mpdBaseUrls.forEach(bu => {
    const url = bu.textContent.trim();
    if (url) result.baseUrls.push(url);
  });

  // Effective base URL
  let effectiveBase = baseUrl || "";
  if (result.baseUrls.length > 0) {
    effectiveBase = resolveUrl(effectiveBase, result.baseUrls[0]);
  }

  // UTCTiming
  const utc = mpd.querySelector("UTCTiming");
  if (utc) {
    result.utcTiming = {
      schemeIdUri: utc.getAttribute("schemeIdUri") || "",
      value: utc.getAttribute("value") || ""
    };
  }

  // DRM at MPD level
  mpd.querySelectorAll(":scope > ContentProtection").forEach(cp => {
    parseDRM(cp, result.drm);
  });

  // ProgramInformation
  const progInfo = mpd.querySelector(":scope > ProgramInformation");
  if (progInfo) {
    result.programInfo = {
      lang: progInfo.getAttribute("lang") || "",
      moreInformationURL: progInfo.getAttribute("moreInformationURL") || "",
      title: "",
      source: "",
      copyright: ""
    };
    const titleEl = progInfo.querySelector("Title");
    if (titleEl) result.programInfo.title = titleEl.textContent.trim();
    const sourceEl = progInfo.querySelector("Source");
    if (sourceEl) result.programInfo.source = sourceEl.textContent.trim();
    const copyrightEl = progInfo.querySelector("Copyright");
    if (copyrightEl) result.programInfo.copyright = copyrightEl.textContent.trim();
  }

  // Location
  mpd.querySelectorAll(":scope > Location").forEach(loc => {
    const url = loc.textContent.trim();
    if (url) result.locations.push(url);
  });

  // ServiceDescription (low-latency)
  mpd.querySelectorAll(":scope > ServiceDescription").forEach(sd => {
    const desc = { id: sd.getAttribute("id") || "", latency: null, playbackRate: null };
    const latency = sd.querySelector("Latency");
    if (latency) {
      desc.latency = {
        target: latency.getAttribute("target") || "",
        max: latency.getAttribute("max") || "",
        min: latency.getAttribute("min") || "",
        referenceId: latency.getAttribute("referenceId") || ""
      };
    }
    const pbRate = sd.querySelector("PlaybackRate");
    if (pbRate) {
      desc.playbackRate = {
        max: pbRate.getAttribute("max") || "",
        min: pbRate.getAttribute("min") || ""
      };
    }
    result.serviceDescriptions.push(desc);
  });

  // Determine low-latency from ServiceDescription
  if (result.serviceDescriptions.length > 0) {
    result.isLowLatency = true;
  }

  // EventStream at MPD level
  mpd.querySelectorAll(":scope > EventStream").forEach(es => {
    result.eventStreams.push(parseEventStream(es));
  });

  // PERIODS
  const periods = mpd.querySelectorAll(":scope > Period");
  periods.forEach((period, pIdx) => {
    const periodData = {
      id: period.getAttribute("id") || "Period " + (pIdx + 1),
      start: period.getAttribute("start"),
      duration: period.getAttribute("duration"),
      durationSeconds: parseISO8601Duration(period.getAttribute("duration")),
      adaptationSets: [],
      eventStreams: []
    };

    // Period-level EventStreams
    period.querySelectorAll(":scope > EventStream").forEach(es => {
      periodData.eventStreams.push(parseEventStream(es));
      result.eventStreams.push(parseEventStream(es));
    });

    // Period-level BaseURL
    let periodBase = effectiveBase;
    const periodBaseUrl = period.querySelector(":scope > BaseURL");
    if (periodBaseUrl) {
      periodBase = resolveUrl(periodBase, periodBaseUrl.textContent.trim());
    }

    // DRM at Period level
    period.querySelectorAll(":scope > ContentProtection").forEach(cp => {
      parseDRM(cp, result.drm);
    });

    // ADAPTATION SETS
    const adaptationSets = period.querySelectorAll(":scope > AdaptationSet");
    adaptationSets.forEach((as, asIdx) => {
      result.totalAdaptationSets++;

      const asData = {
        id: as.getAttribute("id") || String(asIdx + 1),
        contentType: as.getAttribute("contentType") || "",
        mimeType: as.getAttribute("mimeType") || "",
        codecs: as.getAttribute("codecs") || "",
        lang: as.getAttribute("lang") || "",
        group: as.getAttribute("group") || "",
        par: as.getAttribute("par") || "",
        minBandwidth: as.getAttribute("minBandwidth") || "",
        maxBandwidth: as.getAttribute("maxBandwidth") || "",
        minWidth: as.getAttribute("minWidth") || "",
        maxWidth: as.getAttribute("maxWidth") || "",
        minHeight: as.getAttribute("minHeight") || "",
        maxHeight: as.getAttribute("maxHeight") || "",
        frameRate: as.getAttribute("frameRate") || "",
        segmentAlignment: as.getAttribute("segmentAlignment") || "",
        subsegmentAlignment: as.getAttribute("subsegmentAlignment") || "",
        bitstreamSwitching: as.getAttribute("bitstreamSwitching") || "",
        label: "",
        drm: [],
        representations: [],
        segmentTemplate: null,
        segmentList: null,
        segmentBase: null,
        essentialProperties: [],
        supplementalProperties: [],
        inbandEventStreams: [],
        audioChannelConfig: null,
        isTrickMode: false,
        trickModeRef: "",
        isThumbnail: false
      };

      // EssentialProperty
      as.querySelectorAll(":scope > EssentialProperty").forEach(ep => {
        const prop = {
          schemeIdUri: ep.getAttribute("schemeIdUri") || "",
          value: ep.getAttribute("value") || "",
          id: ep.getAttribute("id") || ""
        };
        asData.essentialProperties.push(prop);
        // Trick mode detection
        if (prop.schemeIdUri === "http://dashif.org/guidelines/trickmode") {
          asData.isTrickMode = true;
          asData.trickModeRef = prop.value;
        }
        // Thumbnail detection
        if (prop.schemeIdUri === "http://dashif.org/thumbnail_tile" ||
            prop.schemeIdUri === "http://dashif.org/guidelines/thumbnail_tile") {
          asData.isThumbnail = true;
        }
      });

      // SupplementalProperty
      as.querySelectorAll(":scope > SupplementalProperty").forEach(sp => {
        const prop = {
          schemeIdUri: sp.getAttribute("schemeIdUri") || "",
          value: sp.getAttribute("value") || "",
          id: sp.getAttribute("id") || ""
        };
        asData.supplementalProperties.push(prop);
        if (prop.schemeIdUri === "http://dashif.org/guidelines/trickmode") {
          asData.isTrickMode = true;
          asData.trickModeRef = prop.value;
        }
        if (prop.schemeIdUri === "http://dashif.org/thumbnail_tile" ||
            prop.schemeIdUri === "http://dashif.org/guidelines/thumbnail_tile") {
          asData.isThumbnail = true;
        }
      });

      // InbandEventStream
      as.querySelectorAll(":scope > InbandEventStream").forEach(ie => {
        asData.inbandEventStreams.push({
          schemeIdUri: ie.getAttribute("schemeIdUri") || "",
          value: ie.getAttribute("value") || ""
        });
      });

      // ProducerReferenceTime at AS level
      as.querySelectorAll(":scope > ProducerReferenceTime").forEach(prt => {
        const entry = {
          id: prt.getAttribute("id") || "",
          type: prt.getAttribute("type") || "encoder",
          wallClockTime: prt.getAttribute("wallClockTime") || "",
          presentationTime: prt.getAttribute("presentationTime") || "",
          inband: prt.getAttribute("inband") === "true",
          adaptationSet: asData.id || "",
          contentType: asData.contentType || ""
        };
        const utc = prt.querySelector("UTCTiming");
        if (utc) {
          entry.utcTiming = {
            schemeIdUri: utc.getAttribute("schemeIdUri") || "",
            value: utc.getAttribute("value") || ""
          };
        }
        result.producerReferenceTimes.push(entry);
        result.isLowLatency = true;
      });

      // AudioChannelConfiguration
      const audioChCfg = as.querySelector(":scope > AudioChannelConfiguration");
      if (audioChCfg) {
        asData.audioChannelConfig = {
          schemeIdUri: audioChCfg.getAttribute("schemeIdUri") || "",
          value: audioChCfg.getAttribute("value") || ""
        };
      }

      // Determine content type from mimeType if not set
      if (!asData.contentType) {
        const mime = asData.mimeType.toLowerCase();
        if (mime.includes("video")) asData.contentType = "video";
        else if (mime.includes("audio")) asData.contentType = "audio";
        else if (mime.includes("text") || mime.includes("subtitle") || mime.includes("application/ttml")) asData.contentType = "text";
      }

      // Label
      const labelEl = as.querySelector(":scope > Label");
      if (labelEl) asData.label = labelEl.textContent.trim();

      // Roles
      const roles = as.querySelectorAll(":scope > Role");
      asData.roles = [];
      roles.forEach(r => {
        asData.roles.push(r.getAttribute("value") || r.getAttribute("schemeIdUri") || "");
      });

      // Accessibility
      const accessibility = as.querySelectorAll(":scope > Accessibility");
      asData.accessibility = [];
      accessibility.forEach(a => {
        asData.accessibility.push({
          schemeIdUri: a.getAttribute("schemeIdUri") || "",
          value: a.getAttribute("value") || ""
        });
      });

      // DRM at AdaptationSet level
      as.querySelectorAll(":scope > ContentProtection").forEach(cp => {
        parseDRM(cp, asData.drm);
        parseDRM(cp, result.drm);
      });

      // SegmentTemplate at AS level
      const asST = as.querySelector(":scope > SegmentTemplate");
      if (asST) {
        asData.segmentTemplate = parseSegmentTemplate(asST);
      }

      // SegmentList at AS level
      const asSL = as.querySelector(":scope > SegmentList");
      if (asSL) {
        asData.segmentList = parseSegmentList(asSL);
      }

      // SegmentBase at AS level
      const asSB = as.querySelector(":scope > SegmentBase");
      if (asSB) {
        asData.segmentBase = parseSegmentBase(asSB);
      }

      // AS-level BaseURL
      let asBase = periodBase;
      const asBaseUrl = as.querySelector(":scope > BaseURL");
      if (asBaseUrl) {
        asBase = resolveUrl(asBase, asBaseUrl.textContent.trim());
      }

      // REPRESENTATIONS
      const representations = as.querySelectorAll(":scope > Representation");
      representations.forEach((rep) => {
        result.totalRepresentations++;

        const repData = {
          id: rep.getAttribute("id") || "",
          bandwidth: rep.getAttribute("bandwidth") || "",
          width: rep.getAttribute("width") || as.getAttribute("width") || "",
          height: rep.getAttribute("height") || as.getAttribute("height") || "",
          frameRate: rep.getAttribute("frameRate") || asData.frameRate || "",
          codecs: rep.getAttribute("codecs") || asData.codecs || "",
          mimeType: rep.getAttribute("mimeType") || asData.mimeType || "",
          contentType: asData.contentType,
          lang: asData.lang,
          audioSamplingRate: rep.getAttribute("audioSamplingRate") || as.getAttribute("audioSamplingRate") || "",
          audioChannelConfig: asData.audioChannelConfig,
          qualityRanking: rep.getAttribute("qualityRanking") || "",
          scanType: rep.getAttribute("scanType") || "",
          sar: rep.getAttribute("sar") || "",
          isTrickMode: asData.isTrickMode,
          isThumbnail: asData.isThumbnail,
          essentialProperties: asData.essentialProperties,
          supplementalProperties: asData.supplementalProperties,
          inbandEventStreams: asData.inbandEventStreams,
          roles: asData.roles || [],
          segmentTemplate: null,
          segmentList: null,
          segmentBase: null,
          baseUrl: ""
        };

        // Rep-level BaseURL
        const repBaseUrl = rep.querySelector(":scope > BaseURL");
        if (repBaseUrl) {
          repData.baseUrl = resolveUrl(asBase, repBaseUrl.textContent.trim());
        } else {
          repData.baseUrl = asBase;
        }

        // Rep-level SegmentTemplate (overrides AS-level)
        const repST = rep.querySelector(":scope > SegmentTemplate");
        if (repST) {
          repData.segmentTemplate = parseSegmentTemplate(repST);
        } else if (asData.segmentTemplate) {
          repData.segmentTemplate = asData.segmentTemplate;
        }

        // Rep-level SegmentList
        const repSL = rep.querySelector(":scope > SegmentList");
        if (repSL) {
          repData.segmentList = parseSegmentList(repSL);
        } else if (asData.segmentList) {
          repData.segmentList = asData.segmentList;
        }

        // Rep-level SegmentBase
        const repSB = rep.querySelector(":scope > SegmentBase");
        if (repSB) {
          repData.segmentBase = parseSegmentBase(repSB);
        } else if (asData.segmentBase) {
          repData.segmentBase = asData.segmentBase;
        }

        // Track bandwidth
        const bw = parseInt(repData.bandwidth);
        if (bw > 0) {
          result.maxBandwidth = Math.max(result.maxBandwidth, bw);
          result.minBandwidth = Math.min(result.minBandwidth, bw);
        }

        // Track resolution
        if (repData.width && repData.height) {
          const res = repData.width + "x" + repData.height;
          if (!result.allResolutions.includes(res)) result.allResolutions.push(res);
        }

        // Track codecs
        if (repData.codecs) {
          repData.codecs.split(",").forEach(cc => {
            const trimmed = cc.trim();
            if (trimmed && !result.allCodecs.includes(trimmed)) result.allCodecs.push(trimmed);
          });
        }

        // Rep-level AudioChannelConfiguration (overrides AS-level)
        const repAudioCh = rep.querySelector(":scope > AudioChannelConfiguration");
        if (repAudioCh) {
          repData.audioChannelConfig = {
            schemeIdUri: repAudioCh.getAttribute("schemeIdUri") || "",
            value: repAudioCh.getAttribute("value") || ""
          };
        }

        // Categorize
        const liveInfo = {
          totalDuration: result.durationSeconds || periodData.durationSeconds || 0,
          isDynamic: result.type === "dynamic",
          availabilityStartTime: result.availabilityStartTime || "",
          timeShiftBufferDepth: result.timeShiftBufferDepth || ""
        };
        repData._totalDurationSeconds = liveInfo.totalDuration;
        repData._liveInfo = liveInfo;
        if (repData.isTrickMode) {
          result.trickModeAdaptations.push(repData);
        } else if (repData.isThumbnail) {
          result.thumbnailAdaptations.push(repData);
        } else if (repData.contentType === "video") {
          result.videoRepresentations.push(repData);
        } else if (repData.contentType === "audio") {
          result.audioRepresentations.push(repData);
        } else if (repData.contentType === "text") {
          result.subtitleRepresentations.push(repData);
        }

        asData.representations.push(repData);
      });

      periodData.adaptationSets.push(asData);
    });

    result.periods.push(periodData);
  });

  if (result.minBandwidth === Infinity) result.minBandwidth = 0;

  // Deduplicate DRM
  const drmMap = {};
  result.drm.forEach(d => {
    const key = d.systemId + "|" + d.name;
    if (!drmMap[key]) drmMap[key] = d;
  });
  result.drm = Object.values(drmMap);

  // Detect availabilityTimeOffset as low-latency indicator
  if (!result.isLowLatency) {
    for (const period of result.periods) {
      for (const as of period.adaptationSets) {
        const st = as.segmentTemplate || (as.representations[0] && as.representations[0].segmentTemplate);
        if (st && st.availabilityTimeOffset) {
          result.isLowLatency = true;
          break;
        }
      }
      if (result.isLowLatency) break;
    }
  }

  // Validation
  if (!xmlString.trim().startsWith("<?xml") && !xmlString.trim().startsWith("<MPD")) {
    result.warnings.push("Content does not start with <?xml> or <MPD> — may not be a valid DASH manifest.");
  }
  if (periods.length === 0) {
    result.warnings.push("No <Period> elements found in the MPD.");
  }
  if (result.totalRepresentations === 0) {
    result.warnings.push("No <Representation> elements found.");
  }
  if (result.type === "dynamic" && !result.availabilityStartTime) {
    result.warnings.push("Dynamic MPD missing availabilityStartTime.");
  }
  if (result.type === "static" && !result.mediaPresentationDuration) {
    result.warnings.push("Static MPD missing mediaPresentationDuration.");
  }

  // DASH-IF IOP Conformance Checks
  if (result.type === "dynamic" && !result.minimumUpdatePeriod) {
    result.warnings.push("DASH-IF IOP: Dynamic MPD should include @minimumUpdatePeriod.");
  }
  if (result.type === "dynamic" && !result.timeShiftBufferDepth) {
    result.warnings.push("DASH-IF IOP: Dynamic MPD should include @timeShiftBufferDepth for DVR window.");
  }
  for (const period of result.periods) {
    for (const as of period.adaptationSets) {
      if (as.contentType === "video" && as.representations.length > 1 && !as.segmentAlignment && !as.subsegmentAlignment) {
        result.warnings.push("DASH-IF IOP: Video AdaptationSet '" + as.id + "' with multiple Representations should set @segmentAlignment=\"true\" for seamless switching.");
        break;
      }
    }
  }
  // Check for mixed codecs in same AdaptationSet
  for (const period of result.periods) {
    for (const as of period.adaptationSets) {
      if (as.representations.length > 1) {
        const baseCodecs = as.representations.map(r => (r.codecs || "").split(".")[0]).filter(Boolean);
        const unique = [...new Set(baseCodecs)];
        if (unique.length > 1) {
          result.warnings.push("DASH-IF IOP: AdaptationSet '" + as.id + "' mixes codec families (" + unique.join(", ") + "). Separate into distinct AdaptationSets.");
          break;
        }
      }
    }
  }
  // Check video representations have resolution
  const videoMissingRes = result.videoRepresentations.filter(r => !r.width || !r.height);
  if (videoMissingRes.length > 0) {
    result.warnings.push("DASH-IF IOP: " + videoMissingRes.length + " video Representation(s) missing @width/@height attributes.");
  }
  // Check all representations have bandwidth
  const missingBw = result.videoRepresentations.concat(result.audioRepresentations).filter(r => !r.bandwidth || r.bandwidth === "0");
  if (missingBw.length > 0) {
    result.warnings.push("DASH-IF IOP: " + missingBw.length + " Representation(s) missing or zero @bandwidth.");
  }
  // Check DRM has mp4protection signaling
  if (result.drm.length > 0) {
    const hasMp4Protection = result.drm.some(d => d.systemId === "urn:mpeg:dash:mp4protection:2011");
    if (!hasMp4Protection) {
      result.warnings.push("DASH-IF IOP: Encrypted content should include ContentProtection with schemeIdUri=\"urn:mpeg:dash:mp4protection:2011\".");
    }
  }

  return result;
}

function parseDRM(cpElement, drmArray) {
  const schemeId = cpElement.getAttribute("schemeIdUri") || "";
  const value = cpElement.getAttribute("value") || "";

  // Known DRM systems
  const systemId = schemeId.replace("urn:uuid:", "").toLowerCase();
  const drmNames = {
    "edef8ba9-79d6-4ace-a3c8-27dcd51d21ed": "Widevine",
    "9a04f079-9840-4286-ab92-e65be0885f95": "PlayReady",
    "94ce86fb-07ff-4f43-adb8-93d2fa968ca2": "FairPlay",
    "1077efec-c0b2-4d02-ace3-3c1e52e2fb4b": "W3C Common (ClearKey)",
    "e2719d58-a985-b3c9-781a-b030af78d30e": "ClearKey",
  };

  if (schemeId === "urn:mpeg:dash:mp4protection:2011") {
    drmArray.push({ name: "CENC (" + (value || "mp4protection") + ")", systemId: schemeId, value: value });
    return;
  }

  const name = drmNames[systemId] || "";
  if (name) {
    const entry = { name: name, systemId: systemId, value: value };
    // Check for pssh — store full base64 for decoding
    const pssh = cpElement.querySelector("pssh, cenc\\:pssh");
    if (pssh) {
      entry.psshRaw = pssh.textContent.trim();
      entry.psshDecoded = decodePSSH(entry.psshRaw);
    }
    // Check for laurl
    const laurl = cpElement.querySelector("laurl, ms\\:laurl");
    if (laurl) entry.laUrl = laurl.textContent.trim();
    drmArray.push(entry);
  } else if (schemeId) {
    drmArray.push({ name: schemeId, systemId: systemId, value: value });
  }
}

function parseSegmentTemplate(el) {
  return {
    media: el.getAttribute("media") || "",
    initialization: el.getAttribute("initialization") || "",
    startNumber: el.getAttribute("startNumber") || "",
    timescale: el.getAttribute("timescale") || "",
    duration: el.getAttribute("duration") || "",
    presentationTimeOffset: el.getAttribute("presentationTimeOffset") || "",
    availabilityTimeOffset: el.getAttribute("availabilityTimeOffset") || "",
    timeline: parseSegmentTimeline(el)
  };
}

function parseSegmentTimeline(parentEl) {
  const tl = parentEl.querySelector("SegmentTimeline");
  if (!tl) return null;
  const entries = [];
  tl.querySelectorAll("S").forEach(s => {
    entries.push({
      t: s.getAttribute("t") || "",
      d: s.getAttribute("d") || "",
      r: s.getAttribute("r") || ""
    });
  });
  return entries;
}

function parseSegmentList(el) {
  const data = {
    timescale: el.getAttribute("timescale") || "",
    duration: el.getAttribute("duration") || "",
    initialization: null,
    segmentUrls: []
  };
  const init = el.querySelector("Initialization");
  if (init) {
    data.initialization = init.getAttribute("sourceURL") || init.getAttribute("range") || "";
  }
  el.querySelectorAll("SegmentURL").forEach(su => {
    data.segmentUrls.push({
      media: su.getAttribute("media") || "",
      mediaRange: su.getAttribute("mediaRange") || ""
    });
  });
  return data;
}

function parseSegmentBase(el) {
  return {
    indexRange: el.getAttribute("indexRange") || "",
    timescale: el.getAttribute("timescale") || "",
    presentationTimeOffset: el.getAttribute("presentationTimeOffset") || "",
    initialization: el.querySelector("Initialization") ?
      (el.querySelector("Initialization").getAttribute("range") || el.querySelector("Initialization").getAttribute("sourceURL") || "") : ""
  };
}

function parseEventStream(el) {
  const events = [];
  el.querySelectorAll(":scope > Event").forEach(evt => {
    events.push({
      presentationTime: evt.getAttribute("presentationTime") || "",
      duration: evt.getAttribute("duration") || "",
      id: evt.getAttribute("id") || "",
      contentEncoding: evt.getAttribute("contentEncoding") || "",
      messageData: evt.getAttribute("messageData") || evt.textContent.trim().substring(0, 200)
    });
  });
  return {
    schemeIdUri: el.getAttribute("schemeIdUri") || "",
    value: el.getAttribute("value") || "",
    timescale: el.getAttribute("timescale") || "",
    events: events
  };
}

function decodeAudioChannels(config) {
  if (!config) return "";
  const val = config.value;
  const scheme = config.schemeIdUri;
  if (scheme === "urn:mpeg:dash:23003:3:audio_channel_configuration:2011" ||
      scheme === "urn:mpeg:mpegB:cicp:ChannelConfiguration") {
    const map = { "1": "Mono", "2": "Stereo", "3": "2.1", "4": "4.0 Quad", "5": "5.0", "6": "5.1", "7": "7.1", "8": "7.1", "12": "7.1.4 Atmos", "24": "Atmos" };
    return map[val] || val + " ch";
  }
  if (scheme === "tag:dolby.com,2014:dash:audio_channel_configuration:2011") {
    const hex = parseInt(val, 16);
    if (hex) {
      let channels = 0;
      for (let i = 0; i < 16; i++) { if (hex & (1 << i)) channels++; }
      const presets = { 1: "Mono", 2: "Stereo", 6: "5.1", 8: "7.1" };
      return presets[channels] || channels + " ch (Dolby)";
    }
    return val;
  }
  return val || "";
}

function decodeEventScheme(schemeIdUri) {
  const schemes = {
    "urn:scte:scte35:2013:xml": "SCTE-35 (XML)",
    "urn:scte:scte35:2014:xml+bin": "SCTE-35 (Binary)",
    "urn:scte:scte35:2013:bin": "SCTE-35 (Binary)",
    "https://aomedia.org/emsg/ID3": "ID3 Metadata",
    "urn:mpeg:dash:event:2012": "MPD Validity Expiration",
    "urn:mpeg:dash:event:callback:2015": "MPD Callback",
    "urn:dvb:iptv:cpm:2014": "DVB Content Protection",
    "urn:com:adobe:dpi:simple:2015": "Adobe Primetime",
    "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed": "Widevine EMSG",
    "https://dashif.org/identifiers/vast": "VAST Ad Insertion"
  };
  return schemes[schemeIdUri] || "";
}

// ============================
// SEGMENT URL COMPUTATION
// ============================

function resolveTemplate(template, vars) {
  if (!template) return "";
  return template
    .replace(/\$RepresentationID\$/g, vars.id || "")
    .replace(/\$Bandwidth\$/g, vars.bandwidth || "")
    .replace(/\$Number(%(\d+)d)?\$/g, (_, fmt, width) => {
      const num = String(vars.number || 0);
      return width ? num.padStart(parseInt(width), '0') : num;
    })
    .replace(/\$Time\$/g, vars.time || "");
}

function computeSegmentUrls(rep) {
  const result = { initUrl: "", segments: [], type: "" };
  const baseUrl = rep.baseUrl || "";

  // 1. SegmentTemplate
  if (rep.segmentTemplate) {
    const st = rep.segmentTemplate;
    result.type = "SegmentTemplate";
    const vars = { id: rep.id, bandwidth: rep.bandwidth };

    // Init URL
    if (st.initialization) {
      result.initUrl = resolveUrl(baseUrl, resolveTemplate(st.initialization, vars));
    }

    const startNumber = parseInt(st.startNumber) || 1;
    const timescale = parseInt(st.timescale) || 1;

    if (st.timeline && st.timeline.length > 0) {
      // SegmentTimeline mode — exact segments from S elements
      let time = 0;
      let number = startNumber;
      st.timeline.forEach(s => {
        const t = s.t !== "" ? parseInt(s.t) : time;
        const d = parseInt(s.d) || 0;
        const r = parseInt(s.r) || 0;
        time = t;
        for (let i = 0; i <= r; i++) {
          vars.number = number;
          vars.time = time;
          const mediaUrl = resolveUrl(baseUrl, resolveTemplate(st.media, vars));
          result.segments.push({
            number: number,
            time: time,
            duration: (d / timescale).toFixed(3),
            url: mediaUrl
          });
          time += d;
          number++;
        }
      });
    } else if (st.duration) {
      // Duration-based mode
      const segDuration = parseInt(st.duration);
      const totalDuration = rep._totalDurationSeconds || 0;
      const live = rep._liveInfo;

      if (live && live.isDynamic && live.availabilityStartTime && segDuration > 0) {
        // Dynamic manifest — compute available segments from wall clock time
        const ast = new Date(live.availabilityStartTime).getTime();
        const now = Date.now();
        const elapsedSec = (now - ast) / 1000;
        const segDurSec = segDuration / timescale;
        const latestSegNum = Math.floor(elapsedSec / segDurSec) + startNumber;

        // timeShiftBufferDepth determines how far back we can go
        let bufferDepthSec = 60; // default 1 min
        if (live.timeShiftBufferDepth) {
          bufferDepthSec = parseISO8601Duration(live.timeShiftBufferDepth);
        }
        const bufferSegCount = Math.ceil(bufferDepthSec / segDurSec);
        const earliestSegNum = Math.max(startNumber, latestSegNum - bufferSegCount);

        for (let num = earliestSegNum; num <= latestSegNum; num++) {
          vars.number = num;
          vars.time = (num - startNumber) * segDuration;
          const mediaUrl = resolveUrl(baseUrl, resolveTemplate(st.media, vars));
          result.segments.push({
            number: num,
            time: vars.time,
            duration: segDurSec.toFixed(3),
            url: mediaUrl
          });
        }
      } else if (totalDuration > 0 && segDuration > 0) {
        const segCount = Math.ceil((totalDuration * timescale) / segDuration);
        for (let i = 0; i < segCount; i++) {
          const number = startNumber + i;
          vars.number = number;
          vars.time = i * segDuration;
          const mediaUrl = resolveUrl(baseUrl, resolveTemplate(st.media, vars));
          result.segments.push({
            number: number,
            time: vars.time,
            duration: (segDuration / timescale).toFixed(3),
            url: mediaUrl
          });
        }
      } else {
        // No total duration — show template pattern
        result.segments.push({
          number: startNumber,
          time: 0,
          duration: (segDuration / timescale).toFixed(3),
          url: resolveUrl(baseUrl, resolveTemplate(st.media, { ...vars, number: startNumber, time: 0 })),
          isPattern: true
        });
      }
    }
    return result;
  }

  // 2. SegmentList
  if (rep.segmentList) {
    const sl = rep.segmentList;
    result.type = "SegmentList";

    if (sl.initialization) {
      result.initUrl = resolveUrl(baseUrl, sl.initialization);
    }

    const timescale = parseInt(sl.timescale) || 1;
    const segDuration = parseInt(sl.duration) || 0;

    sl.segmentUrls.forEach((su, i) => {
      result.segments.push({
        number: i + 1,
        duration: segDuration > 0 ? (segDuration / timescale).toFixed(3) : "—",
        url: su.media ? resolveUrl(baseUrl, su.media) : "",
        range: su.mediaRange || ""
      });
    });
    return result;
  }

  // 3. SegmentBase (single file with byte ranges)
  if (rep.segmentBase) {
    result.type = "SegmentBase";
    if (rep.segmentBase.initialization) {
      result.initUrl = rep.segmentBase.initialization;
    }
    // SegmentBase uses the BaseURL as the single media file
    if (baseUrl) {
      result.segments.push({
        number: 1,
        duration: "—",
        url: baseUrl,
        range: rep.segmentBase.indexRange || ""
      });
    }
    return result;
  }

  // 4. BaseURL only (no segment addressing)
  if (baseUrl) {
    result.type = "BaseURL";
    result.segments.push({ number: 1, duration: "—", url: baseUrl });
  }

  return result;
}

// ============================
// SEGMENT DURATION CHART
// ============================

function computeSegmentDurations(segmentTemplate) {
  if (!segmentTemplate || !segmentTemplate.timeline) return [];
  const timescale = parseInt(segmentTemplate.timescale) || 1;
  const durations = [];
  segmentTemplate.timeline.forEach(s => {
    const d = parseInt(s.d) || 0;
    const r = parseInt(s.r) || 0;
    const durationSec = d / timescale;
    for (let i = 0; i <= r; i++) {
      durations.push(durationSec);
    }
  });
  return durations;
}

function drawDurationChart(canvas, durations, targetDuration) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const isDark = !document.documentElement.getAttribute("data-theme");
  const textColor = isDark ? "#8b8fa3" : "#5a5e73";
  const barColor = isDark ? "rgba(91, 141, 239, 0.6)" : "rgba(74, 114, 212, 0.6)";
  const barOverColor = isDark ? "rgba(239, 68, 68, 0.6)" : "rgba(220, 38, 38, 0.6)";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const targetColor = isDark ? "rgba(251, 191, 36, 0.7)" : "rgba(180, 83, 9, 0.7)";

  const padLeft = 45, padRight = 10, padTop = 10, padBottom = 30;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;
  const maxD = Math.max(...durations, targetDuration || 0) * 1.1;
  const barW = Math.max(1, Math.min(12, (chartW / durations.length) - 1));
  const gap = (chartW - barW * durations.length) / (durations.length + 1);

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = textColor;
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const y = padTop + chartH - (chartH * i / 4);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(w - padRight, y);
    ctx.stroke();
    ctx.fillText((maxD * i / 4).toFixed(1) + "s", padLeft - 6, y + 3);
  }

  if (targetDuration && targetDuration > 0) {
    const ty = padTop + chartH - (chartH * targetDuration / maxD);
    ctx.strokeStyle = targetColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, ty);
    ctx.lineTo(w - padRight, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = targetColor;
    ctx.textAlign = "left";
    ctx.fillText("Target: " + targetDuration.toFixed(1) + "s", padLeft + 4, ty - 5);
  }

  durations.forEach((d, i) => {
    const x = padLeft + gap + i * (barW + gap);
    const barH = (d / maxD) * chartH;
    const y = padTop + chartH - barH;
    ctx.fillStyle = (targetDuration && d > targetDuration * 1.1) ? barOverColor : barColor;
    ctx.fillRect(x, y, barW, barH);
  });

  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.font = "10px Inter, sans-serif";
  ctx.fillText("Segments (" + durations.length + ")", w / 2, h - 4);
}

// ============================
// BANDWIDTH LADDER CHART
// ============================

function drawBandwidthLadder(canvas, reps) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const isDark = !document.documentElement.getAttribute("data-theme");
  const textColor = isDark ? "#8b8fa3" : "#5a5e73";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const dotColor = isDark ? "rgba(91, 141, 239, 0.9)" : "rgba(74, 114, 212, 0.9)";
  const dotGlow = isDark ? "rgba(91, 141, 239, 0.3)" : "rgba(74, 114, 212, 0.2)";
  const lineColor = isDark ? "rgba(91, 141, 239, 0.3)" : "rgba(74, 114, 212, 0.2)";

  const padLeft = 70, padRight = 30, padTop = 20, padBottom = 40;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;

  // sort by bandwidth
  const sorted = [...reps].sort((a, b) => parseInt(a.bandwidth) - parseInt(b.bandwidth));

  const bandwidths = sorted.map(r => parseInt(r.bandwidth) || 0);
  const heights = sorted.map(r => parseInt(r.height) || 0);
  const maxBw = Math.max(...bandwidths) * 1.1;
  const maxH = Math.max(...heights) * 1.15;

  // Grid lines (bandwidth axis - Y)
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.font = "10px Inter, sans-serif";
  ctx.fillStyle = textColor;
  ctx.textAlign = "right";
  for (let i = 0; i <= 5; i++) {
    const y = padTop + chartH - (chartH * i / 5);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(w - padRight, y);
    ctx.stroke();
    const bwVal = (maxBw * i / 5);
    ctx.fillText(bwVal >= 1000000 ? (bwVal / 1000000).toFixed(1) + "M" : (bwVal / 1000).toFixed(0) + "k", padLeft - 8, y + 3);
  }

  // X axis labels (resolution height)
  ctx.textAlign = "center";
  for (let i = 0; i <= 4; i++) {
    const x = padLeft + (chartW * i / 4);
    const hVal = Math.round(maxH * i / 4);
    ctx.fillText(hVal + "p", x, h - 8);
  }

  // Axis labels
  ctx.fillStyle = textColor;
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Resolution (height)", w / 2, h - 2);
  ctx.save();
  ctx.translate(12, padTop + chartH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Bandwidth (bps)", 0, 0);
  ctx.restore();

  // Connect dots with line
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  sorted.forEach((r, i) => {
    const x = padLeft + (heights[i] / maxH) * chartW;
    const y = padTop + chartH - (bandwidths[i] / maxBw) * chartH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Draw dots
  sorted.forEach((r, i) => {
    const x = padLeft + (heights[i] / maxH) * chartW;
    const y = padTop + chartH - (bandwidths[i] / maxBw) * chartH;

    // Glow
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = dotGlow;
    ctx.fill();

    // Dot
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    // Label
    ctx.fillStyle = textColor;
    ctx.font = "9px Inter, sans-serif";
    ctx.textAlign = "center";
    const label = (r.width && r.height) ? r.width + "x" + r.height : "";
    ctx.fillText(label, x, y - 12);
  });
}

// ============================
// MULTI-PERIOD TIMELINE
// ============================

function drawPeriodTimeline(container, periods, totalDuration) {
  container.innerHTML = "";
  container.className = "period-timeline";

  if (periods.length === 0) return;

  // Calculate period start/end times
  let accumulated = 0;
  const periodTimes = periods.map((p, i) => {
    let start = 0;
    let dur = p.durationSeconds || 0;

    if (p.start) {
      start = parseISO8601Duration(p.start);
    } else {
      start = accumulated;
    }

    if (dur === 0 && totalDuration > 0 && i === periods.length - 1) {
      dur = totalDuration - start;
    }

    accumulated = start + dur;
    return { id: p.id, start, duration: dur, adaptationSets: p.adaptationSets.length };
  });

  const effectiveTotal = totalDuration || accumulated || 1;

  // Header
  const header = document.createElement("div");
  header.className = "period-timeline-header";
  header.textContent = "Total: " + formatDuration(effectiveTotal);
  container.appendChild(header);

  // Timeline bar
  const bar = document.createElement("div");
  bar.className = "period-timeline-bar";

  const colors = ["#5b8def", "#7c5bef", "#ef5b8d", "#5befa0", "#efb85b", "#5bc8ef"];

  periodTimes.forEach((p, i) => {
    const pct = (p.duration / effectiveTotal) * 100;
    const seg = document.createElement("div");
    seg.className = "period-timeline-segment";
    seg.style.width = Math.max(pct, 0.5) + "%";
    seg.style.backgroundColor = colors[i % colors.length];
    seg.title = p.id + "\nStart: " + formatDuration(p.start) + "\nDuration: " + formatDuration(p.duration) + "\nAdaptation Sets: " + p.adaptationSets;
    bar.appendChild(seg);
  });

  container.appendChild(bar);

  // Legend
  const legend = document.createElement("div");
  legend.className = "period-timeline-legend";

  periodTimes.forEach((p, i) => {
    const item = document.createElement("div");
    item.className = "period-timeline-legend-item";
    const dot = document.createElement("span");
    dot.className = "period-timeline-dot";
    dot.style.backgroundColor = colors[i % colors.length];
    item.appendChild(dot);
    const label = document.createElement("span");
    label.textContent = p.id + " (" + formatDuration(p.duration) + ")";
    item.appendChild(label);
    legend.appendChild(item);
  });

  container.appendChild(legend);
}

// ============================
// RAW MANIFEST RENDERER
// ============================

let rawCollapsed = true;

function renderRawManifest(xmlText, preserveState) {
  const viewer = document.getElementById("rawViewer");
  const content = document.getElementById("rawContent");
  viewer.style.display = "block";
  if (!preserveState) {
    rawCollapsed = true;
    content.style.display = "none";
    document.getElementById("toggleRawBtn").textContent = "▶";
  } else {
    content.style.display = rawCollapsed ? "none" : "block";
    document.getElementById("toggleRawBtn").textContent = rawCollapsed ? "▶" : "▼";
  }

  const lines = xmlText.split(/\r?\n/);
  content.innerHTML = "";
  lines.forEach((line, i) => {
    const lineEl = document.createElement("div");
    const numSpan = document.createElement("span");
    numSpan.className = "line-num";
    numSpan.textContent = i + 1;
    lineEl.appendChild(numSpan);

    const textSpan = document.createElement("span");
    const trimmed = line.trim();
    if (trimmed.startsWith("<") && !trimmed.startsWith("<!--")) {
      textSpan.className = "tag-line";
    } else if (trimmed.startsWith("<!--")) {
      textSpan.className = "comment-line";
    } else if (trimmed.length > 0) {
      textSpan.className = "url-line";
    }
    textSpan.textContent = line;
    lineEl.appendChild(textSpan);
    content.appendChild(lineEl);
  });
}

function toggleRawViewer() {
  rawCollapsed = !rawCollapsed;
  document.getElementById("rawContent").style.display = rawCollapsed ? "none" : "block";
  document.getElementById("toggleRawBtn").textContent = rawCollapsed ? "▶" : "▼";
}

// ============================
// COLLAPSIBLE SECTION
// ============================

// Track section expand/collapse states across re-renders
const _expandedSections = {};

function createCollapsibleSection(titleText, count, startCollapsed) {
  const section = document.createElement("div");
  section.className = "media-tracks collapsible-section";

  const header = document.createElement("div");
  header.className = "section-header";
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  header.setAttribute("aria-expanded", startCollapsed ? "false" : "true");

  const arrow = document.createElement("span");
  arrow.className = "section-arrow";

  const title = document.createElement("h2");
  title.textContent = titleText;

  // Use saved state if available, otherwise use default
  let collapsed = (titleText in _expandedSections) ? !_expandedSections[titleText] : startCollapsed;
  arrow.textContent = collapsed ? "▶" : "▼";
  header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  header.appendChild(arrow);
  header.appendChild(title);

  if (count !== undefined && count !== null) {
    const badge = document.createElement("span");
    badge.className = "section-count";
    badge.textContent = count;
    header.appendChild(badge);
  }

  section.appendChild(header);

  const body = document.createElement("div");
  body.className = "section-body";
  if (collapsed) body.style.display = "none";
  section.appendChild(body);

  const toggle = () => {
    const isCollapsed = body.style.display === "none";
    body.style.display = isCollapsed ? "block" : "none";
    arrow.textContent = isCollapsed ? "▼" : "▶";
    header.setAttribute("aria-expanded", isCollapsed ? "true" : "false");
    _expandedSections[titleText] = isCollapsed; // true = now expanded
  };

  header.addEventListener("click", toggle);
  header.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });

  return { section, body };
}

// ============================
// TABLE ACTION HELPER
// ============================

function createTableActions(td, url, onLoadClick) {
  if (!url) return;
  const wrap = document.createElement("div");
  wrap.className = "table-action-group";

  if (onLoadClick) {
    const loadBtn = document.createElement("button");
    loadBtn.className = "table-load-btn";
    loadBtn.textContent = "▶ Load";
    loadBtn.title = url;
    loadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onLoadClick(url);
    });
    wrap.appendChild(loadBtn);
  }

  const copyBtn = document.createElement("button");
  copyBtn.className = "table-copy-btn";
  copyBtn.textContent = "📋";
  copyBtn.title = "Copy URL: " + url;
  copyBtn.setAttribute("aria-label", "Copy URL");
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url).then(() => {
      copyBtn.textContent = "✓";
      setTimeout(() => { copyBtn.textContent = "📋"; }, 1200);
    });
  });
  wrap.appendChild(copyBtn);

  td.appendChild(wrap);
}

// ============================
// JUMP NAV
// ============================

function renderJumpNav(outputEl, sections) {
  const nav = document.createElement("div");
  nav.className = "jump-nav";
  sections.forEach(s => {
    const btn = document.createElement("button");
    btn.className = "jump-nav-item";
    btn.textContent = s.label;
    btn.addEventListener("click", () => {
      s.el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    nav.appendChild(btn);
  });
  outputEl.insertBefore(nav, outputEl.firstChild);
}

// ============================
// RESULTS RENDERER
// ============================

function renderResults(data) {
  const outputEl = document.getElementById("output");
  outputEl.innerHTML = "";

  document.getElementById("copyResultsBtn").style.display = "inline-block";
  document.getElementById("exportJsonBtn").style.display = "inline-block";
  window._lastAnalysis = data;

  if (data.error) {
    appendStat(outputEl, "Error", data.error);
    return;
  }

  const jumpSections = [];

  // MPD Type
  const isLive = data.type === "dynamic";
  let typeLabel = escapeHtml(isLive ? "Dynamic (Live)" : "Static (VOD)");
  const badgeClass = isLive ? "badge-live" : "badge-vod";
  typeLabel += ' <span class="badge ' + badgeClass + '">' + (isLive ? "LIVE" : "VOD") + '</span>';

  if (data.drm.length > 0) {
    typeLabel += ' <span class="badge badge-encrypted">🔒 DRM</span>';
  }
  if (data.isLowLatency) {
    typeLabel += ' <span class="badge badge-ll">⚡ Low-Latency</span>';
  }

  appendStat(outputEl, "MPD Type", typeLabel, true);

  // Profiles
  if (data.profiles) {
    const profileNames = [];
    if (data.profiles.includes("urn:mpeg:dash:profile:isoff-live")) profileNames.push("ISO BMFF Live");
    if (data.profiles.includes("urn:mpeg:dash:profile:isoff-on-demand")) profileNames.push("ISO BMFF On-Demand");
    if (data.profiles.includes("urn:mpeg:dash:profile:isoff-main")) profileNames.push("ISO BMFF Main");
    if (data.profiles.includes("urn:mpeg:dash:profile:full")) profileNames.push("Full");
    if (data.profiles.includes("urn:mpeg:dash:profile:mp2t-simple")) profileNames.push("MPEG-2 TS Simple");
    if (data.profiles.includes("urn:mpeg:dash:profile:mp2t-main")) profileNames.push("MPEG-2 TS Main");
    const profileDisplay = profileNames.length > 0 ? profileNames.join(", ") : data.profiles;
    appendStat(outputEl, "Profile", profileDisplay);
  }

  // Stats grid
  const grid = document.createElement("div");
  grid.className = "stat-grid";
  appendStatToGrid(grid, "Periods", data.periods.length);
  appendStatToGrid(grid, "Adaptation Sets", data.totalAdaptationSets);
  appendStatToGrid(grid, "Representations", data.totalRepresentations);
  if (data.durationSeconds > 0) appendStatToGrid(grid, "Duration", formatDuration(data.durationSeconds));
  if (data.minBufferSeconds > 0) appendStatToGrid(grid, "Min Buffer Time", data.minBufferSeconds.toFixed(1) + "s");
  if (data.videoRepresentations.length > 0) {
    appendStatToGrid(grid, "Max Bandwidth", formatBandwidth(data.maxBandwidth));
    appendStatToGrid(grid, "Min Bandwidth", formatBandwidth(data.minBandwidth));
  }
  outputEl.appendChild(grid);

  // Live-specific info
  if (isLive) {
    const liveGrid = document.createElement("div");
    liveGrid.className = "stat-grid";
    if (data.availabilityStartTime) appendStatToGrid(liveGrid, "Availability Start", data.availabilityStartTime);
    if (data.publishTime) appendStatToGrid(liveGrid, "Publish Time", data.publishTime);
    if (data.minimumUpdatePeriod) appendStatToGrid(liveGrid, "Min Update Period", data.minimumUpdatePeriod);
    if (data.timeShiftBufferDepth) appendStatToGrid(liveGrid, "Timeshift Buffer", data.timeShiftBufferDepth);
    if (data.suggestedPresentationDelay) appendStatToGrid(liveGrid, "Suggested Delay", data.suggestedPresentationDelay);
    if (liveGrid.children.length > 0) outputEl.appendChild(liveGrid);
  }

  // Resolutions
  if (data.allResolutions.length > 0) {
    const resStat = createStat("Resolutions");
    const tagContainer = document.createElement("div");
    tagContainer.style.marginTop = "8px";
    data.allResolutions.forEach(r => {
      const tag = document.createElement("span");
      tag.className = "resolution-tag";
      tag.textContent = r;
      tagContainer.appendChild(tag);
    });
    resStat.appendChild(tagContainer);
    outputEl.appendChild(resStat);
  }

  // Codecs
  if (data.allCodecs.length > 0) {
    const codecStat = createStat("Codecs");
    const tagContainer = document.createElement("div");
    tagContainer.style.marginTop = "8px";
    data.allCodecs.forEach(c => {
      const tag = document.createElement("span");
      tag.className = "codec-tag";
      const decoded = decodeCodec(c);
      tag.textContent = decoded !== c ? c + " (" + decoded + ")" : c;
      tag.title = decoded;
      tagContainer.appendChild(tag);
    });
    codecStat.appendChild(tagContainer);
    outputEl.appendChild(codecStat);
  }

  // DRM
  if (data.drm.length > 0) {
    const { section, body } = createCollapsibleSection("DRM / Content Protection", data.drm.length, false);
    data.drm.forEach(d => {
      const item = document.createElement("div");
      item.className = "track-item";

      const typeBadge = document.createElement("span");
      typeBadge.className = "track-type track-type-drm";
      typeBadge.textContent = "DRM";
      item.appendChild(typeBadge);

      const nameSpan = document.createElement("span");
      nameSpan.className = "track-name";
      nameSpan.textContent = d.name;
      item.appendChild(nameSpan);

      const details = [];
      if (d.systemId && d.systemId !== d.name) details.push("System ID: " + d.systemId);
      if (d.value) details.push("Value: " + d.value);
      if (d.laUrl) details.push("License URL: " + d.laUrl);

      if (details.length > 0) {
        const detailDiv = document.createElement("div");
        detailDiv.className = "track-details";
        detailDiv.textContent = details.join(" · ");
        item.appendChild(detailDiv);
      }

      // Decoded PSSH panel
      if (d.psshDecoded && !d.psshDecoded.error) {
        const decoded = d.psshDecoded;
        const decodePanel = document.createElement("div");
        decodePanel.className = "decoded-pssh-panel";

        const decodeToggle = document.createElement("button");
        decodeToggle.className = "decode-toggle-btn";
        decodeToggle.textContent = "🔓 Decode PSSH";
        item.appendChild(decodeToggle);

        const decodeBody = document.createElement("div");
        decodeBody.className = "decoded-pssh-body";
        decodeBody.style.display = "none";

        // Build decoded info rows
        const rows = [];
        rows.push(["PSSH Version", "v" + decoded.version]);
        rows.push(["System ID", decoded.systemId + " (" + decoded.drmName + ")"]);
        rows.push(["Data Size", decoded.dataSize + " bytes"]);

        if (decoded.keyIds.length > 0) {
          rows.push(["Key IDs (" + decoded.keyIds.length + ")", decoded.keyIds.join("\n")]);
        }

        // PlayReady-specific
        if (decoded.playreadyData) {
          const pr = decoded.playreadyData;
          if (pr.laUrl) rows.push(["PlayReady License URL", pr.laUrl]);
          if (pr.algorithm) rows.push(["Algorithm", pr.algorithm]);
          if (pr.keyIds && pr.keyIds.length > 0) {
            rows.push(["PlayReady Key IDs", pr.keyIds.join("\n")]);
          }
          if (pr.checksum) rows.push(["Checksum", pr.checksum]);
          if (pr.headerXml) {
            const xmlBtn = document.createElement("button");
            xmlBtn.className = "decode-toggle-btn decode-xml-btn";
            xmlBtn.textContent = "📄 Show PlayReady Header XML";
            const xmlPre = document.createElement("pre");
            xmlPre.className = "decoded-xml";
            xmlPre.style.display = "none";
            try {
              // Pretty-print the XML
              const formatted = pr.headerXml.replace(/></g, '>\n<');
              xmlPre.textContent = formatted;
            } catch {
              xmlPre.textContent = pr.headerXml;
            }
            xmlBtn.addEventListener("click", () => {
              const showing = xmlPre.style.display !== "none";
              xmlPre.style.display = showing ? "none" : "block";
              xmlBtn.textContent = showing ? "📄 Show PlayReady Header XML" : "📄 Hide PlayReady Header XML";
            });
            decodeBody.appendChild(xmlBtn);
            decodeBody.appendChild(xmlPre);
          }
        }

        // Widevine-specific
        if (decoded.widevineData) {
          const wv = decoded.widevineData;
          if (wv.provider) rows.push(["Widevine Provider", wv.provider]);
          if (wv.contentId) rows.push(["Content ID", wv.contentId]);
          if (wv.protectionScheme) rows.push(["Protection Scheme", wv.protectionScheme]);
          if (wv.keyIds && wv.keyIds.length > 0) {
            rows.push(["Widevine Key IDs", wv.keyIds.join("\n")]);
          }
        }

        const table = document.createElement("table");
        table.className = "decoded-table";
        rows.forEach(([label, value]) => {
          const tr = document.createElement("tr");
          const tdLabel = document.createElement("td");
          tdLabel.className = "decoded-label";
          tdLabel.textContent = label;
          tr.appendChild(tdLabel);
          const tdValue = document.createElement("td");
          tdValue.className = "decoded-value";
          tdValue.textContent = value;

          // Add copy button for key IDs and system IDs
          if (label.includes("Key ID") || label === "System ID" || label.includes("License URL") || label === "Content ID") {
            const copyBtn = document.createElement("button");
            copyBtn.className = "table-copy-btn";
            copyBtn.textContent = "📋";
            copyBtn.title = "Copy " + label;
            copyBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(value).then(() => {
                copyBtn.textContent = "✓";
                setTimeout(() => { copyBtn.textContent = "📋"; }, 1200);
              });
            });
            const wrap = document.createElement("div");
            wrap.style.display = "flex";
            wrap.style.alignItems = "flex-start";
            wrap.style.gap = "8px";
            const valSpan = document.createElement("span");
            valSpan.textContent = value;
            valSpan.style.flex = "1";
            wrap.appendChild(valSpan);
            wrap.appendChild(copyBtn);
            tdValue.textContent = "";
            tdValue.appendChild(wrap);
          }

          tr.appendChild(tdValue);
          table.appendChild(tr);
        });

        decodeBody.insertBefore(table, decodeBody.firstChild);

        // PSSH raw base64 toggle
        if (d.psshRaw) {
          const rawBtn = document.createElement("button");
          rawBtn.className = "decode-toggle-btn decode-xml-btn";
          rawBtn.textContent = "🔑 Show Raw PSSH (Base64)";
          const rawPre = document.createElement("pre");
          rawPre.className = "decoded-xml";
          rawPre.style.display = "none";
          rawPre.textContent = d.psshRaw;
          rawBtn.addEventListener("click", () => {
            const showing = rawPre.style.display !== "none";
            rawPre.style.display = showing ? "none" : "block";
            rawBtn.textContent = showing ? "🔑 Show Raw PSSH (Base64)" : "🔑 Hide Raw PSSH (Base64)";
          });
          decodeBody.appendChild(rawBtn);
          decodeBody.appendChild(rawPre);
        }

        decodePanel.appendChild(decodeBody);
        item.appendChild(decodePanel);

        decodeToggle.addEventListener("click", () => {
          const showing = decodeBody.style.display !== "none";
          decodeBody.style.display = showing ? "none" : "block";
          decodeToggle.textContent = showing ? "🔓 Decode PSSH" : "🔒 Hide Decoded PSSH";
        });
      } else if (d.psshRaw) {
        // PSSH present but couldn't fully decode — show raw with copy
        const detailDiv = item.querySelector(".track-details") || document.createElement("div");
        if (!detailDiv.parentNode) { detailDiv.className = "track-details"; item.appendChild(detailDiv); }
        detailDiv.textContent += (detailDiv.textContent ? " · " : "") + "PSSH: " + d.psshRaw.substring(0, 60) + (d.psshRaw.length > 60 ? "..." : "");
      }

      body.appendChild(item);
    });
    outputEl.appendChild(section);
    jumpSections.push({ label: "DRM (" + data.drm.length + ")", el: section });
  }

  // VIDEO representations
  if (data.videoRepresentations.length > 0) {
    const { section, body } = createCollapsibleSection(
      "Video Representations", data.videoRepresentations.length, data.videoRepresentations.length > 10
    );
    renderVideoTable(body, data.videoRepresentations);
    outputEl.appendChild(section);
    jumpSections.push({ label: "Video (" + data.videoRepresentations.length + ")", el: section });
  }

  // AUDIO representations
  if (data.audioRepresentations.length > 0) {
    const { section, body } = createCollapsibleSection(
      "Audio Representations", data.audioRepresentations.length, false
    );
    renderAudioRepTable(body, data.audioRepresentations);
    outputEl.appendChild(section);
    jumpSections.push({ label: "Audio (" + data.audioRepresentations.length + ")", el: section });
  }

  // SUBTITLE representations
  if (data.subtitleRepresentations.length > 0) {
    const { section, body } = createCollapsibleSection(
      "Subtitle / Text Representations", data.subtitleRepresentations.length, false
    );
    renderSubtitleTable(body, data.subtitleRepresentations);
    outputEl.appendChild(section);
    jumpSections.push({ label: "Subtitles (" + data.subtitleRepresentations.length + ")", el: section });
  }

  // PERIODS detail
  if (data.periods.length > 1) {
    const { section, body } = createCollapsibleSection("Periods", data.periods.length, true);
    data.periods.forEach((p, i) => {
      const item = document.createElement("div");
      item.className = "track-item";
      const nameSpan = document.createElement("span");
      nameSpan.className = "track-name";
      nameSpan.textContent = p.id || ("Period " + (i + 1));
      item.appendChild(nameSpan);

      const details = [];
      if (p.start) details.push("Start: " + p.start);
      if (p.duration) details.push("Duration: " + p.duration);
      details.push("Adaptation Sets: " + p.adaptationSets.length);
      const totalReps = p.adaptationSets.reduce((sum, as) => sum + as.representations.length, 0);
      details.push("Representations: " + totalReps);

      const detailDiv = document.createElement("div");
      detailDiv.className = "track-details";
      detailDiv.textContent = details.join(" · ");
      item.appendChild(detailDiv);
      body.appendChild(item);
    });
    outputEl.appendChild(section);
    jumpSections.push({ label: "Periods (" + data.periods.length + ")", el: section });
  }

  // TRICK MODE / I-Frame representations
  if (data.trickModeAdaptations.length > 0) {
    const { section, body } = createCollapsibleSection(
      "Trick Mode / I-Frame Streams", data.trickModeAdaptations.length, true
    );
    renderTrickModeTable(body, data.trickModeAdaptations);
    outputEl.appendChild(section);
    jumpSections.push({ label: "I-Frame (" + data.trickModeAdaptations.length + ")", el: section });
  }

  // THUMBNAIL representations
  if (data.thumbnailAdaptations.length > 0) {
    const { section, body } = createCollapsibleSection(
      "Thumbnail Tracks", data.thumbnailAdaptations.length, true
    );
    renderThumbnailTable(body, data.thumbnailAdaptations);
    outputEl.appendChild(section);
    jumpSections.push({ label: "Thumbnails (" + data.thumbnailAdaptations.length + ")", el: section });
  }

  // EVENT STREAMS
  if (data.eventStreams.length > 0) {
    const totalEvents = data.eventStreams.reduce((sum, es) => sum + es.events.length, 0);
    const { section, body } = createCollapsibleSection(
      "Event Streams", data.eventStreams.length, true
    );
    data.eventStreams.forEach(es => {
      const item = document.createElement("div");
      item.className = "track-item";

      const typeBadge = document.createElement("span");
      typeBadge.className = "track-type track-type-event";
      typeBadge.textContent = "EVENT";
      item.appendChild(typeBadge);

      const decoded = decodeEventScheme(es.schemeIdUri);
      const nameSpan = document.createElement("span");
      nameSpan.className = "track-name";
      nameSpan.textContent = decoded ? decoded : es.schemeIdUri;
      item.appendChild(nameSpan);

      const details = [];
      if (decoded && decoded !== es.schemeIdUri) details.push("Scheme: " + es.schemeIdUri);
      if (es.value) details.push("Value: " + es.value);
      if (es.timescale) details.push("Timescale: " + es.timescale);
      details.push("Events: " + es.events.length);

      if (details.length > 0) {
        const detailDiv = document.createElement("div");
        detailDiv.className = "track-details";
        detailDiv.textContent = details.join(" · ");
        item.appendChild(detailDiv);
      }

      // Show individual events
      if (es.events.length > 0) {
        const evtToggle = document.createElement("button");
        evtToggle.className = "decode-toggle-btn";
        evtToggle.textContent = "📋 Show Events (" + es.events.length + ")";
        const evtBody = document.createElement("div");
        evtBody.className = "decoded-pssh-body";
        evtBody.style.display = "none";

        const evtTable = document.createElement("table");
        evtTable.className = "decoded-table";
        es.events.forEach(evt => {
          const rows = [];
          if (evt.id) rows.push(["ID", evt.id]);
          if (evt.presentationTime) rows.push(["Presentation Time", evt.presentationTime]);
          if (evt.duration) rows.push(["Duration", evt.duration]);
          if (evt.messageData) rows.push(["Data", evt.messageData]);
          rows.forEach(([label, value]) => {
            const tr = document.createElement("tr");
            const tdLabel = document.createElement("td");
            tdLabel.className = "decoded-label";
            tdLabel.textContent = label;
            tr.appendChild(tdLabel);
            const tdValue = document.createElement("td");
            tdValue.className = "decoded-value";
            tdValue.textContent = value;
            tr.appendChild(tdValue);
            evtTable.appendChild(tr);
          });
          // Add separator between events
          const sepTr = document.createElement("tr");
          sepTr.className = "event-separator";
          const sepTd = document.createElement("td");
          sepTd.colSpan = 2;
          sepTr.appendChild(sepTd);
          evtTable.appendChild(sepTr);
        });
        evtBody.appendChild(evtTable);

        evtToggle.addEventListener("click", () => {
          const showing = evtBody.style.display !== "none";
          evtBody.style.display = showing ? "none" : "block";
          evtToggle.textContent = showing ? "📋 Show Events (" + es.events.length + ")" : "📋 Hide Events";
        });
        item.appendChild(evtToggle);
        item.appendChild(evtBody);
      }

      body.appendChild(item);
    });
    outputEl.appendChild(section);
    jumpSections.push({ label: "Events (" + data.eventStreams.length + ")", el: section });
  }

  // PROGRAM INFORMATION
  if (data.programInfo) {
    const pi = data.programInfo;
    const hasContent = pi.title || pi.source || pi.copyright || pi.moreInformationURL;
    if (hasContent) {
      const { section, body } = createCollapsibleSection("Program Information", null, true);
      const grid = document.createElement("div");
      grid.className = "stat-grid";
      if (pi.title) appendStatToGrid(grid, "Title", pi.title);
      if (pi.source) appendStatToGrid(grid, "Source", pi.source);
      if (pi.copyright) appendStatToGrid(grid, "Copyright", pi.copyright);
      if (pi.lang) appendStatToGrid(grid, "Language", pi.lang);
      if (pi.moreInformationURL) appendStatToGrid(grid, "More Info", pi.moreInformationURL);
      body.appendChild(grid);
      outputEl.appendChild(section);
      jumpSections.push({ label: "Info", el: section });
    }
  }

  // SERVICE DESCRIPTION (low-latency)
  if (data.serviceDescriptions.length > 0) {
    const { section, body } = createCollapsibleSection("Service Description", data.serviceDescriptions.length, true);
    data.serviceDescriptions.forEach(sd => {
      const item = document.createElement("div");
      item.className = "track-item";

      const typeBadge = document.createElement("span");
      typeBadge.className = "track-type track-type-service";
      typeBadge.textContent = "SERVICE";
      item.appendChild(typeBadge);

      const nameSpan = document.createElement("span");
      nameSpan.className = "track-name";
      nameSpan.textContent = sd.id ? "Service " + sd.id : "Service Description";
      item.appendChild(nameSpan);

      const details = [];
      if (sd.latency) {
        if (sd.latency.target) details.push("Target Latency: " + sd.latency.target + "ms");
        if (sd.latency.max) details.push("Max Latency: " + sd.latency.max + "ms");
        if (sd.latency.min) details.push("Min Latency: " + sd.latency.min + "ms");
      }
      if (sd.playbackRate) {
        if (sd.playbackRate.min) details.push("Min Rate: " + sd.playbackRate.min + "x");
        if (sd.playbackRate.max) details.push("Max Rate: " + sd.playbackRate.max + "x");
      }
      if (details.length > 0) {
        const detailDiv = document.createElement("div");
        detailDiv.className = "track-details";
        detailDiv.textContent = details.join(" · ");
        item.appendChild(detailDiv);
      }
      body.appendChild(item);
    });
    outputEl.appendChild(section);
    jumpSections.push({ label: "Service", el: section });
  }

  // LOW-LATENCY DASH DETAILS
  if (data.isLowLatency) {
    const llItems = [];

    // Collect availabilityTimeOffset values from SegmentTemplates
    const atoValues = [];
    data.periods.forEach(period => {
      period.adaptationSets.forEach(as => {
        const reps = as.representations || [];
        reps.forEach(rep => {
          const st = rep.segmentTemplate;
          if (st && st.availabilityTimeOffset) {
            atoValues.push({
              repId: rep.id,
              contentType: rep.contentType || as.contentType || "",
              value: st.availabilityTimeOffset
            });
          }
        });
      });
    });

    if (atoValues.length > 0 || data.producerReferenceTimes.length > 0) {
      const { section, body } = createCollapsibleSection(
        "Low-Latency DASH Details", null, false
      );
      section.classList.add("ll-dash-section");

      const llBadge = document.createElement("span");
      llBadge.className = "badge badge-ll";
      llBadge.textContent = "⚡ LL-DASH";
      section.querySelector(".section-header").appendChild(llBadge);

      // availabilityTimeOffset
      if (atoValues.length > 0) {
        const atoTitle = document.createElement("h3");
        atoTitle.className = "cc-subtitle";
        atoTitle.textContent = "Availability Time Offset";
        body.appendChild(atoTitle);

        const atoGrid = document.createElement("div");
        atoGrid.className = "stat-grid";
        const uniqueAto = [...new Set(atoValues.map(a => a.value))];
        if (uniqueAto.length === 1) {
          appendStatToGrid(atoGrid, "availabilityTimeOffset", uniqueAto[0] === "INF" ? "INF (Infinite — very low latency)" : uniqueAto[0] + "s");
        } else {
          atoValues.forEach(a => {
            const label = (a.contentType ? a.contentType + " " : "") + "Rep " + a.repId;
            appendStatToGrid(atoGrid, label, a.value === "INF" ? "INF" : a.value + "s");
          });
        }
        body.appendChild(atoGrid);

        const atoNote = document.createElement("div");
        atoNote.className = "track-details";
        atoNote.style.marginTop = "8px";
        atoNote.textContent = "availabilityTimeOffset allows segments to be available before their nominal time, reducing latency.";
        body.appendChild(atoNote);
      }

      // ProducerReferenceTime
      if (data.producerReferenceTimes.length > 0) {
        const prtTitle = document.createElement("h3");
        prtTitle.className = "cc-subtitle";
        prtTitle.textContent = "Producer Reference Time";
        body.appendChild(prtTitle);

        data.producerReferenceTimes.forEach(prt => {
          const item = document.createElement("div");
          item.className = "track-item";

          const typeBadge = document.createElement("span");
          typeBadge.className = "track-type track-type-ll";
          typeBadge.textContent = prt.type.toUpperCase();
          item.appendChild(typeBadge);

          const nameSpan = document.createElement("span");
          nameSpan.className = "track-name";
          nameSpan.textContent = (prt.contentType ? prt.contentType + " — " : "") + "ID: " + (prt.id || "N/A");
          item.appendChild(nameSpan);

          const details = [];
          if (prt.wallClockTime) details.push("Wall Clock: " + prt.wallClockTime);
          if (prt.presentationTime) details.push("Presentation Time: " + prt.presentationTime);
          if (prt.inband) details.push("Inband: YES");
          if (prt.utcTiming) details.push("UTC: " + prt.utcTiming.schemeIdUri);

          if (details.length > 0) {
            const detailDiv = document.createElement("div");
            detailDiv.className = "track-details";
            detailDiv.textContent = details.join(" · ");
            item.appendChild(detailDiv);
          }
          body.appendChild(item);
        });
      }

      outputEl.appendChild(section);
      jumpSections.push({ label: "LL-DASH", el: section });
    }
  }

  // LOCATIONS
  if (data.locations.length > 0) {
    const { section, body } = createCollapsibleSection("MPD Location(s)", data.locations.length, true);
    data.locations.forEach(loc => {
      const item = document.createElement("div");
      item.className = "track-item";
      const nameSpan = document.createElement("span");
      nameSpan.className = "track-name";
      nameSpan.style.fontFamily = "'JetBrains Mono', monospace";
      nameSpan.style.fontSize = "12px";
      nameSpan.style.wordBreak = "break-all";
      nameSpan.textContent = loc;
      item.appendChild(nameSpan);

      const copyBtn = document.createElement("button");
      copyBtn.className = "table-copy-btn";
      copyBtn.textContent = "📋";
      copyBtn.style.marginLeft = "8px";
      copyBtn.title = "Copy URL";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(loc).then(() => {
          copyBtn.textContent = "✓";
          setTimeout(() => { copyBtn.textContent = "📋"; }, 1200);
        });
      });
      item.appendChild(copyBtn);
      body.appendChild(item);
    });
    outputEl.appendChild(section);
    jumpSections.push({ label: "Location", el: section });
  }

  // UTCTiming
  if (data.utcTiming) {
    appendStat(outputEl, "UTC Timing", data.utcTiming.schemeIdUri + (data.utcTiming.value ? " — " + data.utcTiming.value : ""));
  }

  // Base URLs
  if (data.baseUrls.length > 0) {
    appendStat(outputEl, "Base URL", data.baseUrls.join(", "));
  }

  // Segment Duration Chart
  const allDurations = [];
  data.periods.forEach(p => {
    p.adaptationSets.forEach(as => {
      if (as.contentType === "video") {
        const st = as.segmentTemplate || (as.representations[0] && as.representations[0].segmentTemplate);
        if (st) {
          const d = computeSegmentDurations(st);
          if (d.length > allDurations.length) allDurations.length = 0, allDurations.push(...d);
        }
      }
    });
  });

  if (allDurations.length > 2) {
    const { section, body } = createCollapsibleSection("Segment Duration Chart", null, false);
    const canvas = document.createElement("canvas");
    canvas.className = "duration-chart";
    body.appendChild(canvas);
    outputEl.appendChild(section);

    const maxSD = data.maxSegmentDuration ? parseISO8601Duration(data.maxSegmentDuration) : null;
    requestAnimationFrame(() => drawDurationChart(canvas, allDurations, maxSD));

    section.querySelector(".section-header").addEventListener("click", () => {
      setTimeout(() => {
        if (body.style.display !== "none") drawDurationChart(canvas, allDurations, maxSD);
      }, 50);
    });
    jumpSections.push({ label: "Chart", el: section });
  }

  // Bandwidth Ladder Chart
  const ladderReps = data.videoRepresentations.filter(r => r.width && r.height && r.bandwidth);
  if (ladderReps.length >= 2) {
    const { section, body } = createCollapsibleSection("Bandwidth Ladder", ladderReps.length, false);
    const canvas = document.createElement("canvas");
    canvas.className = "duration-chart bandwidth-ladder-chart";
    body.appendChild(canvas);
    outputEl.appendChild(section);

    requestAnimationFrame(() => drawBandwidthLadder(canvas, ladderReps));

    section.querySelector(".section-header").addEventListener("click", () => {
      setTimeout(() => {
        if (body.style.display !== "none") drawBandwidthLadder(canvas, ladderReps);
      }, 50);
    });
    jumpSections.push({ label: "Ladder", el: section });
  }

  // Multi-Period Timeline
  if (data.periods.length > 1) {
    const { section, body } = createCollapsibleSection("Period Timeline", data.periods.length, false);
    const timelineContainer = document.createElement("div");
    body.appendChild(timelineContainer);
    outputEl.appendChild(section);
    drawPeriodTimeline(timelineContainer, data.periods, data.durationSeconds);
    jumpSections.push({ label: "Timeline", el: section });
  }

  // Warnings
  if (data.warnings.length > 0) {
    const { section, body } = createCollapsibleSection("Warnings", data.warnings.length, false);
    section.classList.add("warning-section");
    data.warnings.forEach(w => {
      const wDiv = document.createElement("div");
      wDiv.className = "warning-item";
      wDiv.textContent = "⚠ " + w;
      body.appendChild(wDiv);
    });
    outputEl.appendChild(section);
    jumpSections.push({ label: "Warnings", el: section });
  }

  // Jump nav
  if (jumpSections.length > 0) {
    renderJumpNav(outputEl, jumpSections);
  }
}

// ============================
// TABLE RENDERERS
// ============================

function renderVideoTable(parent, reps) {
  const wrapper = document.createElement("div");
  wrapper.className = "variant-table-wrapper";
  const table = document.createElement("table");
  table.className = "variant-table";

  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>ID</th><th>Resolution</th><th>Bandwidth</th><th>Codecs</th><th>Frame Rate</th><th>MIME</th><th>Segments</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  reps.forEach(r => {
    const tr = document.createElement("tr");

    const tdId = document.createElement("td");
    tdId.textContent = r.id || "—";
    tr.appendChild(tdId);

    const tdRes = document.createElement("td");
    tdRes.className = "table-resolution-cell";
    tdRes.textContent = (r.width && r.height) ? r.width + "x" + r.height : "—";
    tr.appendChild(tdRes);

    const tdBw = document.createElement("td");
    tdBw.className = "table-bandwidth";
    tdBw.textContent = formatBandwidth(r.bandwidth);
    tr.appendChild(tdBw);

    const tdCodec = document.createElement("td");
    if (r.codecs) {
      const span = document.createElement("span");
      span.className = "table-codec";
      const decoded = decodeCodec(r.codecs);
      span.textContent = decoded !== r.codecs ? r.codecs + " (" + decoded + ")" : r.codecs;
      span.title = decoded;
      tdCodec.appendChild(span);
    } else {
      tdCodec.textContent = "—";
    }
    tr.appendChild(tdCodec);

    const tdFr = document.createElement("td");
    tdFr.textContent = r.frameRate || "—";
    tr.appendChild(tdFr);

    const tdMime = document.createElement("td");
    tdMime.className = "table-mime";
    tdMime.textContent = r.mimeType || "—";
    tr.appendChild(tdMime);

    const tdSeg = document.createElement("td");
    renderSegmentButton(tdSeg, r, tbody);
    tr.appendChild(tdSeg);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);
  parent.appendChild(wrapper);
}

function renderAudioRepTable(parent, reps) {
  const wrapper = document.createElement("div");
  wrapper.className = "variant-table-wrapper";
  const table = document.createElement("table");
  table.className = "variant-table";

  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>ID</th><th>Language</th><th>Bandwidth</th><th>Codecs</th><th>Channels</th><th>Sample Rate</th><th>MIME</th><th>Segments</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  reps.forEach(r => {
    const tr = document.createElement("tr");

    const tdId = document.createElement("td");
    tdId.innerHTML = '<span class="track-type track-type-audio" style="margin-right:6px">AUDIO</span>' + escapeHtml(r.id || "—");
    tr.appendChild(tdId);

    const tdLang = document.createElement("td");
    tdLang.textContent = r.lang || "—";
    tr.appendChild(tdLang);

    const tdBw = document.createElement("td");
    tdBw.className = "table-bandwidth";
    tdBw.textContent = formatBandwidth(r.bandwidth);
    tr.appendChild(tdBw);

    const tdCodec = document.createElement("td");
    if (r.codecs) {
      const span = document.createElement("span");
      span.className = "table-codec";
      const decoded = decodeCodec(r.codecs);
      span.textContent = decoded !== r.codecs ? r.codecs + " (" + decoded + ")" : r.codecs;
      tdCodec.appendChild(span);
    } else {
      tdCodec.textContent = "—";
    }
    tr.appendChild(tdCodec);

    const tdCh = document.createElement("td");
    const channels = decodeAudioChannels(r.audioChannelConfig);
    tdCh.textContent = channels || "—";
    if (channels) tdCh.title = r.audioChannelConfig.schemeIdUri + " = " + r.audioChannelConfig.value;
    tr.appendChild(tdCh);

    const tdSr = document.createElement("td");
    tdSr.textContent = r.audioSamplingRate ? r.audioSamplingRate + " Hz" : "—";
    tr.appendChild(tdSr);

    const tdMime = document.createElement("td");
    tdMime.className = "table-mime";
    tdMime.textContent = r.mimeType || "—";
    tr.appendChild(tdMime);

    const tdSeg = document.createElement("td");
    renderSegmentButton(tdSeg, r, tbody);
    tr.appendChild(tdSeg);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);
  parent.appendChild(wrapper);
}

function renderSubtitleTable(parent, reps) {
  const wrapper = document.createElement("div");
  wrapper.className = "variant-table-wrapper";
  const table = document.createElement("table");
  table.className = "variant-table";

  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>ID</th><th>Language</th><th>Codecs</th><th>MIME Type</th><th>Segments</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  reps.forEach(r => {
    const tr = document.createElement("tr");

    const tdId = document.createElement("td");
    tdId.innerHTML = '<span class="track-type track-type-sub" style="margin-right:6px">TEXT</span>' + escapeHtml(r.id || "—");
    tr.appendChild(tdId);

    const tdLang = document.createElement("td");
    tdLang.textContent = r.lang || "—";
    tr.appendChild(tdLang);

    const tdCodec = document.createElement("td");
    tdCodec.textContent = r.codecs || "—";
    tr.appendChild(tdCodec);

    const tdMime = document.createElement("td");
    tdMime.textContent = r.mimeType || "—";
    tr.appendChild(tdMime);

    const tdSeg = document.createElement("td");
    renderSegmentButton(tdSeg, r, tbody);
    tr.appendChild(tdSeg);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);
  parent.appendChild(wrapper);
}

// ============================
// SEGMENT URL PANEL
// ============================

function renderSegmentButton(td, rep, tbody) {
  const segData = computeSegmentUrls(rep);
  const totalSegs = segData.segments.length;
  if (totalSegs === 0 && !segData.initUrl) {
    td.textContent = "—";
    return;
  }

  const btn = document.createElement("button");
  btn.className = "table-load-btn";
  btn.textContent = "📂 " + (totalSegs > 0 ? totalSegs : "View");
  btn.title = segData.type + " · " + totalSegs + " segment" + (totalSegs !== 1 ? "s" : "");

  let panelRow = null;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (panelRow) {
      panelRow.remove();
      panelRow = null;
      btn.textContent = "📂 " + (totalSegs > 0 ? totalSegs : "View");
      return;
    }

    btn.textContent = "📁 Hide";
    panelRow = document.createElement("tr");
    panelRow.className = "segment-panel-row";
    const panelTd = document.createElement("td");
    panelTd.colSpan = td.parentElement.children.length;
    panelTd.className = "segment-panel-cell";

    const panel = document.createElement("div");
    panel.className = "segment-panel";

    // Header with type badge and copy-all
    const panelHeader = document.createElement("div");
    panelHeader.className = "segment-panel-header";

    const typeBadge = document.createElement("span");
    typeBadge.className = "segment-type-badge";
    typeBadge.textContent = segData.type;
    panelHeader.appendChild(typeBadge);

    const repLabel = document.createElement("span");
    repLabel.className = "segment-rep-label";
    repLabel.textContent = "Rep: " + (rep.id || "—") + (rep.width ? " · " + rep.width + "x" + rep.height : "") + (rep.bandwidth ? " · " + formatBandwidth(rep.bandwidth) : "");
    panelHeader.appendChild(repLabel);

    const copyAllBtn = document.createElement("button");
    copyAllBtn.className = "table-load-btn";
    copyAllBtn.textContent = "📋 Copy All URLs";
    copyAllBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const allUrls = [];
      if (segData.initUrl) allUrls.push(segData.initUrl);
      segData.segments.forEach(s => { if (s.url) allUrls.push(s.url); });
      navigator.clipboard.writeText(allUrls.join("\n")).then(() => {
        copyAllBtn.textContent = "✓ Copied!";
        setTimeout(() => { copyAllBtn.textContent = "📋 Copy All URLs"; }, 1500);
      });
    });
    panelHeader.appendChild(copyAllBtn);
    panel.appendChild(panelHeader);

    // Init URL
    if (segData.initUrl) {
      const initRow = document.createElement("div");
      initRow.className = "segment-init-row";
      const initLabel = document.createElement("span");
      initLabel.className = "segment-init-label";
      initLabel.textContent = "Init:";
      initRow.appendChild(initLabel);
      const initUrl = document.createElement("span");
      initUrl.className = "segment-url-text";
      initUrl.textContent = segData.initUrl;
      initUrl.title = segData.initUrl;
      initRow.appendChild(initUrl);
      const initCopy = document.createElement("button");
      initCopy.className = "table-copy-btn";
      initCopy.textContent = "📋";
      initCopy.title = "Copy init URL";
      initCopy.addEventListener("click", (ev) => {
        ev.stopPropagation();
        navigator.clipboard.writeText(segData.initUrl).then(() => {
          initCopy.textContent = "✓";
          setTimeout(() => { initCopy.textContent = "📋"; }, 1200);
        });
      });
      initRow.appendChild(initCopy);
      panel.appendChild(initRow);
    }

    // Segment table
    if (totalSegs > 0) {
      const segWrapper = document.createElement("div");
      segWrapper.className = "segment-url-table-wrapper";
      const segTable = document.createElement("table");
      segTable.className = "variant-table segment-url-table";

      const hasRange = segData.segments.some(s => s.range);
      const hasTime = segData.segments.some(s => s.time !== undefined);

      let headerHtml = "<tr><th>#</th>";
      if (hasTime) headerHtml += "<th>Time</th>";
      headerHtml += "<th>Duration</th>";
      if (hasRange) headerHtml += "<th>Range</th>";
      headerHtml += "<th>URL</th><th></th></tr>";

      const segThead = document.createElement("thead");
      segThead.innerHTML = headerHtml;
      segTable.appendChild(segThead);

      const segTbody = document.createElement("tbody");

      // If too many segments, show first 100 with a "show more" button
      const MAX_INITIAL = 100;
      const renderSegments = (segs, start) => {
        segs.forEach((s, idx) => {
          const segTr = document.createElement("tr");
          if (s.isPattern) segTr.classList.add("segment-pattern-row");

          const tdNum = document.createElement("td");
          tdNum.textContent = s.number;
          tdNum.className = "table-bandwidth";
          segTr.appendChild(tdNum);

          if (hasTime) {
            const tdTime = document.createElement("td");
            tdTime.textContent = s.time !== undefined ? s.time : "—";
            tdTime.className = "table-bandwidth";
            segTr.appendChild(tdTime);
          }

          const tdDur = document.createElement("td");
          tdDur.textContent = s.duration !== "—" ? s.duration + "s" : "—";
          tdDur.className = "table-bandwidth";
          segTr.appendChild(tdDur);

          if (hasRange) {
            const tdRange = document.createElement("td");
            tdRange.textContent = s.range || "—";
            tdRange.className = "table-bandwidth";
            segTr.appendChild(tdRange);
          }

          const tdUrl = document.createElement("td");
          tdUrl.className = "segment-url-cell";
          const urlSpan = document.createElement("span");
          urlSpan.className = "segment-url-text";
          urlSpan.textContent = s.url || "—";
          urlSpan.title = s.url || "";
          tdUrl.appendChild(urlSpan);
          segTr.appendChild(tdUrl);

          const tdCopy = document.createElement("td");
          if (s.url) {
            const copyBtn = document.createElement("button");
            copyBtn.className = "table-copy-btn";
            copyBtn.textContent = "📋";
            copyBtn.title = "Copy URL";
            copyBtn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              navigator.clipboard.writeText(s.url).then(() => {
                copyBtn.textContent = "✓";
                setTimeout(() => { copyBtn.textContent = "📋"; }, 1200);
              });
            });
            tdCopy.appendChild(copyBtn);
          }
          segTr.appendChild(tdCopy);

          segTbody.appendChild(segTr);
        });
      };

      renderSegments(segData.segments.slice(0, MAX_INITIAL));

      if (totalSegs > MAX_INITIAL) {
        const moreTr = document.createElement("tr");
        const moreTd = document.createElement("td");
        moreTd.colSpan = 10;
        moreTd.style.textAlign = "center";
        const moreBtn = document.createElement("button");
        moreBtn.className = "table-load-btn";
        moreBtn.textContent = "Show remaining " + (totalSegs - MAX_INITIAL) + " segments";
        moreBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          moreTr.remove();
          renderSegments(segData.segments.slice(MAX_INITIAL));
        });
        moreTd.appendChild(moreBtn);
        moreTr.appendChild(moreTd);
        segTbody.appendChild(moreTr);
      }

      segTable.appendChild(segTbody);
      segWrapper.appendChild(segTable);
      panel.appendChild(segWrapper);
    }

    panelTd.appendChild(panel);
    panelRow.appendChild(panelTd);

    // Insert panel row after the current row
    const currentRow = td.parentElement;
    if (currentRow.nextSibling) {
      tbody.insertBefore(panelRow, currentRow.nextSibling);
    } else {
      tbody.appendChild(panelRow);
    }
  });

  td.appendChild(btn);
}

// ============================
// TRICK MODE & THUMBNAIL TABLES
// ============================

function renderTrickModeTable(parent, reps) {
  const wrapper = document.createElement("div");
  wrapper.className = "variant-table-wrapper";
  const table = document.createElement("table");
  table.className = "variant-table";

  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>ID</th><th>Resolution</th><th>Bandwidth</th><th>Codecs</th><th>Frame Rate</th><th>Ref AS</th><th>Segments</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  reps.forEach(r => {
    const tr = document.createElement("tr");

    const tdId = document.createElement("td");
    tdId.innerHTML = '<span class="track-type track-type-iframe" style="margin-right:6px">I-FRAME</span>' + escapeHtml(r.id || "—");
    tr.appendChild(tdId);

    const tdRes = document.createElement("td");
    tdRes.className = "table-resolution-cell";
    tdRes.textContent = (r.width && r.height) ? r.width + "x" + r.height : "—";
    tr.appendChild(tdRes);

    const tdBw = document.createElement("td");
    tdBw.className = "table-bandwidth";
    tdBw.textContent = formatBandwidth(r.bandwidth);
    tr.appendChild(tdBw);

    const tdCodec = document.createElement("td");
    if (r.codecs) {
      const span = document.createElement("span");
      span.className = "table-codec";
      const decoded = decodeCodec(r.codecs);
      span.textContent = decoded !== r.codecs ? r.codecs + " (" + decoded + ")" : r.codecs;
      tdCodec.appendChild(span);
    } else {
      tdCodec.textContent = "—";
    }
    tr.appendChild(tdCodec);

    const tdFr = document.createElement("td");
    tdFr.textContent = r.frameRate || "—";
    tr.appendChild(tdFr);

    const tdRef = document.createElement("td");
    tdRef.className = "table-bandwidth";
    tdRef.textContent = r.isTrickMode && r.essentialProperties.length > 0 ?
      r.essentialProperties.find(p => p.schemeIdUri.includes("trickmode"))?.value || "—" : "—";
    tr.appendChild(tdRef);

    const tdSeg = document.createElement("td");
    renderSegmentButton(tdSeg, r, tbody);
    tr.appendChild(tdSeg);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);
  parent.appendChild(wrapper);
}

function renderThumbnailTable(parent, reps) {
  const wrapper = document.createElement("div");
  wrapper.className = "variant-table-wrapper";
  const table = document.createElement("table");
  table.className = "variant-table";

  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>ID</th><th>Resolution</th><th>Bandwidth</th><th>MIME</th><th>Tile Layout</th><th>Segments</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  reps.forEach(r => {
    const tr = document.createElement("tr");

    const tdId = document.createElement("td");
    tdId.innerHTML = '<span class="track-type track-type-thumb" style="margin-right:6px">THUMB</span>' + escapeHtml(r.id || "—");
    tr.appendChild(tdId);

    const tdRes = document.createElement("td");
    tdRes.className = "table-resolution-cell";
    tdRes.textContent = (r.width && r.height) ? r.width + "x" + r.height : "—";
    tr.appendChild(tdRes);

    const tdBw = document.createElement("td");
    tdBw.className = "table-bandwidth";
    tdBw.textContent = formatBandwidth(r.bandwidth);
    tr.appendChild(tdBw);

    const tdMime = document.createElement("td");
    tdMime.className = "table-mime";
    tdMime.textContent = r.mimeType || "—";
    tr.appendChild(tdMime);

    const tdTile = document.createElement("td");
    const tileProp = r.essentialProperties.find(p =>
      p.schemeIdUri.includes("thumbnail_tile")) ||
      r.supplementalProperties.find(p => p.schemeIdUri.includes("thumbnail_tile"));
    tdTile.textContent = tileProp ? tileProp.value : "—";
    tr.appendChild(tdTile);

    const tdSeg = document.createElement("td");
    renderSegmentButton(tdSeg, r, tbody);
    tr.appendChild(tdSeg);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);
  parent.appendChild(wrapper);
}

// ============================
// STAT HELPERS
// ============================

function createStat(label) {
  const div = document.createElement("div");
  div.className = "stat";
  const strong = document.createElement("strong");
  strong.textContent = label;
  div.appendChild(strong);
  return div;
}

function appendStat(parent, label, value, isHtml) {
  const div = document.createElement("div");
  div.className = "stat";
  const strong = document.createElement("strong");
  strong.textContent = label;
  div.appendChild(strong);
  const valSpan = document.createElement("span");
  valSpan.className = "stat-value";
  if (isHtml) valSpan.innerHTML = value;
  else valSpan.textContent = value;
  div.appendChild(valSpan);
  parent.appendChild(div);
}

function appendStatToGrid(grid, label, value) {
  const div = document.createElement("div");
  div.className = "stat";
  const strong = document.createElement("strong");
  strong.textContent = label;
  div.appendChild(strong);
  const valSpan = document.createElement("span");
  valSpan.className = "stat-value";
  valSpan.textContent = value;
  div.appendChild(valSpan);
  grid.appendChild(div);
}

// ============================
// FETCH & ANALYZE
// ============================

async function loadManifestFromUrl() {
  const urlInput = document.getElementById("manifestUrl");
  const url = urlInput.value.trim();
  clearError();

  if (!url) { showError("Please enter an MPD URL."); return; }
  if (!isValidUrl(url)) { showError("Please enter a valid HTTP or HTTPS URL."); return; }

  showLoading(true);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      showError(getHttpErrorMessage(response.status, response.statusText) + "\n\nURL: " + url);
      return;
    }
    const text = await response.text();
    document.getElementById("manifestInput").value = text;
    addToHistory(url);
    autoRefreshCount = 0;
    lastManifestText = text;
    analyzeManifest(url);
  } catch (error) {
    showError(getFetchErrorMessage(error) + "\n\nURL: " + url);
  } finally {
    showLoading(false);
  }
}

// ============================
// AUTO-REFRESH
// ============================

let autoRefreshTimer = null;
let autoRefreshInterval = 5000;
let autoRefreshCount = 0;
let lastManifestText = "";

function startAutoRefresh(url) {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
  const badge = document.getElementById("autoRefreshBadge");
  if (badge) {
    badge.style.display = "inline-flex";
    updateRefreshBadge();
  }
  autoRefreshTimer = setInterval(async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const text = await response.text();
      const changed = text !== lastManifestText;
      autoRefreshCount++;
      lastManifestText = text;
      document.getElementById("manifestInput").value = text;
      analyzeManifest(url);
      updateRefreshBadge(changed);
      const outputEl = document.getElementById("output");
      outputEl.classList.remove("refresh-flash", "refresh-flash-subtle");
      void outputEl.offsetWidth;
      outputEl.classList.add(changed ? "refresh-flash" : "refresh-flash-subtle");
      setTimeout(() => outputEl.classList.remove("refresh-flash", "refresh-flash-subtle"), 600);
    } catch (err) {
      console.warn("Auto-refresh failed:", err.message);
    }
  }, autoRefreshInterval);
}

function updateRefreshBadge(changed) {
  const badge = document.getElementById("autoRefreshBadge");
  if (!badge) return;
  const now = new Date();
  const time = now.toLocaleTimeString();
  const countText = autoRefreshCount > 0 ? " · #" + autoRefreshCount : "";
  const timeText = autoRefreshCount > 0 ? " · " + time : "";
  const changeText = autoRefreshCount > 0 ? (changed ? " · ✓ Updated" : " · ✓ Fetched") : "";
  badge.innerHTML = '<span class="auto-refresh-dot"></span> LIVE' + countText + timeText + changeText;
}

function stopAutoRefresh() {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
  autoRefreshCount = 0;
  const badge = document.getElementById("autoRefreshBadge");
  if (badge) badge.style.display = "none";
}

function analyzeManifest(baseUrl) {
  clearError();
  const manifest = document.getElementById("manifestInput").value;
  if (!baseUrl) baseUrl = document.getElementById("manifestUrl").value.trim() || "";

  if (!manifest.trim()) {
    showError("Please paste, upload, or load an MPD manifest first.");
    return;
  }

  const isAutoRefreshing = autoRefreshTimer !== null;
  // Stop timer without resetting count during auto-refresh
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
  const data = parseMPD(manifest, baseUrl);
  renderRawManifest(manifest, isAutoRefreshing);
  renderResults(data);

  // Auto-refresh for dynamic manifests
  if (data.type === "dynamic" && baseUrl && isValidUrl(baseUrl)) {
    if (data.minimumUpdatePeriod) {
      autoRefreshInterval = Math.max(2000, parseISO8601Duration(data.minimumUpdatePeriod) * 1000);
    }
    startAutoRefresh(baseUrl);
  } else {
    // Not a dynamic manifest or no URL — fully stop
    autoRefreshCount = 0;
    const badge = document.getElementById("autoRefreshBadge");
    if (badge) badge.style.display = "none";
  }
}

// ============================
// COPY & EXPORT
// ============================

function copyRawManifest() {
  navigator.clipboard.writeText(document.getElementById("manifestInput").value).then(() => showToast("Raw MPD copied!"));
}

function copyResults() {
  navigator.clipboard.writeText(document.getElementById("output").innerText).then(() => showToast("Results copied!"));
}

function shareUrl() {
  const url = document.getElementById("manifestUrl").value.trim();
  if (!url || !isValidUrl(url)) {
    showToast("Enter a valid URL first");
    return;
  }
  const shareLink = window.location.origin + window.location.pathname + "?url=" + encodeURIComponent(url);
  navigator.clipboard.writeText(shareLink).then(() => showToast("Shareable link copied!"));
}

function exportJson() {
  if (!window._lastAnalysis) return;
  const blob = new Blob([JSON.stringify(window._lastAnalysis, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mpd-analysis.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("JSON exported!");
}

// ============================
// INIT
// ============================

document.addEventListener("DOMContentLoaded", () => {
  // File input
  document.getElementById("fileInput").addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById("manifestInput").value = e.target.result;
      showToast("File loaded: " + file.name);
    };
    reader.readAsText(file);
  });

  // Buttons
  document.getElementById("loadUrlBtn").addEventListener("click", loadManifestFromUrl);
  document.getElementById("shareUrlBtn").addEventListener("click", shareUrl);
  document.getElementById("analyzeBtn").addEventListener("click", () => analyzeManifest());
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
  document.getElementById("copyRawBtn").addEventListener("click", copyRawManifest);
  document.getElementById("toggleRawBtn").addEventListener("click", toggleRawViewer);
  document.getElementById("copyResultsBtn").addEventListener("click", copyResults);
  document.getElementById("exportJsonBtn").addEventListener("click", exportJson);

  // Auto-refresh badge
  document.getElementById("autoRefreshBadge").addEventListener("click", () => {
    stopAutoRefresh();
    showToast("Auto-refresh stopped");
  });

  // Enter key
  document.getElementById("manifestUrl").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); loadManifestFromUrl(); }
  });

  // Escape closes modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeErrorModal();
  });

  // Drag and drop
  const dropZone = document.getElementById("dropZone");
  dropZone.addEventListener("click", (e) => {
    if (e.target.tagName !== "LABEL") document.getElementById("fileInput").click();
  });
  ["dragenter", "dragover"].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("drag-over");
    });
  });
  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      document.getElementById("manifestInput").value = ev.target.result;
      showToast("File loaded: " + file.name);
    };
    reader.readAsText(file);
  });

  initTheme();
  renderHistory();

  // URL parameter support — auto-load from ?url=...
  const params = new URLSearchParams(window.location.search);
  const urlParam = params.get("url");
  if (urlParam && isValidUrl(urlParam)) {
    document.getElementById("manifestUrl").value = urlParam;
    loadManifestFromUrl();
  }
});
