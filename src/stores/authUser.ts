import { computed, ref } from "vue";
import type { Ref } from "vue";
import { defineStore } from "pinia";
import { useRouter } from "vue-router";
import { supabase } from "@/lib/supabase";

// Build an Authorization header from the current Supabase session so the
// serverless admin endpoints can verify the caller.
async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Map a Supabase auth user to the shape used throughout the UI.
function mapAuthUser(user: any): UserData {
  return {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
    user_metadata: user.user_metadata,
    app_metadata: user.app_metadata,
    full_name: user.user_metadata?.full_name,
    role_id: user.app_metadata?.role,
    status: user.app_metadata?.status,
  };
}

function isPendingApproval(user: any): boolean {
  return String(user?.app_metadata?.status || "").toLowerCase() === "pending";
}

function pendingApprovalError(): Error {
  return new Error(
    "Your account is awaiting administrator approval. You can sign in once an admin approves it.",
  );
}

function clearLocalSession(): void {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("auth_id");
}

interface UserData {
  id: string;
  email?: string;
  created_at?: string;
  user_metadata?: Record<string, any>;
  app_metadata?: Record<string, any>;
  full_name?: string;
  role_id?: number;
  role_title?: string;
  status?: string;
}

interface SessionUser {
  id: string;
  email?: string;
  user_metadata: Record<string, any>;
}

export const useAuthUserStore = defineStore("authUser", () => {
  // States
  const userData: Ref<UserData | null> = ref(null);
  const users: Ref<UserData[]> = ref([]);
  const authPages: Ref<string[]> = ref([]);
  const authBranchIds: Ref<number[]> = ref([]);
  const loading = ref(false);
  const router = useRouter();

  // Computed properties
  const isAuthenticated = computed(() => userData.value !== null);
  const userEmail = computed(() => userData.value?.email || null);
  const userName = computed(() => userData.value?.user_metadata?.full_name || userData.value?.email || null);
  const userRole = computed(() => userData.value?.app_metadata?.role || null);

 // Resolve the role title from the roles table for a given role ID
  async function fetchRoleTitle(roleId: number | null | undefined): Promise<string | undefined> {
    if (!roleId) return undefined;
    try {
      const { data, error } = await supabase
        .from("roles")
        .select("title")
        .eq("id", roleId)
        .maybeSingle();

      if (error || !data?.title) return undefined;
      return data.title;
    } catch (e) {
      return undefined;
    }
  }

  async function registerUser(
    email: string,
    password: string,
    username: string,
    roleId: number,

  ) {
    loading.value = true;
    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, fullName: username, roleId }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        return { error: new Error(payload?.error || `Request failed (${response.status})`) };
      }

      if (!payload?.user?.id) {
        return { error: new Error("Signup failed") };
      }

      return {
        data: { id: payload.user.id, email },
        needsEmailConfirmation: Boolean(payload.needsEmailConfirmation),
        needsApproval: Boolean(payload.needsApproval),
      };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error("Signup failed") };
    } finally {
      loading.value = false;
    }
  }

  async function signIn(email: string, password: string, rememberMe = false) {
    loading.value = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { error };
      }

      if (!data.session) {
        return { error: new Error("No session") };
      }

      const user = data.user;

      if (isPendingApproval(user)) {
        await supabase.auth.signOut();
        clearLocalSession();
        return { error: pendingApprovalError() };
      }

      localStorage.setItem("access_token", data.session.access_token);
      localStorage.setItem("refresh_token", data.session.refresh_token);
      localStorage.setItem("auth_id", user.id);

      // Resolve the actual role title from the database for this role ID
      const roleId = user.app_metadata?.role;
      const roleTitle = await fetchRoleTitle(roleId);

      if (!roleTitle) {
        console.error("Login blocked: no matching role found for role ID:", roleId);
        await supabase.auth.signOut();
        clearLocalSession();
        return { error: new Error("Your account role is not configured. Contact your administrator.") };
      }

      // Update the store's userData with Supabase user data only
      userData.value = {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        user_metadata: user.user_metadata,
        app_metadata: user.app_metadata,
        full_name: user.user_metadata?.full_name,
        role_id: roleId,
        role_title: roleTitle,
        status: user.app_metadata?.status,
      };

      return { user };
    } finally {
      loading.value = false;
    }
  }

  async function signOut() {
    loading.value = true;
    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        return { error };
      }

      // Clear local storage
      clearLocalSession();

      // Clear user data
      userData.value = null;

      // Redirect to home or login page
      router.push("/");

      return { success: true };
    } finally {
      loading.value = false;
    }
  }

  // Initialize auth state on store creation using getCurrentUser
  async function initializeAuth() {
    try {
      const result = await getCurrentUser();

      if (result.error || !result.user) {
        userData.value = null;
        return;
      }

      // Set user data from getCurrentUser result
      userData.value = result.user;
    } catch (error) {
      console.error("Error initializing auth:", error);
      userData.value = null;
    }
  }

  // Get user data by ID using Supabase API
  async function getUser(userId?: string) {
    loading.value = true;
    try {
      // Use the current user's ID if no userId is provided
      const targetUserId = userId || userData.value?.id;

      if (!targetUserId) {
        return { error: new Error("No user ID provided") };
      }

      const { data: { user }, error } = await supabase.auth.admin.getUserById(targetUserId);

      if (error) {
        return { error };
      }

      if (!user) {
        return { error: new Error("User not found") };
      }

      return {
        user: {
          id: user.id,
          email: user.email,
          created_at: user.created_at,
          user_metadata: user.user_metadata,
          app_metadata: user.app_metadata,
          full_name: user.user_metadata?.full_name,
          role_id: user.app_metadata?.role,
          status: user.app_metadata?.status,
        }
      };
    } catch (error) {
      console.error("Error fetching user:", error);
      return { error };
    } finally {
      loading.value = false;
    }
  }

  // Get current authenticated user
  async function getCurrentUser() {
    loading.value = true;
    try {
      const { data: { user }, error } = await supabase.auth.getUser();

      if (error) {
        return { error };
      }

      if (!user) {
        return { error: new Error("No authenticated user") };
      }

      if (isPendingApproval(user)) {
        await supabase.auth.signOut();
        clearLocalSession();
        return { error: pendingApprovalError() };
      }

      const userData: UserData = {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        user_metadata: user.user_metadata,
        app_metadata: user.app_metadata,
        full_name: user.user_metadata?.full_name,
        role_id: user.app_metadata?.role,
        status: user.app_metadata?.status,
      };

      return { user: userData };
    } catch (error) {
      console.error("Error fetching current user:", error);
      return { error };
    } finally {
      loading.value = false;
    }
  }

  // Get all users via the serverless admin endpoint
  async function getAllUsers(page = 1, perPage = 50) {
    loading.value = true;
    try {
      const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      const response = await fetch(`/api/admin-users?${params.toString()}`, {
        headers: await getAuthHeaders(),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(payload?.error || `Request failed (${response.status})`);
        console.error("Error fetching all users:", error);
        return { error };
      }

      if (!payload?.users) {
        return { error: new Error("No users data returned") };
      }

      // Map users to the expected format
      const mappedUsers: UserData[] = payload.users.map(mapAuthUser);

      // Store users in the reactive state
      users.value = mappedUsers;

      return { users: mappedUsers, pagination: payload.pagination };
    } catch (error) {
      console.error("Error fetching all users:", error);
      return { error };
    } finally {
      loading.value = false;
    }
  }

  // Delete user via the serverless admin endpoint
  async function deleteUser(userId: string) {
    loading.value = true;
    try {
      const response = await fetch(`/api/admin-users?id=${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: await getAuthHeaders(),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(payload?.error || `Request failed (${response.status})`);
        console.error("Error deleting user:", error);
        return { error };
      }

      // Remove user from local state
      users.value = users.value.filter(user => user.id !== userId);

      return { success: true };
    } catch (error) {
      console.error("Error deleting user:", error);
      return { error };
    } finally {
      loading.value = false;
    }
  }

  // Update user via the serverless admin endpoint
  async function updateUser(userId: string, updateData: {
    email?: string;
    phone?: string;
    password?: string;
    user_metadata?: Record<string, any>;
    app_metadata?: Record<string, any>;
  }) {
    loading.value = true;
    try {
      const response = await fetch(`/api/admin-users?id=${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: {
          ...(await getAuthHeaders()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateData),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(payload?.error || `Request failed (${response.status})`);
        console.error("Error updating user:", error);
        return { error };
      }

      if (!payload?.user) {
        return { error: new Error("No user data returned") };
      }

      // Update the user in local state
      const updatedUser: UserData = mapAuthUser(payload.user);

      const userIndex = users.value.findIndex(user => user.id === userId);
      if (userIndex !== -1) {
        users.value[userIndex] = updatedUser;
      }

      // If updating current user, update userData
      if (userId === userData.value?.id) {
        userData.value = updatedUser;
      }

      return { user: updatedUser };
    } catch (error) {
      console.error("Error updating user:", error);
      return { error };
    } finally {
      loading.value = false;
    }
  }

  // Call initialize on store creation
  initializeAuth();

  return {
    // State
    userData,
    users,
    authPages,
    authBranchIds,
    loading,

    // Computed
    isAuthenticated,
    userEmail,
    userName,
    userRole,

    // Actions
    registerUser,
    signIn,
    signOut,
    initializeAuth,
    getUser,
    getCurrentUser,
    getAllUsers,
    deleteUser,
    updateUser,
  };
});

// Utility function for logout (can be used independently)
export async function doLogout() {
  const authStore = useAuthUserStore();
  return await authStore.signOut();
}
