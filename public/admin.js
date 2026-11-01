
const $ = (selector) => document.querySelector(selector);

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Ocurrió un error.");
  }

  return data;
}

function showMessage(message, isError = false) {
  const element = $("#admin-message");
  if (!element) return;

  element.textContent = message;
  element.dataset.type = isError ? "error" : "success";
}

function renderUsers(users) {
  const container = $("#users-list");
  if (!container) return;

  container.replaceChildren();

  if (!users || users.length === 0) {
    container.textContent = "Todavía no hay usuarios registrados.";
    return;
  }

  users.forEach((user) => {
    const item = document.createElement("div");
    item.className = "user-item";

    const info = document.createElement("span");
    info.textContent = `${user.username} — ${user.role || "usuario"}`;

    item.appendChild(info);

    if (user.role !== "admin") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Eliminar";
      button.addEventListener("click", () => deleteUser(user.id));
      item.appendChild(button);
    }

    container.appendChild(item);
  });
}

async function loadUsers() {
  try {
    const data = await api("/api/admin/users");
    renderUsers(data.users);
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function deleteUser(id) {
  if (!confirm("¿Seguro que querés eliminar este usuario?")) return;

  try {
    await api(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    showMessage("Usuario eliminado correctamente.");
    await loadUsers();
  } catch (error) {
    showMessage(error.message, true);
  }
}

const createForm = $("#create-user-form");

if (createForm) {
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = $("#new-username").value.trim();
    const password = $("#new-password").value;

    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });

      showMessage("Usuario creado correctamente.");
      createForm.reset();
      await loadUsers();
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

const logoutButton = $("#admin-logout-button");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST" });
      window.location.href = "/";
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

loadUsers();
