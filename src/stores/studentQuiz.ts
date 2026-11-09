import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useAnswerKeysStore } from './answerKeysData';
import type { AnswerKey } from './answerKeysData';

/**
 * Interface for student answer
 */
interface StudentAnswer {
    questionNumber: number;
    selectedAnswer: string;
    confidence: number;
    alternatives?: string[];
    isManuallyEdited?: boolean;
}

/**
 * Pinia Store for student quiz functionality
 * This store manages the student's interaction with quizzes
 */
export const useStudentQuizStore = defineStore('studentQuiz', () => {
    // Store references
    const answerKeysStore = useAnswerKeysStore();

    // State
    const currentQuiz = ref<AnswerKey | null>(null);
    const scannedAnswers = ref<any[]>([]);
    const isSubmitting = ref(false);
    const submissionResult = ref<{ success: boolean; message: string } | null>(null);

    // Computed
    const isQuizLoaded = computed(() => currentQuiz.value !== null);
    const isQuizActive = computed(() => currentQuiz.value?.is_active || false);
    const canSubmitAnswers = computed(() =>
        isQuizLoaded.value &&
        isQuizActive.value &&
        !isSubmitting.value &&
        scannedAnswers.value.length > 0
    );

    /**
     * Load a quiz by ID for student view
     */
    const loadQuiz = async (quizId: string) => {
        const { data, error } = await answerKeysStore.fetchPublicAnswerKeyById(quizId);

        if (data && !error) {
            currentQuiz.value = data;
            // Clear previous state when loading new quiz
            scannedAnswers.value = [];
            submissionResult.value = null;
        }

        return { data, error };
    };

    /**
     * Clear current quiz state
     */
    const clearQuiz = () => {
        currentQuiz.value = null;
        scannedAnswers.value = [];
        submissionResult.value = null;
        isSubmitting.value = false;
    };

    /**
     * Add scanned answer data
     */
    const addScannedAnswers = (answers: any[]) => {
        scannedAnswers.value = [...answers];
    };

    /**
     * Submit scanned answers
     * TODO: Implement submission logic
     */
    const submitAnswers = async () => {
        if (!canSubmitAnswers.value) {
            return { success: false, message: 'Cannot submit answers at this time' };
        }

        isSubmitting.value = true;

        try {
            // TODO: Implement actual submission to backend
            // This would involve processing scanned answers, grading, etc.

            // Simulated submission for now
            await new Promise(resolve => setTimeout(resolve, 2000));

            submissionResult.value = {
                success: true,
                message: 'Answers submitted successfully!'
            };

            return submissionResult.value;
        } catch (error) {
            submissionResult.value = {
                success: false,
                message: 'Failed to submit answers. Please try again.'
            };

            return submissionResult.value;
        } finally {
            isSubmitting.value = false;
        }
    };

    /**
     * Grade and persist a student submission on the server.
     * The correct answers never reach the browser.
     */
    const gradeStudentSubmission = async (
        studentAnswers: StudentAnswer[],
        answerKeyId: number,
        student: { fullname: string; student_id: string; imageUrl?: string | null }
    ) => {
        const response = await fetch('/api/grade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quizId: answerKeyId,
                studentId: student.student_id,
                fullname: student.fullname,
                answers: studentAnswers,
                imageUrl: student.imageUrl ?? null,
            }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error || `Grading failed (${response.status})`);
        }

        return payload;
    };

    /**
     * Get quiz info for display
     */
    const getQuizDisplayInfo = () => {
        if (!currentQuiz.value) return null;

        return {
            id: currentQuiz.value.id,
            title: currentQuiz.value.title,
            description: currentQuiz.value.description,
            isActive: currentQuiz.value.is_active,
            qrLink: currentQuiz.value.qr_link,
            answerImageUrl: currentQuiz.value.answer_images
        };
    };

    return {
        // State
        currentQuiz,
        scannedAnswers,
        isSubmitting,
        submissionResult,

        // Computed
        isQuizLoaded,
        isQuizActive,
        canSubmitAnswers,

        // Actions
        loadQuiz,
        clearQuiz,
        addScannedAnswers,
        submitAnswers,
        getQuizDisplayInfo,
        gradeStudentSubmission,
    };
});
