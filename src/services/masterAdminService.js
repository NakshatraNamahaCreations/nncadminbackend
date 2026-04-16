import axios from "axios";

const API_BASE =
  import.meta?.env?.VITE_API_BASE_URL || "http://localhost:5000";

export const getMasterAdminDashboard = async () => {
  try {
    const token = localStorage.getItem("nnc_token");

    const response = await axios.get(`${API_BASE}/api/master-admin/dashboard`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return response.data;
  } catch (error) {
    console.error("getMasterAdminDashboard error:", error);
    throw error;
  }
};

export const createMasterAdminUser = async (payload) => {
  try {
    const token = localStorage.getItem("nnc_token");

    const response = await axios.post(
      `${API_BASE}/api/master-admin/users`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error("createMasterAdminUser error:", error);
    throw error;
  }
};

export const updateMasterAdminUser = async (id, payload) => {
  try {
    const token = localStorage.getItem("nnc_token");

    const response = await axios.put(
      `${API_BASE}/api/master-admin/users/${id}`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error("updateMasterAdminUser error:", error);
    throw error;
  }
};

export const deleteMasterAdminUser = async (id) => {
  try {
    const token = localStorage.getItem("nnc_token");

    const response = await axios.delete(
      `${API_BASE}/api/master-admin/users/${id}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    console.error("deleteMasterAdminUser error:", error);
    throw error;
  }
};