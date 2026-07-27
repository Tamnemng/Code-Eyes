// Fixture: throw không được bắt -> edge "exception" tới exit.

export function requireName(name: string): string {
  if (name === "") {
    throw new Error("name required");
  }
  return name;
}

export function firstOrThrow(items: string[]): string {
  for (const item of items) {
    if (item !== "") {
      return item;
    }
  }
  throw new Error("empty");
}
