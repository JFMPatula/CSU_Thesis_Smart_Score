//if supabase is applied use here

import { createClient } from '@supabase/supabase-js';
import { useToast } from 'vue-toastification';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

function syncAuthCookie(token: string | null) {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  if (token) {
    document.cookie = `sb-access-token=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=7200${secure}`;
  } else {
    document.cookie = `sb-access-token=; Path=/; SameSite=Lax; Max-Age=0${secure}`;
  }
}

supabase.auth.getSession().then(({ data }) => {
  syncAuthCookie(data.session?.access_token ?? null);
});

supabase.auth.onAuthStateChange((_event, session) => {
  syncAuthCookie(session?.access_token ?? null);
});

// NOTE: privileged admin operations (list/delete/update users) must NOT run in
// the browser with the service role key. They are handled by the serverless
// function at /api/admin-users instead.

export async function doLogout() {
    // Confirm logout
    const confirmed = window.confirm("Are you sure you want to logout?");

    // If not confirmed, exit the function early
    if (!confirmed) {
      return;
    }

    const toast = useToast();

    // Use the auth store's signOut method which handles everything properly
    const { useAuthUserStore } = await import('@/stores/authUser');
    const authStore = useAuthUserStore();

    const result = await authStore.signOut();

    if (result.error) {
      toast.error("Error during logout.");
      return;
    }

    toast.success("Logout Successfully!");
}
