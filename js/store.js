// =========================================================
// NORDICA NUTRITION - Full-Stack API Data Client
// All pages fetch and query from PostgreSQL database APIs
// =========================================================

const NordicaStore = (() => {

  const get = async (key) => {
    try {
      const response = await fetch(`/api/${key}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error(`Error fetching ${key} from API:`, err);
      return [];
    }
  };

  const add = async (key, item) => {
    try {
      const response = await fetch(`/api/${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error(`Error saving ${key} to database:`, err);
      return null;
    }
  };

  const update = async (key, id, updates) => {
    try {
      const response = await fetch(`/api/${key}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error(`Error updating ${key} [${id}] in database:`, err);
      return null;
    }
  };

  const patch = async (key, id, updates) => {
    try {
      const response = await fetch(`/api/${key}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error(`Error partially updating ${key} [${id}] in database:`, err);
      return null;
    }
  };

  const remove = async (key, id) => {
    try {
      const response = await fetch(`/api/${key}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error(`Error deleting ${key} [${id}] from database:`, err);
      return null;
    }
  };

  // ---- Authentication client helpers ----
  const login = async (email, password) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Login failed');
      }
      const user = await response.json();
      localStorage.setItem('nordica-user', JSON.stringify(user));
      return { success: true, user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const register = async (name, email, phone, wilaya, password) => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, wilaya, password }),
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Registration failed');
      }
      const user = await response.json();
      localStorage.setItem('nordica-user', JSON.stringify(user));
      return { success: true, user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Unable to clear the server session:', err);
    } finally {
      localStorage.removeItem('nordica-user');
    }
  };

  const getCurrentUser = () => {
    try {
      const uStr = localStorage.getItem('nordica-user');
      return uStr ? JSON.parse(uStr) : null;
    } catch (e) {
      return null;
    }
  };

  const generateId = (prefix = 'id') => `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

  const today = () => new Date().toISOString().split('T')[0];

  const init = () => {
    console.log("NordicaStore database API client initialized.");
  };

  return { init, get, add, update, patch, remove, generateId, today, login, register, logout, getCurrentUser };
})();

// Auto-initialize
NordicaStore.init();
