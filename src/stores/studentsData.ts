import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { supabase } from '@/lib/supabase';

/**
 * Interface for Student data
 */
export interface Student {
    id?: number;
    created_at?: string;
    fullname: string; // Required, cannot be null
    score: number | null;
    remarks: string | null;
    answer_key_id: number | null;
    image_url: string | null;
    answers: any | null; // JSONB data
    student_id: string; // Required, cannot be null
}

/**
 * Interface for creating student data
 */
export interface StudentInput {
    fullname: string; // Required for creation
    score?: number | null;
    remarks?: string | null;
    answer_key_id: number; // Required for creation
    image_url?: string | null;
    answers?: any | null;
    student_id: string; // Required for creation
}

/**
 * Interface for updating student data (partial updates allowed)
 */
export interface StudentUpdateInput {
    fullname?: string;
    score?: number | null;
    remarks?: string | null;
    answer_key_id?: number;
    image_url?: string | null;
    answers?: any | null;
    student_id?: string;
}

/**
 * Pinia Store for managing students data
 * This store handles all CRUD operations for students
 */
export const useStudentsStore = defineStore('studentsData', () => {
    // State
    const students = ref<Student[]>([]);
    const currentStudent = ref<Student | null>(null);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // Computed
    const studentCount = computed(() => students.value.length);

    const studentsByAnswerKey = computed(() => (answerKeyId: number) =>
        students.value.filter(student => student.answer_key_id === answerKeyId)
    );

    const averageScore = computed(() => {
        const validScores = students.value
            .map(student => student.score)
            .filter((score): score is number => score !== null && score !== undefined);

        if (validScores.length === 0) return 0;
        return validScores.reduce((sum, score) => sum + score, 0) / validScores.length;
    });

    const topPerformers = computed(() =>
        students.value
            .filter(student => student.score !== null)
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, 10)
    );

    /**
     * Fetch all students
     */
    const fetchStudents = async () => {
        loading.value = true;
        error.value = null;

        try {
            const { data, error: fetchError } = await supabase
                .from('students')
                .select('*')
                .order('created_at', { ascending: false });

            if (fetchError) throw fetchError;

            students.value = data || [];
            return { data, error: null };
        } catch (err) {
            error.value = err instanceof Error ? err.message : 'Failed to fetch students';
            return { data: null, error: error.value };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Fetch students by answer key ID
     */
    const fetchStudentsByAnswerKey = async (answerKeyId: number) => {
        loading.value = true;
        error.value = null;

        try {
            const { data, error: fetchError } = await supabase
                .from('students')
                .select('*')
                .eq('answer_key_id', answerKeyId)
                .order('score', { ascending: false });

            if (fetchError) throw fetchError;

            return { data: data || [], error: null };
        } catch (err) {
            error.value = err instanceof Error ? err.message : 'Failed to fetch students for answer key';
            return { data: null, error: error.value };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Search student records by exact student id and/or full name (public RPC)
     */
    const searchStudentRecords = async (
        answerKeyId: number,
        studentId: string,
        fullname: string,
    ) => {
        loading.value = true;
        error.value = null;

        try {
            const { data, error: searchError } = await supabase.rpc('search_student_records', {
                p_answer_key_id: answerKeyId,
                p_student_id: studentId.trim(),
                p_fullname: fullname.trim(),
            });

            if (searchError) throw searchError;

            return { data: (data || []) as Student[], error: null };
        } catch (err) {
            error.value = err instanceof Error ? err.message : 'Failed to search student records';
            return { data: null, error: error.value };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Fetch a single student by ID
     */
    const fetchStudentById = async (id: number) => {
        loading.value = true;
        error.value = null;

        try {
            const { data, error: fetchError } = await supabase
                .from('students')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchError) throw fetchError;

            currentStudent.value = data;
            return { data, error: null };
        } catch (err) {
            error.value = err instanceof Error ? err.message : 'Failed to fetch student';
            return { data: null, error: error.value };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Create a new student record
     */
    const createStudent = async (studentData: StudentInput) => {
        loading.value = true;
        error.value = null;

        try {
            const { data, error: createError } = await supabase
                .from('students')
                .insert([studentData])
                .select()
                .single();

            if (createError) throw createError;

            if (data) {
                students.value.unshift(data);
                currentStudent.value = data;
            }

            return { data, error: null };
        } catch (err) {
            error.value = err instanceof Error ? err.message : 'Failed to create student';
            return { data: null, error: error.value };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Update an existing student
     */
    const updateStudent = async (id: number, studentData: StudentUpdateInput) => {
        loading.value = true;
        error.value = null;

        try {
            const { data, error: updateError } = await supabase
                .from('students')
                .update(studentData)
                .eq('id', id)
                .select()
                .single();

            if (updateError) throw updateError;

            if (data) {
                const index = students.value.findIndex(student => student.id === id);
                if (index !== -1) {
                    students.value[index] = data;
                }
                if (currentStudent.value?.id === id) {
                    currentStudent.value = data;
                }
            }

            return { data, error: null };
        } catch (err) {
            error.value = err instanceof Error ? err.message : 'Failed to update student';
            return { data: null, error: error.value };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Delete a student
     */
    const deleteStudent = async (id: number) => {
        loading.value = true;
        error.value = null;

        try {
            const { error: deleteError } = await supabase
                .from('students')
                .delete()
                .eq('id', id);

            if (deleteError) throw deleteError;

            students.value = students.value.filter(student => student.id !== id);
            if (currentStudent.value?.id === id) {
                currentStudent.value = null;
            }

            return { error: null };
        } catch (err) {
            error.value = err instanceof Error ? err.message : 'Failed to delete student';
            return { error: error.value };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Bulk create students (useful for batch submissions)
     */
    const createStudentsBulk = async (studentsData: StudentInput[]) => {
        loading.value = true;
        error.value = null;

        try {
            const { data, error: createError } = await supabase
                .from('students')
                .insert(studentsData)
                .select();

            if (createError) throw createError;

            if (data) {
                students.value.unshift(...data);
            }

            return { data, error: null };
        } catch (err) {
            error.value = err instanceof Error ? err.message : 'Failed to create students in bulk';
            return { data: null, error: error.value };
        } finally {
            loading.value = false;
        }
    };

    /**
     * Update student score and remarks
     */
    const updateStudentScore = async (id: number, score: number, remarks?: string) => {
        return await updateStudent(id, { score, remarks });
    };

    /**
     * Get statistics for a specific answer key
     */
    const getAnswerKeyStatistics = async (answerKeyId: number) => {
        const { data, error } = await fetchStudentsByAnswerKey(answerKeyId);

        if (error || !data) {
            return { error };
        }

        const validScores = data
            .map(student => student.score)
            .filter((score): score is number => score !== null && score !== undefined);

        const statistics = {
            totalStudents: data.length,
            gradedStudents: validScores.length,
            averageScore: validScores.length > 0 ?
                validScores.reduce((sum, score) => sum + score, 0) / validScores.length : 0,
            highestScore: validScores.length > 0 ? Math.max(...validScores) : 0,
            lowestScore: validScores.length > 0 ? Math.min(...validScores) : 0,
            passRate: validScores.length > 0 ?
                validScores.filter(score => score >= 75).length / validScores.length * 100 : 0
        };

        return { data: statistics, error: null };
    };

    /**
     * Clear all state
     */
    const clearState = () => {
        students.value = [];
        currentStudent.value = null;
        error.value = null;
    };

    /**
     * Set current student
     */
    const setCurrentStudent = (student: Student | null) => {
        currentStudent.value = student;
    };

    return {
        // State
        students,
        currentStudent,
        loading,
        error,

        // Computed
        studentCount,
        studentsByAnswerKey,
        averageScore,
        topPerformers,

        // Actions
        fetchStudents,
        fetchStudentsByAnswerKey,
        searchStudentRecords,
        fetchStudentById,
        createStudent,
        updateStudent,
        deleteStudent,
        createStudentsBulk,
        updateStudentScore,
        getAnswerKeyStatistics,
        clearState,
        setCurrentStudent,
    };
});
