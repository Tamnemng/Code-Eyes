// Fixture: try / catch / finally.
// Điểm khó nhất: finally phải chạy trên MỌI đường thoát khỏi try,
// kể cả return sớm và throw.

export function parseSafely(raw: string): string {
  let out = "none";
  try {
    out = raw.trim();
  } catch (err) {
    out = "error";
  } finally {
    out = out + "!";
  }
  return out;
}

export function loadValue(raw: string): string {
  try {
    if (raw === "") {
      return "empty";
    }
    if (raw === "bad") {
      throw new Error("bad input");
    }
    return raw;
  } catch (err) {
    return "caught";
  } finally {
    console.log("done");
  }
}

export function cleanup(flag: string): string {
  try {
    if (flag === "boom") {
      throw new Error("boom");
    }
    return "ok";
  } finally {
    console.log("cleanup");
  }
}

// try/catch KHÔNG có finally.
export function tryOnlyCatch(raw: string): string {
  try {
    return raw.trim();
  } catch (err) {
    return "fallback";
  }
}

// try lồng try: throw trong catch TRONG phải bị bắt bởi catch NGOÀI,
// return trong try TRONG phải chạy finally của khối NGOÀI.
export function nestedTry(raw: string): string {
  try {
    try {
      return raw.trim();
    } catch (inner) {
      throw new Error("inner failed");
    }
  } catch (outer) {
    return "outer";
  } finally {
    console.log("both done");
  }
}

export function rethrow(raw: string): string {
  try {
    return raw.trim();
  } catch (err) {
    throw new Error("wrapped");
  } finally {
    console.log("closing");
  }
}
