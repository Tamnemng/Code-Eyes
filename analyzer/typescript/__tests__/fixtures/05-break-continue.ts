// Fixture: break / continue, có label và không, trong vòng lặp lồng nhau.

export function firstBlocked(codes: string[]): string {
  let found = "none";
  for (const code of codes) {
    if (code === "skip") {
      continue;
    }
    if (code === "stop") {
      found = code;
      break;
    }
    found = "seen";
  }
  return found;
}

export function findPair(rows: string[][], target: string): string {
  let hit = "none";
  outer: for (const row of rows) {
    for (const cell of row) {
      if (cell === target) {
        hit = cell;
        break outer;
      }
      if (cell === "skip") {
        continue outer;
      }
      hit = "checked";
    }
    hit = "scanned";
  }
  return hit;
}

// continue TRẦN (không label) trong vòng lặp lồng: phải về vòng TRONG.
export function sumSkipping(rows: string[][]): number {
  let kept = 0;
  for (const row of rows) {
    for (const cell of row) {
      if (cell === "skip") {
        continue;
      }
      kept += 1;
    }
    kept += 100;
  }
  return kept;
}

export function countRows(rows: string[][]): number {
  let hits = 0;
  for (const row of rows) {
    for (const cell of row) {
      if (cell === "x") {
        break;
      }
      hits += 1;
    }
    hits += 10;
  }
  return hits;
}
