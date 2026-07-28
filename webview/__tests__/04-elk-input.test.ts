import { describe, expect, it } from "vitest";

import { markBackEdges } from "../model/back-edges";
import { toDisplayGraph } from "../model/display-graph";
import { toElkGraph } from "../layout/elk-input";
import { defaultSettings } from "../settings";
import { loadGolden } from "./helpers/golden";

const NAMES = [
  "a-finally-fanout-shipOrder",
  "b-nested-regions-pipeline",
  "c-loops-scan",
  "c-loops-drain",
  "c-loops-bailOut",
  "d-confidence-route",
  "e-all-kinds-everything",
] as const;

function build(name: string) {
  return toElkGraph(markBackEdges(toDisplayGraph(loadGolden(name))));
}

describe("toElkGraph - số lượng và id", () => {
  it.each(NAMES)("%s: số node/edge khớp, id giữ nguyên", (name) => {
    const display = markBackEdges(toDisplayGraph(loadGolden(name)));
    const elk = toElkGraph(display);

    expect(elk.children ?? []).toHaveLength(display.nodes.length);
    expect(elk.edges ?? []).toHaveLength(display.edges.length);
    expect((elk.children ?? []).map((c) => c.id)).toEqual(display.nodes.map((n) => n.id));
  });

  it.each(NAMES)("%s: mỗi edge nối đúng cặp id, đúng một source và một target", (name) => {
    const display = markBackEdges(toDisplayGraph(loadGolden(name)));
    const elk = toElkGraph(display);

    expect((elk.edges ?? []).map((e) => `${e.sources.join()}->${e.targets.join()}`)).toEqual(
      display.edges.map((e) => `${e.from}->${e.to}`),
    );
    for (const e of elk.edges ?? []) {
      expect(e.sources).toHaveLength(1);
      expect(e.targets).toHaveLength(1);
    }
  });

  it("id edge là duy nhất, kể cả khi hai edge cùng cặp (from, to)", () => {
    // `label` phân biệt được hai edge cùng cặp, nhưng ELK cần id duy nhất bất kể vậy.
    for (const name of NAMES) {
      const elk = build(name);
      const ids = (elk.edges ?? []).map((e) => e.id);
      expect(new Set(ids).size, name).toBe(ids.length);
    }
  });
});

describe("toElkGraph - layout options", () => {
  it("layered + DOWN, không force-directed", () => {
    const options = build("c-loops-scan").layoutOptions ?? {};
    expect(options["elk.algorithm"]).toBe("layered");
    expect(options["elk.direction"]).toBe("DOWN");
  });

  it("cycle breaking là DEPTH_FIRST -> layout deterministic trên graph có chu trình", () => {
    // Mặc định của ELK phụ thuộc thứ tự duyệt; chốt cứng để cùng input cho cùng layout.
    expect(build("c-loops-scan").layoutOptions?.["elk.layered.cycleBreaking.strategy"]).toBe(
      "DEPTH_FIRST",
    );
  });

  it("mọi node có width/height - ELK không tự đoán kích thước hộ", () => {
    for (const child of build("e-all-kinds-everything").children ?? []) {
      expect(child.width, child.id).toBeGreaterThan(0);
      expect(child.height, child.id).toBeGreaterThan(0);
    }
  });

  it("label dài -> node rộng hơn; label rỗng -> node hẹp nhất", () => {
    const elk = build("a-finally-fanout-shipOrder");
    const byId = new Map((elk.children ?? []).map((c) => [c.id, c]));
    const exit = byId.get("n_2");
    const stmt = byId.get("n_3");
    if (exit === undefined || stmt === undefined) throw new Error("golden đã đổi id");
    expect(stmt.width).toBeGreaterThan(exit.width ?? 0);
    expect(exit.height).toBe(stmt.height);
  });

  it("edge có nhãn thì đặt kèm label có kích thước -> ELK chừa chỗ, nhãn không đè nhau", () => {
    const elk = build("c-loops-scan");
    const labelled = (elk.edges ?? []).filter((e) => (e.labels ?? []).length > 0);
    expect(labelled.length).toBeGreaterThan(0);
    for (const e of labelled) {
      const label = e.labels?.[0];
      expect(label?.text).toBeTruthy();
      expect(label?.width ?? 0).toBeGreaterThan(0);
      expect(label?.height ?? 0).toBeGreaterThan(0);
    }
    // Edge không nhãn (`label: null`) thì KHÔNG chừa chỗ vô ích.
    const unlabelled = (elk.edges ?? []).filter((e) => (e.labels ?? []).length === 0);
    expect(unlabelled.length).toBeGreaterThan(0);
  });
});

describe("toElkGraph - back edge", () => {
  it("cạnh ngược KHÔNG bị bỏ khỏi input của ELK", () => {
    const display = markBackEdges(toDisplayGraph(loadGolden("c-loops-scan")));
    const back = display.edges.filter((e) => e.isBackEdge);
    expect(back).toHaveLength(3);

    const pairs = new Set(
      (build("c-loops-scan").edges ?? []).map((e) => `${e.sources[0]}->${e.targets[0]}`),
    );
    for (const e of back) expect(pairs.has(`${e.from}->${e.to}`)).toBe(true);
  });

  it("id edge là `e_<index>` -> tầng vẽ tra lại được DisplayEdge, kể cả cờ isBackEdge", () => {
    // SEMANTICS §14.1 buộc renderer vẽ cạnh ngược theo kiểu quay lui. Thông tin đó KHÔNG
    // nhồi vào layoutOptions của ELK (side-channel mà ELK lặng lẽ bỏ qua): id edge đã là
    // ánh xạ xác định về `display.edges[index]`, nơi cờ đã có sẵn.
    const display = markBackEdges(toDisplayGraph(loadGolden("c-loops-scan")));
    const elk = toElkGraph(display);

    const recovered = (elk.edges ?? [])
      .filter((e) => display.edges[Number(e.id.slice("e_".length))]?.isBackEdge === true)
      .map((e) => `${e.sources[0]}->${e.targets[0]}`);
    const expected = display.edges
      .filter((e) => e.isBackEdge)
      .map((e) => `${e.from}->${e.to}`);

    expect(recovered).toEqual(expected);
    expect(recovered).toHaveLength(3);
  });
});

describe("toElkGraph - DisplaySettings đổi kích thước", () => {
  it("nodeScale to hơn -> node to hơn VÀ khoảng cách thưa hơn", () => {
    const display = markBackEdges(toDisplayGraph(loadGolden("c-loops-scan")));
    const small = toElkGraph(display, { ...defaultSettings(), nodeScale: 1 });
    const big = toElkGraph(display, { ...defaultSettings(), nodeScale: 2 });

    const firstSmall = (small.children ?? [])[0];
    const firstBig = (big.children ?? [])[0];
    expect(firstBig?.width ?? 0).toBeGreaterThan(firstSmall?.width ?? 0);
    expect(firstBig?.height ?? 0).toBeGreaterThan(firstSmall?.height ?? 0);

    // Node to mà khoảng cách giữ nguyên thì lại chật như cũ.
    const gap = (g: typeof small): number =>
      Number(g.layoutOptions?.["elk.layered.spacing.nodeNodeBetweenLayers"] ?? "0");
    expect(gap(big)).toBeGreaterThan(gap(small));
  });

  it("fontSize to hơn -> node rộng và cao hơn, chữ không tràn", () => {
    const display = markBackEdges(toDisplayGraph(loadGolden("c-loops-scan")));
    const normal = toElkGraph(display, { ...defaultSettings(), fontSize: 12 });
    const large = toElkGraph(display, { ...defaultSettings(), fontSize: 20 });

    const a = (normal.children ?? [])[0];
    const b = (large.children ?? [])[0];
    expect(b?.width ?? 0).toBeGreaterThan(a?.width ?? 0);
    expect(b?.height ?? 0).toBeGreaterThan(a?.height ?? 0);
  });

  it("edgeWidth và palette KHÔNG đổi input của ELK - chúng chỉ là CSS", () => {
    const display = markBackEdges(toDisplayGraph(loadGolden("c-loops-scan")));
    const base = toElkGraph(display, defaultSettings());
    const styled = toElkGraph(display, {
      ...defaultSettings(),
      edgeWidth: 4,
      palette: "contrast",
    });
    expect(JSON.stringify(styled)).toBe(JSON.stringify(base));
  });

  it("không truyền settings -> dùng mặc định", () => {
    const display = markBackEdges(toDisplayGraph(loadGolden("c-loops-scan")));
    expect(JSON.stringify(toElkGraph(display))).toBe(
      JSON.stringify(toElkGraph(display, defaultSettings())),
    );
  });
});

describe("toElkGraph - thuần", () => {
  it("không đột biến display graph", () => {
    const display = markBackEdges(toDisplayGraph(loadGolden("e-all-kinds-everything")));
    const before = JSON.stringify(display);
    toElkGraph(display);
    expect(JSON.stringify(display)).toBe(before);
  });

  it("cùng input -> cùng output (deterministic)", () => {
    expect(JSON.stringify(build("b-nested-regions-pipeline"))).toBe(
      JSON.stringify(build("b-nested-regions-pipeline")),
    );
  });
});
