// Mind Map Builder with jsMind v0.8.5 - Stable & Simple
const STORAGE_KEY = "taedu:mindmap:data";
const containerId = "mindmapCanvas";
const toolbar = document.getElementById("mindmap-toolbar");
const exportBox = document.getElementById("mindmapExport");
const buttons = document.querySelectorAll("[data-action]");

// State
let jm = null;
let currentTheme = 0;
const themes = ["primary", "warning", "danger", "success", "info", "greensea", "nephrite", "belizehole", "wisteria", "asphalt"];

// Default mind map data
function defaultData() {
  return {
    meta: {
      name: "TA-Edu Mind Map",
      author: "TA-Edu",
      version: "1.0"
    },
    format: "node_tree",
    data: {
      id: "root",
      topic: "Ý tưởng chính",
      expanded: true,
      children: [
        {
          id: "branch-1",
          topic: "Mục tiêu",
          direction: "right",
          expanded: true,
          children: [
            { id: "branch-1-1", topic: "Ngắn hạn" },
            { id: "branch-1-2", topic: "Dài hạn" }
          ]
        },
        {
          id: "branch-2",
          topic: "Kiến thức",
          direction: "right",
          expanded: true,
          children: [
            { id: "branch-2-1", topic: "Lý thuyết" },
            { id: "branch-2-2", topic: "Thực hành" }
          ]
        },
        {
          id: "branch-3",
          topic: "Kỹ năng",
          direction: "left",
          expanded: true,
          children: []
        }
      ]
    }
  };
}

// Load data from localStorage
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const data = JSON.parse(raw);
    if (!data || !data.format || !data.data) return defaultData();
    return data;
  } catch (err) {
    console.warn("Mind map load error:", err);
    return defaultData();
  }
}

// Save data to localStorage
function saveData() {
  if (!jm) return;
  try {
    const data = jm.get_data("node_tree");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    console.log("Mind map saved");
  } catch (err) {
    console.warn("Mind map save error:", err);
  }
}

// Initialize the mind map
function initMindmap() {
  try {
    // Check if jsMind is loaded
    if (typeof jsMind === 'undefined') {
      toolbar.textContent = "Lỗi: jsMind chưa được tải";
      console.error("jsMind library not loaded");
      return;
    }

    const options = {
      container: containerId,
      theme: themes[currentTheme],
      editable: true,
      view: {
        hmargin: 100,
        vmargin: 50,
        line_width: 2,
        line_color: '#cbd5e1',
        draggable: true,
        hide_scrollbars_when_draggable: true
      },
      layout: {
        hspace: 100,
        vspace: 10,
        pspace: 15
      },
      shortcut: {
        enable: true,
        handles: {},
        mapping: {
          addchild: 45,    // Insert
          addbrother: 13,  // Enter
          editnode: 113,   // F2
          delnode: 46,     // Delete
          toggle: 32       // Space
        }
      }
    };

    jm = new jsMind(options);
    
    const data = loadData();
    jm.show(data);
    
    // Auto-save on any change
    jm.add_event_listener(function(type, data) {
      saveData();
      if (type === 1) { // select_node
        toolbar.textContent = `Đã chọn: "${data.topic}"`;
      }
    });

    toolbar.textContent = "Click vào node để chọn • Kéo thả để di chuyển • Đã sẵn sàng!";
    
  } catch (err) {
    console.error("Init error:", err);
    toolbar.textContent = "Lỗi khởi tạo: " + err.message;
  }
}

// Get selected node
function getSelectedNode() {
  const node = jm.get_selected_node();
  if (!node) {
    alert("Vui lòng chọn một node trên sơ đồ trước.");
    return null;
  }
  return node;
}

// Add child node
function addChildNode() {
  const node = getSelectedNode();
  if (!node) return;

  const topic = prompt("Nhập tên nhánh con:", "Nhánh mới");
  if (!topic) return;

  const newId = `node-${Date.now()}`;
  jm.add_node(node, newId, topic);
  saveData();
}

// Add sibling node
function addSiblingNode() {
  const node = getSelectedNode();
  if (!node) return;

  if (node.id === "root") {
    alert("Node gốc không thể thêm nhánh cùng cấp. Vui lòng dùng 'Nhánh con'.");
    return;
  }

  const topic = prompt("Nhập tên nhánh cùng cấp:", "Nhánh mới");
  if (!topic) return;

  const newId = `node-${Date.now()}`;
  jm.add_node(node.parent, newId, topic, node.index + 1);
  saveData();
}

// Edit node
function editNode() {
  const node = getSelectedNode();
  if (!node) return;

  const newTopic = prompt("Nhập tên mới:", node.topic);
  if (!newTopic) return;

  jm.update_node(node.id, newTopic);
  saveData();
  toolbar.textContent = `Đã đổi tên thành: "${newTopic}"`;
}

// Delete node
function deleteNode() {
  const node = getSelectedNode();
  if (!node) return;

  if (node.id === "root") {
    alert("Không thể xóa node gốc.");
    return;
  }

  if (!confirm(`Xóa "${node.topic}" và tất cả nhánh con?`)) return;

  jm.remove_node(node.id);
  saveData();
  toolbar.textContent = "Node đã xóa";
}

// Zoom functions
function zoomIn() {
  if (!jm) return;
  jm.view.zoom_in();
}

function zoomOut() {
  if (!jm) return;
  jm.view.zoom_out();
}

function centerView() {
  if (!jm) return;
  jm.view.reset();
}

// Theme
function resetTheme() {
  currentTheme = (currentTheme + 1) % themes.length;
  if (!jm) return;
  jm.set_theme(themes[currentTheme]);
}

// Export/Import
function exportJSON() {
  if (!jm) return;
  const data = jm.get_data("node_tree");
  exportBox.value = JSON.stringify(data, null, 2);
  exportBox.select();
}

function importJSON() {
  const raw = prompt("Dán JSON mind map vào đây:");
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    
    // Validate structure
    if (!data.format || !data.data) {
      throw new Error("JSON phải có 'format' và 'data'");
    }
    
    jm.show(data);
    saveData();
    alert("Nhập thành công!");
  } catch (err) {
    alert("JSON không hợp lệ: " + err.message);
  }
}

function resetMap() {
  if (!confirm("Xóa toàn bộ sơ đồ và khởi tạo lại?")) return;
  
  localStorage.removeItem(STORAGE_KEY);
  jm.show(defaultData());
  saveData();
  toolbar.textContent = "Đã reset mind map";
}

// Action mappings
const ACTIONS = {
  "add-child": addChildNode,
  "add-sibling": addSiblingNode,
  "edit-node": editNode,
  "delete-node": deleteNode,
  "zoom-in": zoomIn,
  "zoom-out": zoomOut,
  "center": centerView,
  "reset-theme": resetTheme,
  "export-json": exportJSON,
  "import-json": importJSON,
  "reset-map": resetMap
};

// Bind button actions
buttons.forEach(btn => {
  const action = btn.dataset.action;
  if (!action || !ACTIONS[action]) return;
  btn.addEventListener("click", ACTIONS[action]);
});

// Initialize on load
document.addEventListener("DOMContentLoaded", () => {
  // Wait for jsMind to load with retry
  let retryCount = 0;
  const maxRetries = 20;
  
  function tryInit() {
    if (typeof jsMind !== 'undefined') {
      console.log("jsMind loaded successfully!");
      initMindmap();
    } else {
      retryCount++;
      if (retryCount < maxRetries) {
        toolbar.textContent = `Đang tải jsMind... (${retryCount}/${maxRetries})`;
        console.log(`Waiting for jsMind... attempt ${retryCount}`);
        setTimeout(tryInit, 500);
      } else {
        toolbar.textContent = "Lỗi: Không thể tải jsMind. Vui lòng refresh lại trang.";
        console.error("jsMind failed to load after", maxRetries, "retries");
        console.error("Check console for network errors");
      }
    }
  }
  
  // Start trying after a short delay
  setTimeout(tryInit, 100);
});

// Handle window resize
window.addEventListener("resize", () => {
  if (jm) {
    jm.view.resize();
  }
});
