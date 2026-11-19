# CSU-SmartScore - AI-Powered Quiz Scoring System

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/JFMPatula/CSU_Thesis_Smart_Score)

CSU-SmartScore automates handwritten quiz scoring. Students upload or photograph an answer sheet, AI extracts and grades the answers, and teachers review, override, and release feedback when ready.

## Features

- Student quiz flow with access-code protection, camera/upload input, answer review, and rate-limited submission.
- Teacher answer-key creation, student submission review, manual answer override, submission deletion, and claim re-link/reset controls.
- Feedback release gating: scores, correct answers, and AI explanations stay hidden until a teacher releases them.
- Role-based access to teacher and admin tools.
- Supabase Auth, database, storage, and serverless API endpoints.

## Tech stack

- Vue 3, TypeScript, Vuetify 3, Vite, Pinia
- Supabase Auth, Postgres, Storage, RLS
- Vercel serverless functions
- Groq/Gemini vision services with local Tesseract fallback

## Quick start

```bash
git clone https://github.com/JFMPatula/CSU_Thesis_Smart_Score.git
cd CSU_Thesis_Smart_Score
npm install
npm run dev
```

Configure the app through `public/data/external-page.json` and environment variables for Supabase, AI providers, and Upstash rate limiting.

## Database setup

Apply migrations in order:

```bash
supabase/migrations/20260910000000_initial_schema.sql
supabase/migrations/20260910000001_allow_anon_read_roles.sql
supabase/migrations/20260910000002_remove_student_role.sql
supabase/migrations/20260910000003_restore_student_role.sql
supabase/migrations/20261109000000_security_hardening.sql
supabase/migrations/20261110000000_fixes.sql
supabase/migrations/20261110000001_pending_approval.sql
supabase/migrations/20261110000002_student_result_linking.sql
supabase/migrations/20261111000000_search_fix.sql
supabase/migrations/20261111000001_cleanup.sql
supabase/migrations/20261115000000_quiz_feedback_and_claims.sql
supabase/migrations/20261119000000_teacher_access_and_security_fixes.sql
```

After applying migrations, log out and back in so role/page permissions are refreshed.

Teacher and admin accounts are created or promoted by an administrator; self-registration only creates student accounts.

## Useful commands

```bash
npm run dev
npm run type-check
npm run build
npm run lint:check
```

## License

This project is open source and available under the [MIT License](LICENSE).

[Report Bug](https://github.com/JFMPatula/CSU_Thesis_Smart_Score/issues) · [Request Feature](https://github.com/JFMPatula/CSU_Thesis_Smart_Score/issues) · [Discussions](https://github.com/JFMPatula/CSU_Thesis_Smart_Score/discussions)
