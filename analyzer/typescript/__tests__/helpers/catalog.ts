import type { NodeMatcher } from "./graph";

export interface FixtureCase {
  file: string;
  /** Giá trị `FlowGraph.functionName` kỳ vọng (xem SEMANTICS §13). */
  fn: string;
  /**
   * Identifier dùng để đặt con trỏ trong fixture. Mặc định = `fn`.
   * Cần khai báo riêng khi tên hàm không xuất hiện nguyên văn trong source
   * (method của class, hàm ẩn danh, con trỏ nằm trong thân hàm lồng).
   */
  cursor?: string;
  /** Node cố ý unreachable (code sau return) - được miễn kiểm tra "phải có edge vào". */
  allowUnreachable?: NodeMatcher[];
}

export function cursorToken(testCase: FixtureCase): string {
  return testCase.cursor ?? testCase.fn;
}

/** Mọi cặp (fixture, hàm) của Giai đoạn 1. Test invariants chạy trên toàn bộ danh sách này. */
export const CATALOG: readonly FixtureCase[] = [
  { file: "01-linear.ts", fn: "computeTotal" },
  { file: "01-linear.ts", fn: "logOnly" },
  { file: "01-linear.ts", fn: "noop" },

  { file: "02-conditionals.ts", fn: "classifyPositive" },
  { file: "02-conditionals.ts", fn: "pickBranch" },
  { file: "02-conditionals.ts", fn: "grade" },

  { file: "03-ternary.ts", fn: "pickColor" },
  { file: "03-ternary.ts", fn: "pickSize" },
  { file: "03-ternary.ts", fn: "describeCount" },

  { file: "04-loops.ts", fn: "sumTo" },
  { file: "04-loops.ts", fn: "joinNames" },
  { file: "04-loops.ts", fn: "keysOf" },
  { file: "04-loops.ts", fn: "countdown" },
  { file: "04-loops.ts", fn: "atLeastOnce" },
  { file: "04-loops.ts", fn: "drainQueue" },

  { file: "05-break-continue.ts", fn: "firstBlocked" },
  { file: "05-break-continue.ts", fn: "findPair" },
  { file: "05-break-continue.ts", fn: "sumSkipping" },
  { file: "05-break-continue.ts", fn: "countRows" },

  { file: "06-switch.ts", fn: "routeCode" },
  { file: "06-switch.ts", fn: "priorityOf" },
  { file: "06-switch.ts", fn: "flagOf" },
  { file: "06-switch.ts", fn: "resolveClient" },
  { file: "06-switch.ts", fn: "scanCodes" },

  { file: "07-try-catch-finally.ts", fn: "parseSafely" },
  { file: "07-try-catch-finally.ts", fn: "loadValue" },
  { file: "07-try-catch-finally.ts", fn: "cleanup" },
  { file: "07-try-catch-finally.ts", fn: "tryOnlyCatch" },
  { file: "07-try-catch-finally.ts", fn: "nestedTry" },
  { file: "07-try-catch-finally.ts", fn: "rethrow" },

  { file: "08-return.ts", fn: "validate" },
  { file: "08-return.ts", fn: "earlyBail" },
  { file: "08-return.ts", fn: "withUnreachable", allowUnreachable: ['statement:console.log("never runs")'] },

  { file: "09-throw.ts", fn: "requireName" },
  { file: "09-throw.ts", fn: "firstOrThrow" },

  { file: "10-async-await.ts", fn: "fetchLabel" },
  { file: "10-async-await.ts", fn: "sumAll" },

  { file: "11-implicit-branches.ts", fn: "nameOf" },
  { file: "11-implicit-branches.ts", fn: "displayName" },

  { file: "12-nested-functions.ts", fn: "summarize" },

  { file: "13-condition-parsing.ts", fn: "routeClient" },
  { file: "13-condition-parsing.ts", fn: "canEdit" },
  { file: "13-condition-parsing.ts", fn: "isBlocked" },
  { file: "13-condition-parsing.ts", fn: "chainOrder" },

  // Dạng khai báo: functionName khác hẳn token đặt con trỏ (SEMANTICS §13)
  { file: "14-declaration-forms.ts", fn: "OrderService.constructor", cursor: "constructor" },
  { file: "14-declaration-forms.ts", fn: "OrderService.get label", cursor: "label" },
  { file: "14-declaration-forms.ts", fn: "OrderService.route", cursor: "route" },
  { file: "14-declaration-forms.ts", fn: "handlers.onSubmit", cursor: "onSubmit" },
  { file: "14-declaration-forms.ts", fn: "withCallback" },
  // con trỏ nằm TRONG thân arrow -> phân tích chính arrow đó
  { file: "14-declaration-forms.ts", fn: "(anonymous)", cursor: "insideCallback" },

  { file: "15-combined.ts", fn: "findFirst" },
  { file: "15-combined.ts", fn: "sumValid" },
  { file: "15-combined.ts", fn: "overridden" },
];
