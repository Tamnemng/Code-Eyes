// Fixture: switch - có break, có default, có fallthrough, và switch nằm trong vòng lặp.

export function routeCode(code: string): string {
  let target = "";
  switch (code) {
    case "A":
      target = "alpha";
      break;
    case "B":
      target = "bravo";
      break;
    default:
      target = "other";
  }
  return target;
}

export function priorityOf(level: string): number {
  let score = 0;
  switch (level) {
    case "high":
    case "urgent":
      score = 10;
      break;
    case "low":
      score = 1;
    default:
      score += 100;
  }
  return score;
}

// switch KHÔNG có default: vẫn phải có nhánh "không case nào khớp".
export function flagOf(code: string): string {
  let flag = "off";
  switch (code) {
    case "on":
      flag = "on";
      break;
  }
  return flag;
}

// Fallthrough + filter: với clientCode = "A", thân của case "B" VẪN chạy.
// Giai đoạn 3 phải prune theo reachability, không phải theo nhãn case.
export function resolveClient(clientCode: string): string {
  let plan = "base";
  switch (clientCode) {
    case "A":
      plan = "alpha";
    case "B":
      plan = plan + "-shared";
      break;
    default:
      plan = "other";
  }
  return plan;
}

export function scanCodes(codes: string[]): number {
  let total = 0;
  for (const code of codes) {
    switch (code) {
      case "add":
        total += 1;
        break;
      default:
        total -= 1;
    }
    total *= 2;
  }
  return total;
}
