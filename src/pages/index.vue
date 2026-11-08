<script lang="ts" setup>
  import { onMounted } from 'vue'
  import { useLandingController } from '@/controller/landingController'
  import OuterLayoutWrapper from '@/layouts/OuterLayoutWrapper.vue'
  import { useDisplay } from 'vuetify'

  const { data, loading, error, fetchLandingData } = useLandingController()
  const { mobile } = useDisplay()

  onMounted(async () => {
    await fetchLandingData()
  })

  function scrollToFeatures () {
    const element = document.querySelector('#features')
    if (element) {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
  }

  function openGithub () {
    window.open('https://github.com', '_blank', 'noopener,noreferrer')
  }

  function openDocumentation () {
    window.open('https://vuetifyjs.com/', '_blank', 'noopener,noreferrer')
  }

  function formatDate (dateString: string) {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
</script>

<template>
  <OuterLayoutWrapper>
    <template #content>
      <div class="landing-view">
        <!-- Loading State -->
        <v-container
          v-if="loading"
          class="d-flex justify-center align-center"
          style="min-height: 50vh"
        >
          <v-progress-circular color="primary" indeterminate size="64" />
        </v-container>

        <!-- Error State -->
        <v-container
          v-else-if="error"
          class="d-flex justify-center align-center"
          style="min-height: 50vh"
        >
          <v-alert
            color="error"
            icon="mdi-alert-circle"
            type="error"
            variant="tonal"
          >
            <v-alert-title>Failed to load content</v-alert-title>
            {{ error }}
          </v-alert>
        </v-container>

        <!-- Content -->
        <div v-else-if="data">
          <!-- Hero Section -->
          <section class="hero-section">
            <div class="hero-container" :class="{ 'mobile-layout': mobile }">
              <div class="hero-wrapper" :class="{ 'mobile-wrapper': mobile }">
                <!-- Mobile Layout: Content only, no image -->
                <template v-if="mobile">
                  <!-- Content Side (Centered on mobile) -->
                  <div class="hero-content-side mobile-content">
                    <div class="hero-content mobile-content-inner">
                      <h1 class="hero-title mobile-title">
                        {{ data.title }}
                      </h1>

                      <h2 class="hero-subtitle mobile-subtitle">
                        {{ data.subtitle }}
                      </h2>

                      <p class="hero-description mobile-description">
                        {{ data.description }}
                      </p>

                      <div class="hero-buttons mobile-buttons">
                        <v-btn
                          class="text-none hero-btn-primary"
                          color="primary"
                          size="large"
                          variant="elevated"
                          block
                          @click="scrollToFeatures"
                        >
                          <v-icon class="me-2" icon="mdi-rocket-launch" />
                          Explore Features
                        </v-btn>

                        <v-btn
                          class="text-none hero-btn-secondary"
                          color="white"
                          size="large"
                          variant="outlined"
                          block
                          @click="openGithub"
                        >
                          <v-icon class="me-2" icon="mdi-github" />
                          View Source
                        </v-btn>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- Desktop Layout: Content left, image right -->
                <template v-else>
                  <!-- Content Side (Left) -->
                  <div class="hero-content-side">
                    <div class="hero-content">
                      <h1 class="hero-title">
                        {{ data.title }}
                      </h1>

                      <h2 class="hero-subtitle">
                        {{ data.subtitle }}
                      </h2>

                      <p class="hero-description">
                        {{ data.description }}
                      </p>

                      <div class="hero-buttons">
                        <v-btn
                          class="text-none hero-btn-primary"
                          color="primary"
                          size="large"
                          variant="elevated"
                          @click="scrollToFeatures"
                        >
                          <v-icon class="me-2" icon="mdi-rocket-launch" />
                          Explore Features
                        </v-btn>

                        <v-btn
                          class="text-none hero-btn-secondary"
                          color="white"
                          size="large"
                          variant="outlined"
                          @click="openGithub"
                        >
                          <v-icon class="me-2" icon="mdi-github" />
                          View Source
                        </v-btn>
                      </div>
                    </div>
                  </div>

                  <!-- Image Side (Right) -->
                  <div class="hero-image-side">
                    <div class="hero-image-container">
                      <v-img
                        src="/assets/hero.webp"
                        alt="CSU-SmartScore Professional"
                        class="hero-image"
                        cover
                      />
                    </div>
                  </div>

                  <!-- Diagonal Overlay -->
                  <div class="hero-diagonal-overlay"></div>
                </template>
              </div>
            </div>
          </section>

          <!-- Features and About Section -->
          <section id="features" class="features-about-section py-16">
            <v-container fluid>
              <!-- Section Header -->
              <div class="text-center mb-12">
                <h2 class="text-h2 font-weight-bold mb-6">
                  <span class="gradient-text">Discover</span> What Makes Us Different
                </h2>
                <p class="text-h6 text-grey-darken-1 max-width-800 mx-auto">
                  Advanced AI technology meets educational excellence in our comprehensive platform
                </p>
              </div>

              <!-- Creative Grid Layout -->
              <v-row class="creative-grid align-stretch" no-gutters>
                <!-- Large About Card - Left Side -->
                <v-col cols="12" lg="6" md="6" id="about" class="pa-3">
                  <v-card
                    class="about-hero-card h-100 position-relative overflow-hidden d-flex flex-column"
                    elevation="8"
                    hover
                  >
                    <!-- Background Pattern -->
                    <div class="card-bg-pattern"></div>

                    <v-card-text class="pa-8 position-relative flex-grow-1 d-flex flex-column">
                      <div class="d-flex align-center mb-6">
                        <v-avatar class="me-4" color="primary" size="64">
                          <v-icon color="on-primary" icon="mdi-brain" size="32" />
                        </v-avatar>
                        <div>
                          <h3 class="text-h4 font-weight-bold">
                            CSU-SmartScore
                          </h3>
                          <p class="text-subtitle-1 text-primary font-weight-medium mb-0">
                            AI-Powered Education Revolution
                          </p>
                        </div>
                      </div>

                      <p class="text-body-1  mb-6 line-height-1-8 flex-grow-1">
                        CSU-SmartScore transforms the traditional grading process by leveraging advanced
                        artificial intelligence to analyze handwritten quiz answers. Our system provides
                        instant, accurate feedback to students while empowering teachers with powerful
                        oversight and analytics tools.
                      </p>

                      <div class="info-grid mb-6">
                        <div class="info-item">
                          <v-icon class="info-icon" color="success" icon="mdi-check-circle" />
                          <div class="info-content">
                            <span class="info-label">Version</span>
                            <span class="info-value">{{ data.version }}</span>
                          </div>
                        </div>
                        <div class="info-item">
                          <v-icon class="info-icon" color="info" icon="mdi-account-group" />
                          <div class="info-content">
                            <span class="info-label">Developed by</span>
                            <span class="info-value">{{ data.author }}</span>
                          </div>
                        </div>
                        <div class="info-item">
                          <v-icon class="info-icon" color="warning" icon="mdi-calendar-clock" />
                          <div class="info-content">
                            <span class="info-label">Last updated</span>
                            <span class="info-value">{{ formatDate(data.lastUpdated) }}</span>
                          </div>
                        </div>
                      </div>


                    </v-card-text>
                  </v-card>
                </v-col>

                <!-- Features Grid - Right Side -->
                <v-col cols="12" lg="6" md="6" class="pa-3">
                  <div class="features-container h-100 d-flex flex-column">


                    <!-- Even Feature Grid -->
                    <div class="feature-grid flex-grow-1">
                      <v-card
                        v-for="(feature, index) in data.features"
                        :key="index"
                        class="feature-card h-100"
                        :class="`feature-card-${index}`"
                        elevation="4"
                        hover
                      >
                        <v-card-text class="pa-6 text-center h-100 d-flex flex-column">
                          <v-avatar class="mb-4" color="primary" size="56">
                            <v-icon color="on-primary" :icon="feature.icon" size="28" />
                          </v-avatar>
                          <h4 class="text-h6 font-weight-bold mb-3">
                            {{ feature.title }}
                          </h4>
                          <p class="text-body-2  flex-grow-1 d-flex align-center">
                            {{ feature.description }}
                          </p>
                        </v-card-text>
                      </v-card>
                    </div>
                  </div>
                </v-col>
              </v-row>
            </v-container>
          </section>
					<div class="mt-5">
						<div style="height: 35vh;"></div>
					</div>
        </div>
      </div>
    </template>
  </OuterLayoutWrapper>
</template>

