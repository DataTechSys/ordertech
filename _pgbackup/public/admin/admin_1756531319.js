<script>
// ---------- tiny DOM helpers ----------
const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

// ---------- panels / routing ----------
function showPanel(id) {
  $$(".panel").forEach(p => p.classList.remove("show"));
  const panel = document.getElementById(id);
  if (panel) panel.classList.add("show");
}

function activateNav(link) {
  $$(".menu a.menu-item").forEach(a => a.classList.remove("active"));
  if (link) link.classList.add("active");
  // breadcrumbs: last crumb = active label
  const label = link?.querySelector(".label")?.textContent?.trim() || "Admin";
  const crumb = $(".breadcrumbs .sep + span");
  if (crumb) crumb.textContent = label;
}

// handle clicks on any menu item with data-panel
function wirePanelNav() {
  $$(".menu a.menu-item[data-panel]").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const target = a.getAttribute("data-panel");
      showPanel(target);
      activateNav(a);
    });
  });
}

// ---------- collapsible sections ----------
function wireCollapsibles() {
  $$(".menu-section[data-section]").forEach(section => {
    const head = $(".menu-head", section);
    const body = $(".menu-body", section);
    if (!head || !body) return;

    head.addEventListener("click", () => {
      const expanded = head.getAttribute("aria-expanded") === "true";
      head.setAttribute("aria-expanded", String(!expanded));
      if (expanded) {
        body.setAttribute("hidden", "");
        head.querySelector(".chev").textContent = "▸";
      } else {
        body.removeAttribute("hidden");
        head.querySelector(".chev").textContent = "▾";
      }
    });
  });
}

// ---------- sidebar collapse / mobile ----------
function wireSidebar() {
  const app = $(".app");
  const sidebar = $("#sidebar");
  const collapseBtn = $("#sidebarCollapse");
  const mobileBtn = $("#mobileMenu");

  // desktop collapse (compact width)
  collapseBtn?.addEventListener("click", () => {
    app.classList.toggle("is-collapsed");
    sidebar.classList.toggle("collapsed");
  });

  // mobile overlay toggle
  mobileBtn?.addEventListener("click", () => {
    // reuse classes defined in CSS: .sidebar.overlay + .sidebar-dim
    if (!$("#sidebarDim")) {
      const dim = document.createElement("div");
      dim.id = "sidebarDim";
      dim.className = "sidebar-dim show";
      dim.addEventListener("click", () => {
        sidebar.classList.remove("overlay");
        dim.remove();
      });
      document.body.appendChild(dim);
    } else {
      $("#sidebarDim").remove();
    }
    sidebar.classList.toggle("overlay");
  });
}

// ---------- modal (Product) ----------
function wireProductModal() {
  const modalBackdrop = $("#productModal");
  const openBtn = $("#newProductBtn");
  const closeBtn = $("#productModalClose");
  const cancelBtn = $("#productModalCancel");
  const saveBtn = $("#productModalSave");

  const open = () => {
    modalBackdrop.classList.add("open");
    modalBackdrop.setAttribute("aria-hidden", "false");
  };
  const close = () => {
    modalBackdrop.classList.remove("open");
    modalBackdrop.setAttribute("aria-hidden", "true");
  };

  openBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  cancelBtn?.addEventListener("click", close);
  modalBackdrop?.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) close();
  });

  // stub: handle save
  saveBtn?.addEventListener("click", () => {
    // collect form data (you can send to your API)
    const data = {
      sku: $("#prodFormSku").value.trim(),
      name: $("#prodFormName").value.trim(),
      category: $("#prodFormCategory").value,
      price: parseFloat($("#prodFormPrice").value || "0"),
      imageUrl: $("#prodFormImageUrl").value.trim(),
      active: $("#prodFormActive").checked
    };
    console.log("Save product", data);
    close();
    toast("Product saved (stub). Hook me to the backend.");
  });
}

// ---------- toolbar / stubs ----------
function wireStubs() {
  // Tenants
  $("#refreshTenants")?.addEventListener("click", () => toast("Refreshing tenants…"));
  $("#createTenant")?.addEventListener("click", () => toast("Creating tenant…"));
  // Devices
  $("#claimDevice")?.addEventListener("click", () => toast("Claiming device…"));
  $("#saveLicense")?.addEventListener("click", () => toast("Saved license limit."));
  // Branches
  $("#addBranch")?.addEventListener("click", () => toast("Adding branch…"));
  $("#saveBranchLimit")?.addEventListener("click", () => toast("Saved branch limit."));
  // Domains
  $("#addDomain")?.addEventListener("click", () => toast("Adding domain…"));
  // Billing
  $("#saveLicenseBilling")?.addEventListener("click", () => toast("Saved billing license limit."));
  // Posters
  $("#refreshPosters")?.addEventListener("click", () => toast("Refreshing posters…"));
  // Messages
  $("#saveDisplay")?.addEventListener("click", () => toast("Display settings saved."));
  // Categories / Products
  $("#refreshCategories")?.addEventListener("click", () => toast("Refreshing categories…"));
  $("#refreshProducts")?.addEventListener("click", () => toast("Refreshing products…"));
  $("#deleteSelectedProducts")?.addEventListener("click", () => toast("Deleting selected products…"));
  $("#deleteSelectedCategories")?.addEventListener("click", () => toast("Deleting selected categories…"));
  // Auth
  $("#logoutBtn")?.addEventListener("click", () => toast("Logging out…"));
}

// ---------- simple toast using .toast styles ----------
let toastTimeout;
function toast(msg, ms = 1800) {
  let t = $("#_toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "_toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => (t.style.display = "none"), ms);
}

// ---------- initial state ----------
function init() {
  wirePanelNav();
  wireCollapsibles();
  wireSidebar();
  wireProductModal();
  wireStubs();

  // default: mark Dashboard as active
  const defaultLink = $("#navDashboard");
  if (defaultLink) {
    activateNav(defaultLink);
    showPanel(defaultLink.getAttribute("data-panel"));
  }

  // Fill some quick status placeholders (optional)
  $("#dbBrandName") && ($("#dbBrandName").textContent = "—");
  $("#dbTenantId") && ($("#dbTenantId").textContent = "—");
  $("#dbTenantName") && ($("#dbTenantName").textContent = "—");
}
document.addEventListener("DOMContentLoaded", init);
</script>
