import { setupLayouts } from "virtual:generated-layouts";
import { createRouter, createWebHistory } from "vue-router";

import Hero from "@/pages/index.vue";
import Auth from "@/pages/Auth.vue";
import Dashboard from "@/pages/HomeView.vue";
import NotFound from "@/pages/NotFound.vue";
import ForbiddenView from "@/pages/ForbiddenView.vue";
import AdminUserRolesView from "@/pages/admin/AdminUserRolesView.vue";
import UserManagementView from "@/pages/admin/UserManagementView.vue";
import AnnouncementsView from "@/pages/admin/AnnouncementsView.vue";
import SettingsView from "@/pages/account/SettingsView.vue";
import MyResultsView from "@/pages/account/MyResultsView.vue";
import TeacherAnswerKeyView from "@/pages/teachertab/TeacherAnswerKeyView.vue";
import TeacherStudentsView from "@/pages/teachertab/TeacherStudentsView.vue";
import StudentView from "@/pages/student/StudentView.vue";

/**
 * Route definitions for the application
 */
const routes = setupLayouts([
  {
    path: "/",
    component: Hero,
  },
  {
    path: "/auth",
    component: Auth,
  },

  {
    path: "/account/home",
    component: Dashboard,
    meta: { requiresAuth: true },
  },
  {
    path: "/account/settings",
    component: SettingsView,
    meta: { requiresAuth: true },
  },
  {
    path: "/account/results",
    component: MyResultsView,
    meta: { requiresAuth: true },
  },
  {
    path: "/admin/user-roles",
    component: AdminUserRolesView,
    meta: { requiresAuth: true },
  },
  {
    path: "/admin/user-management",
    component: UserManagementView,
    meta: { requiresAuth: true }
  },
  {
    path: "/admin/announcements",
    component: AnnouncementsView,
    meta: { requiresAuth: true }
  },
  {
    path: "/teachertab/teacher-answer-key",
    component: TeacherAnswerKeyView,
    meta: { requiresAuth: true }
  },
  {
    path: "/teachertab/teacher-students",
    component: TeacherStudentsView,
    meta: { requiresAuth: true }
  },
  {
    path: "/student/quiz/:id",
    name: "StudentQuiz",
    component: StudentView,
    // Note: This is a public route (no requiresAuth) for student quiz access
  },
  {
    path: "/forbidden",
    component: ForbiddenView,
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: NotFound,
  },
]);

/**
 * Create and configure the router instance
 */
export const createAppRouter = () => {
  return createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
  });
};
