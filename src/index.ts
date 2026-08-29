import ChatBoxReader, { type Chatbox } from "alt1/chatbox";
import * as a1lib from "alt1/base";
import BrothersPanelReader from "./brothers-panel";
import {
  MOUND_NAMES,
  type MoundId,
  RecentMessageGuard,
  findBarrowsCompletionMessage,
  getEnabledTunnelBrothers,
  getSlainTunnelBrothers,
  inferTunnelMound,
  isTunnelBrotherId,
  isMoundId,
  type PanelBrotherId,
  type TunnelBrotherId,
} from "./core";
import "./style.css";

const STORAGE_KEY = "barrows-tunnel-selected-mound";
const CHAT_SELECTION_STORAGE_KEY = "barrows-tunnel-chat-selection";
const SHOW_AKRISAE_STORAGE_KEY = "barrows-tunnel-show-akrisae";
const SHOW_LINZA_STORAGE_KEY = "barrows-tunnel-show-linza";
const SCAN_INTERVAL_MS = 650;
const PANEL_SCAN_INTERVAL_MS = 1300;
const PANEL_RELOCATE_INTERVAL_MS = 5000;
const CHAT_READER_WARMUP_MS = 5000;
const CHAT_READER_RETRY_MS = 500;
const APP_CONFIG_URL = "./appconfig.json";

type StatusKind = "working" | "ready" | "warning";

const map = document.querySelector<HTMLElement>(".map")!;
const summary = document.querySelector<HTMLElement>("#selection-summary")!;
const statusDot = document.querySelector<HTMLElement>("#status-dot")!;
const statusTitle = document.querySelector<HTMLElement>("#status-title")!;
const statusDetail = document.querySelector<HTMLElement>("#status-detail")!;
const resetButton = document.querySelector<HTMLButtonElement>("#reset-button")!;
const settingsButton = document.querySelector<HTMLButtonElement>("#settings-button")!;
const settingsCloseButton = document.querySelector<HTMLButtonElement>("#settings-close-button")!;
const settingsModal = document.querySelector<HTMLDialogElement>("#settings-modal")!;
const puzzleButton = document.querySelector<HTMLButtonElement>("#puzzle-button")!;
const puzzleCloseButton = document.querySelector<HTMLButtonElement>("#puzzle-close-button")!;
const puzzleModal = document.querySelector<HTMLDialogElement>("#puzzle-modal")!;
const showAkrisaeToggle = document.querySelector<HTMLInputElement>("#show-akrisae-toggle")!;
const showLinzaToggle = document.querySelector<HTMLInputElement>("#show-linza-toggle")!;
const akrisaeSelector = document.querySelector<HTMLElement>("#akrisae-selector")!;
const akrisaeInput = akrisaeSelector.querySelector<HTMLInputElement>('input[name="mound"]')!;
const linzaDisplay = document.querySelector<HTMLElement>("#linza-display")!;
const findChatButton = document.querySelector<HTMLButtonElement>("#find-chat-button")!;
const chatSelectRow = document.querySelector<HTMLElement>("#chat-select-row")!;
const chatSelect = document.querySelector<HTMLSelectElement>("#chat-select")!;
const toast = document.querySelector<HTMLElement>("#toast")!;
const moundInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="mound"]'));

map.style.backgroundImage = 'url("./images/map.png")';

let toastTimer: number | undefined;
let scanTimer: number | undefined;
let panelScanTimer: number | undefined;
let locateRetryTimer: number | undefined;
let reader: ChatBoxReader | null = null;
let brothersPanelReader: BrothersPanelReader | null = null;
let readerPrimed = false;
let scanInProgress = false;
let lastLocateAttempt = 0;
let lastPanelScan = 0;
let lastPanelLocateAttempt = 0;
let chatReaderWarmupUntil = 0;
let linzaRemaining: boolean | null = null;
let lastRemainingPanelBrothers: PanelBrotherId[] | null = null;
const completionMessageGuard = new RecentMessageGuard(100);

type ChatReaderPosition = {
  mainbox: Chatbox;
  boxes: Chatbox[];
};

function setStatus(kind: StatusKind, title: string, detail: string, showFindChat = true): void {
  statusDot.dataset.kind = kind;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
  findChatButton.hidden = !showFindChat;
}

function getChatReaderPosition(): ChatReaderPosition | null {
  if (!reader?.pos) return null;
  return reader.pos as unknown as ChatReaderPosition;
}

function getChatBoxKey(box: Chatbox): string {
  return [box.type, box.topright.x, box.topright.y, box.botleft.x, box.botleft.y].join(":");
}

function getChatTypeLabel(type: Chatbox["type"]): string {
  switch (type) {
    case "main":
      return "Main chat";
    case "cc":
      return "Clan chat";
    case "fc":
      return "Friends chat";
    case "gc":
      return "Group chat";
    case "gcc":
      return "Group chat (guest)";
    case "private":
      return "Private chat";
    case "gimc":
      return "Group ironman chat";
    default:
      return "Chat window";
  }
}

function clearChatChoices(message: string): void {
  chatSelectRow.hidden = true;
  chatSelect.replaceChildren(new Option(message, ""));
  chatSelect.disabled = true;
}

function renderChatChoices(position: ChatReaderPosition): void {
  const savedKey = localStorage.getItem(CHAT_SELECTION_STORAGE_KEY);
  const savedBox = savedKey
    ? position.boxes.find((box) => getChatBoxKey(box) === savedKey)
    : undefined;
  const selectedBox = savedBox ?? position.mainbox;
  position.mainbox = selectedBox;

  chatSelect.replaceChildren(
    ...position.boxes.map((box, index) => {
      const option = new Option(
        `${getChatTypeLabel(box.type)}${position.boxes.length > 1 ? ` ${index + 1}` : ""}`,
        getChatBoxKey(box),
      );
      option.selected = box === selectedBox;
      return option;
    }),
  );
  chatSelect.disabled = position.boxes.length < 2;
  chatSelectRow.hidden = position.boxes.length < 2;
}

function resetChatReaderHistory(): void {
  if (!reader) return;
  reader.overlaplines = [];
  reader.lastTimestamp = -1;
  reader.lastTimestampUpdate = 0;
  reader.addedLastread = false;
  reader.font = null;
  reader.lastReadBuffer = null;
  readerPrimed = false;
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("toast--visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("toast--visible"), 2600);
}

function getSelectedMound(): MoundId | null {
  const selected = moundInputs.find((input) => input.checked)?.value ?? null;
  return isMoundId(selected) ? selected : null;
}

function renderSelection(): void {
  const selected = getSelectedMound();
  map.classList.toggle("map--has-selection", selected !== null);
  summary.textContent = selected
    ? `${MOUND_NAMES[selected]} leads underground.`
    : "Select the mound that leads underground.";
}

function renderLinza(): void {
  const shown = showLinzaToggle.checked;
  linzaDisplay.hidden = !shown;
  const slain = shown && linzaRemaining === false;
  linzaDisplay.classList.toggle("mound--slain", slain);
  linzaDisplay.setAttribute("aria-label", slain ? "Linza — slain" : "Linza");
}

function renderAkrisae(): void {
  const shown = showAkrisaeToggle.checked;
  akrisaeSelector.hidden = !shown;

  if (!shown) {
    if (akrisaeInput.checked) {
      akrisaeInput.checked = false;
      localStorage.removeItem(STORAGE_KEY);
      renderSelection();
    }
    akrisaeInput.disabled = true;
    akrisaeSelector.classList.remove("mound--slain");
    akrisaeInput.setAttribute("aria-label", MOUND_NAMES.akrisae);
  } else if (!akrisaeSelector.classList.contains("mound--slain")) {
    akrisaeInput.disabled = false;
  }
}

function renderBrotherStates(remainingBrothers: TunnelBrotherId[] | null): void {
  if (!remainingBrothers) return;
  const slainBrothers = new Set(
    getSlainTunnelBrothers(remainingBrothers, showAkrisaeToggle.checked),
  );

  moundInputs.forEach((input) => {
    if (!isMoundId(input.value)) return;
    const slain = slainBrothers.has(input.value);
    input.disabled = slain;
    input.closest(".mound")?.classList.toggle("mound--slain", slain);
    input.setAttribute("aria-label", slain ? `${MOUND_NAMES[input.value]} — slain` : MOUND_NAMES[input.value]);
  });
}

function clearBrotherStates(): void {
  moundInputs.forEach((input) => {
    input.disabled = false;
    input.closest(".mound")?.classList.remove("mound--slain");
    if (isMoundId(input.value)) input.setAttribute("aria-label", MOUND_NAMES[input.value]);
  });
  linzaRemaining = null;
  lastRemainingPanelBrothers = null;
  renderAkrisae();
  renderLinza();
}

function selectMound(mound: MoundId, announce = false): void {
  const input = moundInputs.find((candidate) => candidate.value === mound);
  if (!input) return;
  input.checked = true;
  localStorage.setItem(STORAGE_KEY, mound);
  renderSelection();
  if (announce) showToast(`${MOUND_NAMES[mound]} marked as the tunnel.`);
}

function clearSelection(reason: "manual" | "completion"): void {
  const hadSelection = getSelectedMound() !== null;
  moundInputs.forEach((input) => (input.checked = false));
  localStorage.removeItem(STORAGE_KEY);
  renderSelection();

  if (reason === "completion") {
    clearBrotherStates();
    showToast(hadSelection ? "Run complete — tunnel cleared." : "Run complete — ready for the next tunnel.");
  } else if (hadSelection) {
    showToast("Tunnel selection cleared.");
  }
}

function inspectNewChatLines(): void {
  if (!reader?.pos) return;
  const lines = reader.read();
  if (!lines) return;
  const completionMessage = findBarrowsCompletionMessage(lines.map((line) => line.text));

  if (!readerPrimed) {
    if (completionMessage) completionMessageGuard.remember(completionMessage);
    readerPrimed = true;
    setStatus("ready", "Auto Reset Active", "Watching Brothers slain and completed-run chat.");
    return;
  }

  if (completionMessage && completionMessageGuard.accept(completionMessage)) {
    clearSelection("completion");
  }
}

function applyBrothersPanelState(remainingPanelBrothers: PanelBrotherId[]): void {
  linzaRemaining = remainingPanelBrothers.includes("linza");
  const detectedTunnelBrothers = remainingPanelBrothers.filter(isTunnelBrotherId);
  const remainingBrothers = getEnabledTunnelBrothers(
    detectedTunnelBrothers,
    showAkrisaeToggle.checked,
  );
  renderBrotherStates(remainingBrothers);
  renderAkrisae();
  renderLinza();
  const inferredMound = inferTunnelMound(remainingBrothers);
  if (inferredMound && getSelectedMound() === null) {
    selectMound(inferredMound);
    showToast(`${MOUND_NAMES[inferredMound]} inferred from Brothers slain.`);
  }
}

function inspectBrothersPanel(): void {
  if (!brothersPanelReader) return;
  const now = Date.now();
  if (now - lastPanelScan < PANEL_SCAN_INTERVAL_MS) return;
  lastPanelScan = now;

  if (!brothersPanelReader.located) {
    if (now - lastPanelLocateAttempt < PANEL_RELOCATE_INTERVAL_MS) return;
    lastPanelLocateAttempt = now;
    brothersPanelReader.locate();
  }

  const remainingPanelBrothers = brothersPanelReader.readRemainingBrothers();
  if (!remainingPanelBrothers) return;
  lastRemainingPanelBrothers = remainingPanelBrothers;
  applyBrothersPanelState(remainingPanelBrothers);
}

function locateChatbox(): void {
  if (scanInProgress || !reader) return;
  window.clearTimeout(locateRetryTimer);
  scanInProgress = true;
  lastLocateAttempt = Date.now();
  try {
    a1lib.resetEnvironment();
    const position = reader.find();
    if (!position) {
      clearChatChoices("No chat windows found");
      setStatus("working", "Waiting for chatbox", "Detection will retry automatically.");
      return;
    }
    renderChatChoices(position as unknown as ChatReaderPosition);
    chatReaderWarmupUntil = 0;
    readerPrimed = false;
    inspectNewChatLines();
  } catch (error) {
    if (error instanceof TypeError && Date.now() < chatReaderWarmupUntil) {
      setStatus("working", "Preparing chat watcher…", "Loading the chat detection templates.");
      locateRetryTimer = window.setTimeout(locateChatbox, CHAT_READER_RETRY_MS);
      return;
    }
    console.error("Unable to locate the RuneScape chatbox", error);
    setStatus("warning", "Chat watcher paused", "Could not read the chatbox.", true);
  } finally {
    scanInProgress = false;
  }
}

function prepareChatReader(): void {
  window.clearTimeout(locateRetryTimer);
  reader = new ChatBoxReader();
  clearChatChoices("Finding chat windows…");
  readerPrimed = false;
  chatReaderWarmupUntil = Date.now() + CHAT_READER_WARMUP_MS;
  locateRetryTimer = window.setTimeout(locateChatbox, CHAT_READER_RETRY_MS);
}

function startChatWatcher(): void {
  window.clearInterval(scanTimer);
  window.clearInterval(panelScanTimer);
  window.clearTimeout(locateRetryTimer);

  if (!window.alt1) {
    chatSelectRow.hidden = true;
    const addAppUrl = `alt1://addapp/${new URL(APP_CONFIG_URL, window.location.href).href}`;
    setStatus("warning", "Browser preview", "Automatic reset works when this page runs in Alt1.", false);
    statusDetail.innerHTML = `Automatic reset works in Alt1. <a href="${addAppUrl}">Add local app</a>`;
    return;
  }

  window.alt1.identifyAppUrl(APP_CONFIG_URL);
  if (!window.alt1.permissionPixel) {
    setStatus("warning", "Screen permission needed", "Enable “View screen” for this app in Alt1 settings.", false);
    return;
  }

  prepareChatReader();
  brothersPanelReader = new BrothersPanelReader();
  setStatus("working", "Finding chatbox…", "Keep the RuneScape chatbox visible.");

  scanTimer = window.setInterval(() => {
    try {
      if (reader?.pos) inspectNewChatLines();
      else if (Date.now() - lastLocateAttempt > 5000) locateChatbox();
    } catch (error) {
      console.error("Automatic screen reading failed", error);
      prepareChatReader();
      setStatus("working", "Restarting detection…", "Keep chat and Brothers slain visible.");
    }
  }, SCAN_INTERVAL_MS);

  panelScanTimer = window.setInterval(() => {
    try {
      inspectBrothersPanel();
    } catch (error) {
      console.error("Brothers slain reading failed", error);
      brothersPanelReader?.reset();
    }
  }, PANEL_SCAN_INTERVAL_MS);
}

moundInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked && isMoundId(input.value)) selectMound(input.value, true);
  });
});

resetButton.addEventListener("click", () => clearSelection("manual"));
settingsButton.addEventListener("click", () => settingsModal.showModal());
settingsCloseButton.addEventListener("click", () => settingsModal.close());
settingsModal.addEventListener("click", (event) => {
  if (event.target === settingsModal) settingsModal.close();
});
puzzleButton.addEventListener("click", () => puzzleModal.showModal());
puzzleCloseButton.addEventListener("click", () => puzzleModal.close());
puzzleModal.addEventListener("click", (event) => {
  if (event.target === puzzleModal) puzzleModal.close();
});
showAkrisaeToggle.addEventListener("change", () => {
  localStorage.setItem(SHOW_AKRISAE_STORAGE_KEY, showAkrisaeToggle.checked ? "true" : "false");
  renderAkrisae();
  if (lastRemainingPanelBrothers) applyBrothersPanelState(lastRemainingPanelBrothers);
});
showLinzaToggle.addEventListener("change", () => {
  localStorage.setItem(SHOW_LINZA_STORAGE_KEY, showLinzaToggle.checked ? "true" : "false");
  renderLinza();
});
findChatButton.addEventListener("click", () => {
  prepareChatReader();
  brothersPanelReader?.reset();
  lastPanelLocateAttempt = 0;
  setStatus("working", "Finding chatbox…", "Keep the RuneScape chatbox visible.");
});
chatSelect.addEventListener("change", () => {
  const position = getChatReaderPosition();
  if (!position) return;
  const selectedBox = position.boxes.find((box) => getChatBoxKey(box) === chatSelect.value);
  if (!selectedBox) return;

  position.mainbox = selectedBox;
  localStorage.setItem(CHAT_SELECTION_STORAGE_KEY, getChatBoxKey(selectedBox));
  resetChatReaderHistory();
  setStatus("working", "Chat selected", "Reading this window for the next run reset.");
});

const savedMound = localStorage.getItem(STORAGE_KEY);
showAkrisaeToggle.checked = localStorage.getItem(SHOW_AKRISAE_STORAGE_KEY) === "true";
showLinzaToggle.checked = localStorage.getItem(SHOW_LINZA_STORAGE_KEY) === "true";
renderAkrisae();
renderLinza();
if (isMoundId(savedMound) && (savedMound !== "akrisae" || showAkrisaeToggle.checked)) {
  selectMound(savedMound);
}
else {
  localStorage.removeItem(STORAGE_KEY);
  renderSelection();
}

startChatWatcher();
