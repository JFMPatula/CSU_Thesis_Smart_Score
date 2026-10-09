<script setup lang="ts">
import { onMounted, onUnmounted, computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useToast } from "vue-toastification";
import { useDisplay } from "vuetify";
import { useStudentQuizStore } from "@/stores/studentQuiz";
import { useAnswerProcessor } from "./composables/processAnswer";
import { useStudentsStore } from "@/stores/studentsData";
import { uploadImageToStorage } from "@/utils/imageUpload";
import OuterLayoutWrapper from "@/layouts/OuterLayoutWrapper.vue";
import UploadImageDialog from "./dialogs/UploadImageDialog.vue";
import CameraDialog from "./dialogs/CameraDialog.vue";
import RemindersDialog from "./dialogs/RemindersDialog.vue";
import EditAnswersDialog from "./dialogs/EditAnswersDialog.vue";
import ScoreResultDialog from "./dialogs/ScoreResultDialog.vue";
import SearchResultDialog from "./dialogs/SearchResultDialog.vue";

const route = useRoute();
const toast = useToast();
const studentQuizStore = useStudentQuizStore();
const studentsStore = useStudentsStore();
const answerProcessor = useAnswerProcessor();

// Vuetify display helpers (responsive)
const { mobile } = useDisplay();
const isMobile = computed(() => mobile.value);

// State
const showUploadDialog = ref(false);
const showCameraDialog = ref(false);
const showRemindersDialog = ref(false);
const showEditAnswersDialog = ref(false);
const showScoreResultDialog = ref(false);
const showSearchResultDialog = ref(false);
const processingResults = ref<any>(null);
const submittedImage = ref<File | Blob | null>(null);
const scoreResults = ref<any>(null);
const submissionData = ref<any>(null);
const quizNotFound = ref(false);

// Which dialog should open after the reminders are acknowledged
const remindersNext = ref<'upload' | 'camera'>('upload');

// Computed properties
const quizId = computed(() => {
  const params = route.params as { id?: string };
  return params.id || "";
});

const quizInfo = computed(() => studentQuizStore.getQuizDisplayInfo());
const quizTitle = computed(() => quizInfo.value?.title || "Quiz Not Found");
const quizDescription = computed(
  () => quizInfo.value?.description || "No description available.",
);
const isQuizActive = computed(() => quizInfo.value?.isActive || false);
const isQuizLoaded = computed(() => studentQuizStore.isQuizLoaded);
const loading = computed(
  () => !isQuizLoaded.value && !quizNotFound.value && quizId.value !== "",
);

/**
 * Fetch quiz information based on the route parameter
 */
const fetchQuizInfo = async () => {
  if (!quizId.value) {
    console.error("Invalid quiz ID");
    quizNotFound.value = true;
    return;
  }

  try {
    const { data, error } = await studentQuizStore.loadQuiz(quizId.value);

    if (error || !data) {
      console.error("Quiz not found:", error);
      quizNotFound.value = true;
      return;
    }

    if (!data.is_active) {
      console.warn("This quiz is currently inactive");
    }
  } catch (error) {
    console.error("Error:", error);
    quizNotFound.value = true;
  }
};

/**
 * Open camera dialog
 */
const openCameraDialog = () => {
  remindersNext.value = 'camera';
  showRemindersDialog.value = true;
};

/**
 * Open upload dialog
 */
const openUploadDialog = () => {
  remindersNext.value = 'upload';
  showRemindersDialog.value = true;
};

const handleProceedAfterReminders = () => {
  if (remindersNext.value === 'camera') {
    showCameraDialog.value = true;
  } else {
    showUploadDialog.value = true;
  }
};

/**
 * Open search result dialog
 */
const openSearchDialog = () => {
  showSearchResultDialog.value = true;
};

/**
 * Handle image submission from dialog
 */
const handleImageSubmit = async (image: File | Blob) => {
  try {
    console.log("📷 Processing image for quiz:", quizId.value);
    submittedImage.value = image;

    // Close the current dialogs
    showUploadDialog.value = false;
    showCameraDialog.value = false;
  showRemindersDialog.value = false;

    console.log("🔄 Processing answer sheet...");

    const answerKeyData = studentQuizStore.currentQuiz;
    const result = await answerProcessor.processAnswerSheet(
      image,
      answerKeyData,
      false, // Set to true if you want streaming
    );

    processingResults.value = result;

    // Open the edit answers dialog
    showEditAnswersDialog.value = true;
  } catch (error) {
    console.error("Error processing answer sheet:", error);
    toast.error("Failed to process answer sheet. Please try again.");
  }
};

/**
 * Handle final submission of edited answers
 */
const handleAnswersSubmit = async (finalAnswers: any) => {
  try {
    if (!quizId.value || !submittedImage.value) {
      console.error("Missing required data for submission");
      return;
    }

    console.log("📤 Submitting answers...");

    // Upload image to storage first
    let imageUrl = null;
    try {
      imageUrl = await uploadImageToStorage(submittedImage.value);
      console.log("✅ Image uploaded successfully");
    } catch (uploadError) {
      console.warn("Image upload failed:", uploadError);
    }

    // Grade the student answers by comparing with answer key using AI synonym checking
    console.log("🧮 Grading student submission with AI synonym checking...");
    const gradedAt = performance.now();
    const gradingResult = {
      ...(await studentQuizStore.gradeStudentSubmission(
        finalAnswers.answers,
        parseInt(quizId.value),
      )),
      checkingTimeMs: Math.round(performance.now() - gradedAt),
    };

    console.log("📊 Grading Result:", gradingResult);

    // Prepare student data
    const studentData = {
      fullname: finalAnswers.studentName,
      student_id: finalAnswers.studentId,
      answer_key_id: parseInt(quizId.value),
      answers: finalAnswers.answers,
      image_url: imageUrl,
      score: gradingResult.score,
      remarks: gradingResult.remarks,
    };

    console.log("💾 Saving student data:", studentData);

    // Save to database
    const { data, error } = await studentsStore.createStudent(studentData);

    if (error) {
      throw new Error(error);
    }

    console.log("✅ Student data saved successfully");

    // Store results and show score dialog
    scoreResults.value = gradingResult;
    submissionData.value = finalAnswers;

    // Clear processing state
    processingResults.value = null;
    submittedImage.value = null;
    showEditAnswersDialog.value = false;

    // Show score results
    showScoreResultDialog.value = true;
  } catch (error) {
    console.error("Error submitting answers:", error);
    // Keep one toast for critical errors
    toast.error("Failed to submit answers. Please try again.");
  }
};

// Lifecycle
onMounted(() => {
  fetchQuizInfo();
});

onUnmounted(() => {
  // Cleanup answer processor resources
  answerProcessor.cleanup();
});
</script>

<template>
  <OuterLayoutWrapper>
    <template #content>
      <v-container
  fluid
  style="min-height: 100dvh"
  :class="isMobile ? 'pa-3' : 'pa-4'"
      >
        <v-row justify="center">
          <v-col cols="12" md="8" lg="6">
            <!-- Spacer so content doesn't hide behind the fixed app-bar, but also doesn't waste too much on mobile -->
            <div :style="{ marginTop: isMobile ? '72px' : '96px' }"></div>
            <!-- Image at the top -->
            <div class="text-center" :class="isMobile ? 'my-3' : 'my-5'">
              <v-img
                src="/assets/logo.svg"
                alt="Quiz Icon"
                :max-width="isMobile ? 90 : 120"
                class="mx-auto"
              />
            </div>

            <!-- Quiz Info Header -->
            <v-card-title
              class="text-center mb-3"
              :class="isMobile ? 'text-h6' : 'text-h5'"
            >
              {{ quizTitle }}
            </v-card-title>

            <v-card-text
              class="text-center text-body-2 text-medium-emphasis mb-6"
            >
              {{ quizDescription }}
            </v-card-text>

            <!-- Action Buttons Section -->
            <div class="text-center">
              <p class="text-body-2 text-medium-emphasis mb-4">
                Choose how to submit your answer:
              </p>

              <v-row :class="isMobile ? 'mb-2' : 'mb-4'" justify="center">
                <!-- Camera Button -->
                <v-col cols="12" sm="4">
                  <v-btn
                    :size="isMobile ? 'default' : 'large'"
                    color="primary"
                    variant="flat"
                    @click="openCameraDialog"
                    :disabled="!isQuizActive"
                    block
                    :height="isMobile ? 52 : 60"
                  >
                    <v-icon left>mdi-camera</v-icon>
                    Use Camera
                  </v-btn>
                </v-col>

                <!-- Upload Image Button -->
                <v-col cols="12" sm="4">
                  <v-btn
                    :size="isMobile ? 'default' : 'large'"
                    color="primary"
                    variant="outlined"
                    @click="openUploadDialog"
                    :disabled="!isQuizActive"
                    block
                    :height="isMobile ? 52 : 60"
                  >
                    <v-icon left>mdi-upload</v-icon>
                    Upload Image
                  </v-btn>
                </v-col>

                <!-- View Record Button -->
                <v-col cols="12" sm="4">
                  <v-btn
                    :size="isMobile ? 'default' : 'large'"
                    color="info"
                    variant="tonal"
                    @click="openSearchDialog"
                    block
                    :height="isMobile ? 52 : 60"
                  >
                    <v-icon left>mdi-account-search</v-icon>
                    View Record
                  </v-btn>
                </v-col>
              </v-row>

              <!-- Status Messages -->
              <v-alert
                v-if="quizNotFound"
                type="error"
                variant="tonal"
                density="compact"
                class="mt-4"
              >
                Quiz not found. Please check your link or QR code.
              </v-alert>

              <v-alert
                v-else-if="!quizId"
                type="error"
                variant="tonal"
                density="compact"
                class="mt-4"
              >
                Invalid quiz ID
              </v-alert>

              <v-alert
                v-else-if="!isQuizActive"
                type="info"
                variant="tonal"
                density="compact"
                class="mt-4"
              >
                This quiz is currently inactive. You can still view your
                previous submissions and see correct answers with AI
                explanations.
              </v-alert>
            </div>

            <!-- Extra breathing room above footer (on top of container paddingBottom) -->
            <div :style="{ height: isMobile ? '12px' : '24px' }"></div>
          </v-col>
        </v-row>

        <!-- Loading Overlay -->
        <v-overlay
          :model-value="loading"
          class="align-center justify-center"
          persistent
        >
          <v-progress-circular indeterminate size="48" color="primary" />
          <div class="mt-3 text-center">
            <p class="text-body-1">Loading...</p>
          </div>
        </v-overlay>

        <!-- Processing Overlay -->
        <v-overlay
          :model-value="answerProcessor.isProcessing.value"
          class="align-center justify-center"
          persistent
        >
          <v-card class="pa-6 text-center" min-width="300">
            <v-progress-circular
              :model-value="answerProcessor.progress.value"
              size="80"
              width="8"
              color="primary"
            />
            <div class="mt-4">
              <p class="text-h6 mb-2">Processing Answer Sheet</p>
              <p class="text-body-2 text-medium-emphasis">
                {{ answerProcessor.currentStatus.value }}
              </p>
              <v-progress-linear
                :model-value="answerProcessor.progress.value"
                color="primary"
                height="4"
                rounded
                class="mt-3"
              />
            </div>
          </v-card>
        </v-overlay>

        <!-- Camera Dialog -->
        <RemindersDialog
          v-model="showRemindersDialog"
          :quiz-title="quizTitle"
          @proceed="handleProceedAfterReminders"
        />

        <!-- Camera Dialog -->
        <CameraDialog
          v-model="showCameraDialog"
          :quiz-title="quizTitle"
          @submit="handleImageSubmit"
        />

        <!-- Upload Image Dialog -->
        <UploadImageDialog
          v-model="showUploadDialog"
          :quiz-title="quizTitle"
          @submit="handleImageSubmit"
        />

        <!-- Edit Answers Dialog -->
        <EditAnswersDialog
          v-model="showEditAnswersDialog"
          :quiz-title="quizTitle"
          :extracted-answers="processingResults?.extractedAnswers"
          :answer-key-data="studentQuizStore.currentQuiz"
          @submit="handleAnswersSubmit"
        />

        <!-- Score Result Dialog -->
        <ScoreResultDialog
          v-model="showScoreResultDialog"
          :quiz-title="quizTitle"
          :student-name="submissionData?.studentName"
          :student-id="submissionData?.studentId"
          :quiz-id="quizId"
          :score-data="scoreResults"
          @close="
            () => {
              scoreResults = null;
              submissionData = null;
            }
          "
        />

        <!-- Search Result Dialog -->
        <SearchResultDialog
          v-model="showSearchResultDialog"
          :quiz-title="quizTitle"
          :answer-key-id="parseInt(quizId)"
        />
      </v-container>
    </template>
  </OuterLayoutWrapper>
</template>
