// Fixture: if, if-else, else-if lồng nhau.

export function classifyPositive(n: number): string {
  const kind = "number";
  if (n > 0) {
    return "positive";
  }
  return "non-positive";
}

export function pickBranch(flag: string): string {
  let out = "";
  if (flag === "yes") {
    out = "accepted";
  } else {
    out = "rejected";
  }
  return out;
}

export function grade(score: number, bonus: string): string {
  if (score >= 90) {
    if (bonus === "gold") {
      return "A+";
    }
    return "A";
  } else if (score >= 80) {
    return "B";
  } else {
    return "C";
  }
}
