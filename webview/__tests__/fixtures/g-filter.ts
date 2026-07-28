// Fixture nguồn cho Giai đoạn 3. Mọi golden filter phải được sinh từ analyzer thật;
// không viết FlowGraph bằng tay vì rất dễ tạo topology mà analyzer không bao giờ emit.

declare function guard(): boolean;
declare function normalize(value: string): string;
declare function audit(value: string): void;
declare function work(value: string): void;

export function routeClient(clientCode: string, enabled: boolean): string[] {
  const steps = ["common:start"];

  switch (clientCode) {
    case "A":
      steps.push("branch:A");
    case "B":
      steps.push("fallthrough:A-or-B");
      break;
    case "C":
      try {
        steps.push("branch:C");
      } finally {
        steps.push("cleanup:C");
      }
      break;
    case "D":
      steps.push("branch:D");
      break;
    case "E":
      steps.push("branch:E");
      break;
    default:
      steps.push("branch:default");
  }

  // Boolean identifier không có `parsed`: filter phải giữ cả hai nhánh.
  if (enabled) {
    steps.push("unknown:true");
  } else {
    steps.push("unknown:false");
  }

  steps.push("common:end");
  return steps;
}

export function noDefault(clientCode: string): string {
  switch (clientCode) {
    case "A":
      return "A";
    case "B":
      return "B";
  }
  return "none";
}

export function complexSwitch(clientCode: string): string {
  switch (normalize(clientCode)) {
    case "A":
      return "A";
    case "B":
      return "B";
    default:
      return "other";
  }
}

export function asymmetric(clientCode: string): string {
  if (clientCode === "A" && guard()) {
    return "A-and-guard";
  }
  return "fallback";
}

export function throughFinally(clientCode: string): string {
  try {
    if (clientCode === "A") {
      return "A";
    }
    return "other";
  } finally {
    audit(clientCode);
  }
}

export function cyclic(clientCode: string, running: boolean): string {
  while (running) {
    if (clientCode === "A") {
      work("A");
    } else {
      work("other");
    }
    if (guard()) break;
  }
  return "done";
}

export function terminalLoop(clientCode: string): never {
  while (true) {
    if (clientCode === "A") {
      continue;
    }
    throw new Error("stop");
  }
}

export function withDeadCode(clientCode: string): string {
  if (clientCode === "A") {
    return "A";
  }
  return "other";
  work("unreachable");
}

export function operators(
  clientCode: string,
  region: string,
  tier: string,
  group: string,
): string {
  if (clientCode !== "A") return "not-a";
  if (region.startsWith("EU")) return "eu";
  if (["gold", "silver"].includes(tier)) return "member";
  if (group === "last") return "last";
  return "other";
}

export function compoundWarehouse(
  currentUser: { clientCode: string },
  whseid: string,
  ready: boolean,
): string {
  if (currentUser.clientCode === "SAINTGOBAIN" && whseid === "510" && ready) {
    return "matched";
  }
  return "fallback";
}

export function optionalClient(
  currentUser: { clientCode: string } | undefined,
): string {
  if (currentUser?.clientCode === "TTC") return "ttc";
  return "other";
}

enum ETaskType {
  RECEIVE_BY_LPN,
  RECEIVE_BY_UPC,
  UPDATE_RECEIPT_BY_UPC,
}

export function routeTask(data: { taskType: ETaskType }): string {
  switch (data.taskType) {
    case ETaskType.RECEIVE_BY_LPN:
      return "lpn";
    case ETaskType.RECEIVE_BY_UPC:
      return "upc";
    case ETaskType.UPDATE_RECEIPT_BY_UPC:
      return "update";
    default:
      return "other";
  }
}
