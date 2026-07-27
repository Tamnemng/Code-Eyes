// Fixture: nhánh ngầm (?. , ?? , && , ||).
// Giai đoạn 1 KHÔNG mô hình hoá -> node giữ nguyên nhưng confidence "unknown"
// và phải có warning, tuyệt đối không im lặng.

export function nameOf(user: { profile?: { name?: string } } | null): string {
  const name = user?.profile?.name;
  const upper = String(name).toUpperCase();
  return upper;
}

export function displayName(user: { name?: string } | null): string {
  const raw = user && user.name;
  const shown = raw ?? "anonymous";
  const fallback = shown || "unknown";
  return fallback;
}
