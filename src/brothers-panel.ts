import * as a1lib from "alt1/base";
import { hasGoldPanelMarker, type PanelBrotherId } from "./core";

const ANCHOR_URL = "./images/brothers-anchor.png";
const REGION_TOP_FROM_ANCHOR = 69;
const REGION_WIDTH = 172;
const REGION_HEIGHT = 84;

const BROTHER_MARKERS: ReadonlyArray<{
  brother: PanelBrotherId;
  x: number;
  y: number;
}> = [
  { brother: "ahrim", x: 12, y: 6 },
  { brother: "dharok", x: 12, y: 22 },
  { brother: "guthan", x: 12, y: 38 },
  { brother: "akrisae", x: 12, y: 54 },
  { brother: "torag", x: 166, y: 6 },
  { brother: "verac", x: 166, y: 22 },
  { brother: "karil", x: 166, y: 38 },
  { brother: "linza", x: 166, y: 54 },
];

type Point = { x: number; y: number };

export default class BrothersPanelReader {
  private anchorImage: ImageData | null = null;
  private anchorPosition: Point | null = null;

  constructor() {
    void a1lib.imageDataFromUrl(ANCHOR_URL)
      .then((image) => {
        this.anchorImage = image;
      })
      .catch((error) => console.error("Unable to load the Brothers slain panel anchor", error));
  }

  get located(): boolean {
    return this.anchorPosition !== null;
  }

  reset(): void {
    this.anchorPosition = null;
  }

  locate(): boolean {
    if (!this.anchorImage) return false;
    const screen = a1lib.captureHoldFullRs();
    const matches = screen.findSubimage(this.anchorImage);
    this.anchorPosition = matches[0] ?? null;
    return this.anchorPosition !== null;
  }

  readRemainingBrothers(): PanelBrotherId[] | null {
    if (!this.anchorImage || !this.anchorPosition) return null;

    const region = a1lib.capture(
      this.anchorPosition.x,
      this.anchorPosition.y - REGION_TOP_FROM_ANCHOR,
      REGION_WIDTH,
      REGION_HEIGHT,
    );

    const anchorY = REGION_TOP_FROM_ANCHOR;
    const anchorScore = a1lib.simpleCompare(region, this.anchorImage, 0, anchorY, 30);
    if (anchorScore === Infinity) {
      this.anchorPosition = null;
      return null;
    }

    return BROTHER_MARKERS
      .filter((marker) => hasGoldPanelMarker(region, marker.x, marker.y))
      .map((marker) => marker.brother);
  }
}
