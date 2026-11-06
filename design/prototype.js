/** Only changes text and modes in a design prototype. No data requests or calculations. */
const copy = {
  connectivity: {
    heading: "構造的なつながり",
    title: "つながりを読む",
    description: "地図上で植生候補と緑地パッチを調べる。現在表示しているのは画面の設計案です。",
    checklist: ["土地被覆の分類とその年", "4近傍・8近傍の違い", "出典・欠測・未検証の区別"]
  },
  scenario: {
    heading: "440条件を比較する",
    title: "条件を試す",
    description: "仮説の移動スケールや仮想的な植生減少率を変えて、構造的接続性の計算結果を比較するモードの設計。",
    checklist: ["移動スケール10種類（仮説）", "植生減少11段階・連結2方式・除去2規則", "予測確率ではないことを明示"]
  },
  threshold: {
    heading: "モデルの低下区間を読む",
    title: "急変区間を調べる",
    description: "モデル上でPCの低下が大きくなる区間を調べる。生態系の崩壊や絶滅を証明する画面ではありません。",
    checklist: ["最大低下区間と判定ルール", "他条件・研究範囲での安定性", "生態学的な閾値の実証は未完了"]
  },
  bridge: {
    heading: "仮想的な接続候補を比べる",
    title: "自然の橋を比較",
    description: "同じ400㎡の仮想的な植生追加を、440条件で比較するモードの設計。PC増分と緑地パッチの結合を区別します。",
    checklist: ["比較地点は同面積400㎡", "PCが増えた条件と、直接パッチが結合した条件", "地権・施工可能性・生物移動は未検証"]
  }
};
const tabs = [...document.querySelectorAll('[role="tab"][data-mode]')];
const pane = document.getElementById("details-panel");
const heading = document.getElementById("map-title");
const title = document.getElementById("pane-title");
const description = document.getElementById("pane-description");
const list = document.getElementById("pane-list");
function activate(mode, focus) {
  const data = copy[mode];
  if (!data) return;
  tabs.forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  pane.setAttribute("aria-labelledby", `tab-${mode}`);
  heading.textContent = data.heading;
  title.textContent = data.title;
  description.textContent = data.description;
  list.replaceChildren(...data.checklist.map((line) => {
    const element = document.createElement("li");
    element.textContent = line;
    return element;
  }));
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activate(tab.dataset.mode, false));
  tab.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();activate(tabs[(index + 1) % tabs.length].dataset.mode, true);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();activate(tabs[(index - 1 + tabs.length) % tabs.length].dataset.mode, true);
    } else if (event.key === "Home") {
      event.preventDefault();activate(tabs[0].dataset.mode, true);
    } else if (event.key === "End") {
      event.preventDefault();activate(tabs[tabs.length - 1].dataset.mode, true);
    }
  });
});
// The region chooser intentionally changes no results; no real study JSON is connected.
const region = document.getElementById("region");
region.addEventListener("change", () => {
  document.title = `ECO MIRROR 3.0｜${region.selectedOptions[0].textContent}（デザイン用・データ未接続）`;
});
