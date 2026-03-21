const STORAGE_KEY = "taedu:mindmap:jsmind";
const containerId = "mindmapCanvas";
const toolbar = document.getElementById("mindmap-toolbar");
const exportBox = document.getElementById("mindmapExport");
const buttons = document.querySelectorAll("[data-action]");

const THEMES = ["primary", "greensea", "nephrite", "asbestos", "warning"];
let currentThemeIndex = 0;
let jm = null;

function defaultData() {
  return {
    format: "node_tree",
    data: {
      id: "root",
      topic: "Ý tưởng chính",
      children: [
        { id: "branch-1", topic: "Mục tiêu", children: [] },
        { id: "branch-2", topic: "Kiến thức", children: [] },
      ],
    },
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return defaultData();
    return data;
  } catch (err) {
    console.warn("mindmap load error", err);
    return defaultData();
  }
}

function saveData() {
  if (!jm) return;
  try {
    const data = jm.get_data("node_tree");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn("mindmap save error", err);
  }
}

function initMindmap() {
  const options = {
    container: containerId,
    editable: true,
    theme: THEMES[currentThemeIndex],
    view: {
      draggable: true,
      hide_scrollbars_when_draggable: false,
    },
  };
  jm = new window.jsMind(options);
  jm.show(loadData());
  toolbar.textContent = "Chọn node để chỉnh sửa hoặc kéo thả tự do.";
  jm.add_event_listener(() => {
    saveData();
  });
}

function ensureNodeSelected() {
  const node = jm.get_selected_node();
  if (!node) {
    alert("Hãy chọn một node trên sơ đồ.");
    return null;
  }
  return node;
}

function addChildNode() {
  const selected = ensureNodeSelected();
  if (!selected) return;
  const topic = prompt("Tiêu đề nhánh con:");
  if (!topic) return;
  jm.add_node(selected, window.crypto.randomUUID(), topic);
}

function addSiblingNode() {
  const selected = ensureNodeSelected();
  if (!selected) return;
  if (!selected.parent) {
    alert("Node trung tâm không thể thêm nhánh cùng cấp.");
    return;
  }
  const topic = prompt("Tiêu đề nhánh cùng cấp:");
  if (!topic) return;
  jm.add_node(selected.parent, window.crypto.randomUUID(), topic);
}

function editNode() {
  const selected = ensureNodeSelected();
  if (!selected) return;
  const next = prompt("Tiêu đề mới:", selected.topic);
  if (!next) return;
  jm.update_node(selected.id, next);
}

function deleteNode() {
  const selected = ensureNodeSelected();
  if (!selected) return;
  if (!selected.parent) {
    alert("Không thể xóa node trung tâm.");
    return;
  }
  if (confirm("Xóa nhánh này và toàn bộ nhánh con?")) {
    jm.remove_node(selected.id);
  }
}

function zoomIn() {
  jm.view.zoomIn();
}

function zoomOut() {
  jm.view.zoomOut();
}

function resetTheme() {
  currentThemeIndex = (currentThemeIndex + 1) % THEMES.length;
  jm.set_theme(THEMES[currentThemeIndex]);
}

function centerView() {
  jm.view.reset();
}

function exportJSON() {
  const data = jm.get_data("node_tree");
  exportBox.value = JSON.stringify(data, null, 2);
}

function importJSON() {
  const raw = prompt("Dán JSON mind map tại đây:");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    jm.show(parsed);
    saveData();
  } catch (err) {
    alert("JSON không hợp lệ.");
  }
}

function resetMap() {
  if (!confirm("Xóa hoàn toàn sơ đồ và trở về mặc định?")) return;
  localStorage.removeItem(STORAGE_KEY);
  jm.show(defaultData());
}

const ACTIONS = {
  "add-child": addChildNode,
  "add-sibling": addSiblingNode,
  "edit-node": editNode,
  "delete-node": deleteNode,
  "zoom-in": zoomIn,
  "zoom-out": zoomOut,
  center: centerView,
  "reset-theme": resetTheme,
  "export-json": exportJSON,
  "import-json": importJSON,
  "reset-map": resetMap,
};

buttons.forEach((btn) => {
  const action = btn.dataset.action;
  if (!action || !ACTIONS[action]) return;
  btn.addEventListener("click", ACTIONS[action]);
});

document.addEventListener("DOMContentLoaded", () => {
  initMindmap();
});
