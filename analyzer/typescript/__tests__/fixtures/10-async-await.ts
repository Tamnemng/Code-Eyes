// Fixture: async/await. `await` là statement thường, KHÔNG tạo nhánh.
// `load` khai báo ở top-level nên không bị coi là hàm lồng.

declare function load(ids: string[]): AsyncIterable<{ size: number }>;

export async function fetchLabel(id: string): Promise<string> {
  const url = "/api/" + id;
  const res = await fetch(url);
  const data = await res.json();
  if (data.kind === "ok") {
    return data.label;
  }
  return "none";
}

export async function sumAll(ids: string[]): Promise<number> {
  let total = 0;
  for await (const chunk of load(ids)) {
    total += chunk.size;
  }
  return total;
}
