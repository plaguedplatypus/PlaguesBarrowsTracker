export const moundNames = {
  verac: "Verac",
  akrisae: "Akrisae",
  dharok: "Dharok",
  ahrim: "Ahrim",
  torag: "Torag",
  guthan: "Guthan",
  karil: "Karil",
} as const;

export type MoundId = keyof typeof moundNames;

const brotherMounds = {
  ahrim: "ahrim",
  dharok: "dharok",
  guthan: "guthan",
  akrisae: "akrisae",
  torag: "torag",
  verac: "verac",
  karil: "karil",
} as const satisfies Record<string, MoundId>;

export type BrotherId = keyof typeof brotherMounds;
export type PanelBrotherId = BrotherId | "linza";

const brothers = Object.keys(brotherMounds) as BrotherId[];

export function isEligibleBrother(brother: PanelBrotherId): brother is BrotherId {
  return brother !== "linza";
}

export function getEnabledBrothers(
  brothersToCheck: BrotherId[],
  includeAkrisae: boolean,
): BrotherId[] {
  return includeAkrisae
    ? [...brothersToCheck]
    : brothersToCheck.filter((brother) => brother !== "akrisae");
}

export function getSlainBrothers(
  remainingBrothers: BrotherId[],
  includeAkrisae = true,
): BrotherId[] {
  const remaining = new Set(remainingBrothers);
  return getEnabledBrothers(brothers, includeAkrisae)
    .filter((brother) => !remaining.has(brother));
}

export function inferMound(remainingBrothers: BrotherId[]): MoundId | null {
  if (remainingBrothers.length !== 1) return null;
  return brotherMounds[remainingBrothers[0]];
}

type PixelBuffer = {
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
  return value !== null && Object.prototype.hasOwnProperty.call(moundNames, value);
}

function normalizeChatLine(line: string): string {
  return line
    .replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "")
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// Accept the normal completion line plus common OCR and formatting variants.
function isCompletionMessage(line: string): boolean {
  const normalized = normalizeChatLine(line);
  return /^You have killed ['"]?\d+['"]? (?:of )?(?:the )?Barrows Brothers\.?$/i.test(normalized);
}

export function findCompletionMessage(lines: string[]): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isCompletionMessage(line)) return line;
    if (index === 0) continue;
    const joined = `${lines[index - 1]} ${line}`;
    if (isCompletionMessage(joined)) return joined;
  }
  return null;
}

function simplifyChatMessage(message: string): string {
  return message
    .replace(/[‘’`]/g, "'")
    .toLowerCase()
    .replace(/[\[\]\.\'":;,_\s]/g, "")
    .replace(/[|!lji]/g, "i");
}

export class RecentMessageGuard {
  private readonly recent: string[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly maximum = 100) {}

  remember(message: string): void {
    const simplified = simplifyChatMessage(message);
    if (!simplified || this.seen.has(simplified)) return;
    this.recent.push(simplified);
    this.seen.add(simplified);
    if (this.recent.length > this.maximum) {
      const oldest = this.recent.shift();
      if (oldest) this.seen.delete(oldest);
    }
  }

  accept(message: string): boolean {
    const simplified = simplifyChatMessage(message);
    if (!simplified || this.seen.has(simplified)) return false;
    this.remember(message);
    return true;
  }
}
