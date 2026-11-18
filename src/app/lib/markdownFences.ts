// Fenced code in Markdown, found the way the backend's Markdown and the live reply's renderer find
// it: a fence of three or more backticks or tildes indented at most three spaces opens a block,
// and a fence of the same character, at least as long and indented at most three spaces, closes it.

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

export const stripLeadingSpaces = (text: string): string => text.replace(/^ +/, '');
export const splitLinesKeepingEnds = (text: string): string[] =>
  text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

const countRepeated = (text: string, start: number, character: string): number => {
  let end = start;
  while (end < text.length && text[end] === character) end += 1;
  return end - start;
};

const isFenceClosingLine = (line: string, character: string, openingLength: number): boolean => {
  const stripped = stripLeadingSpaces(line);
  if (line.length - stripped.length > 3 || !stripped.startsWith(character)) return false;
  const closingLength = countRepeated(stripped, 0, character);
  return closingLength >= openingLength && stripped.slice(closingLength).trim() === '';
};

/** Each fenced code block of `text` as `[start, end)` offsets; an unclosed one runs to the end. */
export const fencedCodeRanges = (text: string): [number, number][] => {
  const ranges: [number, number][] = [];
  let fenceStart: number | undefined;
  let fenceCharacter: string | undefined;
  let openingLength = 0;
  let offset = 0;
  splitLinesKeepingEnds(text).forEach((line) => {
    if (fenceCharacter === undefined) {
      const fence = FENCE_OPEN.exec(line);
      if (fence && (fence[1]![0] === '~' || !line.slice(fence[0].length).includes('`'))) {
        fenceStart = offset;
        [fenceCharacter] = fence[1]!;
        openingLength = fence[1]!.length;
      }
    } else if (
      fenceStart !== undefined &&
      isFenceClosingLine(line, fenceCharacter, openingLength)
    ) {
      ranges.push([fenceStart, offset + line.length]);
      fenceStart = undefined;
      fenceCharacter = undefined;
    }
    offset += line.length;
  });
  if (fenceStart !== undefined) ranges.push([fenceStart, text.length]);
  return ranges;
};
