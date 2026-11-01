
const $ = (selector) => document.querySelector(selector);

let authMode = "login";
let currentUser = null;
let selectedSection = "inicio";
let selectedCategory = "todos";
let searchTerm = "";

const modal = $("#auth-modal");
const authForm = $("#auth-form");

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Ocurrió un error.");
  }

  return data;
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove("hidden");

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 3500);
}

function showAuthMessage(message, error = false) {
  const element = $("#auth-message");
  if (!element) return;

  element.textContent = message;
  element.style.color = error ? "#ff7777" : "#e6c56b";
}

function openAuth(mode = "login") {
  authMode = mode;
  showAuthMessage("");

  $("#modal-title").textContent =
    mode === "register" ? "Crear tu cuenta" : "Ingresá a tu cuenta";

  $("#submit-auth").textContent =
    mode === "register" ? "Crear cuenta" : "Ingresar";

  $("#login-tab").classList.toggle("active", mode === "login");
  $("#register-tab").classList.toggle("active", mode === "register");

  $("#password-hint").classList.toggle("hidden", mode !== "register");

  $("#password").autocomplete =
    mode === "register" ? "new-password" : "current-password";

  modal.classList.remove("hidden");
}

function closeAuth() {
  modal.classList.add("hidden");
  authForm.reset();
  showAuthMessage("");
}

function updateAccountDisplay() {
  const loginButton = $("#header-login");
  const registerButton = $("#header-register");
  const userButton = $("#header-user");

  if (currentUser) {
    loginButton.classList.add("hidden");
    registerButton.classList.add("hidden");
    userButton.classList.remove("hidden");

    userButton.textContent = currentUser.username;
    userButton.onclick = async () => {
      if (currentUser.role === "admin") {
        window.location.href = "/admin.html";
        return;
      }

      if (confirm("¿Querés cerrar tu sesión?")) {
        try {
          await api("/api/logout", { method: "POST" });
          currentUser = null;
          updateAccountDisplay();
          showToast("Sesión cerrada correctamente.");
        } catch (error) {
          showToast(error.message);
        }
      }
    };

    if (currentUser.role === "admin") {
      userButton.title = "Abrir panel de administración";
    }
  } else {
    loginButton.classList.remove("hidden");
    registerButton.classList.remove("hidden");
    userButton.classList.add("hidden");
    userButton.textContent = "";
    userButton.onclick = null;
  }
}

async function refreshUser() {
  try {
    const data = await api("/api/me");
    currentUser = data.user || null;
    updateAccountDisplay();
  } catch (error) {
    currentUser = null;
    updateAccountDisplay();
  }
}

function renderGames() {
  const cards = [...document.querySelectorAll(".game-card")];
  let visibleCount = 0;

  cards.forEach((card) => {
    const name = (card.dataset.game || "").toLowerCase();
    const category = card.dataset.category || "";
    const section = card.dataset.section || "";

    const matchesSearch = name.includes(searchTerm);
    const matchesCategory =
      selectedCategory === "todos" || category === selectedCategory;

    let matchesSection = true;

    if (selectedSection === "populares" || selectedSection === "nuevos") {
      matchesSection = section === selectedSection;
    }

    const visible =
      matchesSearch && matchesCategory && matchesSection;

    card.classList.toggle("hidden", !visible);

    if (visible) visibleCount++;
  });

  $("#game-count").textContent =
    `${visibleCount} ${visibleCount === 1 ? "juego demo" : "juegos demo"}`;

  $("#empty-games").classList.toggle("hidden", visibleCount !== 0);

  if (searchTerm) {
    $("#catalog-title").textContent = "Resultados de búsqueda";
  } else if (selectedCategory !== "todos") {
    $("#catalog-title").textContent = "Juegos por categoría";
  } else if (selectedSection === "populares") {
    $("#catalog-title").textContent = "Juegos populares";
  } else if (selectedSection === "nuevos") {
    $("#catalog-title").textContent = "Nuevos juegos";
  } else if (selectedSection === "favoritos") {
    $("#catalog-title").textContent = "Favoritos";
  } else {
    $("#catalog-title").textContent = "Juegos destacados";
  }
}

function selectSection(section) {
  selectedSection = section;
  selectedCategory = "todos";

  document.querySelectorAll("[data-section]").forEach((button) => {
    button.classList.toggle(
      "selected",
      button.dataset.section === section
    );
  });

  document.querySelectorAll("[data-category]").forEach((button) => {
    button.classList.remove("selected");
  });

  renderGames();
}

function selectCategory(category) {
  selectedCategory = category;
  selectedSection = "inicio";

  document.querySelectorAll("[data-category]").forEach((button) => {
    button.classList.toggle(
      "selected",
      button.dataset.category === category
    );
  });

  document.querySelectorAll("[data-section]").forEach((button) => {
    button.classList.remove("selected");
  });

  renderGames();
}

if (authForm) {
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = $("#username").value.trim();
    const password = $("#password").value;

    const endpoint =
      authMode === "register" ? "/api/register" : "/api/login";

    try {
      $("#submit-auth").disabled = true;
      showAuthMessage("Procesando...");

      await api(endpoint, {
        method: "POST",
        body: JSON.stringify({ username, password })
      });

      await refreshUser();
      closeAuth();

      showToast(
        authMode === "register"
          ? "Cuenta creada correctamente."
          : "Sesión iniciada correctamente."
      );
    } catch (error) {
      showAuthMessage(error.message, true);
    } finally {
      $("#submit-auth").disabled = false;
    }
  });
}

$("#header-login").addEventListener("click", () => openAuth("login"));
$("#header-register").addEventListener("click", () => openAuth("register"));
$("#footer-login").addEventListener("click", () => openAuth("login"));
$("#banner-account").addEventListener("click", () => {
  if (currentUser) {
    showToast(`Sesión iniciada: ${currentUser.username}`);
  } else {
    openAuth("login");
  }
});
$("#strip-register").addEventListener("click", () => openAuth("register"));

$("#modal-close").addEventListener("click", closeAuth);

modal.addEventListener("click", (event) => {
  if (event.target === modal) closeAuth();
});

$("#login-tab").addEventListener("click", () => openAuth("login"));
$("#register-tab").addEventListener("click", () => openAuth("register"));

$("#banner-play").addEventListener("click", () => {
  $("#games").scrollIntoView({ behavior: "smooth" });
});

$("#search").addEventListener("input", (event) => {
  searchTerm = event.target.value.trim().toLowerCase();
  renderGames();
});

document.querySelectorAll("[data-section]").forEach((button) => {
  button.addEventListener("click", () => {
    selectSection(button.dataset.section);
  });
});

document.querySelectorAll("[data-category]").forEach((button) => {
  button.addEventListener("click", () => {
    selectCategory(button.dataset.category);
  });
});

document.querySelectorAll(".game-card").forEach((card) => {
  card.addEventListener("click", () => {
    showToast(`${card.dataset.game}: próximamente en modo demo.`);
  });
});

$("#mobile-menu").addEventListener("click", () => {
  $("#sidebar").classList.toggle("mobile-open");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAuth();
});

refreshUser();
renderGames();
