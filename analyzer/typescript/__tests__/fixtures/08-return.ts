// Fixture: nhiều return sớm ở nhiều vị trí -> nhiều edge tới exit.
// Kèm trường hợp code unreachable sau return.

export function validate(name: string, role: string): string {
  if (name === "") {
    return "no-name";
  }
  if (role === "") {
    return "no-role";
  }
  if (role === "admin") {
    return "admin-ok";
  }
  return "ok";
}

export function earlyBail(flag: string): void {
  if (flag === "stop") {
    return;
  }
  console.log("continuing");
}

export function withUnreachable(): string {
  return "first";
  console.log("never runs");
}
