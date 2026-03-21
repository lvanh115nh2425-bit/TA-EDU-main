// js/core/menu_toggle.js
// Toggle menu cho header TA-Edu (d?i header s?n s�ng, overlay, ESC, resize, active link)
const READY_EVENT = "taedu:header:ready";

function initMenuToggle() {
  const btn = document.querySelector("#menuToggle, [data-menu-toggle]");
  const nav = document.querySelector("#mainNav, [data-menu]");
  if (!btn || !nav) return;

  let overlay = document.getElementById("menuOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "menuOverlay";
    overlay.className = "menu-overlay";
    overlay.hidden = true;
    nav.parentElement?.appendChild(overlay);
  }

  const mq = window.matchMedia("(min-width: 992px)");

  const open  = () => { nav.classList.add("open");  btn.setAttribute("aria-expanded","true");  overlay.hidden = false;  document.body.classList.add("nav-open"); };
  const close = () => { nav.classList.remove("open"); btn.setAttribute("aria-expanded","false"); overlay.hidden = true;  document.body.classList.remove("nav-open"); };
  const toggle = () => (nav.classList.contains("open") ? close() : open());

  btn.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); toggle(); });
  overlay.addEventListener("click", close);
  document.addEventListener("click", e => { if (!nav.contains(e.target) && !btn.contains(e.target)) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });

  if (typeof mq.addEventListener === "function") mq.addEventListener("change", e => e.matches && close());
  else window.addEventListener("resize", () => { if (window.innerWidth >= 992) close(); });

  try {
    const normalize = (path) => {
      if (!path) return "index.html";
      const clean = path.replace(/\/+$/, "").replace(/^\/+/, "");
      return clean || "index.html";
    };
    const currentFull = normalize(location.pathname);
    const currentScope = location.pathname.replace(/\/+$/, "/").replace(/^\/+/, "/");

    nav.querySelectorAll("a[href]").forEach(a => {
      a.classList.remove("active");
      const scope = (a.dataset.activeScope || "").trim();
      if (scope) {
        const cleanScope = scope.replace(/\/+$/, "/").replace(/^\/+/, "/");
        if (cleanScope && currentScope.startsWith(cleanScope)) {
          a.classList.add("active");
          return;
        }
      }
      const url = new URL(a.href, location.origin);
      const target = normalize(url.pathname);
      if (target === currentFull) a.classList.add("active");
    });
  } catch {}
}

if (document.querySelector("#mainNav, [data-menu]")) initMenuToggle();
else document.addEventListener(READY_EVENT, initMenuToggle, { once: true });
