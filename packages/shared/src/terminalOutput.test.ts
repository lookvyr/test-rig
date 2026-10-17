import { describe, expect, it } from "vite-plus/test";

import {
  appendTerminalOutput,
  EMPTY_TERMINAL_OUTPUT,
  normalizeTerminalOutput,
  TERMINAL_PALETTES,
  terminalOutputPlainText,
  terminalOutputSpans,
  terminalOutputTail,
  type TerminalOutputState,
} from "./terminalOutput.ts";

function feed(chunks: ReadonlyArray<string>, maxChars?: number): TerminalOutputState {
  return chunks.reduce(
    (state, chunk) => appendTerminalOutput(state, chunk, maxChars),
    EMPTY_TERMINAL_OUTPUT,
  );
}

const plain = (input: string) => terminalOutputPlainText(normalizeTerminalOutput(input).text);

describe("appendTerminalOutput", () => {
  it("keeps colours as canonical codes that reset at each line end", () => {
    expect(normalizeTerminalOutput("\x1b[1;32mPASS\x1b[0m ok\x1b]0;title\x07\n").text).toBe(
      "\x1b[0;1;32mPASS\x1b[0m ok\n",
    );
    // A colour left on across a newline is restated on the next line.
    expect(normalizeTerminalOutput("\x1b[31mone\ntwo").text).toBe(
      "\x1b[0;31mone\x1b[0m\n\x1b[0;31mtwo\x1b[0m",
    );
  });

  it("keeps only the latest frame of a carriage-return progress bar", () => {
    expect(feed(["[1/3]", "\r[2/3]", "\r[3/3] done\nnext"]).text).toBe("[3/3] done\nnext");
  });

  it("redraws several lines in place when the cursor moves up", () => {
    // docker pull / pnpm style: print two bars, move up two lines, redraw both.
    const frames = [
      "layer a: 10%\nlayer b: 10%\n",
      "\x1b[2A\x1b[2Klayer a: 60%\n\x1b[2Klayer b: 40%\n",
      "\x1b[2A\x1b[2Klayer a: done\n\x1b[2Klayer b: done\n",
    ];
    expect(feed(frames).text).toBe("layer a: done\nlayer b: done\n");
  });

  it("erases from the cursor to the end of the screen", () => {
    // log-update style: move up, clear everything below, print the new frame.
    expect(plain("status 1\ndetail 1\n\x1b[2A\x1b[Jstatus 2\n")).toBe("status 2\n");
  });

  it("overwrites in place like a terminal: carriage return, backspace, columns", () => {
    expect(plain("progress 100%\rdone\x1b[K")).toBe("done");
    expect(plain("abc\b\bX")).toBe("aXc");
    expect(plain("12345\x1b[3GX")).toBe("12X45");
  });

  it("treats CRLF as one newline even when the pair is split across chunks", () => {
    const state = feed(["one\r", "\ntwo\r\n"]);
    expect(state.text).toBe("one\ntwo\n");
    expect(state.pending).toBe("");
  });

  it("holds an escape sequence split across chunks until it finishes", () => {
    const first = appendTerminalOutput(EMPTY_TERMINAL_OUTPUT, "red: \x1b[3");
    expect(first.text).toBe("red: ");
    expect(feed(["red: \x1b[3", "1mR\x1b[0m"]).text).toBe("red: \x1b[0;31mR\x1b[0m");
  });

  it("drops binary control bytes but keeps tabs and replacement characters", () => {
    expect(normalizeTerminalOutput("a\x00b\x07\tc�\x10d").text).toBe("ab\tc�d");
  });

  it("keeps a bounded tail that starts on a fresh line", () => {
    const lines = Array.from({ length: 2_000 }, (_, index) => `line ${index}`).join("\n");
    const state = feed([lines], 1_000);
    expect(state.truncated).toBe(true);
    expect(state.text.length).toBeLessThanOrEqual(1_000);
    expect(state.text.startsWith("line ")).toBe(true);
    expect(state.text.endsWith("line 1999")).toBe(true);
  });

  it("stays bounded across many appends of huge output, including one endless line", () => {
    let state = EMPTY_TERMINAL_OUTPUT;
    for (let index = 0; index < 5_000; index += 1) {
      state = appendTerminalOutput(state, "y\n".repeat(200), 4_096);
    }
    expect(state.text.length).toBeLessThanOrEqual(4_096);
    expect(state.truncated).toBe(true);
    for (let index = 0; index < 1_000; index += 1) {
      state = appendTerminalOutput(state, ".".repeat(100), 4_096);
    }
    expect(state.text.length).toBeLessThanOrEqual(4_096);
    expect(state.text.endsWith(".")).toBe(true);
  });

  it("hides a long string sequence's payload however it is split into chunks", () => {
    const input = `a\x1b]0;${"t".repeat(100)}\x07b`;
    expect(feed([input]).text).toBe("ab");
    expect(feed(["a\x1b]0;", "t".repeat(100), "\x07b"]).text).toBe("ab");
    expect(feed([`a\x1b]0;${"t".repeat(80)}`, "\x1b", "\\b"]).text).toBe("ab");
  });

  it("hides an SOS string sequence and its payload", () => {
    expect(normalizeTerminalOutput("a\x1bXhidden \x1b\\b").text).toBe("ab");
  });

  it("drops an escape sequence that never terminates and resumes after it", () => {
    expect(feed(["ok\x1b]", "x".repeat(200), "\nafter"]).text).toBe("ok\nafter");
  });

  it("drops oversized complete escape sequences without parsing their parameters", () => {
    expect(normalizeTerminalOutput(`before\x1b[${"31;".repeat(100_000)}mafter`).text).toBe(
      "beforeafter",
    );
  });
});

describe("appendTerminalOutput edge cases from review", () => {
  it("reads colon-form true colour with or without a colour-space id", () => {
    const red = normalizeTerminalOutput("\x1b[38:2::255:0:0mR").text;
    expect(red).toBe("\x1b[0;38;2;255;0;0mR\x1b[0m");
    expect(normalizeTerminalOutput("\x1b[38:2:0:255:0:0mR").text).toBe(red);
  });

  it("clears only scrollback on ESC[3J", () => {
    const lines = Array.from({ length: 70 }, (_, index) => `line ${index}`).join("\n");
    const state = feed([lines, "\x1b[3J"]);
    expect(state.text.startsWith("line 6\n")).toBe(true);
    expect(state.text.endsWith("line 69")).toBe(true);
    expect(state.truncated).toBe(true);
  });

  it("keeps the whole window within the tail when every line is long", () => {
    const long = `${"x".repeat(900)}\n`;
    const state = feed([long.repeat(64)], 4_096);
    const windowChars = state.screen.lines.reduce(
      (total, line) => total + line.reduce((sum, run) => sum + run.text.length, 0),
      0,
    );
    expect(windowChars).toBeLessThanOrEqual(4_096);
    expect(state.text.length).toBeLessThanOrEqual(4_096);
  });

  it("bounds long lines below a cursor that moved up", () => {
    const long = `${"x".repeat(900)}\n`;
    const state = feed([long.repeat(63), "\x1b[63A"], 4_096);
    const windowChars = state.screen.lines.reduce(
      (total, line) => total + line.reduce((sum, run) => sum + run.text.length, 0),
      0,
    );
    expect(windowChars).toBeLessThanOrEqual(2 * 4_096);
  });
});

describe("appendTerminalOutput under adversarial output", () => {
  it("gives the same result however the output is split into chunks", () => {
    const input = "abcdef\rX\x1b[31mred\x1b[0m\nnext line\r\x1b[2Kdone\n";
    const whole = feed([input], 3).text;
    for (let cut = 1; cut < input.length; cut += 1) {
      expect(feed([input.slice(0, cut), input.slice(cut)], 3).text).toBe(whole);
    }
    expect(feed(["abcdef", "\rX"], 3).text).toBe(feed(["abcdef\rX"], 3).text);
  });

  it("handles a colour change on every character in linear time", () => {
    const chunk = Array.from({ length: 200_000 }, (_, index) =>
      index % 2 === 0 ? "\x1b[31mx" : "\x1b[32my",
    ).join("");
    const started = performance.now();
    const state = appendTerminalOutput(EMPTY_TERMINAL_OUTPUT, chunk);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(terminalOutputPlainText(state.text).length).toBeLessThanOrEqual(64 * 1024);
  });

  it("keeps scrollback bounded while a single huge chunk scrolls", () => {
    const state = appendTerminalOutput(
      EMPTY_TERMINAL_OUTPUT,
      "line of log output\n".repeat(200_000),
      4_096,
    );
    expect(state.screen.settled.length).toBeLessThanOrEqual(2 * 4_096);
    expect(state.truncated).toBe(true);
  });
});

describe("terminal cursor state", () => {
  it("restores a saved cursor across chunks", () => {
    expect(feed(["abc\x1b7def", "\x1b8X"]).text).toBe("abcXef");
  });

  it("survives a huge cursor move without throwing", () => {
    expect(() => normalizeTerminalOutput("a\x1b[999999999999Cb")).not.toThrow();
  });
});

describe("terminalOutputTail", () => {
  it("never begins on a lone low surrogate", () => {
    const text = `${"a".repeat(10)}😀${"b".repeat(4)}`;
    const tail = terminalOutputTail(text, 5);
    expect(tail.text).toBe("bbbb");
  });

  it("never splits a colour code and keeps the colour in force when cutting a line", () => {
    const text = `\x1b[0;32m${"g".repeat(100)}\x1b[0m`;
    const cut = terminalOutputTail(text, 32).text;
    expect(cut.length).toBeLessThanOrEqual(32);
    expect(cut.startsWith("\x1b[0;32m")).toBe(true);
    expect(terminalOutputPlainText(cut)).toMatch(/^g+$/u);
  });

  it("includes restored colour codes in the output budget", () => {
    const state = normalizeTerminalOutput(`\x1b[31m${"x".repeat(70_000)}`);
    expect(state.truncated).toBe(true);
    expect(state.text.length).toBeLessThanOrEqual(64 * 1024);
    expect(terminalOutputPlainText(state.text)).toMatch(/^x+$/u);
  });
});

describe("terminalOutputSpans", () => {
  it("resolves standard, 256-colour and true-colour codes against the palette", () => {
    const text = normalizeTerminalOutput(
      "\x1b[31mred\x1b[0m \x1b[1;38;5;196mhot\x1b[0m \x1b[38;2;1;2;3mrgb\x1b[0m",
    ).text;
    expect(terminalOutputSpans(text, TERMINAL_PALETTES.dark)).toEqual([
      { text: "red", style: { color: TERMINAL_PALETTES.dark[1] } },
      { text: " ", style: null },
      { text: "hot", style: { color: "rgb(255,0,0)", fontWeight: "600" } },
      { text: " ", style: null },
      { text: "rgb", style: { color: "rgb(1,2,3)" } },
    ]);
  });

  it("keeps text on a coloured background readable on either palette", () => {
    // "PASS" badge: black on green; "FAIL" badge: grey-white on red.
    const text = normalizeTerminalOutput("\x1b[30;42m PASS \x1b[0m\x1b[1;37;41m FAIL \x1b[0m").text;
    for (const palette of [TERMINAL_PALETTES.light, TERMINAL_PALETTES.dark]) {
      for (const span of terminalOutputSpans(text, palette)) {
        expect(span.style?.color === undefined).toBe(false);
      }
    }
    const [pass, fail] = terminalOutputSpans(text, TERMINAL_PALETTES.light);
    expect(pass?.style?.color).toBe("#ffffff");
    expect(fail?.style?.color).toBe("#ffffff");
  });

  it("collapses the rest into plain text past the span limit", () => {
    const text = normalizeTerminalOutput("\x1b[31mx\x1b[32my".repeat(50)).text;
    const spans = terminalOutputSpans(text, TERMINAL_PALETTES.light, 10);
    expect(spans.length).toBe(11);
    expect(spans.at(-1)?.style).toBeNull();
    expect(spans.map((span) => span.text).join("")).toBe("xy".repeat(50));
  });
});
