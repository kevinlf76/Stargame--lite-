
const $ = (selector) => document.querySelector(selector);

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

function showMessage(message, error = false) {
  const element = $("#message");
  if (!element) return;

  element.textContent = message;
  element.style.color = error ? "#ff7777" : "#e6c56b";
}

function renderUsers(users) {
  const tbody = $("#users");
  const count = $("#count");

  if (!tbody) return;

  tbody.replaceChildren();
  if (count) count.textContent = `${users.length} usuarios registrados`;

  users.forEach((user) => {
    const tr = document.createElement("tr");

    const values = [
      user.id,
      user.username,
      user.role,
      user.created_at || "—",
      user.last_login_at || "Nunca"
    ];

    values.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.appendChild(td);
    });

    const action = document.createElement("td");

    if (user.role !== "admin") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Eliminar";
      button.className = "danger";
      button.addEventListener("click", () => deleteUser(user.id));
      action.appendChild(button);
    } else {
      action.textContent = "Administrador";
    }

    tr.appendChild(action);
    tbody.appendChild(tr);
  });

  if (users.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "Todavía no hay usuarios.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
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

const createForm = $("#create-user");

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

const refreshButton = $("#refresh");

if (refreshButton) {
  refreshButton.addEventListener("click", loadUsers);
}

loadUsers();
