<script setup lang="ts">
import { computed, ref } from "vue";
import { useAuthUserStore } from "@/stores/authUser";
import { useToast } from "vue-toastification";
import { storeToRefs } from "pinia";
import InnerLayoutWrapper from "@/layouts/InnerLayoutWrapper.vue";
import HomeLogs from "@/pages/hometab/HomeLogs.vue";
import HomeAnnouncements from "@/pages/hometab/HomeAnnouncements.vue";
import QuizesListWidget from "@/pages/teachertab/components/QuizesListWIdget.vue";
import GraphWidget from "@/pages/teachertab/components/GraphWidget.vue";
import TabFolder from "@/pages/teachertab/dialogs/home/TabFolder.vue";

const authStore = useAuthUserStore();
const toast = useToast();

// Reactive references from the auth store
const { userName, loading } = storeToRefs(authStore);

// Tab folder visibility control
const showTabFolder = ref(true);

// Check if user is a teacher (role ID 2)
const isTeacher = computed(() => {
  return authStore.userData?.role_id === 2;
});

const handleLogout = async () => {
  try {
    const result = await authStore.signOut();

    if (result.error) {
      toast.error("Logout failed: " + result.error.message);
    } else {
      toast.success("You have been logged out successfully");
    }
  } catch (error) {
    console.error("Logout error:", error);
    toast.error("An unexpected error occurred during logout");
  }
};

// Toggle tab folder visibility
const toggleTabFolder = () => {
  showTabFolder.value = !showTabFolder.value;
};
</script>

<template>
  <InnerLayoutWrapper>
    <template #content>
      <v-container fluid class="pa-0">
          <!-- Announcements Carousel Section -->
          <section class="announcements-section mb-8">
            <v-container>
              <HomeAnnouncements />
            </v-container>
          </section>
        <v-divider class="mx-4 mb-8" />

        <!-- Score Analytics Section -->
        <section class="analytics-section mb-8">
          <v-container>
            <GraphWidget />
          </v-container>
        </section>
        <!-- Divider -->
        <v-divider class="mx-4 mb-8" />

        <!-- Quiz Overview Section -->
        <section class="quiz-section mb-8">
          <v-container>
            <QuizesListWidget />
          </v-container>
        </section>

        <!-- Divider -->

        <!-- Divider -->
        <v-divider class="mx-4 mb-8" />

        <!-- Logs Section -->
        <section class="logs-section">
          <v-container fluid class="px-2 px-sm-4 px-md-6">
            <v-row justify="center" align="center" no-gutters>
              <v-col cols="12" sm="12" md="10" lg="8" xl="6">
                <HomeLogs />
              </v-col>
            </v-row>
          </v-container>
        </section>
        </v-container>
    </template>
  </InnerLayoutWrapper>

  <!-- Tab Folder Navigation (positioned outside layout for fixed positioning) -->
  <TabFolder
    v-if="showTabFolder"
    @toggle-visibility="toggleTabFolder"
  />
</template>
