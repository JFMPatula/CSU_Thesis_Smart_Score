import { useToast } from 'vue-toastification';
import { useAuthUserStore } from '@/stores/authUser';
import { useUserPagesStore } from '@/stores/pages';
import { navigationConfig, getPermissionForRoute, type NavigationGroup, type NavigationItem } from '@/utils/navigation';
import type { RouteLocationNormalized, NavigationGuardNext, Router } from 'vue-router';
import { ref, computed, watch } from 'vue';

/**
 * User permissions functionality merged from useUserPermissions composable
 */
export const useUserPermissions = () => {
  const authStore = useAuthUserStore()
  const pagesStore = useUserPagesStore()

  const userAccessiblePages = ref<string[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Get current user's role ID
  const userRoleId = computed(() => authStore.userData?.role_id || authStore.userData?.user_metadata?.role)

  // Fetch accessible pages for the current user's role
  const fetchUserAccessiblePages = async () => {
    if (!userRoleId.value) {
      userAccessiblePages.value = []
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const rolePages = await pagesStore.fetchRolePagesByRoleId(userRoleId.value)
      userAccessiblePages.value = rolePages.map(rolePage => rolePage.pages).filter(Boolean) as string[]
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch user permissions'
      userAccessiblePages.value = []
    } finally {
      isLoading.value = false
    }
  }

  // Check if user has access to a specific route
  const hasAccessToRoute = (route: string): boolean => {
    // If no role ID, no access to any route
    if (!userRoleId.value) {
      return false
    }

    // Always allow access to account pages (base user functionality)
    if (route.startsWith('/account/')) {
      return true
    }

    // Account-only routes that are not explicitly permission-gated
    const requiredPermissions = getPermissionForRoute(route)
    if (requiredPermissions.length === 0) {
      return true
    }

    return requiredPermissions.some(permission => userAccessiblePages.value.includes(permission))
  }

  // Check if user has access to any route in a group
  const hasAccessToGroup = (group: NavigationGroup): boolean => {
    // If no role ID, no access
    if (!userRoleId.value) {
      return false
    }

    // Check if any child in the group is accessible
    return group.children.some(child => hasAccessToRoute(child.route))
  }

  // Filter navigation items based on user permissions
  const getFilteredNavigationItems = (items: NavigationItem[]): NavigationItem[] => {
    return items.filter(item => hasAccessToRoute(item.route))
  }

  // Filter navigation groups based on user permissions
  const getFilteredNavigationGroups = (): NavigationGroup[] => {
    if (!userRoleId.value) {
      // If no role, return empty array (no navigation items)
      return []
    }

    return navigationConfig
      .map(group => ({
        ...group,
        children: getFilteredNavigationItems(group.children)
      }))
      .filter(group => group.children.length > 0) // Only show groups that have accessible children
  }

  // Watch for role changes and refetch permissions
  watch(
    () => userRoleId.value,
    (newRoleId) => {
      if (newRoleId) {
        fetchUserAccessiblePages()
      } else {
        userAccessiblePages.value = []
      }
    },
    { immediate: true }
  )

  return {
    userAccessiblePages,
    isLoading,
    error,
    userRoleId,
    hasAccessToRoute,
    hasAccessToGroup,
    getFilteredNavigationItems,
    getFilteredNavigationGroups,
    fetchUserAccessiblePages
  }
}

/**
 * Authentication and role-based page access guard
 */
export const authGuard = async (to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext) => {
  const isLoggedIn = localStorage.getItem("access_token") !== null;
  const publicPages = ["/", "/auth"];
  const isStudentQuizPage = to.path.startsWith("/student/quiz/");
  const toast = useToast();

  // If user is not authenticated and trying to access protected page
  if (to.meta.requiresAuth && !isLoggedIn) {
    /* toast.error("Authentication is required to access this page."); */
    return next("/auth");
  }

  // If user is authenticated and trying to access public/auth pages (except student quiz), redirect to dashboard
  if (isLoggedIn && publicPages.includes(to.path) && !isStudentQuizPage) {
    /*  toast.info("You are already logged in. Redirecting to home."); */
    return next("/account/home");
  }

  // Check role-based page access for authenticated users on protected routes
  if (isLoggedIn && to.meta.requiresAuth && !to.path.startsWith("/account/")) {
    try {
      const authStore = useAuthUserStore();
      const pagesStore = useUserPagesStore();

      // Get current user data to access role ID from metadata
      const currentUserResult = await authStore.getCurrentUser();

      if (currentUserResult.user) {
        const userRoleId = currentUserResult.user.user_metadata?.role;

        if (userRoleId) {
          console.log('Checking page access for role ID:', userRoleId);
          console.log('Requested path:', to.path);

          // Fetch pages accessible by this role
          const rolePages = await pagesStore.fetchRolePagesByRoleId(userRoleId);

          if (rolePages && rolePages.length > 0) {
            // Determine required permissions for the requested path
            const requiredPermissions = getPermissionForRoute(to.path)
            const allowedPages = rolePages.map(rolePage => rolePage.pages).filter(Boolean) as string[]
            const isPageAllowed = requiredPermissions.length === 0 || requiredPermissions.some(permission => allowedPages.includes(permission))

            console.log('Allowed pages for role:', allowedPages);
            console.log('Required permissions for path:', requiredPermissions);
            console.log('Is page allowed:', isPageAllowed);

            if (!isPageAllowed) {
              console.log('Access denied for path:', to.path, 'Role ID:', userRoleId);
              return next("/forbidden"); // Redirect to forbidden page if access denied
            }
          } else {
            // No pages defined for this role - redirect to forbidden page
            console.log('No pages configured for role ID:', userRoleId);
            return next("/forbidden");
          }
        } else {
          console.log('No role ID found in user metadata - denying access to protected pages');
          // If no role ID (null or undefined), deny access to protected pages
          return next("/forbidden");
        }
      }
    } catch (error) {
      console.error('Error checking role-based page access:', error);
      // Continue with navigation if there's an error to avoid blocking the user
    }
  }

  next();
};

/**
 * Error handler for router errors, particularly dynamic import failures
 */
export const errorHandler = (err: any, to: RouteLocationNormalized) => {
  if (err?.message?.includes?.("Failed to fetch dynamically imported module")) {
    if (!localStorage.getItem("vuetify:dynamic-reload")) {
      console.log("Reloading page to fix dynamic import error");
      localStorage.setItem("vuetify:dynamic-reload", "true");
      location.assign(to.fullPath);
    } else {
      console.error("Dynamic import error, reloading page did not fix it", err);
    }
  } else {
    console.error(err);
  }
};

/**
 * Setup guards for the router instance
 */
export const setupGuards = (router: Router) => {
  // Setup navigation guard
  router.beforeEach(authGuard);

  // Setup error handler
  router.onError(errorHandler);

  // Setup ready handler to clean up dynamic reload flag
  router.isReady().then(() => {
    localStorage.removeItem("vuetify:dynamic-reload");
  });
};
