import ChatBoxReader, { type Chatbox } from "alt1/chatbox";
import * as a1lib from "alt1/base";
import BrothersPanelReader from "./brothers-panel";
import {
  moundNames,
  type MoundId,
  RecentMessageGuard,
  findCompletionMessage,
  getEnabledBrothers,
  getSlainBrothers,
  inferMound,
  isEligibleBrother,
  isMoundId,
  type PanelBrotherId,
  type BrotherId,
} from "./core";
import "./style.css";

const selectedMoundKey = "barrows-selected-mound";
const chatSelectionKey = "barrows-chat-selection";
const showAkrisaeKey = "barrows-show-akrisae";
const showLinzaKey = "barrows-show-linza";
const scanMs = 650;
const panelScanMs = 1300;
const panelRelocateMs = 5000;
const chatReaderWarmupMs = 5000;
const chatReaderRetryMs = 500;
const appConfigUrl = "./appconfig.json";

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
let panelReader: BrothersPanelReader | null = null;
let readerPrimed = false;
let scanInProgress = false;
let lastLocateAttempt = 0;
let lastPanelScan = 0;
let lastPanelLocateAttempt = 0;
let chatReaderWarmupUntil = 0;
let linzaRemaining: boolean | null = null;
let lastPanelBrothers: PanelBrotherId[] | null = null;
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
  const savedKey = localStorage.getItem(chatSelectionKey);
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
    ? `${moundNames[selected]} leads underground.`
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
      localStorage.removeItem(selectedMoundKey);
      renderSelection();
    }
    akrisaeInput.disabled = true;
    akrisaeSelector.classList.remove("mound--slain");
    akrisaeInput.setAttribute("aria-label", moundNames.akrisae);
  } else if (!akrisaeSelector.classList.contains("mound--slain")) {
    akrisaeInput.disabled = false;
  }
}

function renderBrotherStates(remainingBrothers: BrotherId[] | null): void {
  if (!remainingBrothers) return;
  const slainBrothers = new Set(
    getSlainBrothers(remainingBrothers, showAkrisaeToggle.checked),
  );

  moundInputs.forEach((input) => {
    if (!isMoundId(input.value)) return;
    const slain = slainBrothers.has(input.value);
    input.disabled = slain;
    input.closest(".mound")?.classList.toggle("mound--slain", slain);
    input.setAttribute("aria-label", slain ? `${moundNames[input.value]} — slain` : moundNames[input.value]);
  });
}

function clearBrotherStates(): void {
  moundInputs.forEach((input) => {
    input.disabled = false;
    input.closest(".mound")?.classList.remove("mound--slain");
    if (isMoundId(input.value)) input.setAttribute("aria-label", moundNames[input.value]);
  });
  linzaRemaining = null;
  lastPanelBrothers = null;
  renderAkrisae();
  renderLinza();
}

function selectMound(mound: MoundId, announce = false): void {
  const input = moundInputs.find((candidate) => candidate.value === mound);
  if (!input) return;
  input.checked = true;
  localStorage.setItem(selectedMoundKey, mound);
  renderSelection();
  if (announce) showToast(`${moundNames[mound]} marked as the tunnel.`);
}

function clearSelection(reason: "manual" | "completion"): void {
  const hadSelection = getSelectedMound() !== null;
  moundInputs.forEach((input) => (input.checked = false));
  localStorage.removeItem(selectedMoundKey);
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
  const completionMessage = findCompletionMessage(lines.map((line) => line.text));

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

function applyPanelState(panelBrothers: PanelBrotherId[]): void {
  linzaRemaining = panelBrothers.includes("linza");
  const eligibleBrothers = panelBrothers.filter(isEligibleBrother);
  const remainingBrothers = getEnabledBrothers(
    eligibleBrothers,
    showAkrisaeToggle.checked,
  );
  renderBrotherStates(remainingBrothers);
  renderAkrisae();
  renderLinza();
  const inferredMound = inferMound(remainingBrothers);
  if (inferredMound && getSelectedMound() === null) {
    selectMound(inferredMound);
    showToast(`${moundNames[inferredMound]} inferred from Brothers slain.`);
  }
}

function scanPanel(): void {
  if (!panelReader) return;
  const now = Date.now();
  if (now - lastPanelScan < panelScanMs) return;
  lastPanelScan = now;

  if (!panelReader.located) {
    if (now - lastPanelLocateAttempt < panelRelocateMs) return;
    lastPanelLocateAttempt = now;
    panelReader.locate();
  }

  const panelBrothers = panelReader.readRemaining();
  if (!panelBrothers) return;
  lastPanelBrothers = panelBrothers;
  applyPanelState(panelBrothers);
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
      locateRetryTimer = window.setTimeout(locateChatbox, chatReaderRetryMs);
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
  chatReaderWarmupUntil = Date.now() + chatReaderWarmupMs;
  locateRetryTimer = window.setTimeout(locateChatbox, chatReaderRetryMs);
}

function startChatWatcher(): void {
  window.clearInterval(scanTimer);
  window.clearInterval(panelScanTimer);
  window.clearTimeout(locateRetryTimer);

  if (!window.alt1) {
    chatSelectRow.hidden = true;
    const addAppUrl = `alt1://addapp/${new URL(appConfigUrl, window.location.href).href}`;
    setStatus("warning", "Browser preview", "Automatic reset works when this page runs in Alt1.", false);
    statusDetail.innerHTML = `Automatic reset works in Alt1. <a href="${addAppUrl}">Add local app</a>`;
    return;
  }

  window.alt1.identifyAppUrl(appConfigUrl);
  if (!window.alt1.permissionPixel) {
    setStatus("warning", "Screen permission needed", "Enable “View screen” for this app in Alt1 settings.", false);
    return;
  }

  prepareChatReader();
  panelReader = new BrothersPanelReader();
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
  }, scanMs);

  panelScanTimer = window.setInterval(() => {
    try {
      scanPanel();
    } catch (error) {
      console.error("Brothers slain reading failed", error);
      panelReader?.reset();
    }
  }, panelScanMs);
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
  localStorage.setItem(showAkrisaeKey, showAkrisaeToggle.checked ? "true" : "false");
  renderAkrisae();
  if (lastPanelBrothers) applyPanelState(lastPanelBrothers);
});
showLinzaToggle.addEventListener("change", () => {
  localStorage.setItem(showLinzaKey, showLinzaToggle.checked ? "true" : "false");
  renderLinza();
});
findChatButton.addEventListener("click", () => {
  prepareChatReader();
  panelReader?.reset();
  lastPanelLocateAttempt = 0;
  setStatus("working", "Finding chatbox…", "Keep the RuneScape chatbox visible.");
});
chatSelect.addEventListener("change", () => {
  const position = getChatReaderPosition();
  if (!position) return;
  const selectedBox = position.boxes.find((box) => getChatBoxKey(box) === chatSelect.value);
  if (!selectedBox) return;

  position.mainbox = selectedBox;
  localStorage.setItem(chatSelectionKey, getChatBoxKey(selectedBox));
  resetChatReaderHistory();
  setStatus("working", "Chat selected", "Reading this window for the next run reset.");
});

const savedMound = localStorage.getItem(selectedMoundKey);
showAkrisaeToggle.checked = localStorage.getItem(showAkrisaeKey) === "true";
showLinzaToggle.checked = localStorage.getItem(showLinzaKey) === "true";
renderAkrisae();
renderLinza();
if (isMoundId(savedMound) && (savedMound !== "akrisae" || showAkrisaeToggle.checked)) {
  selectMound(savedMound);
} else {
  localStorage.removeItem(selectedMoundKey);
  renderSelection();
}

startChatWatcher();
