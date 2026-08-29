export const MOUND_NAMES = {
  verac: "Verac",
  akrisae: "Akrisae",
  dharok: "Dharok",
  ahrim: "Ahrim",
  torag: "Torag",
  guthan: "Guthan",
  karil: "Karil",
} as const;

export type MoundId = keyof typeof MOUND_NAMES;

export const TUNNEL_BROTHER_TO_MOUND = {
  ahrim: "ahrim",
  dharok: "dharok",
  guthan: "guthan",
  akrisae: "akrisae",
  torag: "torag",
  verac: "verac",
  karil: "karil",
} as const satisfies Record<string, MoundId>;

export type TunnelBrotherId = keyof typeof TUNNEL_BROTHER_TO_MOUND;
export type PanelBrotherId = TunnelBrotherId | "linza";

export const TUNNEL_BROTHERS = Object.keys(TUNNEL_BROTHER_TO_MOUND) as TunnelBrotherId[];

export function isTunnelBrotherId(brother: PanelBrotherId): brother is TunnelBrotherId {
  return brother !== "linza";
}

export function getEnabledTunnelBrothers(
  brothers: TunnelBrotherId[],
  includeAkrisae: boolean,
): TunnelBrotherId[] {
  return includeAkrisae ? [...brothers] : brothers.filter((brother) => brother !== "akrisae");
}

export function getSlainTunnelBrothers(
  remainingBrothers: TunnelBrotherId[],
  includeAkrisae = true,
): TunnelBrotherId[] {
  const remaining = new Set(remainingBrothers);
  return getEnabledTunnelBrothers(TUNNEL_BROTHERS, includeAkrisae)
    .filter((brother) => !remaining.has(brother));
}

export function inferTunnelMound(remainingBrothers: TunnelBrotherId[]): MoundId | null {
  if (remainingBrothers.length !== 1) return null;
  return TUNNEL_BROTHER_TO_MOUND[remainingBrothers[0]];
}

export type PixelBuffer = {
  width: number;
  height: number;
  data: ArrayLike<number>;
};

export function hasGoldPanelMarker(buffer: PixelBuffer, centerX: number, centerY: number): boolean {
  let goldPixels = 0;
  for (let y = centerY - 5; y <= centerY + 5; y += 1) {
    for (let x = centerX - 5; x <= centerX + 5; x += 1) {
      if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) continue;
      const offset = (y * buffer.width + x) * 4;
      const red = buffer.data[offset];
      const green = buffer.data[offset + 1];
      const blue = buffer.data[offset + 2];
      if (red > 140 && green > 95 && red > blue * 1.6 && green > blue * 1.3) {
        goldPixels += 1;
      }
    }
  }
  return goldPixels >= 12;
}

export function isMoundId(value: string | null): value is MoundId {
  return value !== null && Object.prototype.hasOwnProperty.call(MOUND_NAMES, value);
}

export function normalizeChatLine(line: string): string {
  return line
    .replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "")
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matches the completion line requested for the helper. The optional quote marks
 * around the number and optional small connecting words make the detector
 * tolerant of chat wording and common OCR differences without matching normal
 * player chat that merely contains the phrase.
 */
export function isBarrowsCompletionMessage(line: string): boolean {
  const normalized = normalizeChatLine(line);
  return /^You have killed ['"]?\d+['"]? (?:of )?(?:the )?Barrows Brothers\.?$/i.test(normalized);
}

export function containsBarrowsCompletionMessage(lines: string[]): boolean {
  return findBarrowsCompletionMessage(lines) !== null;
}

export function findBarrowsCompletionMessage(lines: string[]): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isBarrowsCompletionMessage(line)) return line;
    if (index === 0) continue;
    const joined = `${lines[index - 1]} ${line}`;
    if (isBarrowsCompletionMessage(joined)) return joined;
  }
  return null;
}

export function canonicalChatMessageKey(message: string): string {
  return message
    .replace(/[‘’`]/g, "'")
    .toLowerCase()
    .replace(/[\[\]\.\'":;,_\s]/g, "")
    .replace(/[|!lji]/g, "i");
}

export class RecentMessageGuard {
  private readonly keys: string[] = [];
  private readonly keySet = new Set<string>();

  constructor(private readonly maximum = 100) {}

  remember(message: string): void {
    const key = canonicalChatMessageKey(message);
    if (!key || this.keySet.has(key)) return;
    this.keys.push(key);
    this.keySet.add(key);
    if (this.keys.length > this.maximum) {
      const oldest = this.keys.shift();
      if (oldest) this.keySet.delete(oldest);
    }
  }

  accept(message: string): boolean {
    const key = canonicalChatMessageKey(message);
    if (!key || this.keySet.has(key)) return false;
    this.remember(message);
    return true;
  }
}
