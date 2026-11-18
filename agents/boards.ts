/**
 * The supported boards, from boards.json. The website, the firmware installer and the site build
 * all list boards from here, so adding a board to them is one entry (see
 * docs/contributing/adding-a-board.md). The installer's safety rules for each board's flash layout
 * stay in agents/flasher/firmware.ts.
 */
import data from './boards.json' with { type: 'json' };

export interface Board {
  /** Firmware target and folder name, such as `heltec-v3`; also its page, docs/boards/<id>.md. */
  id: string;
  name: string;
  maker: string;
  /** `experimental` until it has passed the radio, Bluetooth and storage checks on hardware. */
  status: 'supported' | 'experimental';
  /** As the installer's firmware index names the chip, such as `ESP32-S3`. */
  processor: string;
  radio: string;
  /** One sentence for the website. */
  summary: string;
  /** Up to three short facts for the website card. */
  highlights: string[];
  /** The line under the installer's board menu. */
  installHint: string;
}

export const BOARDS = data.boards as Board[];

/** "A, B and C", for sentences that name every board. */
export function listNames(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The boards' makers, each once, in board order. */
export function makers(boards: readonly Board[] = BOARDS): string[] {
  return [...new Set(boards.map(board => board.maker))];
}
