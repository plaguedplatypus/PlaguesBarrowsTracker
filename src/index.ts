import ChatBoxReader, { type Chatbox } from "alt1/chatbox";
import * as a1lib from "alt1/base";
import BrothersPanelReader from "./brothers-panel";
import { moundNames, type MoundId, RecentMessageGuard, findCompletionMessage,
  getEnabledBrothers, getSlainBrothers, inferMound, isEligibleBrother, isMoundId,
  type PanelBrotherId, type BrotherId, } from "./core";
import "./style.css";

const selectedMound = "barrows-selected-mound";
const chatSelection = "barrows-chat-selection";
const showAkrisae = "barrows-show-akrisae";
const showLinza = "barrows-show-linza";
const scanMs = 650;
const panelScanMs = 1300;
const panelRetryMs = 5000;
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
let chatScanTimer: number | undefined;
let panelScanTimer: number | undefined;
let chatLocateRetryTimer: number | undefined;
let chatReader: ChatBoxReader | null = null;
let panelReader: BrothersPanelReader | null = null;
let chatPrimed = false;
let lastChatLocateAttempt = 0;
let lastPanelLocateAttempt = 0;
let chatReaderWarmupUntil = 0;
let linzaRemaining: boolean | null = null;
let lastPanelBrothers: PanelBrotherId[] | null = null;
const completionMessageGuard = new RecentMessageGuard(100);

type ChatReaderPosition = {
  mainbox: Chatbox;
  boxes: Chatbox[];
};

type ChatboxType = Chatbox["type"];

const chatTypeLabels: Record<ChatboxType, string> = {
  main: "Main chat",
  cc: "Clan chat",
  fc: "Friends chat",
  gc: "Group chat",
  gcc: "Guest clan chat",
  private: "Private chat",
  gimc: "Group ironman chat",
  unknown: "Chat window",
};

function setStatus(kind: StatusKind, title: string, detail: string, showFindChat = true): void {
  statusDot.dataset.kind = kind;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
  findChatButton.hidden = !showFindChat;
}

function getChatBoxId(box: Chatbox): string {
  return [box.type, box.topright.x, box.topright.y, box.botleft.x, box.botleft.y].join(":");
}

function clearChatChoices(message: string): void {
  chatSelectRow.hidden = true;
  chatSelect.replaceChildren(new Option(message, ""));
  chatSelect.disabled = true;
}

function renderChatChoices(position: ChatReaderPosition): void {
  const savedId = localStorage.getItem(chatSelection);
  const savedBox = savedId
    ? position.boxes.find((box) => getChatBoxId(box) === savedId)
    : undefined;
  const selectedBox = savedBox ?? position.mainbox;
  position.mainbox = selectedBox;

  chatSelect.replaceChildren(
    ...position.boxes.map((box, index) => {
      const option = new Option(
        `${chatTypeLabels[box.type]}${position.boxes.length > 1 ? ` ${index + 1}` : ""}`,
        getChatBoxId(box),
      );
      option.selected = box === selectedBox;
      return option;
    }),
  );
  chatSelect.disabled = position.boxes.length < 2;
  chatSelectRow.hidden = position.boxes.length < 2;
}

function resetChatReaderHistory(): void {
  if (!chatReader) return;
  chatReader.overlaplines = [];
  chatReader.lastTimestamp = -1;
  chatReader.lastTimestampUpdate = 0;
  chatReader.addedLastread = false;
  chatReader.font = null;
  chatReader.lastReadBuffer = null;
  chatPrimed = false;
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
      localStorage.removeItem(selectedMound);
      renderSelection();
    }
    akrisaeInput.disabled = true;
    akrisaeSelector.classList.remove("mound--slain");
    akrisaeInput.setAttribute("aria-label", moundNames.akrisae);
  } else if (!akrisaeSelector.classList.contains("mound--slain")) {
    akrisaeInput.disabled = false;
  }
}

function renderBrotherStates(remainingBrothers: BrotherId[]): void {
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
  localStorage.setItem(selectedMound, mound);
  renderSelection();
  if (announce) showToast(`${moundNames[mound]} marked as the tunnel.`);
}

function clearSelection(reason: "manual" | "completion"): void {
  const hadSelection = getSelectedMound() !== null;
  moundInputs.forEach((input) => (input.checked = false));
  localStorage.removeItem(selectedMound);
  renderSelection();

  if (reason === "completion") {
    clearBrotherStates();
    showToast(hadSelection ? "Run complete — tunnel cleared." : "Run complete — ready for the next tunnel.");
  } else if (hadSelection) {
    showToast("Tunnel selection cleared.");
  }
}

function inspectNewChatLines(): void {
  if (!chatReader?.pos) return;
  const lines = chatReader.read();
  if (!lines) return;
  const completionMessage = findCompletionMessage(lines.map((line) => line.text));

  if (!chatPrimed) {
    if (completionMessage) completionMessageGuard.remember(completionMessage);
    chatPrimed = true;
    setStatus("ready", "Auto reset active", "Watching Brothers slain and the run-completion message.");
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

  if (!panelReader.located) {
    if (now - lastPanelLocateAttempt < panelRetryMs) return;
    lastPanelLocateAttempt = now;
    panelReader.locate();
  }

  const panelBrothers = panelReader.readRemaining();
  if (!panelBrothers) return;
  lastPanelBrothers = panelBrothers;
  applyPanelState(panelBrothers);
}

function locateChatbox(): void {
  if (!chatReader) return;
  window.clearTimeout(chatLocateRetryTimer);
  lastChatLocateAttempt = Date.now();
  try {
    a1lib.resetEnvironment();
    const position = chatReader.find();
    if (!position) {
      clearChatChoices("No chat windows found");
      setStatus("working", "Waiting for chatbox", "Detection will retry automatically.");
      return;
    }
    renderChatChoices(position as unknown as ChatReaderPosition);
    chatReaderWarmupUntil = 0;
    chatPrimed = false;
    inspectNewChatLines();
  } catch (error) {
    if (error instanceof TypeError && Date.now() < chatReaderWarmupUntil) {
      setStatus("working", "Preparing chat watcher…", "Loading the chat detection templates.");
      chatLocateRetryTimer = window.setTimeout(locateChatbox, chatReaderRetryMs);
      return;
    }
    console.error("Unable to locate the RuneScape chatbox", error);
    setStatus("warning", "Chat watcher paused", "Could not read the chatbox.", true);
  }
}

function prepareChatReader(): void {
  window.clearTimeout(chatLocateRetryTimer);
  chatReader = new ChatBoxReader();
  clearChatChoices("Finding chat windows…");
  chatPrimed = false;
  chatReaderWarmupUntil = Date.now() + chatReaderWarmupMs;
  chatLocateRetryTimer = window.setTimeout(locateChatbox, chatReaderRetryMs);
}

function startChatWatcher(): void {
  window.clearInterval(chatScanTimer);
  window.clearInterval(panelScanTimer);
  window.clearTimeout(chatLocateRetryTimer);

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

  chatScanTimer = window.setInterval(() => {
    try {
      if (chatReader?.pos) inspectNewChatLines();
      else if (Date.now() - lastChatLocateAttempt > 5000) locateChatbox();
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
  localStorage.setItem(showAkrisae, showAkrisaeToggle.checked ? "true" : "false");
  renderAkrisae();
  if (lastPanelBrothers) applyPanelState(lastPanelBrothers);
});
showLinzaToggle.addEventListener("change", () => {
  localStorage.setItem(showLinza, showLinzaToggle.checked ? "true" : "false");
  renderLinza();
});
findChatButton.addEventListener("click", () => {
  prepareChatReader();
  panelReader?.reset();
  lastPanelLocateAttempt = 0;
  setStatus("working", "Finding chatbox…", "Keep the RuneScape chatbox visible.");
});
chatSelect.addEventListener("change", () => {
  const position = chatReader?.pos;
  if (!position) return;
  const selectedBox = position.boxes.find((box) => getChatBoxId(box) === chatSelect.value);
  if (!selectedBox) return;

  position.mainbox = selectedBox;
  localStorage.setItem(chatSelection, getChatBoxId(selectedBox));
  resetChatReaderHistory();
  setStatus("working", "Chat selected", "Watching this window for run completion.");
});

const savedMound = localStorage.getItem(selectedMound);
showAkrisaeToggle.checked = localStorage.getItem(showAkrisae) === "true";
showLinzaToggle.checked = localStorage.getItem(showLinza) === "true";
renderAkrisae();
renderLinza();
if (isMoundId(savedMound) && (savedMound !== "akrisae" || showAkrisaeToggle.checked)) {
  selectMound(savedMound);
} else {
  localStorage.removeItem(selectedMound);
  renderSelection();
}

startChatWatcher();
